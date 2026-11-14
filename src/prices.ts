/**
 * Mistral price table and cost math.
 *
 * Source: https://docs.mistral.ai/inference/pricing (read 2026-11-15).
 * Amounts are USD. Token prices are per 1,000,000 tokens; OCR is per 1,000
 * pages; audio is per minute; TTS is per 1,000,000 characters.
 *
 * A model with no row is reported as `priced: false` instead of `$0.00`, so a
 * new model never looks free. `priceOverrides` (a JSON setting) wins over this
 * table for anything Mistral adds before the plugin ships an update.
 */

export type Price = {
  /** USD per 1M input tokens. */
  input?: number
  /** USD per 1M output tokens. */
  output?: number
  /** USD per 1M cached input tokens. Falls back to `input`. */
  cacheRead?: number
  /** USD per 1,000 pages. */
  per1000Pages?: number
  /** USD per 1,000 annotated pages. Falls back to `per1000Pages`. */
  per1000AnnotatedPages?: number
  /** USD per minute of audio. */
  perMinute?: number
  /** USD per 1M characters of speech. */
  perMillionChars?: number
}

export const PRICES_UPDATED = '2026-11-15'
export const PRICES_SOURCE = 'https://docs.mistral.ai/inference/pricing'

/** Canonical model id -> price. */
export const PRICE_TABLE: Record<string, Price> = {
  'zai-glm-5-3-flash': { input: 0.15, cacheRead: 0.03, output: 0.5 },
  'deepseek-v4-1-flash-1017': { input: 0.3, cacheRead: 0.007, output: 1.2 },
  'zai-glm-5-3': { input: 1.4, cacheRead: 0.14, output: 4.4 },
  'mistral-small-2603': { input: 0.15, output: 0.6 },
  'mistral-large-4': { input: 0.7, cacheRead: 0.07, output: 2.1 },
  'ministral-14b-2512': { input: 0.2, output: 0.2 },
  'ministral-8b-2512': { input: 0.15, output: 0.15 },
  'ministral-3b-2512': { input: 0.1, output: 0.1 },
  'codestral-2508': { input: 0.3, output: 0.9 },
  'codestral-embed-2505': { input: 0.15 },
  'mistral-embed-2312': { input: 0.1 },
  'mistral-moderation-2603': { input: 0, output: 0 },
  'mistral-ocr-4-1': { per1000Pages: 4, per1000AnnotatedPages: 5 },
  'mistral-ocr-2512': { per1000Pages: 2, per1000AnnotatedPages: 3 },
  'voxtral-mini-transcribe-3-0': { perMinute: 0.0035 },
  'voxtral-small-transcribe-3-0': { perMinute: 0.004 },
  'voxtral-mini-transcribe-realtime-3-0': { perMinute: 0.008 },
  'voxtral-mini-tts-3-0': { perMillionChars: 13 },
  'voxtral-small-2507': { input: 0.1, output: 0.4, perMinute: 0.004 },
}

/** Alias ids Mistral serves that bill as a canonical row. */
export const PRICE_ALIASES: Record<string, string> = {
  'mistral-large-4-0': 'mistral-large-4',
  'mistral-large-latest': 'mistral-large-4',
  'mistral-small-latest': 'mistral-small-2603',
  'codestral-latest': 'codestral-2508',
  'mistral-code-latest': 'codestral-2508',
  'mistral-code-fim-latest': 'codestral-2508',
  'ministral-14b-latest': 'ministral-14b-2512',
  'ministral-8b-latest': 'ministral-8b-2512',
  'ministral-3b-latest': 'ministral-3b-2512',
  'zai-glm-latest': 'zai-glm-5-3',
  'zai-glm-5': 'zai-glm-5-3',
  'codestral-embed': 'codestral-embed-2505',
  'mistral-embed': 'mistral-embed-2312',
  'mistral-ocr-latest': 'mistral-ocr-4-1',
  'mistral-ocr-4': 'mistral-ocr-4-1',
  'mistral-ocr-3': 'mistral-ocr-2512',
  'mistral-ocr-3-0': 'mistral-ocr-2512',
  'voxtral-mini-transcribe-3': 'voxtral-mini-transcribe-3-0',
  'voxtral-small-transcribe-3': 'voxtral-small-transcribe-3-0',
  'voxtral-mini-transcribe-realtime-3': 'voxtral-mini-transcribe-realtime-3-0',
  'voxtral-mini-tts-3': 'voxtral-mini-tts-3-0',
  'voxtral-small-latest': 'voxtral-small-2507',
}

/** Normalise a model id: drop a provider prefix, a `:batch` suffix and dots. */
export function canonicalModelId(model: string): string {
  if (typeof model !== 'string') return ''
  let id = model.trim().toLowerCase()
  const slash = id.lastIndexOf('/')
  if (slash !== -1) id = id.slice(slash + 1)
  const colon = id.indexOf(':')
  if (colon !== -1) id = id.slice(0, colon)
  return id.replace(/\./g, '-')
}

/** Price for one model, or null when the table (and overrides) do not know it. */
export function priceFor(model: string, overrides?: Record<string, Price>): Price | null {
  const id = canonicalModelId(model)
  if (!id) return null
  const custom = overrides?.[id] ?? overrides?.[model]
  if (custom !== undefined) return custom
  const alias = PRICE_ALIASES[id]
  if (alias !== undefined && PRICE_TABLE[alias] !== undefined) return PRICE_TABLE[alias]
  if (PRICE_TABLE[id] !== undefined) return PRICE_TABLE[id]
  // Prefix match: `-preview` and dated ids inherit the base row.
  const hit = Object.keys(PRICE_TABLE)
    .sort((a, b) => b.length - a.length)
    .find((key) => id.startsWith(key))
  return hit === undefined ? null : PRICE_TABLE[hit]
}

export type Usage = {
  inputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  pages?: number
  annotatedPages?: number
  minutes?: number
  chars?: number
}

export type Cost = {
  total: number
  priced: boolean
  input: number
  output: number
  cacheRead: number
  pages: number
  other: number
  price: Price | null
}

function nonNegative(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : 0
}

/**
 * Cost of one request. Mistral reports cached tokens as a subset of the input
 * count, so the uncached remainder bills at the full input rate.
 */
export function costOf(model: string, usage: Usage, overrides?: Record<string, Price>): Cost {
  const price = priceFor(model, overrides)
  const empty: Cost = { total: 0, priced: false, input: 0, output: 0, cacheRead: 0, pages: 0, other: 0, price }
  if (price === null) return empty

  const input = nonNegative(usage.inputTokens)
  const cacheRead = Math.min(input, nonNegative(usage.cacheReadTokens))
  const uncached = Math.max(0, input - cacheRead)
  const output = nonNegative(usage.outputTokens)
  const pages = nonNegative(usage.pages)
  const annotated = Math.min(pages, nonNegative(usage.annotatedPages))
  const plainPages = Math.max(0, pages - annotated)
  const minutes = nonNegative(usage.minutes)
  const chars = nonNegative(usage.chars)

  const per = 1_000_000
  const inputCost = (uncached * nonNegative(price.input)) / per
  const cacheReadCost = (cacheRead * nonNegative(price.cacheRead ?? price.input)) / per
  const outputCost = (output * nonNegative(price.output)) / per
  const pageCost =
    (plainPages * nonNegative(price.per1000Pages)) / 1000 +
    (annotated * nonNegative(price.per1000AnnotatedPages ?? price.per1000Pages)) / 1000
  const other = (minutes * nonNegative(price.perMinute)) + (chars * nonNegative(price.perMillionChars)) / per

  return {
    total: inputCost + cacheReadCost + outputCost + pageCost + other,
    priced: true,
    input: inputCost,
    output: outputCost,
    cacheRead: cacheReadCost,
    pages: pageCost,
    other,
    price,
  }
}

/** Parse the `priceOverrides` setting. Invalid JSON or rows are ignored. */
export function parseOverrides(raw: unknown): Record<string, Price> {
  if (typeof raw !== 'string' || raw.trim() === '') return {}
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return {}
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {}
  const out: Record<string, Price> = {}
  for (const [key, row] of Object.entries(value as Record<string, unknown>)) {
    if (row === null || typeof row !== 'object' || Array.isArray(row)) continue
    const source = row as Record<string, unknown>
    const price: Price = {}
    for (const field of [
      'input',
      'output',
      'cacheRead',
      'per1000Pages',
      'per1000AnnotatedPages',
      'perMinute',
      'perMillionChars',
    ] as const) {
      const n = Number(source[field])
      if (Number.isFinite(n) && n >= 0) price[field] = n
    }
    if (Object.keys(price).length > 0) out[canonicalModelId(key)] = price
  }
  return out
}

/** `$0.0004`, `$0.12`, `$1,234.00`. */
export function formatUSD(amount: number): string {
  const n = Number(amount) || 0
  if (n === 0) return '$0.00'
  if (n < 0.0001) return '<$0.0001'
  if (n < 0.01) return `$${n.toFixed(4)}`
  if (n < 1) return `$${n.toFixed(3)}`
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

const SYMBOLS: Record<string, string> = { USD: '$', EUR: '€', GBP: '£', JPY: '¥' }

/** Money in the billing currency, with the code when it has no common symbol. */
export function formatMoney(amount: number, currency: string): string {
  const n = Number(amount) || 0
  const code = (currency || 'USD').toUpperCase()
  const symbol = SYMBOLS[code]
  const digits = n !== 0 && Math.abs(n) < 0.01 ? 4 : 2
  const text = n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })
  return symbol === undefined ? `${text} ${code}` : `${symbol}${text}`
}

/** `1.2M`, `256k`, `8192`. */
export function formatTokens(n: number): string {
  const value = Number(n) || 0
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value % 1_000_000 === 0 ? 0 : 1)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(value % 1_000 === 0 ? 0 : 1)}k`
  return String(value)
}

/** `1M`, `256k`, `8k`. */
export function formatContext(n: number): string {
  return formatTokens(n)
}
