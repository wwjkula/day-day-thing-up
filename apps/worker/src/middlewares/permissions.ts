import { PrismaClient } from '@prisma/client'
import { PrismaNeonHTTP } from '@prisma/adapter-neon'

export type Scope = 'self' | 'direct' | 'subtree'

export function normalizeScope(raw?: string): Scope {
  const s = String(raw || 'self').toLowerCase()
  if (s === 'subordinates') return 'direct'
  if (s === 'self' || s === 'direct' || s === 'subtree') return s as Scope
  return 'self'
}

function parseISOWeek(week: string): { start: Date; end: Date } | null {
  const m = /^(\d{4})W(\d{2})$/.exec(String(week))
  if (!m) return null
  const year = Number(m[1]); const w = Number(m[2])
  if (w < 1 || w > 53) return null
  const jan4 = new Date(Date.UTC(year, 0, 4))
  const dow = jan4.getUTCDay() || 7
  const week1Mon = new Date(Date.UTC(year, 0, 4))
  week1Mon.setUTCDate(jan4.getUTCDate() - (dow - 1))
  const start = new Date(week1Mon)
  start.setUTCDate(week1Mon.getUTCDate() + (w - 1) * 7)
  start.setUTCHours(0, 0, 0, 0)
  const end = new Date(start)
  end.setUTCDate(start.getUTCDate() + 6)
  end.setUTCHours(23, 59, 59, 999)
  return { start, end }
}

export function parseRangeFromQuery(query: Record<string, any>): { start: Date; end: Date } | { error: string } {
  const week = query.week ? String(query.week) : undefined
  const reDate = /^\d{4}-\d{2}-\d{2}$/
  if (week) {
    const r = parseISOWeek(week)
    if (!r) return { error: 'week must be YYYYWww (ISO week)' }
    return r
  }
  const fromStr = String(query.from || '')
  const toStr = String(query.to || '')
  if (!reDate.test(fromStr) || !reDate.test(toStr)) return { error: 'from/to must be YYYY-MM-DD' }
  const start = new Date(fromStr + 'T00:00:00Z')
  const end = new Date(toStr + 'T23:59:59Z')
  if (isNaN(start.getTime()) || isNaN(end.getTime()) || start > end) return { error: 'invalid date range' }
  return { start, end }
}

// Lightweight canRead: normalize scope & range; leave set of visible users to route until fully migrated
export async function canRead(c: any, next: any) {
  const scope = normalizeScope(c.req.query('scope'))
  const range = parseRangeFromQuery(Object.fromEntries(new URL(c.req.url).searchParams))
  if ('error' in range) return c.json({ error: range.error }, 400)
  c.set('scope', scope)
  c.set('range', range)
  await next()
}

// --- Export policy & rate limit ---

type Bindings = { DATABASE_URL: string }

declare global {
  // eslint-disable-next-line no-var
  var __PRISMA__: PrismaClient | undefined
}

function getPrisma(env: Bindings) {
  if (!globalThis.__PRISMA__) {
    const adapter = new PrismaNeonHTTP(env.DATABASE_URL, {})
    globalThis.__PRISMA__ = new PrismaClient({ adapter })
  }
  return globalThis.__PRISMA__ as PrismaClient
}

async function isRateLimited(prisma: PrismaClient, actorUserId: bigint, maxPerMin: number): Promise<boolean> {
  const since = new Date(Date.now() - 60_000)
  const count = await prisma.auditLog.count({
    where: {
      actorUserId,
      action: { in: ['export_request'] },
      createdAt: { gte: since },
    },
  })
  return count >= maxPerMin
}

export async function canExport(c: any, next: any) {
  // Parse scope & range first
  const scope = normalizeScope(c.req.query('scope'))
  const range = parseRangeFromQuery(Object.fromEntries(new URL(c.req.url).searchParams))
  if ('error' in range) return c.json({ error: range.error }, 400)
  c.set('scope', scope)
  c.set('range', range)

  // Rate limiting by audit logs (best-effort)
  const user = c.get('user')
  const sub = user?.sub ?? user?.userId ?? user?.id
  if (sub == null) return c.json({ error: 'No subject in token' }, 400)
  const viewerId = BigInt(sub)

  const prisma = getPrisma(c.env as Bindings)
  const MAX_PER_MIN = 5
  if (await isRateLimited(prisma, viewerId, MAX_PER_MIN)) {
    // audit denial (best-effort)
    await audit(prisma, { actorUserId: viewerId, action: 'export_denied', objectType: 'work_item', detail: { reason: 'rate_limit', maxPerMin: MAX_PER_MIN } })
    return c.json({ code: 'RATE_LIMITED', error: 'too many export requests' }, 429)
  }

  await next()
}

export async function audit(prisma: any, data: { actorUserId: bigint; action: string; objectType?: string; objectId?: bigint; detail?: any }) {
  try {
    await prisma.auditLog.create({
      data: {
        actorUserId: data.actorUserId,
        action: data.action,
        objectType: data.objectType ?? null,
        objectId: data.objectId ?? null,
        detail: data.detail ?? null,
      }
    })
  } catch {
    // best-effort
  }
}

// --- Admin guard ---
export async function requireAdmin(c: any, next: any) {
  const user = c.get('user')
  const sub = user?.sub ?? user?.userId ?? user?.id
  if (sub == null) return c.json({ error: 'Unauthorized' }, 401)

  // Fast-path: JWT may carry isAdmin=true
  if (user?.isAdmin === true) return next()

  const prisma = getPrisma(c.env as any)
  const today = new Date()
  const grant = await prisma.roleGrant.findFirst({
    where: {
      granteeUserId: BigInt(sub),
      role: { code: 'sys_admin' },
      startDate: { lte: today },
      OR: [ { endDate: null }, { endDate: { gte: today } } ],
    },
    select: { id: true },
  })
  if (!grant) return c.json({ error: 'Forbidden' }, 403)
  await next()
}
