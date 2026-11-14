import { assert, mockHost, mountWorker, test } from 'orca/testing'
import * as worker from './worker'

type FetchInput = string | URL | Request

function assertJsonValue(value: unknown, path = 'result'): void {
  if (value === null) return
  const type = typeof value
  if (type === 'string' || type === 'boolean') return
  if (type === 'number') {
    assert.ok(Number.isFinite(value as number), `${path} is not a finite number`)
    return
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertJsonValue(entry, `${path}[${index}]`))
    return
  }
  if (type === 'object') {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      assert.notEqual(child, undefined, `${path}.${key} is undefined`)
      assertJsonValue(child, `${path}.${key}`)
    }
    return
  }
  assert.fail(`${path} is ${type}`)
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function stubFetch(routes: Record<string, unknown>): { calls: string[]; restore: () => void } {
  const original = globalThis.fetch
  const calls: string[] = []
  globalThis.fetch = (async (input: FetchInput) => {
    const url = String(input)
    calls.push(url)
    const path = new URL(url).pathname
    const body = routes[path]
    if (body === undefined) return json({ message: 'not found' }, 404)
    return json(body)
  }) as typeof fetch
  return { calls, restore: () => (globalThis.fetch = original) }
}

const budget = {
  vibe_budget: {
    usage_percentage: 37.16,
    initial_budget: 255,
    currency: 'EUR',
    reset_at: '2026-12-01T00:00:00Z'
  },
  api_budget: {
    usage_percentage: 0.45,
    initial_budget: 25.5,
    currency: 'EUR',
    reset_at: '2026-12-01T00:00:00Z'
  }
}

const listing = {
  data: [
    {
      id: 'mistral-large-4',
      name: 'mistral-large-4',
      billing_model_name: 'mistral-large-4-0-a',
      max_context_length: 1_048_576,
      capabilities: { completion_chat: true, reasoning: true, vision: true },
      aliases: ['mistral-large-latest'],
      deprecation: null
    },
    {
      id: 'mistral-large-latest',
      name: 'mistral-large-4',
      billing_model_name: 'mistral-large-4-0-a',
      max_context_length: 1_048_576,
      capabilities: { completion_chat: true, reasoning: true, vision: true },
      aliases: ['mistral-large-4'],
      deprecation: null
    }
  ]
}

test('reads the budget and the live catalog', async () => {
  const fake = stubFetch({
    '/v1/billing/budget': budget,
    '/v1/billing/subscription': { plan_name: 'INDIVIDUAL' },
    '/v1/models': listing
  })
  try {
    const host = mockHost({ secrets: { apiKey: 'test-key' } })
    const w = await mountWorker(worker, { host })
    const status = await w.request('mistral.status', {})

    assert.equal(status.configured, true)
    assert.equal(status.keySource, 'secret')
    assert.equal(status.account.ok, true)
    assert.equal(status.account.plan, 'INDIVIDUAL')
    assert.equal(status.account.currency, 'EUR')
    assert.equal(status.account.windows.length, 2)
    assert.equal(status.account.windows[0].percent, 37.16)
    assert.equal(status.modelsSource, 'live')
    assert.equal(status.models.length, 1)
    assert.equal(status.models[0].id, 'mistral-large-4')
    assert.equal(status.models[0].price?.input, 0.7)
    assertJsonValue(status)
    assert.deepEqual(w.refusals, [])

    await w.deactivate()
    assert.ok(fake.calls.some((url) => url.endsWith('/v1/billing/budget')))
  } finally {
    fake.restore()
  }
})

test('answers a JSON-safe status with no key', async () => {
  const host = mockHost()
  const w = await mountWorker(worker, { host })
  const status = await w.request('mistral.status', {})
  assert.equal(status.configured, false)
  assert.equal(status.keySource, 'none')
  assert.equal(status.account.ok, false)
  assert.ok(status.models.length > 0)
  assertJsonValue(status)
  assert.deepEqual(w.refusals, [])
  await w.deactivate()
})

test('records an OCR call in the ledger at the page rate', async () => {
  const fake = stubFetch({
    '/v1/billing/budget': budget,
    '/v1/billing/subscription': { plan_name: 'INDIVIDUAL' },
    '/v1/models': listing,
    '/v1/ocr': { pages: [{ markdown: '# Invoice' }], usage_info: { pages_processed: 2 } }
  })
  try {
    const host = mockHost({ secrets: { apiKey: 'test-key' } })
    const w = await mountWorker(worker, { host })

    const result = await w.request('mistral.ocr', { source: 'https://example.com/invoice.pdf' })
    assert.equal(result.ok, true)
    if (result.ok) {
      assert.equal(result.markdown, '# Invoice')
      assert.equal(result.pages, 2)
      assert.equal(Number(result.cost.toFixed(6)), 0.008)
      assert.equal(result.priced, true)
      assertJsonValue(result)
    }

    const status = await w.request('mistral.status', {})
    assert.equal(status.ledger.entries.length, 1)
    assert.equal(status.ledger.entries[0].kind, 'ocr')
    assert.equal(Number(status.ledger.today.toFixed(6)), 0.008)

    const stored = host.data().storage.ledger
    assert.equal(Array.isArray(stored) ? stored.length : 0, 1)
    await w.deactivate()
  } finally {
    fake.restore()
  }
})

test('injects the API key into the agents it is told to', async () => {
  const host = mockHost({
    secrets: { apiKey: 'test-key' },
    settings: { launchArgs: '{"pi":"--model mistral-responses/deepseek-v4-1-flash-1017"}' }
  })
  const w = await mountWorker(worker, { host })

  const pi = await w.hooks.fire('agent.launch.before', {
    agent: 'pi',
    workspaceId: null,
    workspaceKind: null,
    command: 'pi',
    env: { FOO: 'bar' }
  })
  assert.equal(pi.kind, 'continue')
  if (pi.kind === 'continue') {
    assert.equal(pi.event.env.MISTRAL_API_KEY, 'test-key')
    assert.equal(pi.event.env.FOO, 'bar')
    assert.equal(pi.event.command, 'pi --model mistral-responses/deepseek-v4-1-flash-1017')
  }

  const claude = await w.hooks.fire('agent.launch.before', {
    agent: 'claude',
    workspaceId: null,
    workspaceKind: null,
    command: 'claude',
    env: {}
  })
  assert.equal(claude.kind, 'continue')
  if (claude.kind === 'continue') assert.equal(claude.event.env.MISTRAL_API_KEY, undefined)

  await w.deactivate()
})

test('clears the local ledger', async () => {
  const host = mockHost({
    secrets: { apiKey: 'test-key' },
    storage: {
      ledger: [{ at: Date.now(), kind: 'ocr', model: 'mistral-ocr-latest', cost: 0.004, priced: true }]
    }
  })
  const w = await mountWorker(worker, { host })
  const status = await w.request('mistral.clearLedger', {})
  assert.equal(status.ledger.entries.length, 0)
  assert.equal(host.data().storage.ledger, undefined)
  await w.deactivate()
})
