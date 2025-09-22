import { describe, it, expect, beforeEach, vi } from 'vitest'
import app from '../src/index'
import { signJWT_HS256 } from '../src/auth'

// Helper to create auth header
async function makeAuthHeader(sub: number, secret: string) {
  const now = Math.floor(Date.now() / 1000)
  const token = await signJWT_HS256({ sub, iat: now, exp: now + 3600 }, secret)
  return { Authorization: `Bearer ${token}` }
}

type Env = { DATABASE_URL: string; JWT_SECRET: string; VISIBILITY_USE_CLOSURE?: string }

const TEST_ENV: Env = { DATABASE_URL: 'postgres://test', JWT_SECRET: 'test-secret', VISIBILITY_USE_CLOSURE: 'false' }

// Minimal Prisma mock shape used by weekly route
function makePrismaMock() {
  const prisma: any = {
    $queryRaw: vi.fn(async (_strings: TemplateStringsArray, ..._vals: any[]) => {
      // Weekly aggregation query returns two rows for one week
      return [
        {
          creator_id: 1n,
          work_date: new Date('2025-09-15T00:00:00Z'), // Monday
          item_count: 2n,
          total_minutes: 120n,
          done_count: 1n,
          progress_count: 1n,
          temp_count: 0n,
          assist_count: 0n,
        },
        {
          creator_id: 2n,
          work_date: new Date('2025-09-16T00:00:00Z'), // Tuesday
          item_count: 1n,
          total_minutes: 0n,
          done_count: 1n,
          progress_count: 0n,
          temp_count: 0n,
          assist_count: 0n,
        },
      ]
    }),
    auditLog: {
      create: vi.fn(async () => ({ id: 1n })),
    },
  }
  return { prisma }
}

// Mock visibility resolver to avoid DB dependency
vi.mock('../src/visibility', () => {
  return {
    resolveVisibleUsers: vi.fn(async (_prisma: any, viewerId: bigint, scope: string) => {
      if (scope === 'self') return [viewerId]
      if (scope === 'direct') return [viewerId, 2n]
      if (scope === 'subtree') return [viewerId, 2n, 3n]
      return [viewerId]
    }),
    makeClosureDrivers: vi.fn(() => ({})),
  }
})

describe('Weekly Reports API', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    ;(globalThis as any).__PRISMA__ = undefined
  })

  it('rejects invalid week format', async () => {
    const { prisma } = makePrismaMock()
    ;(globalThis as any).__PRISMA__ = prisma
    const headers = await makeAuthHeader(1, TEST_ENV.JWT_SECRET)
    const res = await app.request('http://test/api/reports/weekly?week=2025-37', {
      method: 'GET',
      headers,
    }, TEST_ENV)
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(String(json.error)).toMatch(/week/i)
  })

  it('returns aggregated rows for valid ISO week', async () => {
    const { prisma } = makePrismaMock()
    ;(globalThis as any).__PRISMA__ = prisma
    const headers = await makeAuthHeader(1, TEST_ENV.JWT_SECRET)
    const res = await app.request('http://test/api/reports/weekly?week=2025W38&scope=subordinates', {
      method: 'GET',
      headers,
    }, TEST_ENV)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(json.range.start).toMatch(/^2025-09-/)
    expect(Array.isArray(json.data)).toBe(true)
    expect(json.data.length).toBeGreaterThan(0)
    expect(json.data[0]).toHaveProperty('creatorId')
    expect(json.data[0]).toHaveProperty('typeCounts')
  })
})

