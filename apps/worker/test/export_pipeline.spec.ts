import { describe, it, expect, beforeEach, vi } from 'vitest'
import app, { queue as exportConsumer } from '../src/index'
import { createInMemoryR2 } from './utils/inMemoryR2'
import { signJWT_HS256 } from '../src/auth'

async function makeAuthHeader(sub: number, secret: string) {
  const now = Math.floor(Date.now() / 1000)
  const token = await signJWT_HS256({ sub, iat: now, exp: now + 3600 }, secret)
  return { Authorization: `Bearer ${token}` }
}

type Env = { DATABASE_URL: string; JWT_SECRET: string; VISIBILITY_USE_CLOSURE?: string; DATA_DRIVER?: string; R2_EXPORTS: any; R2_DATA?: any; EXPORT_QUEUE: any }

describe('Export pipeline (Queues + R2)', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    ;(globalThis as any).__PRISMA__ = { auditLog: { create: vi.fn(async () => ({ id: 1n })), count: vi.fn(async () => 0) } }
  })

  it('enqueues export, consumer writes to R2, status & download work', async () => {
    const R2 = createInMemoryR2()
    const QUEUE = { send: vi.fn(async (_msg: any) => {}) }
    const TEST_ENV: Env = { DATABASE_URL: 'postgres://test', JWT_SECRET: 'test-secret', VISIBILITY_USE_CLOSURE: 'false', DATA_DRIVER: '2', R2_EXPORTS: R2, R2_DATA: R2, EXPORT_QUEUE: QUEUE }

    const headers = await makeAuthHeader(1, TEST_ENV.JWT_SECRET)
    const res1 = await app.request('http://test/api/reports/weekly/export?week=2025W38&scope=self', { method: 'POST', headers }, TEST_ENV)
    expect(res1.status).toBe(200)
    const { jobId } = await res1.json() as any
    expect(typeof jobId).toBe('string')

    // Simulate consumer processing the message
    const message = { body: { jobId, viewerId: 1, scope: 'self', start: '2025-09-15', end: '2025-09-21', objectKey: `weekly/${jobId}.xlsx` }, ack: vi.fn() }
    await exportConsumer({ messages: [message] } as any, TEST_ENV)
    expect(message.ack).toHaveBeenCalled()

    // Status should be ready now
    const res2 = await app.request(`http://test/api/reports/weekly/export/status?id=${jobId}`, { method: 'GET', headers }, TEST_ENV)
    expect(res2.status).toBe(200)
    const st: any = await res2.json()
    expect(st.status).toBe('ready')

    // Download should return file
    const res3 = await app.request(`http://test/api/reports/weekly/export/download?id=${jobId}`, { method: 'GET', headers }, TEST_ENV)
    expect(res3.status).toBe(200)
    const buf = new Uint8Array(await res3.arrayBuffer())
    expect(buf.length).toBeGreaterThan(0)
    // ZIP magic 'PK'\n    expect(buf[0]).toBe(0x50); expect(buf[1]).toBe(0x4B)
  })
})


