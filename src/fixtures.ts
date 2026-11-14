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
