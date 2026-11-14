# Mistral for Orca

Mistral account budget, a live model catalog, a per-call cost ledger, the platform
tools worth offloading to the API (OCR, embeddings, fill-in-the-middle), and
`MISTRAL_API_KEY` injection for the agents Orca launches — in one Orca plugin.

The panel lives in Orca's right sidebar. A status-bar item shows today's estimated
spend, and three commands are in the palette.

## What it shows

- **Account budget** — `GET /v1/billing/budget` and `/v1/billing/subscription`:
  the Vibe and API allowance windows, their percentage used, reset date and plan.
  This is the authoritative account-level number, covering agents and every other
  client on the key.
- **This plugin's calls** — every OCR, embedding and FIM request the panel makes is
  recorded with the token or page counts Mistral returned and priced from
  [the API price list](https://docs.mistral.ai/inference/pricing). Today, 7 days,
  month-to-date, cache savings, spend per model and the recent calls are all local.
- **Models** — `GET /v1/models`, grouped so aliases collapse into one row, with
  context window, capabilities and input/output/cached prices. Select a row for the
  full price and a cost calculator.
- **Tools** — OCR a PDF or image URL to markdown, embed a list of texts, or run a
  Codestral fill-in-the-middle completion. Each result shows what it cost.
- **Agent launch hook** — when Orca starts an agent from the configured list
  (`pi`, `dsh`, `hermes`, `opencode`, …), the hook adds `MISTRAL_API_KEY` to its
  environment from the same key the panel uses, and can append per-agent CLI
  arguments (for example `--model mistral-responses/deepseek-v4-1-flash-1017`).
  No shell export needed.

## Scope: what the hook can and cannot do

Orca's plugin API has no MCP or tool contribution point yet (`contributes.mcpServers`
is reserved and must stay empty). So:

- The OCR, embedding and FIM buttons are **yours**: they run from the panel and are
  recorded in the ledger. Agents do not get `mistral_ocr`-style tools from this
  plugin.
- The launch hook only supplies the credential (and optional CLI arguments). It does
  not add a Mistral provider to a harness. The harness must already know how to use
  Mistral.
- The ledger covers this plugin's calls. Per-agent token usage is not visible to
  Orca plugins; the account budget is the authoritative all-client number.

### Harnesses

`injectAgents` defaults to the harnesses that actually read `MISTRAL_API_KEY`:

| Agent id | Reads the key | What it still needs |
| --- | --- | --- |
| `pi` | yes | Built-in `mistral` provider, or `pi-mistral-responses` for reasoning replay. Select with `launchArgs`, e.g. `--model mistral-responses/deepseek-v4-1-flash-1017`. |
| `dsh` | yes | Built-in `mistral` provider or `dsh-mistral` (`mistral-pro`). Select the provider in the profile's `cordis.patch.yml`; dsh has no `--model` flag. |
| `hermes` | yes | `hermes-mistral` provider. `launchArgs` example: `--provider mistral --model deepseek-v4-1-flash-1017`. |
| `opencode`, `opencode2` | yes | Built-in Mistral provider. `launchArgs` example: `--model mistral/mistral-large-latest`. |
| `claude`, `codex`, `gemini`, … | no | Not injected by default; they do not read `MISTRAL_API_KEY`. |

`launchArgs` is a JSON object keyed by agent id, appended to the launch command:

```json
{
  "pi": "--model mistral-responses/deepseek-v4-1-flash-1017",
  "hermes": "--provider mistral --model deepseek-v4-1-flash-1017",
  "opencode": "--model mistral/mistral-large-latest"
}
```

If a harness is not configured for Mistral, the key is injected but unused; the
agent starts on its normal provider. Set `injectApiKey` off to disable the hook
entirely.

## Install

From the Orca app: **Settings → Plugins → Development folders…** and add this
folder, or from a terminal:

```sh
orca plugin dev load .
```

The plugin asks for `storage:own`, `settings:own`, `secrets:own` and
`notifications:show`, and runs its worker out of process. Approve it once.

Then open the **Mistral** panel in the right sidebar and paste an API key from
[console.mistral.ai](https://console.mistral.ai). The key is stored in Orca's
encrypted secrets. If the OS key store is unavailable (Linux without a keyring),
set `MISTRAL_API_KEY` in the environment instead; the panel reads it as a fallback.

## Settings

| Setting | Default | What it does |
| --- | --- | --- |
| `baseURL` | `https://api.mistral.ai/v1` | API endpoint, for a proxy or gateway. |
| `apiKeyEnv` | `MISTRAL_API_KEY` | Environment variable read when no key is stored. |
| `refreshMinutes` | `15` | How often the worker refreshes the budget and status bar. |
| `showStatusBar` | `true` | Show today's spend in the status bar. |
| `injectApiKey` | `true` | Add the key to launched agents' environment. |
| `injectAgents` | `pi,dsh,hermes,opencode,opencode2` | Agent ids that read the key; empty means all. |
| `launchArgs` | `{}` | JSON map of agent id to CLI arguments appended at launch, e.g. `{"pi":"--model mistral-responses/deepseek-v4-1-flash-1017"}`. |
| `ocrModel` | `mistral-ocr-latest` | Model used by the OCR tool. |
| `embedModel` | `codestral-embed` | Model used by the embeddings tool. |
| `fimModel` | `codestral-latest` | Model used by the FIM tool. |
| `priceOverrides` | `{}` | JSON price rows for models newer than the bundled table. |

A price override is keyed by model id and takes any of `input`, `output`,
`cacheRead` (USD per 1M tokens), `per1000Pages`, `per1000AnnotatedPages`,
`perMinute` or `perMillionChars`:

```json
{
  "my-new-model": { "input": 0.4, "output": 1.6, "cacheRead": 0.04 }
}
```

## Cost model

Prices are USD, read from Mistral's API price list on 2026-11-15. The billing
budget is shown in the currency Mistral returns (EUR on a European account), so
the two numbers are labelled separately and never added together.

- Chat/FIM: uncached input at `input`, cached input at `cacheRead`, output at
  `output`. Mistral reports cached tokens as a subset of the prompt count, so the
  uncached remainder is `input - cached`.
- Embeddings: input tokens at `input`.
- OCR: pages at `per1000Pages` (annotated pages at `per1000AnnotatedPages`).
- A model with no row is reported as `unpriced`, never as `$0.00`.

The ledger is capped at the 500 most recent calls and can be cleared from the
Account tab or the palette.

## Development

```sh
orca plugin validate .     # manifest and files
orca plugin check .        # render each panel against a stand-in host
orca plugin test .         # prices, worker and panel tests
orca plugin shot . --scenario connected   # a PNG of the panel
```

`src/prices.ts` is the price table and cost math, `src/models.ts` groups the live
catalog, `src/worker.ts` owns the API calls and the hook, and `src/panel.tsx` is
the components panel. No build step: Orca transpiles the TypeScript and TSX.

## License

MIT.
