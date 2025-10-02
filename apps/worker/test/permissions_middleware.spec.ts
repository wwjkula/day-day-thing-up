import { describe, it, expect, beforeEach, vi } from 'vitest'
import app from '../src/index'
import { signJWT_HS256 } from '../src/auth'
import { normalizeScope, parseRangeFromQuery } from '../src/middlewares/permissions'

async function makeAuthHeader(sub: number, secret: string) {
  const now = Math.floor(Date.now() / 1000)
  const token = await signJWT_HS256({ sub, iat: now, exp: now + 3600 }, secret)
  return { Authorization: `Bearer ${token}` }
}

describe('permissions middleware', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    ;(globalThis as any).__PRISMA__ = undefined
  })

  it('normalizeScope maps subordinates->direct and defaults to self', () => {
    expect(normalizeScope('subordinates')).toBe('direct')
    expect(normalizeScope('direct')).toBe('direct')
    expect(normalizeScope('subtree')).toBe('subtree')
    expect(normalizeScope('unknown')).toBe('self')
    expect(normalizeScope(undefined)).toBe('self')
  })

  it('parseRangeFromQuery supports ISO week and from/to, rejects invalid', () => {
    const r1 = parseRangeFromQuery({ week: '2025W38' }) as any
    expect('error' in r1).toBe(false)
    expect(r1.start).toBeInstanceOf(Date)
    expect(r1.end).toBeInstanceOf(Date)

    const r2 = parseRangeFromQuery({ from: '2025-09-15', to: '2025-09-21' }) as any
    expect('error' in r2).toBe(false)

    const r3 = parseRangeFromQuery({ week: '2025-38' }) as any
    expect(r3.error).toBeTruthy()

    const r4 = parseRangeFromQuery({ from: 'bad', to: '2025-09-21' }) as any
    expect(r4.error).toBeTruthy()

    const r5 = parseRangeFromQuery({ from: '2025-09-22', to: '2025-09-21' }) as any
    expect(r5.error).toBeTruthy()
  })

  it('export route writes export_request audit via middleware wiring', async () => {
    const TEST_ENV: any = {
      DATABASE_URL: 'postgres://test',
      JWT_SECRET: 'test-secret',
      VISIBILITY_USE_CLOSURE: 'false',
      DATA_DRIVER: '1',
      R2_EXPORTS: { put: vi.fn(async () => {}), get: vi.fn(async () => null) },
      EXPORT_QUEUE: { send: vi.fn(async () => {}) },
    }
    const prismaMock: any = { auditLog: { create: vi.fn(async () => ({ id: 1n })), count: vi.fn(async () => 0) } }
    ;(globalThis as any).__PRISMA__ = prismaMock

    const headers = await makeAuthHeader(1, TEST_ENV.JWT_SECRET)
    const res = await app.request('http://test/api/reports/weekly/export?week=2025W38&scope=self', {
      method: 'POST',
      headers,
    }, TEST_ENV)
    expect(res.status).toBe(200)
    expect(prismaMock.auditLog.create).toHaveBeenCalled()
    const arg = (prismaMock.auditLog.create as any).mock.calls[0][0]
    expect(arg.data.action).toBe('export_request')
    expect(arg.data.detail.scope).toBe('self')
    expect(arg.data.detail.start).toMatch(/\d{4}-\d{2}-\d{2}/)
    expect(arg.data.detail.end).toMatch(/\d{4}-\d{2}-\d{2}/)
  })
})






