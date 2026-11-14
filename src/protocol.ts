// The panel <-> worker contract, declared once: src/panel.tsx and src/worker.ts both read it.
import type { EmbedResult, FimResult, OcrResult, SaveKeyResult, Status } from './types'

export {}

declare module 'orca' {
  interface PluginRequests {
    /** Account budget, live model catalog and the local cost ledger. */
    'mistral.status': { input: Record<string, never>; output: Status }
    /** Stores the API key in Orca's encrypted secrets and returns the new status. */
    'mistral.saveKey': { input: { key: string }; output: SaveKeyResult }
    /** Removes the stored API key and returns the new status. */
    'mistral.clearKey': { input: Record<string, never>; output: Status }
    /** OCR a document or image URL (or a data: URL) to markdown. */
    'mistral.ocr': { input: { source: string }; output: OcrResult }
    /** Embed one or more texts with the configured embedding model. */
    'mistral.embed': { input: { texts: string[] }; output: EmbedResult }
    /** Codestral fill-in-the-middle completion. */
    'mistral.fim': {
      input: { prompt: string; suffix: string; maxTokens: number }
      output: FimResult
    }
    /** Empties the local cost ledger. */
    'mistral.clearLedger': { input: Record<string, never>; output: Status }
  }
  interface PluginPanelEvents {
    /** Posted after a call is recorded or the worker refreshed its account data. */
    'mistral.updated': { fetchedAt: number }
  }
}
