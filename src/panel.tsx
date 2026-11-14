import {
  atom,
  Badge,
  Button,
  Callout,
  EmptyState,
  Heading,
  IconButton,
  Input,
  KeyValue,
  Link,
  Progress,
  RelativeTime,
  Row,
  Select,
  Separator,
  Spinner,
  Stack,
  Tab,
  Table,
  Tabs,
  Text,
  plugin,
  read,
  set,
  type PanelContext
} from 'orca'
import { costOf, formatContext, formatMoney, formatUSD, PRICES_SOURCE } from './prices'
import type { ModelInfo } from './models'
import type { Status } from './types'

const tab = atom('tab', 'usage')
const status = atom<Status | null>(null)
const error = atom<string | null>(null)
const loading = atom(false)

const keyDraft = atom('keyDraft', '')
const keyBusy = atom(false)
const keyMessage = atom<string | null>(null)

const selectedModel = atom<string | null>(null)
const calcModel = atom('calcModel', 'mistral-large-4')
const calcInput = atom('calcInput', '10000')
const calcOutput = atom('calcOutput', '1000')

function messageOf(error: unknown): string {
  if (error !== null && typeof error === 'object' && 'message' in error) return String((error as { message: unknown }).message)
  return String(error)
}

async function load(quiet = false): Promise<void> {
  if (!quiet) set(loading, true)
  set(error, null)
  try {
    set(status, await plugin.request('mistral.status', {}))
  } catch (cause) {
    set(error, messageOf(cause))
  } finally {
    set(loading, false)
  }
}

async function saveKey(): Promise<void> {
  const value = read(keyDraft).trim()
  if (value === '') return
  set(keyBusy, true)
  set(keyMessage, null)
  try {
    const result = await plugin.request('mistral.saveKey', { key: value })
    if (!result.ok) {
      set(keyMessage, result.error)
      return
    }
    set(keyDraft, '')
    set(status, result.status)
    set(keyMessage, 'Key stored.')
  } catch (cause) {
    set(keyMessage, messageOf(cause))
  } finally {
    set(keyBusy, false)
  }
}

async function removeKey(): Promise<void> {
  set(keyBusy, true)
  set(keyMessage, null)
  try {
    set(status, await plugin.request('mistral.clearKey', {}))
    set(keyMessage, 'Stored key removed.')
  } catch (cause) {
    set(keyMessage, messageOf(cause))
  } finally {
    set(keyBusy, false)
  }
}

export function setup(ctx: PanelContext): void {
  ctx.subscriptions.push(plugin.on('mistral.updated', () => void load(true)))
  void load()
}

export default function Panel() {
  const current = read(status)
  return (
    <Stack gap="md">
      <Row justify="between">
        <Heading>Mistral</Heading>
        <Row gap="xs">
          {current?.account.ok ? <Badge tone="accent">{current.account.plan ?? 'API'}</Badge> : null}
          <IconButton
            icon="refresh"
            label="Refresh usage"
            disabled={read(loading)}
            onPress={() => void load()}
          />
        </Row>
      </Row>

      {read(error) ? (
        <Callout tone="danger" title="Could not reach the Mistral worker">
          {read(error)}
        </Callout>
      ) : null}

      {current === null ? (
        read(loading) ? <Spinner label="Loading Mistral usage" /> : null
      ) : current.configured ? (
        <Tabs label="Mistral sections" value={read(tab)} onChange={(value) => set(tab, value)}>
          <Tab value="usage" label="Usage">
            <Usage value={current} />
          </Tab>
          <Tab value="models" label="Models">
            <Models value={current} />
          </Tab>
          <Tab value="account" label="Account">
            <Account value={current} />
          </Tab>
        </Tabs>
      ) : (
        <Connect value={current} />
      )}
    </Stack>
  )
}

function Connect({ value }: { value: Status }) {
  return (
    <Stack gap="md">
      <Callout tone="accent" title="Connect your Mistral account">
        Paste an API key from console.mistral.ai. It is kept in Orca's encrypted secrets; if no OS key
        store is available, set {value.apiKeyEnv} in the environment instead.
      </Callout>
      <Input
        label="Mistral API key"
        type="password"
        placeholder="sk-…"
        value={read(keyDraft)}
        onChange={(next) => set(keyDraft, next)}
      />
      <Row gap="xs">
        <Button onPress={() => void saveKey()} disabled={read(keyBusy) || read(keyDraft).trim() === ''}>
          {read(keyBusy) ? 'Saving…' : 'Save key'}
        </Button>
        <Button variant="ghost" onPress={() => void load()}>
          Retry
        </Button>
      </Row>
      {read(keyMessage) ? (
        <Text size="xs" muted>
          {read(keyMessage)}
        </Text>
      ) : null}
      <Text size="xs" muted>
        {value.account.error ?? 'No account data yet.'}
      </Text>
      <Text size="xs" muted>
        Prices from {PRICES_SOURCE} (read {value.pricesUpdated}).
      </Text>
    </Stack>
  )
}

function Usage({ value }: { value: Status }) {
  const account = value.account
  return (
    <Stack gap="md">
      {account.ok ? (
        <Stack gap="sm">
          <Row justify="between">
            <Text weight="semibold">Account budget</Text>
            <Text size="xs" muted>
              {account.plan ?? 'API'}
            </Text>
          </Row>
          {account.windows.length === 0 ? (
            <Text size="xs" muted>
              Mistral returned no budget windows for this account.
            </Text>
          ) : (
            account.windows.map((window) => (
              <Stack gap="xs" key={window.id}>
                <Progress
                  label={`${window.label} · ${formatMoney(window.used ?? 0, window.unit)} of ${formatMoney(
                    window.total ?? 0,
                    window.unit
                  )}`}
                  value={Math.round(window.percent ?? 0)}
                />
                <Row justify="between">
                  <Text size="xs" muted>
                    {window.percent === undefined ? '' : `${window.percent.toFixed(1)}% used`}
                  </Text>
                  {window.resetsAt ? (
                    <Text size="xs" muted>
                      Resets {new Date(window.resetsAt).toLocaleDateString()}
                    </Text>
                  ) : null}
                </Row>
              </Stack>
            ))
          )}
          <Text size="xs" muted>
            The status bar shows the highest-used window. Last refreshed{' '}
            <RelativeTime at={account.fetchedAt ?? value.fetchedAt} format="short" />.
          </Text>
        </Stack>
      ) : (
        <Callout tone="warning" title="Account usage unavailable">
          {account.error ?? 'Add an API key to read your budget.'}
        </Callout>
      )}

      <Separator />

      <KeyValue
        items={[
          { label: 'Plan', value: account.plan ?? 'unknown' },
          { label: 'Currency', value: account.currency },
          { label: 'Endpoint', value: value.baseURL, code: true },
          {
            label: 'Key source',
            value: value.keySource === 'secret' ? 'Orca secrets' : value.keySource === 'env' ? 'Environment' : 'None'
          }
        ]}
      />

      {account.ok && account.windows.length === 0 ? (
        <EmptyState
          title="No budget windows"
          description="This account has no Vibe or API allowance to show. Usage may still be billed through the API."
          icon="gauge"
        />
      ) : null}
    </Stack>
  )
}

function Models({ value }: { value: Status }) {
  const rows = value.models.map((model) => ({
    key: model.id,
    cells: {
      model: model.name === model.id ? model.id : `${model.name} · ${model.id}`,
      context: model.context > 0 ? formatContext(model.context) : '—',
      input: model.price?.input === undefined ? '—' : `$${model.price.input}`,
      output: model.price?.output === undefined ? '—' : `$${model.price.output}`,
      caps: model.caps.length > 0 ? model.caps.slice(0, 3).join(', ') : '—'
    }
  }))
  const selected = value.models.find((model) => model.id === read(selectedModel)) ?? null
  return (
    <Stack gap="md">
      <Row justify="between">
        <Text size="xs" muted>
          {value.modelsSource === 'live' ? 'Live catalog' : 'Bundled price table'} · {value.models.length} models
        </Text>
        {value.modelsError ? (
          <Text size="xs" tone="warning" truncate>
            {value.modelsError}
          </Text>
        ) : null}
      </Row>
      <Table
        label="Models"
        columns={[
          { key: 'model', label: 'Model', minWidth: 'md' },
          { key: 'context', label: 'Context', align: 'end', hideBelow: 'sm' },
          { key: 'input', label: 'In $/M', align: 'end' },
          { key: 'output', label: 'Out $/M', align: 'end', hideBelow: 'sm' },
          { key: 'caps', label: 'Capabilities', hideBelow: 'md' }
        ]}
        rows={rows}
        onRowAction={({ key }) => set(selectedModel, key)}
      />
      {selected ? <ModelDetail model={selected} /> : <Text size="xs" muted>Select a model for its full price and limits.</Text>}
      <Separator />
      <Calculator models={value.models} />
      <Text size="xs" muted>
        USD per 1M tokens from {PRICES_SOURCE}, read {value.pricesUpdated}. Override a model in Settings →
        Plugins → Mistral → Price overrides.
      </Text>
    </Stack>
  )
}

function ModelDetail({ model }: { model: ModelInfo }) {
  const items = [
    { label: 'API id', value: model.id, code: true },
    { label: 'Context', value: model.context > 0 ? formatContext(model.context) : 'unknown' },
    {
      label: 'Input',
      value: model.price?.input === undefined ? 'unknown' : `$${model.price.input} /M tokens`
    },
    {
      label: 'Cached input',
      value:
        model.price?.cacheRead === undefined
          ? model.price?.input === undefined
            ? 'unknown'
            : 'same as input'
          : `$${model.price.cacheRead} /M tokens`
    },
    {
      label: 'Output',
      value: model.price?.output === undefined ? 'unknown' : `$${model.price.output} /M tokens`
    }
  ]
  return (
    <Stack gap="xs">
      <Text weight="semibold">{model.name}</Text>
      {model.description ? (
        <Text size="xs" muted>
          {model.description}
        </Text>
      ) : null}
      <KeyValue items={items} />
      {model.caps.length > 0 ? (
        <Row gap="xs" wrap>
          {model.caps.map((cap) => (
            <Badge key={cap} tone="neutral">
              {cap}
            </Badge>
          ))}
        </Row>
      ) : null}
      {model.aliases.length > 0 ? (
        <Text size="xs" muted>
          Aliases: {model.aliases.slice(0, 6).join(', ')}
        </Text>
      ) : null}
    </Stack>
  )
}

function Calculator({ models }: { models: ModelInfo[] }) {
  const options = models
    .filter((model) => model.price?.input !== undefined)
    .map((model) => ({ value: model.id, label: model.name }))
  const model = read(calcModel)
  const input = Number(read(calcInput)) || 0
  const output = Number(read(calcOutput)) || 0
  const cost = costOf(model, { inputTokens: input, outputTokens: output })
  return (
    <Stack gap="sm">
      <Text weight="semibold">Cost calculator</Text>
      {options.length === 0 ? (
        <Text size="xs" muted>
          No priced models are available.
        </Text>
      ) : (
        <Stack gap="sm">
          <Select
            label="Model"
            value={options.some((option) => option.value === model) ? model : options[0].value}
            options={options}
            onChange={(next) => set(calcModel, next)}
          />
          <Row gap="xs">
            <Input label="Input tokens" value={read(calcInput)} onChange={(next) => set(calcInput, next)} />
            <Input label="Output tokens" value={read(calcOutput)} onChange={(next) => set(calcOutput, next)} />
          </Row>
          <KeyValue
            items={[
              {
                label: 'Estimated cost',
                value: cost.priced ? formatUSD(cost.total) : 'Unknown model price',
                tone: cost.priced ? 'accent' : 'warning'
              }
            ]}
          />
        </Stack>
      )}
    </Stack>
  )
}

function Account({ value }: { value: Status }) {
  return (
    <Stack gap="md">
      <Stack gap="sm">
        <Text weight="semibold">API key</Text>
        <KeyValue
          items={[
            {
              label: 'Source',
              value: value.keySource === 'secret' ? 'Orca secrets' : value.keySource === 'env' ? 'Environment' : 'None'
            },
            {
              label: 'Secrets protection',
              value:
                value.protection === 'os-keyring'
                  ? 'OS keyring'
                  : value.protection === 'unavailable'
                    ? `Unavailable — use ${value.apiKeyEnv}`
                    : 'Unknown'
            },
            { label: 'Endpoint', value: value.baseURL, code: true }
          ]}
        />
        <Input
          label="Replace API key"
          type="password"
          placeholder="sk-…"
          value={read(keyDraft)}
          onChange={(next) => set(keyDraft, next)}
        />
        <Row gap="xs">
          <Button onPress={() => void saveKey()} disabled={read(keyBusy) || read(keyDraft).trim() === ''}>
            Save key
          </Button>
          {value.keySource === 'secret' ? (
            <Button variant="ghost" tone="danger" onPress={() => void removeKey()}>
              Remove stored key
            </Button>
          ) : null}
        </Row>
        {read(keyMessage) ? (
          <Text size="xs" muted>
            {read(keyMessage)}
          </Text>
        ) : null}
      </Stack>

      <Separator />

      <Stack gap="xs">
        <Text weight="semibold">Links</Text>
        <Text size="sm">
          <Link href="https://console.mistral.ai">Mistral Console</Link>
        </Text>
        <Text size="sm">
          <Link href="https://admin.mistral.ai">Usage and billing</Link>
        </Text>
        <Text size="sm">
          <Link href={PRICES_SOURCE}>API pricing</Link>
        </Text>
      </Stack>

      <Separator />

      <Stack gap="xs">
        <Text weight="semibold">Agent launch hook</Text>
        <Text size="xs" muted>
          With “Inject API key” on, agents Orca launches from the configured list receive MISTRAL_API_KEY
          from the same key this panel uses. Manage the list and per-agent arguments in Settings → Plugins
          → Mistral.
        </Text>
        <Text size="xs" muted>
          Last refreshed <RelativeTime at={value.fetchedAt} format="short" />
        </Text>
      </Stack>
    </Stack>
  )
}
