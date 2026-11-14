// Minimal Node builtin declarations for the worker. Orca's generated tsconfig
// does not ship @types/node; the worker runs in Node, so these are the only
// modules it imports.
declare module 'node:fs' {
  export function createReadStream(path: string, options?: { encoding?: string }): any
}

declare module 'node:fs/promises' {
  export function readdir(
    path: string,
    options: { withFileTypes: true }
  ): Promise<Array<{ name: string; isDirectory(): boolean; isFile(): boolean }>>
  export function stat(path: string): Promise<{ mtimeMs: number; isFile(): boolean; isDirectory(): boolean }>
  export function mkdtemp(prefix: string): Promise<string>
  export function writeFile(path: string, data: string): Promise<void>
  export function rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void>
}

declare module 'node:os' {
  export function tmpdir(): string
}

declare module 'node:readline' {
  export function createInterface(options: {
    input: any
    crlfDelay?: number
  }): AsyncIterable<string> & { close(): void }
}

declare module 'node:path' {
  export function join(...parts: string[]): string
}
