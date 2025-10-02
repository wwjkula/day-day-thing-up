import { TextDecoder, TextEncoder } from 'util'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

export interface InMemoryR2Object {
  body: Uint8Array
  httpMetadata?: any
  etag: string
}

export interface PutOptions {
  httpMetadata?: any
  onlyIf?: { etagMatches?: string | null }
}

export interface GetResult {
  body: Uint8Array
  httpMetadata?: any
  etag: string
  httpEtag: string
  json(): Promise<any>
  text(): Promise<string>
}

export interface HeadResult {
  key: string
  size: number
  httpMetadata?: any
  etag: string
  httpEtag: string
}

function toUint8(value: string | ArrayBuffer | ArrayBufferView | Uint8Array): Uint8Array {
  if (typeof value === 'string') return encoder.encode(value)
  if (value instanceof Uint8Array) return new Uint8Array(value)
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength))
  if (value instanceof ArrayBuffer) return new Uint8Array(value)
  throw new TypeError('Unsupported R2 value type')
}

function randomEtag(): string {
  return `etag-${Math.random().toString(36).slice(2)}-${Date.now()}`
}

export function createInMemoryR2(initial: Record<string, string | Uint8Array> = {}) {
  const store = new Map<string, InMemoryR2Object>()
  for (const [key, value] of Object.entries(initial)) {
    store.set(key, { body: toUint8(value), etag: randomEtag() })
  }

  return {
    async put(key: string, value: string | ArrayBuffer | ArrayBufferView | Uint8Array, opts: PutOptions = {}) {
      const body = toUint8(value)
      const existing = store.get(key)
      if (opts.onlyIf && 'etagMatches' in opts.onlyIf) {
        const expected = opts.onlyIf.etagMatches ?? null
        const actual = existing?.etag ?? null
        if (expected !== actual) {
          const err: any = new Error('Precondition Failed')
          err.status = 412
          throw err
        }
      }
      const etag = randomEtag()
      store.set(key, { body, httpMetadata: opts.httpMetadata, etag })
      return { etag, httpEtag: etag }
    },

    async get(key: string): Promise<GetResult | null> {
      const entry = store.get(key)
      if (!entry) return null
      const { body, httpMetadata, etag } = entry
      return {
        body,
        httpMetadata,
        etag,
        httpEtag: etag,
        async json() {
          return JSON.parse(decoder.decode(body))
        },
        async text() {
          return decoder.decode(body)
        },
      }
    },

    async head(key: string): Promise<HeadResult | null> {
      const entry = store.get(key)
      if (!entry) return null
      return {
        key,
        size: entry.body.length,
        httpMetadata: entry.httpMetadata,
        etag: entry.etag,
        httpEtag: entry.etag,
      }
    },

    async delete(key: string): Promise<void> {
      store.delete(key)
    },

    _store: store,
  }
}
