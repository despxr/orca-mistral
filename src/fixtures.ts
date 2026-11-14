/** Status fixtures for tests and `orca plugin check` scenarios. */
import { priceFor } from './prices'
import type { Status } from './types'

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
  baseURL: 'https://api.mistral.ai/v1',
  account: {
    ok: false,
    currency: 'EUR',
    windows: [],
    error: 'No Mistral API key. Add one in the Account tab or set MISTRAL_API_KEY.'
  },
  models: [model('mistral-large-4', 'Mistral Large 4', 1_048_576, ['completion chat', 'reasoning', 'vision'])],
  modelsSource: 'bundled',
  ledger: { entries: [], today: 0, week: 0, month: 0, total: 0, cacheSavings: 0, byModel: [] },
  pricesUpdated: '2026-11-15',
  fetchedAt: Date.now()
}

export const connectedStatus: Status = {
  configured: true,
  keySource: 'secret',
  protection: 'os-keyring',
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
  ledger: {
    entries: [
      {
        at: Date.now() - 4 * 60_000,
        kind: 'fim',
        model: 'codestral-latest',
        inputTokens: 1_240,
        outputTokens: 86,
        cacheReadTokens: 1_024,
        cost: 0.000_45,
        priced: true
      },
      {
        at: Date.now() - 38 * 60_000,
        kind: 'ocr',
        model: 'mistral-ocr-latest',
        pages: 12,
        cost: 0.048,
        priced: true
      },
      {
        at: Date.now() - 3 * 3_600_000,
        kind: 'embed',
        model: 'codestral-embed',
        inputTokens: 18_400,
        cost: 0.002_76,
        priced: true
      }
    ],
    today: 0.051_21,
    week: 0.51,
    month: 1.84,
    total: 6.42,
    cacheSavings: 0.000_31,
    byModel: [
      { model: 'mistral-ocr-latest', cost: 0.048, calls: 1 },
      { model: 'codestral-embed', cost: 0.002_76, calls: 1 },
      { model: 'codestral-latest', cost: 0.000_45, calls: 1 }
    ]
  },
  pricesUpdated: '2026-11-15',
  fetchedAt: Date.now()
}
