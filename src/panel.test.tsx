import { assert, mockHost, mount, test } from 'orca/testing'
import * as panel from './panel'
import { connectedStatus, emptyStatus } from './fixtures'

test('shows the account budget and the local ledger', async () => {
  const host = mockHost({ requests: { 'mistral.status': connectedStatus } })
  const view = await mount(panel, { host })

  assert.ok(view.find({ text: /Account budget/ }))
  assert.ok(view.find({ label: /Vibe budget/ }))
  assert.ok(view.find({ label: /API budget/ }))
  assert.ok(view.find({ text: /This plugin's calls/ }))
  assert.deepEqual(view.errors, [])
  assert.deepEqual(view.refusals, [])
  await view.unmount()
})

test('asks for a key when none is configured', async () => {
  const host = mockHost({ requests: { 'mistral.status': emptyStatus } })
  const view = await mount(panel, { host })

  assert.ok(view.find({ text: /Connect your Mistral account/ }))
  assert.ok(view.find({ label: 'Mistral API key' }))
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('saves a key and swaps in the connected view', async () => {
  const host = mockHost({
    requests: {
      'mistral.status': emptyStatus,
      'mistral.saveKey': { ok: true, status: connectedStatus }
    }
  })
  const view = await mount(panel, { host })

  await view.type({ label: 'Mistral API key' }, 'sk-test')
  await view.press({ text: 'Save key' })

  assert.ok(view.find({ text: /Account budget/ }))
  assert.deepEqual(view.errors, [])
  assert.deepEqual(view.refusals, [])
  await view.unmount()
})

test('switches to the models tab and opens a model', async () => {
  const host = mockHost({ requests: { 'mistral.status': connectedStatus } })
  const view = await mount(panel, { host })

  await view.select({ type: 'Tabs' }, 'models')
  assert.ok(view.find({ text: /Cost calculator/ }))
  await view.activateRow({ type: 'Table' }, 'mistral-large-4')
  assert.ok(view.find({ text: /API id/ }))
  assert.deepEqual(view.errors, [])
  await view.unmount()
})
