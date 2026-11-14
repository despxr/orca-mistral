import {
  atom,
  Badge,
  Button,
  Callout,
  CodeView,
  EmptyState,
  Heading,
  IconButton,
  Input,
  KeyValue,
  Link,
  Markdown,
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
  Textarea,
  plugin,
  read,
  set,
  type PanelContext
} from 'orca'
import { costOf, formatContext, formatMoney, formatTokens, formatUSD, PRICES_SOURCE } from './prices'
import type { ModelInfo } from './models'
import type { EmbedResult, FimResult, OcrResult, Status } from './types'

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

const ocrSource = atom('ocrSource', '')
const ocrResult = atom<OcrResult | null>(null)
const ocrBusy = atom(false)

const embedText = atom('embedText', '')
const embedResult = atom<EmbedResult | null>(null)
const embedBusy = atom(false)

const fimPrompt = atom('fimPrompt', '')
const fimSuffix = atom('fimSuffix', '')
const fimResult = atom<FimResult | null>(null)
const fimBusy = atom(false)

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

async function runOcr(): Promise<void> {
  set(ocrBusy, true)
  set(ocrResult, null)
  try {
    set(ocrResult, await plugin.request('mistral.ocr', { source: read(ocrSource) }, { timeoutMs: 120_000 }))
  } catch (cause) {
    set(ocrResult, { ok: false, error: messageOf(cause) })
  } finally {
    set(ocrBusy, false)
  }
}

async function runEmbed(): Promise<void> {
  const texts = read(embedText)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
  if (texts.length === 0) return
  set(embedBusy, true)
  set(embedResult, null)
  try {
    set(embedResult, await plugin.request('mistral.embed', { texts }))
  } catch (cause) {
    set(embedResult, { ok: false, error: messageOf(cause) })
  } finally {
    set(embedBusy, false)
  }
}

async function runFim(): Promise<void> {
  set(fimBusy, true)
  set(fimResult, null)
  try {
    set(
      fimResult,
      await plugin.request('mistral.fim', {
        prompt: read(fimPrompt),
        suffix: read(fimSuffix),
        maxTokens: 256
      })
    )
  } catch (cause) {
    set(fimResult, { ok: false, error: messageOf(cause) })
  } finally {
    set(fimBusy, false)
  }
}

async function clearLedger(): Promise<void> {
  try {
    set(status, await plugin.request('mistral.clearLedger', {}))
  } catch (cause) {
    set(error, messageOf(cause))
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
          <Tab value="tools" label="Tools">
            <Tools />
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
        store is available, set MISTRAL_API_KEY in the environment instead.
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
  const ledger = value.ledger
  const spendRows = ledger.byModel.map((row) => ({
    key: row.model,
    cells: {
      model: row.model,
      calls: row.calls,
      cost: formatUSD(row.cost)
    }
  }))
  const callRows = ledger.entries.slice(0, 40).map((entry, index) => ({
    key: `${entry.at}-${index}`,
    cells: {
      at: { type: 'relative' as const, at: entry.at },
      kind: entry.kind,
      model: entry.model,
      tokens: formatTokens((entry.inputTokens ?? 0) + (entry.outputTokens ?? 0) + (entry.pages ?? 0)),
      cost: entry.priced ? formatUSD(entry.cost) : 'unpriced'
    }
  }))

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
        </Stack>
      ) : (
        <Callout tone="warning" title="Account usage unavailable">
          {account.error ?? 'Add an API key to read your budget.'}
        </Callout>
      )}

      <Separator />

      <Stack gap="sm">
        <Text weight="semibold">This plugin's calls</Text>
        <KeyValue
          items={[
            { label: 'Today', value: formatUSD(ledger.today), tone: ledger.today > 0 ? 'accent' : undefined },
            { label: 'Last 7 days', value: formatUSD(ledger.week) },
            { label: 'This month', value: formatUSD(ledger.month) },
            { label: 'Cache savings', value: formatUSD(ledger.cacheSavings), tone: 'success' }
          ]}
        />
        <Text size="xs" muted>
          Estimated from the token counts Mistral returned. The account budget above is authoritative.
        </Text>
      </Stack>

      {spendRows.length > 0 ? (
        <Table
          label="Spend by model"
          columns={[
            { key: 'model', label: 'Model', minWidth: 'md' },
            { key: 'calls', label: 'Calls', align: 'end' },
            { key: 'cost', label: 'Cost', align: 'end' }
          ]}
          rows={spendRows}
        />
      ) : null}

      {callRows.length > 0 ? (
        <Table
          label="Recent calls"
          columns={[
            { key: 'at', label: 'When' },
            { key: 'kind', label: 'Kind', hideBelow: 'sm' },
            { key: 'model', label: 'Model', minWidth: 'md' },
            { key: 'tokens', label: 'Units', align: 'end', hideBelow: 'sm' },
            { key: 'cost', label: 'Cost', align: 'end' }
          ]}
          rows={callRows}
        />
      ) : (
        <EmptyState
          title="No calls recorded yet"
          description="OCR, embeddings and FIM calls from the Tools tab appear here with their estimated cost."
          icon="gauge"
        />
      )}
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
    },
    {
      label: 'OCR',
      value: model.price?.per1000Pages === undefined ? '—' : `$${model.price.per1000Pages} /1k pages`
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

function Tools() {
  const ocr = read(ocrResult)
  const embed = read(embedResult)
  const fim = read(fimResult)
  return (
    <Stack gap="md">
      <Stack gap="sm">
        <Text weight="semibold">OCR</Text>
        <Text size="xs" muted>
          A PDF or image URL (or a data: URL) becomes markdown, billed per page instead of vision tokens.
        </Text>
        <Input
          label="Document URL"
          placeholder="https://…/document.pdf"
          value={read(ocrSource)}
          onChange={(next) => set(ocrSource, next)}
        />
        <Button
          icon="file-text"
          onPress={() => void runOcr()}
          disabled={read(ocrBusy) || read(ocrSource).trim() === ''}
        >
          {read(ocrBusy) ? 'Extracting…' : 'Extract markdown'}
        </Button>
        {ocr === null ? null : ocr.ok ? (
          <Stack gap="xs">
            <KeyValue
              items={[
                { label: 'Pages', value: ocr.pages },
                { label: 'Model', value: ocr.model, code: true },
                { label: 'Cost', value: ocr.priced ? formatUSD(ocr.cost) : 'unpriced', tone: 'accent' }
              ]}
            />
            {ocr.markdown === '' ? (
              <Text size="xs" muted>
                No text was found in the document.
              </Text>
            ) : (
              <Markdown content={ocr.markdown.slice(0, 60_000)} />
            )}
            {ocr.truncated ? (
              <Text size="xs" tone="warning">
                The extraction was long; the panel shows the first 60,000 characters.
              </Text>
            ) : null}
          </Stack>
        ) : (
          <Callout tone="danger" title="OCR failed">
            {ocr.error}
          </Callout>
        )}
      </Stack>

      <Separator />

      <Stack gap="sm">
        <Text weight="semibold">Embeddings</Text>
        <Textarea
          label="Texts, one per line"
          rows={4}
          value={read(embedText)}
          onChange={(next) => set(embedText, next)}
        />
        <Button
          icon="layers"
          onPress={() => void runEmbed()}
          disabled={read(embedBusy) || read(embedText).trim() === ''}
        >
          {read(embedBusy) ? 'Embedding…' : 'Embed texts'}
        </Button>
        {embed === null ? null : embed.ok ? (
          <Stack gap="xs">
            <KeyValue
              items={[
                { label: 'Vectors', value: embed.count },
                { label: 'Dimensions', value: embed.dimensions },
                { label: 'Input tokens', value: embed.tokens },
                { label: 'Cost', value: embed.priced ? formatUSD(embed.cost) : 'unpriced', tone: 'accent' }
              ]}
            />
            <CodeView
              label="First vector (8 of many)"
              code={JSON.stringify(embed.preview)}
              language="json"
              lineNumbers={false}
            />
          </Stack>
        ) : (
          <Callout tone="danger" title="Embedding failed">
            {embed.error}
          </Callout>
        )}
      </Stack>

      <Separator />

      <Stack gap="sm">
        <Text weight="semibold">Fill in the middle</Text>
        <Textarea
          label="Code before the cursor"
          rows={5}
          value={read(fimPrompt)}
          onChange={(next) => set(fimPrompt, next)}
        />
        <Input
          label="Code after the cursor"
          placeholder="Optional"
          value={read(fimSuffix)}
          onChange={(next) => set(fimSuffix, next)}
        />
        <Button
          icon="code"
          onPress={() => void runFim()}
          disabled={read(fimBusy) || read(fimPrompt).trim() === ''}
        >
          {read(fimBusy) ? 'Completing…' : 'Complete'}
        </Button>
        {fim === null ? null : fim.ok ? (
          <Stack gap="xs">
            <CodeView label="Completion" code={fim.completion} lineNumbers={false} wrap />
            <KeyValue
              items={[
                { label: 'Model', value: fim.model, code: true },
                { label: 'Input tokens', value: fim.inputTokens },
                { label: 'Output tokens', value: fim.outputTokens },
                { label: 'Cost', value: fim.priced ? formatUSD(fim.cost) : 'unpriced', tone: 'accent' }
              ]}
            />
          </Stack>
        ) : (
          <Callout tone="danger" title="Completion failed">
            {fim.error}
          </Callout>
        )}
      </Stack>
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
                    ? 'Unavailable — use MISTRAL_API_KEY'
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
        <Text weight="semibold">Local ledger</Text>
        <Text size="xs" muted>
          {value.ledger.entries.length} calls recorded, {formatUSD(value.ledger.total)} estimated. Prices read{' '}
          {value.pricesUpdated}.
        </Text>
        <Button variant="ghost" onPress={() => void clearLedger()} disabled={value.ledger.entries.length === 0}>
          Clear local ledger
        </Button>
      </Stack>

      <Separator />

      <Stack gap="xs">
        <Text weight="semibold">Agent launch hook</Text>
        <Text size="xs" muted>
          With “Inject API key” on, agents Orca launches from the configured list receive MISTRAL_API_KEY
          from the same key this panel uses. Manage the list in Settings → Plugins → Mistral.
        </Text>
        <Text size="xs" muted>
          Last refreshed <RelativeTime at={value.fetchedAt} format="short" />
        </Text>
      </Stack>
    </Stack>
  )
}
