import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import app from '../src/index'
import { createInMemoryR2 } from './utils/inMemoryR2'
import { signJWT_HS256 } from '../src/auth'
import * as visibility from '../src/visibility'

async function makeAuthHeader(sub: number, secret: string) {
  const now = Math.floor(Date.now() / 1000)
  const token = await signJWT_HS256({ sub, iat: now, exp: now + 3600 }, secret)
  return { Authorization: `Bearer ${token}` }
}

type Env = { DATABASE_URL: string; JWT_SECRET: string; VISIBILITY_USE_CLOSURE?: string; DATA_DRIVER?: string; R2_EXPORTS: any; R2_DATA?: any }

const TEST_ENV: Env = {
  DATABASE_URL: 'postgres://test',
  JWT_SECRET: 'test-secret',
  VISIBILITY_USE_CLOSURE: 'false',
  DATA_DRIVER: '1',
  R2_EXPORTS: createInMemoryR2(),
  R2_DATA: createInMemoryR2(),
}

describe('Missing weekly API', () => {
  let resolveSpy: vi.SpiedFunction<typeof visibility.resolveVisibleUsers>

  beforeEach(() => {
    vi.restoreAllMocks()
    ;(globalThis as any).__PRISMA__ = undefined
    resolveSpy = vi.spyOn(visibility, 'resolveVisibleUsers').mockResolvedValue([1n, 2n])
  })

  afterEach(() => {
    resolveSpy.mockRestore()
  })

  it('GET /api/reports/missing-weekly returns missing users', async () => {
    const prismaMock: any = {
      user: {
        findMany: vi.fn(async () => [
          { id: 1n, name: 'Alice', email: 'a@example.com', employeeNo: 'E1', active: true },
          { id: 2n, name: 'Bob', email: 'b@example.com', employeeNo: 'E2', active: true },
        ]),
      },
      $queryRaw: vi.fn(async () => [
        { user_id: 2n, day: new Date('2025-09-16T00:00:00Z') },
      ]),
      auditLog: {
        create: vi.fn(async () => ({ id: 1n })),
      },
    }
    ;(globalThis as any).__PRISMA__ = prismaMock

    const headers = await makeAuthHeader(1, TEST_ENV.JWT_SECRET)
    const res = await app.request('http://test/api/reports/missing-weekly?from=2025-09-15&to=2025-09-21&scope=subtree', {
      method: 'GET',
      headers,
    }, TEST_ENV as any)

    expect(res.status).toBe(200)
    const json: any = await res.json()
    expect(json.ok).toBe(true)
    expect(json.stats.missingUsers).toBe(1)
    expect(json.data[0].userId).toBe(2)
    expect(json.data[0].missingDates).toContain('2025-09-16')
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: 'report_missing_weekly' }),
    }))
  })

  it('POST /api/reports/missing-weekly/remind notifies selected users', async () => {
    const prismaMock: any = {
      user: {
        findMany: vi.fn(async () => [
          { id: 1n, name: 'Alice', email: 'a@example.com', employeeNo: 'E1', active: true },
          { id: 2n, name: 'Bob', email: 'b@example.com', employeeNo: 'E2', active: true },
        ]),
      },
      $queryRaw: vi.fn(async () => [
        { user_id: 2n, day: new Date('2025-09-16T00:00:00Z') },
      ]),
      auditLog: {
        create: vi.fn(async () => ({ id: 1n })),
      },
    }
    ;(globalThis as any).__PRISMA__ = prismaMock

    const headers = await makeAuthHeader(1, TEST_ENV.JWT_SECRET)
    const res = await app.request('http://test/api/reports/missing-weekly/remind?from=2025-09-15&to=2025-09-21&scope=subtree', {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ userIds: [2] }),
    }, TEST_ENV as any)

    expect(res.status).toBe(200)
    const json: any = await res.json()
    expect(json.ok).toBe(true)
    expect(json.notified).toBe(1)
    expect(json.targets[0].userId).toBe(2)
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: 'missing_notify' }),
    }))
  })
})



