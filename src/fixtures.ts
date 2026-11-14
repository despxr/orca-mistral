/** Status fixtures for tests and `orca plugin check` scenarios. */
import { priceFor } from './prices'
import type { CacheStats, Status } from './types'

function model(id: string, name: string, context: number, caps: string[]) {
  return {
    id,
    name,
    description: '',
    context,
    caps,
    aliases: [],
    price: priceFor(id),
    deprecated: false
  }
}

export const emptyStatus: Status = {
  configured: false,
  keySource: 'none',
  protection: 'os-keyring',
  apiKeyEnv: 'MISTRAL_API_KEY',
  baseURL: 'https://api.mistral.ai/v1',
  account: {
    ok: false,
    currency: 'EUR',
    windows: [],
    error: 'No Mistral API key. Add one in the Account tab or set MISTRAL_API_KEY.'
  },
  models: [model('mistral-large-4', 'Mistral Large 4', 1_048_576, ['completion chat', 'reasoning', 'vision'])],
  modelsSource: 'bundled',
  pricesUpdated: '2026-11-15',
  fetchedAt: Date.now()
}

export const connectedStatus: Status = {
  configured: true,
  keySource: 'secret',
  protection: 'os-keyring',
  apiKeyEnv: 'MISTRAL_API_KEY',
  baseURL: 'https://api.mistral.ai/v1',
  account: {
    ok: true,
    plan: 'INDIVIDUAL',
    currency: 'EUR',
    fetchedAt: Date.now(),
    windows: [
      {
        id: 'vibe',
        label: 'Vibe budget',
        used: 94.77,
        total: 255,
        percent: 37.16,
        unit: 'EUR',
        resetsAt: '2026-12-01T00:00:00Z'
      },
      {
        id: 'api',
        label: 'API budget',
        used: 0.12,
        total: 25.5,
        percent: 0.45,
        unit: 'EUR',
        resetsAt: '2026-12-01T00:00:00Z'
      }
    ]
  },
  models: [
    model('deepseek-v4-1-flash-1017', 'DeepSeek V4.1 Flash 1017', 1_048_576, ['completion chat', 'reasoning', 'vision']),
    model('zai-glm-5-3', 'Z.ai GLM 5.3', 1_048_576, ['completion chat', 'reasoning']),
    model('mistral-large-4', 'Mistral Large 4', 1_048_576, ['completion chat', 'reasoning', 'vision']),
    model('mistral-small-2603', 'Mistral Small 4', 262_144, ['completion chat', 'reasoning', 'vision']),
    model('codestral-2508', 'Codestral', 256_000, ['completion chat', 'completion fim']),
    model('mistral-ocr-4-1', 'Mistral OCR 4.1', 16_384, ['ocr', 'vision']),
    model('codestral-embed-2505', 'Codestral Embed', 8_192, [])
  ],
  modelsSource: 'live',
  pricesUpdated: '2026-11-15',
  fetchedAt: Date.now()
}

export const cacheFixture: CacheStats = {
  ok: true,
  dir: '~/.pi/agent/sessions',
  windowDays: 30,
  scannedFiles: 12,
  sessions: 4,
  turns: 128,
  inputTokens: 180_000,
  cacheReadTokens: 1_420_000,
  cacheWriteTokens: 0,
  outputTokens: 42_000,
  hitRate: 1_420_000 / 1_600_000,
  cost: 0.92,
  saved: 0.41,
  byModel: [
    {
      key: 'mistral-responses/deepseek-v4-1-flash-1017',
      provider: 'mistral-responses',
      model: 'deepseek-v4-1-flash-1017',
      turns: 96,
      inputTokens: 120_000,
      cacheReadTokens: 1_100_000,
      outputTokens: 28_000,
      hitRate: 1_100_000 / 1_220_000,
      cost: 0.62,
      saved: 0.31
    },
    {
      key: 'mistral-responses/zai-glm-5-3',
      provider: 'mistral-responses',
      model: 'zai-glm-5-3',
      turns: 32,
      inputTokens: 60_000,
      cacheReadTokens: 320_000,
      outputTokens: 14_000,
      hitRate: 320_000 / 380_000,
      cost: 0.3,
      saved: 0.1
    }
  ],
  byDay: [
    { day: '2026-11-14', turns: 64, inputTokens: 90_000, cacheReadTokens: 710_000, hitRate: 710_000 / 800_000, cost: 0.5 },
    { day: '2026-11-13', turns: 64, inputTokens: 90_000, cacheReadTokens: 710_000, hitRate: 710_000 / 800_000, cost: 0.42 }
  ],
  recent: [
    { id: '2026-11-14T23-26-36-228Z_01a1dc62', updatedAt: Date.now() - 3_600_000, turns: 24, hitRate: 0.92, cost: 0.18 },
    { id: '2026-11-14T20-11-02-118Z_01a1dc11', updatedAt: Date.now() - 7_200_000, turns: 18, hitRate: 0.88, cost: 0.14 }
  ],
  fetchedAt: Date.now()
}
