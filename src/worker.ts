/**
 * The Mistral plugin worker.
 *
 * Reads the account budget from Mistral's billing endpoints, keeps a live model
 * catalog with prices, drives the status bar, and injects the API key into the
 * agents Orca launches.
 */
import type { OrcaWorkerApi } from 'orca/worker'
import { groupModels, fallbackModels, type ApiModel, type ModelInfo } from './models'
import { formatMoney, parseOverrides, PRICES_UPDATED, type Price } from './prices'
import type { AccountStatus, BudgetWindow, Protection, SaveKeyResult, Status } from './types'

declare const process: { env: Record<string, string | undefined> }

const DEFAULT_BASE = 'https://api.mistral.ai/v1'
const DEFAULT_ENV = 'MISTRAL_API_KEY'
const SECRET_KEY = 'apiKey'
const BILLING_TTL_MS = 30_000
const MODELS_TTL_MS = 60 * 60_000

type Settings = Record<string, unknown>
type NodeTimer = { unref?: () => void }

class PluginError extends Error {
  code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'PluginError'
    this.code = code
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * The plugin bridge accepts JSON only: no `undefined` members, no NaN or
 * Infinity. Optional fields are dropped rather than sent as undefined.
 */
function jsonSafe<T>(value: T): T {
  if (value === null || typeof value !== 'object') {
    return (typeof value === 'number' && !Number.isFinite(value) ? 0 : value) as T
  }
  if (Array.isArray(value)) return value.map((entry) => jsonSafe(entry)) as T
  const out: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (child === undefined) continue
    out[key] = jsonSafe(child)
  }
  return out as T
}

function str(settings: Settings, key: string, fallback: string): string {
  const value = settings[key]
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : fallback
}

function bool(settings: Settings, key: string, fallback: boolean): boolean {
  const value = settings[key]
  return typeof value === 'boolean' ? value : fallback
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

function nonNegative(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : 0
}

async function readSettings(orca: OrcaWorkerApi): Promise<Settings> {
  return (await orca.settings.get()) as Settings
}

function baseURL(settings: Settings): string {
  const raw = str(settings, 'baseURL', DEFAULT_BASE).replace(/\/+$/, '')
  try {
    const url = new URL(raw)
    return url.protocol === 'http:' || url.protocol === 'https:' ? raw : DEFAULT_BASE
  } catch {
    return DEFAULT_BASE
  }
}

async function apiKey(
  orca: OrcaWorkerApi,
  settings?: Settings
): Promise<{ key: string | null; source: 'secret' | 'env' | 'none' }> {
  try {
    const stored = await orca.secrets.get(SECRET_KEY)
    if (typeof stored === 'string' && stored.trim() !== '') return { key: stored.trim(), source: 'secret' }
  } catch {
    // No secrets capability or no OS key store: fall through to the environment.
  }
  const envName = str(settings ?? (await readSettings(orca)), 'apiKeyEnv', DEFAULT_ENV)
  const value = process.env[envName]
  if (typeof value === 'string' && value.trim() !== '') return { key: value.trim(), source: 'env' }
  return { key: null, source: 'none' }
}

async function protectionOf(orca: OrcaWorkerApi): Promise<Protection> {
  try {
    const result = await orca.host.call('secrets.protection', {})
    return result.status === 'os-keyring' || result.status === 'unavailable' ? result.status : 'unknown'
  } catch {
    return 'unknown'
  }
}

async function apiGet(key: string, base: string, path: string, timeoutMs = 20_000): Promise<unknown> {
  const response = await fetch(`${base}${path}`, {
    headers: {
      authorization: `Bearer ${key}`,
      accept: 'application/json',
      'user-agent': 'orca-mistral/2.0',
    },
    signal: AbortSignal.timeout(timeoutMs),
  })
  const text = await response.text()
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    body = { raw: text }
  }
  if (!response.ok) {
    const detail = typeof body === 'object' && body !== null ? JSON.stringify(body).slice(0, 400) : text.slice(0, 400)
    throw new PluginError('action_failed', `Mistral ${path} failed (${response.status}): ${detail}`)
  }
  return body
}

function recordOf(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim() !== '') return value.trim()
  }
  return undefined
}

function budgetWindow(entry: unknown, id: string, label: string): BudgetWindow | null {
  const row = recordOf(entry)
  if (row === null) return null
  const percentRaw = Number(row.usage_percentage ?? row.usagePercentage)
  const totalRaw = Number(row.initial_budget ?? row.initialBudget ?? row.budget)
  const percent = Number.isFinite(percentRaw) ? clamp(percentRaw, 0, 100) : undefined
  const total = Number.isFinite(totalRaw) && totalRaw > 0 ? totalRaw : undefined
  if (percent === undefined && total === undefined) return null
  const used = percent !== undefined && total !== undefined ? (percent / 100) * total : undefined
  return {
    id,
    label,
    used,
    total,
    percent,
    unit: firstString(row.currency, row.currency_code) ?? 'USD',
    resetsAt: firstString(row.reset_at, row.resetAt),
  }
}

function budgetWindows(budget: unknown): BudgetWindow[] {
  const row = recordOf(budget)
  if (row === null) return []
  const windows: BudgetWindow[] = []
  const vibe = budgetWindow(row.vibe_budget ?? row.vibeBudget, 'vibe', 'Vibe budget')
  const api = budgetWindow(row.api_budget ?? row.apiBudget, 'api', 'API budget')
  if (vibe !== null) windows.push(vibe)
  if (api !== null) windows.push(api)
  if (windows.length === 0) {
    const single = budgetWindow(row, 'budget', 'Monthly budget')
    if (single !== null) windows.push(single)
  }
  return windows
}

async function fetchBilling(key: string, base: string): Promise<AccountStatus> {
  try {
    const [budget, subscription] = await Promise.all([
      apiGet(key, base, '/billing/budget'),
      apiGet(key, base, '/billing/subscription').catch(() => null),
    ])
    const windows = budgetWindows(budget)
    const plan = firstString(recordOf(subscription)?.plan_name, recordOf(subscription)?.plan)
    return {
      ok: true,
      plan,
      currency: windows[0]?.unit ?? 'USD',
      windows,
      fetchedAt: Date.now(),
    }
  } catch (error) {
    return { ok: false, currency: 'USD', windows: [], error: messageOf(error) }
  }
}

async function fetchModels(key: string, base: string, overrides: Record<string, Price>): Promise<ModelInfo[]> {
  const body = recordOf(await apiGet(key, base, '/models'))
  const data = Array.isArray(body?.data) ? (body.data as ApiModel[]) : []
  if (data.length === 0) throw new PluginError('action_failed', 'Mistral returned an empty model list')
  return groupModels(data, overrides)
}

let billingCache: { at: number; key: string; value: AccountStatus } | null = null
let modelsCache: { at: number; key: string; value: ModelInfo[] } | null = null

function invalidate(): void {
  billingCache = null
  modelsCache = null
}

async function status(orca: OrcaWorkerApi, { force = false } = {}): Promise<Status> {
  const settings = await readSettings(orca)
  const overrides = parseOverrides(settings.priceOverrides)
  const base = baseURL(settings)
  const { key, source } = await apiKey(orca, settings)
  const protection = await protectionOf(orca)

  let account: AccountStatus
  let models: ModelInfo[]
  let modelsSource: 'live' | 'bundled' = 'bundled'
  let modelsError: string | undefined

  if (key === null) {
    account = {
      ok: false,
      currency: 'USD',
      windows: [],
      error: `No Mistral API key. Add one in the Account tab or set ${str(settings, 'apiKeyEnv', DEFAULT_ENV)}.`,
    }
    models = fallbackModels(overrides)
  } else {
    const cacheKey = `${key.slice(0, 8)}|${base}`
    if (force || billingCache === null || billingCache.key !== cacheKey || Date.now() - billingCache.at > BILLING_TTL_MS) {
      billingCache = { at: Date.now(), key: cacheKey, value: await fetchBilling(key, base) }
    }
    account = billingCache.value

    if (force || modelsCache === null || modelsCache.key !== cacheKey || Date.now() - modelsCache.at > MODELS_TTL_MS) {
      try {
        modelsCache = { at: Date.now(), key: cacheKey, value: await fetchModels(key, base, overrides) }
      } catch (error) {
        modelsError = messageOf(error)
        modelsCache = null
      }
    }
    if (modelsCache !== null && modelsCache.key === cacheKey) {
      models = modelsCache.value
      modelsSource = 'live'
    } else {
      models = fallbackModels(overrides)
    }
  }

  return {
    configured: key !== null,
    keySource: source,
    protection,
    apiKeyEnv: str(settings, 'apiKeyEnv', DEFAULT_ENV),
    baseURL: base,
    account,
    models,
    modelsSource,
    modelsError,
    pricesUpdated: PRICES_UPDATED,
    fetchedAt: Date.now(),
  }
}

function accountSummary(value: Status): string {
  if (!value.configured) return 'Mistral: no API key configured'
  if (!value.account.ok || value.account.windows.length === 0) {
    return `Mistral: ${value.account.error ?? 'no budget data'}`
  }
  return `Mistral ${value.account.plan ?? 'API'}: ${value.account.windows
    .map((window) => `${window.label} ${formatMoney(window.used ?? 0, window.unit)}/${formatMoney(window.total ?? 0, window.unit)} (${(window.percent ?? 0).toFixed(1)}%)`)
    .join(' · ')}`
}

async function safeStatusBar(orca: OrcaWorkerApi, params: Record<string, unknown>): Promise<void> {
  try {
    await orca.host.call('statusBar.update', params as never)
  } catch {
    // Browser clients and older Orca have no status bar.
  }
}

async function updateStatusBar(orca: OrcaWorkerApi, value: Status): Promise<void> {
  const settings = await readSettings(orca)
  if (!value.configured || bool(settings, 'showStatusBar', true) === false) {
    await safeStatusBar(orca, { id: 'spend', visible: false })
    return
  }
  if (!value.account.ok || value.account.windows.length === 0) {
    await safeStatusBar(orca, {
      id: 'spend',
      text: 'Mistral',
      tone: 'warning',
      tooltip: value.account.error ?? 'Mistral usage unavailable',
      visible: true,
    })
    return
  }
  const worst = [...value.account.windows].sort((a, b) => (b.percent ?? 0) - (a.percent ?? 0))[0]
  const percent = worst.percent ?? 0
  const tone = percent >= 90 ? 'danger' : percent >= 75 ? 'warning' : 'neutral'
  await safeStatusBar(orca, {
    id: 'spend',
    text: `${formatMoney(worst.used ?? 0, worst.unit)} / ${formatMoney(worst.total ?? 0, worst.unit)}`,
    tone,
    tooltip: accountSummary(value),
    visible: true,
  })
}

async function primeStatusBar(orca: OrcaWorkerApi): Promise<void> {
  try {
    const settings = await readSettings(orca)
    const { key } = await apiKey(orca, settings)
    if (key === null || bool(settings, 'showStatusBar', true) === false) {
      await safeStatusBar(orca, { id: 'spend', visible: false })
      return
    }
    await safeStatusBar(orca, {
      id: 'spend',
      text: 'Mistral',
      tone: 'neutral',
      tooltip: 'Mistral: refreshing usage…',
      visible: true,
    })
  } catch {
    // The status bar is a nicety; the panel still works.
  }
}

async function tick(orca: OrcaWorkerApi): Promise<void> {
  try {
    const value = await status(orca)
    await updateStatusBar(orca, value)
    post(orca, 'mistral.updated', { fetchedAt: Date.now() })
  } catch (error) {
    orca.log(`[mistral] refresh failed: ${messageOf(error)}`)
  }
}

function post(orca: OrcaWorkerApi, event: 'mistral.updated', payload: { fetchedAt: number }): void {
  try {
    orca.panels.post(event, payload)
  } catch {
    // No panel is open; nothing to tell.
  }
}

function launchArgsFor(settings: Settings, agent: string): string {
  const raw = settings.launchArgs
  if (typeof raw !== 'string' || raw.trim() === '') return ''
  try {
    const value: unknown = JSON.parse(raw)
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return ''
    const args = (value as Record<string, unknown>)[agent]
    return typeof args === 'string' ? args.trim() : ''
  } catch {
    return ''
  }
}

let pollTimer: NodeTimer | undefined
let firstTimer: NodeTimer | undefined
let stopped = false

function schedule(orca: OrcaWorkerApi): void {
  if (pollTimer !== undefined) clearInterval(pollTimer as unknown as number)
  void (async () => {
    const settings = await readSettings(orca)
    if (stopped) return
    const minutes = clamp(Number(settings.refreshMinutes) || 15, 1, 1440)
    pollTimer = setInterval(() => {
      void tick(orca)
    }, minutes * 60_000) as unknown as NodeTimer
    pollTimer.unref?.()
  })()
}

export default async function activate(orca: OrcaWorkerApi): Promise<void> {
  stopped = false
  orca.panels.handle('mistral.status', async () => jsonSafe(await status(orca)))

  orca.panels.handle('mistral.saveKey', async ({ key }): Promise<SaveKeyResult> => {
    const value = String(key ?? '').trim()
    if (value === '') return { ok: false, error: 'Paste a Mistral API key first.' }
    try {
      await orca.secrets.set(SECRET_KEY, value)
    } catch (error) {
      return {
        ok: false,
        error: `${messageOf(error)} — set ${str(await readSettings(orca), 'apiKeyEnv', DEFAULT_ENV)} in the environment instead, then reopen the panel.`,
      }
    }
    invalidate()
    const next = await status(orca, { force: true })
    await updateStatusBar(orca, next)
    return jsonSafe({ ok: true, status: next })
  })

  orca.panels.handle('mistral.clearKey', async () => {
    try {
      await orca.secrets.delete(SECRET_KEY)
    } catch {
      // Already absent, or secrets are unavailable.
    }
    invalidate()
    const next = await status(orca, { force: true })
    await updateStatusBar(orca, next)
    return jsonSafe(next)
  })

  orca.commands.register('mistral.refresh', async () => {
    const value = await status(orca, { force: true })
    await updateStatusBar(orca, value)
    return accountSummary(value)
  })

  orca.commands.register('mistral.test', async () => {
    const value = await status(orca, { force: true })
    const body = accountSummary(value)
    try {
      await orca.host.call('notifications.show', { title: 'Mistral connection', body })
    } catch {
      // Notifications are optional.
    }
    return body
  })

  orca.hooks.on('agent.launch.before', async (event, next) => {
    const settings = await readSettings(orca)
    let changed = false
    let command = event.command
    const env = { ...event.env }

    const args = launchArgsFor(settings, event.agent)
    if (args !== '') {
      command = `${command} ${args}`
      changed = true
    }

    if (bool(settings, 'injectApiKey', true)) {
      const { key } = await apiKey(orca, settings)
      const agents = str(settings, 'injectAgents', 'pi,dsh,hermes,opencode,opencode2')
        .split(',')
        .map((name) => name.trim())
        .filter((name) => name !== '')
      const allowed = agents.length === 0 || agents.includes(event.agent)
      if (key !== null && allowed && env.MISTRAL_API_KEY !== key) {
        env.MISTRAL_API_KEY = key
        changed = true
      }
    }

    if (!changed) return
    return next({ ...event, command, env })
  })

  void primeStatusBar(orca)
  firstTimer = setTimeout(() => {
    void tick(orca)
  }, 5_000) as unknown as NodeTimer
  firstTimer.unref?.()
  schedule(orca)
  orca.settings.onDidChange(() => {
    invalidate()
    schedule(orca)
    void tick(orca)
  })
}

export function deactivate(): void {
  stopped = true
  if (pollTimer !== undefined) clearInterval(pollTimer as unknown as number)
  if (firstTimer !== undefined) clearTimeout(firstTimer as unknown as number)
  pollTimer = undefined
  firstTimer = undefined
}
