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

// Minimal Prisma mock shape used by routes
function makePrismaMock() {
  const state: any = {
    created: [] as any[],
    listed: [] as any[],
  }
  const prisma: any = {
    $queryRaw: vi.fn(async (_strings: TemplateStringsArray, ..._vals: any[]) => {
      // For POST: primary org lookup
      return [{ org_id: 11n }]
    }),
    workItem: {
      create: vi.fn(async ({ data }: any) => {
        const id = BigInt(state.created.length + 1)
        state.created.push({ id, ...data })
        return { id }
      }),
      findMany: vi.fn(async ({ where, take, skip }: any) => {
        // Return 2 items for testing
        const base = [
          {
            id: 1n,
            creatorId: BigInt(1),
            orgId: 11n,
            workDate: new Date('2025-09-15T00:00:00Z'),
            title: 'A',
            type: 'done',
            durationMinutes: 60,
            tags: '巡检,一线',
            detail: null,
          },
          {
            id: 2n,
            creatorId: BigInt(2),
            orgId: 11n,
            workDate: new Date('2025-09-16T00:00:00Z'),
            title: 'B',
            type: 'progress',
            durationMinutes: null,
            tags: null,
            detail: 'd',
          },
        ]
        return base.slice(skip ?? 0, (skip ?? 0) + (take ?? base.length))
      }),
      count: vi.fn(async () => 2),
    },
    auditLog: {
      create: vi.fn(async () => ({ id: 1n })),
    },
  }
  return { prisma, state }
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

describe('Work Items API', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    ;(globalThis as any).__PRISMA__ = undefined
  })

  it('POST /api/work-items rejects title > 20 chars', async () => {
    const { prisma } = makePrismaMock()
    ;(globalThis as any).__PRISMA__ = prisma
    const headers = await makeAuthHeader(1, TEST_ENV.JWT_SECRET)
    const longTitle = '一二三四五六七八九十一二三四五六七八九十一' // 21 字
    const res = await app.request('http://test/api/work-items', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify({ workDate: '2025-09-15', title: longTitle, type: 'done' }),
    }, TEST_ENV)
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toMatch(/title/i)
  })

  it('POST /api/work-items creates item when valid', async () => {
    const { prisma } = makePrismaMock()
    ;(globalThis as any).__PRISMA__ = prisma
    const headers = await makeAuthHeader(1, TEST_ENV.JWT_SECRET)
    const res = await app.request('http://test/api/work-items', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify({ workDate: '2025-09-15', title: '设备巡检已完成', type: 'done' }),
    }, TEST_ENV)
    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json).toHaveProperty('id')
  })

  it('GET /api/work-items requires valid date range', async () => {
    const { prisma } = makePrismaMock()
    ;(globalThis as any).__PRISMA__ = prisma
    const headers = await makeAuthHeader(1, TEST_ENV.JWT_SECRET)
    const res = await app.request('http://test/api/work-items?from=bad&to=2025-09-15', {
      method: 'GET',
      headers,
    }, TEST_ENV)
    expect(res.status).toBe(400)
  })

  it('GET /api/work-items lists with scope=self', async () => {
    const { prisma } = makePrismaMock()
    ;(globalThis as any).__PRISMA__ = prisma
    const headers = await makeAuthHeader(1, TEST_ENV.JWT_SECRET)
    const res = await app.request('http://test/api/work-items?from=2025-09-15&to=2025-09-21&scope=self', {
      method: 'GET',
      headers,
    }, TEST_ENV)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(Array.isArray(json.items)).toBe(true)
    expect(json.limit).toBeDefined()
  })

  it('GET /api/work-items accepts alias scope=subordinates as direct', async () => {
    const { prisma } = makePrismaMock()
    ;(globalThis as any).__PRISMA__ = prisma
    const headers = await makeAuthHeader(1, TEST_ENV.JWT_SECRET)
    const res = await app.request('http://test/api/work-items?from=2025-09-15&to=2025-09-21&scope=subordinates', {
      method: 'GET',
      headers,
    }, TEST_ENV)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.items.length).toBeGreaterThan(0)
  })
})

