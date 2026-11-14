/**
 * The Mistral plugin worker.
 *
 * It reads the account budget from Mistral's billing endpoints, keeps a live
 * model catalog, records what the plugin's own calls cost, drives the status
 * bar, and injects the API key into agents Orca launches.
 */
import type { OrcaWorkerApi } from 'orca/worker'
import { groupModels, fallbackModels, type ApiModel, type ModelInfo } from './models'
import {
  cacheSavings,
  costOf,
  formatUSD,
  parseOverrides,
  PRICES_UPDATED,
  type Price,
} from './prices'
import type {
  AccountStatus,
  BudgetWindow,
  EmbedResult,
  FimResult,
  LedgerEntry,
  LedgerSummary,
  OcrResult,
  Protection,
  SaveKeyResult,
  Status,
} from './types'

declare const process: { env: Record<string, string | undefined> }

const DEFAULT_BASE = 'https://api.mistral.ai/v1'
const DEFAULT_ENV = 'MISTRAL_API_KEY'
const LEDGER_KEY = 'ledger'
const SECRET_KEY = 'apiKey'
const LEDGER_LIMIT = 500
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

async function apiKey(orca: OrcaWorkerApi, settings?: Settings): Promise<{ key: string | null; source: 'secret' | 'env' | 'none' }> {
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
      'user-agent': 'orca-mistral/1.0',
    },
    signal: AbortSignal.timeout(timeoutMs),
  })
  return readResponse(response, path)
}

async function apiPost(key: string, base: string, path: string, body: unknown, timeoutMs = 120_000): Promise<unknown> {
  const response = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${key}`,
      accept: 'application/json',
      'content-type': 'application/json',
      'user-agent': 'orca-mistral/1.0',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  })
  return readResponse(response, path)
}

async function readResponse(response: Response, path: string): Promise<unknown> {
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

function isLedgerEntry(value: unknown): value is LedgerEntry {
  const row = recordOf(value)
  if (row === null) return false
  return (
    Number.isFinite(Number(row.at)) &&
    Number.isFinite(Number(row.cost)) &&
    typeof row.kind === 'string' &&
    typeof row.model === 'string'
  )
}

async function readLedger(orca: OrcaWorkerApi): Promise<LedgerEntry[]> {
  const raw = await orca.storage.get(LEDGER_KEY)
  return Array.isArray(raw) ? raw.filter(isLedgerEntry) : []
}

async function ledgerSummary(orca: OrcaWorkerApi, overrides: Record<string, Price>): Promise<LedgerSummary> {
  const entries = await readLedger(orca)
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime()
  const weekAgo = now.getTime() - 7 * 86_400_000

  let today = 0
  let week = 0
  let month = 0
  let total = 0
  let savings = 0
  const byModel = new Map<string, { cost: number; calls: number }>()

  for (const entry of entries) {
    const cost = nonNegative(entry.cost)
    total += cost
    if (entry.at >= startOfToday) today += cost
    if (entry.at >= weekAgo) week += cost
    if (entry.at >= startOfMonth) month += cost
    savings += cacheSavings(
      entry.model,
      { inputTokens: entry.inputTokens, cacheReadTokens: entry.cacheReadTokens },
      overrides,
    )
    const row = byModel.get(entry.model) ?? { cost: 0, calls: 0 }
    row.cost += cost
    row.calls += 1
    byModel.set(entry.model, row)
  }

  return {
    entries: [...entries].sort((a, b) => b.at - a.at),
    today,
    week,
    month,
    total,
    cacheSavings: savings,
    byModel: [...byModel.entries()]
      .map(([model, row]) => ({ model, cost: row.cost, calls: row.calls }))
      .sort((a, b) => b.cost - a.cost),
  }
}

async function record(orca: OrcaWorkerApi, entry: LedgerEntry): Promise<void> {
  const entries = await readLedger(orca)
  entries.push(entry)
  await orca.storage.set(LEDGER_KEY, entries.slice(-LEDGER_LIMIT))
  post(orca, 'mistral.updated', { fetchedAt: Date.now() })
}

function post(orca: OrcaWorkerApi, event: 'mistral.updated', payload: { fetchedAt: number }): void {
  try {
    orca.panels.post(event, payload)
  } catch {
    // No panel is open; nothing to tell.
  }
}

async function safeStatusBar(orca: OrcaWorkerApi, params: Record<string, unknown>): Promise<void> {
  try {
    await orca.host.call('statusBar.update', params as never)
  } catch {
    // Browser clients and older Orca have no status bar.
  }
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
  const ledger = await ledgerSummary(orca, overrides)

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
    ledger,
    pricesUpdated: PRICES_UPDATED,
    fetchedAt: Date.now(),
  }
}

async function updateStatusBar(orca: OrcaWorkerApi, value: Status): Promise<void> {
  const settings = await readSettings(orca)
  if (bool(settings, 'showStatusBar', true) === false || !value.configured) {
    await safeStatusBar(orca, { id: 'spend', visible: false })
    return
  }
  const worst = value.account.windows.reduce((max, window) => Math.max(max, window.percent ?? 0), 0)
  const tone = worst >= 90 ? 'danger' : worst >= 75 ? 'warning' : 'neutral'
  const tooltip = value.account.ok
    ? `Mistral plugin calls today: ${formatUSD(value.ledger.today)} · ${value.account.windows
        .map((window) => `${window.label} ${(window.percent ?? 0).toFixed(1)}%`)
        .join(' · ')}`
    : `Mistral plugin calls today: ${formatUSD(value.ledger.today)} · ${value.account.error ?? 'usage unavailable'}`
  await safeStatusBar(orca, {
    id: 'spend',
    text: `${formatUSD(value.ledger.today)} today`,
    tone,
    tooltip,
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
    const ledger = await ledgerSummary(orca, parseOverrides(settings.priceOverrides))
    await safeStatusBar(orca, {
      id: 'spend',
      text: `${formatUSD(ledger.today)} today`,
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

function ocrDocument(source: string): Record<string, string> {
  if (/^data:/i.test(source)) {
    const mime = /^data:([^;,]+)/i.exec(source)?.[1]?.toLowerCase() ?? ''
    return mime.startsWith('image/')
      ? { type: 'image_url', image_url: source }
      : { type: 'document_url', document_url: source }
  }
  const path = source.split('?')[0].toLowerCase()
  return /\.(png|jpe?g|webp|gif|bmp|tiff?)$/.test(path)
    ? { type: 'image_url', image_url: source }
    : { type: 'document_url', document_url: source }
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

function errorResult(error: unknown, code: string): { ok: false; error: string } {
  const message = messageOf(error)
  if (error instanceof PluginError && error.code === code) return { ok: false, error: message }
  return { ok: false, error: message }
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
        error: `${messageOf(error)} — set MISTRAL_API_KEY in the environment instead, then reopen the panel.`,
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

  orca.panels.handle('mistral.ocr', async ({ source }): Promise<OcrResult> => {
    const value = String(source ?? '').trim()
    if (value === '') throw new PluginError('invalid_params', 'Paste a document URL or a data: URL.')
    const settings = await readSettings(orca)
    const overrides = parseOverrides(settings.priceOverrides)
    const model = str(settings, 'ocrModel', 'mistral-ocr-latest')
    const { key } = await apiKey(orca, settings)
    if (key === null) throw new PluginError('action_failed', 'No Mistral API key is configured.')

    try {
      const body = recordOf(await apiPost(key, baseURL(settings), '/ocr', { model, document: ocrDocument(value) }))
      const pages = Array.isArray(body?.pages) ? (body.pages as unknown[]) : []
      const full = pages
        .map((page) => String(recordOf(page)?.markdown ?? ''))
        .filter((text) => text !== '')
        .join('\n\n')
      const truncated = full.length > 200_000
      const markdown = truncated ? full.slice(0, 200_000) : full
      const usage = recordOf(body?.usage_info)
      const pageCount = nonNegative(usage?.pages_processed) || pages.length
      const cost = costOf(model, { pages: pageCount }, overrides)
      await record(orca, {
        at: Date.now(),
        kind: 'ocr',
        model,
        pages: pageCount,
        cost: cost.total,
        priced: cost.priced,
      })
      return jsonSafe({ ok: true, model, markdown, truncated, pages: pageCount, cost: cost.total, priced: cost.priced })
    } catch (error) {
      return errorResult(error, 'invalid_params') as OcrResult
    }
  })

  orca.panels.handle('mistral.embed', async ({ texts }): Promise<EmbedResult> => {
    const cleaned = (Array.isArray(texts) ? texts : [])
      .map((text) => String(text ?? '').trim())
      .filter((text) => text !== '')
      .slice(0, 64)
    if (cleaned.length === 0) throw new PluginError('invalid_params', 'Add at least one line of text.')
    const settings = await readSettings(orca)
    const overrides = parseOverrides(settings.priceOverrides)
    const model = str(settings, 'embedModel', 'codestral-embed')
    const { key } = await apiKey(orca, settings)
    if (key === null) throw new PluginError('action_failed', 'No Mistral API key is configured.')

    try {
      const body = recordOf(await apiPost(key, baseURL(settings), '/embeddings', { model, input: cleaned }))
      const data = Array.isArray(body?.data) ? (body.data as unknown[]) : []
      const usage = recordOf(body?.usage)
      const tokens = nonNegative(usage?.prompt_tokens)
      const first = recordOf(data[0])
      const vector = Array.isArray(first?.embedding) ? (first.embedding as unknown[]) : []
      const cost = costOf(model, { inputTokens: tokens }, overrides)
      await record(orca, {
        at: Date.now(),
        kind: 'embed',
        model,
        inputTokens: tokens,
        cost: cost.total,
        priced: cost.priced,
      })
      return jsonSafe({
        ok: true,
        model,
        count: data.length,
        dimensions: vector.length,
        tokens,
        cost: cost.total,
        priced: cost.priced,
        preview: vector.slice(0, 8).map((n) => Number(Number(n).toFixed(5))),
      })
    } catch (error) {
      return errorResult(error, 'invalid_params') as EmbedResult
    }
  })

  orca.panels.handle('mistral.fim', async ({ prompt, suffix, maxTokens }): Promise<FimResult> => {
    const value = String(prompt ?? '')
    if (value.trim() === '') throw new PluginError('invalid_params', 'Add the code before the cursor.')
    const settings = await readSettings(orca)
    const overrides = parseOverrides(settings.priceOverrides)
    const model = str(settings, 'fimModel', 'codestral-latest')
    const { key } = await apiKey(orca, settings)
    if (key === null) throw new PluginError('action_failed', 'No Mistral API key is configured.')

    try {
      const body = recordOf(
        await apiPost(key, baseURL(settings), '/fim/completions', {
          model,
          prompt: value,
          suffix: String(suffix ?? ''),
          max_tokens: clamp(Number(maxTokens) || 256, 1, 2048),
        }),
      )
      const choices = Array.isArray(body?.choices) ? (body.choices as unknown[]) : []
      const completion = String(recordOf(recordOf(choices[0])?.message)?.content ?? '')
      const usage = recordOf(body?.usage)
      const inputTokens = nonNegative(usage?.prompt_tokens)
      const outputTokens = nonNegative(usage?.completion_tokens)
      const details = recordOf(usage?.prompt_tokens_details)
      const cacheReadTokens = nonNegative(details?.cached_tokens)
      const cost = costOf(model, { inputTokens, outputTokens, cacheReadTokens }, overrides)
      await record(orca, {
        at: Date.now(),
        kind: 'fim',
        model,
        inputTokens,
        outputTokens,
        cacheReadTokens,
        cost: cost.total,
        priced: cost.priced,
      })
      return jsonSafe({ ok: true, model, completion, inputTokens, outputTokens, cost: cost.total, priced: cost.priced })
    } catch (error) {
      return errorResult(error, 'invalid_params') as FimResult
    }
  })

  orca.panels.handle('mistral.clearLedger', async () => {
    await orca.storage.delete(LEDGER_KEY)
    post(orca, 'mistral.updated', { fetchedAt: Date.now() })
    return jsonSafe(await status(orca))
  })

  orca.commands.register('mistral.refresh', async () => {
    const value = await status(orca, { force: true })
    await updateStatusBar(orca, value)
    return value.configured
      ? `Mistral ${value.account.plan ?? 'API'}: plugin calls ${formatUSD(value.ledger.today)} today · ${formatUSD(value.ledger.month)} this month`
      : 'Mistral: no API key configured'
  })

  orca.commands.register('mistral.test', async () => {
    const value = await status(orca, { force: true })
    const body = value.account.ok
      ? `${value.account.plan ?? 'API'} · ${value.account.windows
          .map((window) => `${window.label} ${(window.percent ?? 0).toFixed(1)}%`)
          .join(' · ')}`
      : value.account.error ?? 'No account data.'
    try {
      await orca.host.call('notifications.show', { title: 'Mistral connection', body })
    } catch {
      // Notifications are optional.
    }
    return body
  })

  orca.commands.register('mistral.clearLedger', async () => {
    await orca.storage.delete(LEDGER_KEY)
    post(orca, 'mistral.updated', { fetchedAt: Date.now() })
    return 'Mistral: local cost ledger cleared'
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
