/** Data shared by the panel, the worker and the tests. */
import type { ModelInfo } from './models'

export type BudgetWindow = {
  id: string
  label: string
  used?: number
  total?: number
  percent?: number
  unit: string
  resetsAt?: string
}

export type AccountStatus = {
  ok: boolean
  plan?: string
  currency: string
  windows: BudgetWindow[]
  fetchedAt?: number
  error?: string
}

export type LedgerKind = 'ocr' | 'embed' | 'fim' | 'chat'

export type LedgerEntry = {
  at: number
  kind: LedgerKind
  model: string
  inputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  pages?: number
  cost: number
  priced: boolean
}

export type ModelSpend = { model: string; cost: number; calls: number }

export type LedgerSummary = {
  entries: LedgerEntry[]
  today: number
  week: number
  month: number
  total: number
  cacheSavings: number
  byModel: ModelSpend[]
}

export type KeySource = 'secret' | 'env' | 'none'
export type Protection = 'os-keyring' | 'unavailable' | 'unknown'

export type Status = {
  configured: boolean
  keySource: KeySource
  protection: Protection
  baseURL: string
  account: AccountStatus
  models: ModelInfo[]
  modelsSource: 'live' | 'bundled'
  modelsError?: string
  ledger: LedgerSummary
  pricesUpdated: string
  fetchedAt: number
}

export type OcrResult =
  | {
      ok: true
      model: string
      markdown: string
      truncated: boolean
      pages: number
      cost: number
      priced: boolean
    }
  | { ok: false; error: string }

export type EmbedResult =
  | {
      ok: true
      model: string
      count: number
      dimensions: number
      tokens: number
      cost: number
      priced: boolean
      preview: number[]
    }
  | { ok: false; error: string }

export type FimResult =
  | {
      ok: true
      model: string
      completion: string
      inputTokens: number
      outputTokens: number
      cost: number
      priced: boolean
    }
  | { ok: false; error: string }

export type SaveKeyResult = { ok: true; status: Status } | { ok: false; error: string }
