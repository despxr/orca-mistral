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
