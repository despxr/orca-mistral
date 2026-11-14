/**
 * Turn Mistral's `/v1/models` listing into one row per billable model.
 *
 * The listing repeats every alias as its own entry with the same display name,
 * so entries are grouped by `billing_model_name` (falling back to the name) and
 * one canonical id is chosen: the id equal to the billing name, else the id
 * equal to the display name, else the shortest id without `-latest`.
 */
import { priceFor, PRICE_TABLE, type Price } from './prices'

export type ApiModel = {
  id: string
  name?: string
  description?: string
  max_context_length?: number
  capabilities?: Record<string, boolean>
  aliases?: string[]
  billing_model_name?: string
  deprecation?: unknown
}

export type ModelInfo = {
  id: string
  name: string
  description: string
  context: number
  caps: string[]
  aliases: string[]
  price: Price | null
  deprecated: boolean
}

function capsOf(model: ApiModel): string[] {
  const caps = model.capabilities ?? {}
  return Object.keys(caps)
    .filter((key) => caps[key] === true)
    .map((key) => key.replace(/_/g, ' '))
    .sort()
}

function canonicalOf(group: ApiModel[]): ApiModel {
  const billing = group[0]?.billing_model_name
  if (billing !== undefined) {
    const exact = group.find((model) => model.id === billing)
    if (exact !== undefined) return exact
  }
  const name = group[0]?.name?.toLowerCase()
  if (name !== undefined) {
    const exact = group.find((model) => model.id.toLowerCase() === name)
    if (exact !== undefined) return exact
  }
  const stable = group.filter((model) => !model.id.endsWith('-latest'))
  const pool = stable.length > 0 ? stable : group
  return [...pool].sort((a, b) => a.id.length - b.id.length || a.id.localeCompare(b.id))[0]
}

function priceOf(model: ApiModel, aliases: string[], overrides?: Record<string, Price>): Price | null {
  const candidates = [model.id, model.billing_model_name, model.name, ...aliases]
  for (const candidate of candidates) {
    if (typeof candidate !== 'string' || candidate === '') continue
    const price = priceFor(candidate, overrides)
    if (price !== null) return price
  }
  return null
}

/** One entry per distinct model, priced where the table knows it. */
export function groupModels(list: ApiModel[], overrides?: Record<string, Price>): ModelInfo[] {
  const groups = new Map<string, ApiModel[]>()
  for (const model of list) {
    if (typeof model?.id !== 'string' || model.id === '') continue
    const key = String(model.billing_model_name ?? model.name ?? model.id).toLowerCase()
    const group = groups.get(key)
    if (group === undefined) groups.set(key, [model])
    else group.push(model)
  }

  const rows: ModelInfo[] = []
  for (const group of groups.values()) {
    const canonical = canonicalOf(group)
    const aliases = [...new Set(group.flatMap((model) => [model.id, ...(model.aliases ?? [])]))]
      .filter((id) => id !== canonical.id)
      .sort()
    rows.push({
      id: canonical.id,
      name: canonical.name ?? canonical.id,
      description: canonical.description ?? '',
      context: Number(canonical.max_context_length) || 0,
      caps: capsOf(canonical),
      aliases,
      price: priceOf(canonical, aliases, overrides),
      deprecated: canonical.deprecation !== null && canonical.deprecation !== undefined,
    })
  }

  return rows.sort((a, b) => {
    if (a.deprecated !== b.deprecated) return a.deprecated ? 1 : -1
    return a.name.localeCompare(b.name) || a.id.localeCompare(b.id)
  })
}

/** The table's own models, for when the live listing cannot be read. */
export function fallbackModels(overrides?: Record<string, Price>): ModelInfo[] {
  return Object.keys(PRICE_TABLE)
    .map((id) => ({
      id,
      name: id,
      description: 'From the bundled price table; the live catalog was unavailable.',
      context: 0,
      caps: [],
      aliases: [],
      price: priceFor(id, overrides),
      deprecated: false,
    }))
    .sort((a, b) => a.id.localeCompare(b.id))
}
