// The panel <-> worker contract, declared once: src/panel.tsx and src/worker.ts both read it.
import type { CacheStats, SaveKeyResult, Status } from './types'

export {}

declare module 'orca' {
  interface PluginRequests {
    /** Account budget, live model prices and the key status. */
    'mistral.status': { input: Record<string, never>; output: Status }
    /** Stores the API key in Orca's encrypted secrets and returns the new status. */
    'mistral.saveKey': { input: { key: string }; output: SaveKeyResult }
    /** Removes the stored API key and returns the new status. */
    'mistral.clearKey': { input: Record<string, never>; output: Status }
    /** pi/Mistral cache hit rate and cost, read from pi's local session logs. */
    'mistral.cache': { input: Record<string, never>; output: CacheStats }
  }
  interface PluginPanelEvents {
    /** Posted after the worker refreshed its account data. */
    'mistral.updated': { fetchedAt: number }
  }
}
