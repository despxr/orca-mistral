import { assert, test } from 'orca/testing'
import { groupModels, type ApiModel } from './models'
import { cacheSavings, costOf, formatMoney, formatUSD, parseOverrides, priceFor } from './prices'

test('prices a chat turn and its cache reads', () => {
  const full = costOf('mistral-large-4', { inputTokens: 1_000_000, outputTokens: 1_000_000 })
  assert.equal(full.priced, true)
  assert.equal(Number(full.total.toFixed(6)), 2.8)

  const cached = costOf('mistral-large-4', { inputTokens: 1_000_000, cacheReadTokens: 1_000_000 })
  assert.equal(Number(cached.total.toFixed(6)), 0.07)
  assert.equal(Number(cacheSavings('mistral-large-4', { inputTokens: 1_000_000, cacheReadTokens: 1_000_000 }).toFixed(6)), 0.63)
})

test('prices OCR per page and embeddings per token', () => {
  const ocr = costOf('mistral-ocr-4-1', { pages: 1000 })
  assert.equal(ocr.total, 4)
  const annotated = costOf('mistral-ocr-4-1', { pages: 1000, annotatedPages: 1000 })
  assert.equal(annotated.total, 5)
  const embed = costOf('codestral-embed', { inputTokens: 1_000_000 })
  assert.equal(embed.total, 0.15)
})

test('an unknown model is unpriced, never free', () => {
  const cost = costOf('some-new-model', { inputTokens: 1_000_000, outputTokens: 1_000_000 })
  assert.equal(cost.priced, false)
  assert.equal(cost.total, 0)
  assert.equal(priceFor('some-new-model'), null)
})

test('aliases resolve to the canonical row', () => {
  assert.equal(priceFor('mistral-large-latest')?.input, 0.7)
  assert.equal(priceFor('codestral-latest')?.output, 0.9)
  assert.equal(priceFor('mistral-ocr-latest')?.per1000Pages, 4)
})

test('overrides win and invalid JSON is ignored', () => {
  const overrides = parseOverrides('{"my-model":{"input":1,"output":2}}')
  assert.equal(costOf('my-model', { inputTokens: 1_000_000, outputTokens: 1_000_000 }, overrides).total, 3)
  assert.deepEqual(parseOverrides('not json'), {})
  assert.deepEqual(parseOverrides('{"bad":42}'), {})
})

test('formats money and tiny amounts', () => {
  assert.equal(formatUSD(0), '$0.00')
  assert.equal(formatUSD(0.00045), '$0.0004')
  assert.equal(formatUSD(0.00001), '<$0.0001')
  assert.equal(formatUSD(2.8), '$2.80')
  assert.equal(formatMoney(255, 'EUR'), '€255.00')
  assert.equal(formatMoney(0.12, 'EUR'), '€0.12')
  assert.equal(formatMoney(12.5, 'CHF'), '12.50 CHF')
})

test('groups aliases into one canonical model', () => {
  const listing: ApiModel[] = [
    { id: 'mistral-large-latest', name: 'mistral-large-4', billing_model_name: 'mistral-large-4-0-a', max_context_length: 1_048_576 },
    { id: 'mistral-large-4', name: 'mistral-large-4', billing_model_name: 'mistral-large-4-0-a', max_context_length: 1_048_576 },
    { id: 'mistral-large-4-0', name: 'mistral-large-4', billing_model_name: 'mistral-large-4-0-a', max_context_length: 1_048_576 },
    { id: 'zai-glm-latest', name: 'zai-glm-5-3', billing_model_name: 'zai-glm-5-3', max_context_length: 1_048_576 },
    { id: 'zai-glm-5-3', name: 'zai-glm-5-3', billing_model_name: 'zai-glm-5-3', max_context_length: 1_048_576 }
  ]
  const models = groupModels(listing)
  assert.equal(models.length, 2)
  assert.equal(models.find((model) => model.id === 'mistral-large-4')?.price?.input, 0.7)
  assert.equal(models.find((model) => model.id === 'zai-glm-5-3')?.price?.output, 4.4)
})
