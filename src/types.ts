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

export type KeySource = 'secret' | 'env' | 'none'
export type Protection = 'os-keyring' | 'unavailable' | 'unknown'

export type Status = {
  configured: boolean
  keySource: KeySource
  protection: Protection
  apiKeyEnv: string
  baseURL: string
  account: AccountStatus
  models: ModelInfo[]
  modelsSource: 'live' | 'bundled'
  modelsError?: string
  pricesUpdated: string
  fetchedAt: number
}

export type SaveKeyResult = { ok: true; status: Status } | { ok: false; error: string }

export type CacheModelRow = {
  key: string
  provider: string
  model: string
  turns: number
  inputTokens: number
  cacheReadTokens: number
  outputTokens: number
  hitRate: number
  cost: number
  saved: number
}

export type CacheDayRow = {
  day: string
  turns: number
  inputTokens: number
  cacheReadTokens: number
  hitRate: number
  cost: number
}

export type CacheSessionRow = {
  id: string
  updatedAt: number
  turns: number
  hitRate: number
  cost: number
}

export type CacheStats = {
  ok: boolean
  dir: string
  windowDays: number
  scannedFiles: number
  sessions: number
  turns: number
  inputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  outputTokens: number
  hitRate: number
  cost: number
  saved: number
  byModel: CacheModelRow[]
  byDay: CacheDayRow[]
  recent: CacheSessionRow[]
  error?: string
  fetchedAt: number
}
