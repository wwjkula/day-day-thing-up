import { Hono } from 'hono'
import { Prisma, PrismaClient } from '@prisma/client'
import * as XLSX from 'xlsx'



import { neon } from '@neondatabase/serverless'
import { PrismaNeonHTTP } from '@prisma/adapter-neon'
import { verifyJWT_HS256, signJWT_HS256, type JWTPayload } from './auth'
import { resolveVisibleUsers, makeClosureDrivers } from './visibility'
import { canRead, canExport, audit, requireAdmin } from './middlewares/permissions'

import { registerAdminRoutes } from './admin'
import { hashPassword, verifyPassword } from './password'

type Bindings = { DATABASE_URL: string; JWT_SECRET: string; VISIBILITY_USE_CLOSURE?: string; QUEUE_DRIVER?: string; R2_EXPORTS: any; EXPORT_QUEUE?: any }

declare global {
  // Cloudflare Workers reuse Prisma across requests
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

const app = new Hono<{ Bindings: Bindings; Variables: { user?: JWTPayload; scope?: 'self'|'direct'|'subtree'; range?: { start: Date; end: Date }; visibleUserIds?: bigint[] } }>()


// Global JSON error/notFound handlers to avoid HTML/plaintext responses
app.onError((err, c) => {
  try { console.error(err) } catch {}
  return c.json({ ok: false, error: (err as any)?.message || 'Internal Server Error' }, 500)
})
app.notFound((c) => c.json({ ok: false, error: 'Not Found' }, 404))

// --- CORS for cross-origin frontend (Pages) ---
app.options('*', (c) => {
  const origin = c.req.header('origin') || '*'
  return new Response(null, { status: 204, headers: {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Vary': 'Origin',
  } })
})
app.use('*', async (c, next) => {
  await next()
  const origin = c.req.header('origin') || '*'
  c.header('Access-Control-Allow-Origin', origin)
  c.header('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS')
  c.header('Access-Control-Allow-Headers', 'Authorization, Content-Type')
  c.header('Vary', 'Origin')

})

// Auth: login by employeeNo/email + optional password (backward compatible if no password set)
app.post('/api/auth/login', async (c) => {
  const prisma: any = getPrisma(c.env)
  let body: any
  try { body = await c.req.json() } catch { return c.json({ ok: false, error: 'Invalid JSON' }, 400) }
  const employeeNo = (body.employeeNo ?? body.employee_no ?? '').toString().trim()
  const email = (body.email ?? '').toString().trim()
  const password = body.password != null ? String(body.password) : undefined
  if (!employeeNo && !email) return c.json({ ok: false, error: 'employeeNo or email required' }, 400)

  let user: any = null
  try {
    if (employeeNo) {
      user = await prisma.user.findUnique({ where: { employeeNo }, select: { id: true, name: true, email: true, employeeNo: true, passwordHash: true, passwordChangedAt: true } })
    } else if (email) {
      user = await prisma.user.findFirst({ where: { email }, select: { id: true, name: true, email: true, employeeNo: true, passwordHash: true, passwordChangedAt: true } })
    }
  } catch (e: any) {
    return c.json({ ok: false, error: 'lookup failed' }, 500)
  }
  if (!user) return c.json({ ok: false, error: 'invalid credentials' }, 401)

  // Optional: rate-limit excessive failed logins in last 5 minutes
  async function tooManyFailed(): Promise<boolean> {
    const since = new Date(Date.now() - 5 * 60 * 1000)
    const cnt = await prisma.auditLog.count({ where: { actorUserId: BigInt(user.id), action: { in: ['login_failed'] }, createdAt: { gte: since } } })
    return cnt >= 5
  }
  if (await tooManyFailed()) {
    try { await prisma.auditLog.create({ data: { actorUserId: BigInt(user.id), action: 'login_denied_rate_limit', objectType: 'user' } }) } catch {}
    return c.json({ ok: false, code: 'RATE_LIMITED', error: 'too many failed logins, try later' }, 429)
  }

  // If passwordHash exists, require correct password; otherwise allow legacy no-password login
  if (user.passwordHash) {
    const ok = await verifyPassword(password || '', user.passwordHash)
    if (!ok) {
      try { await prisma.auditLog.create({ data: { actorUserId: BigInt(user.id), action: 'login_failed', objectType: 'user' } }) } catch {}
      return c.json({ ok: false, error: 'invalid credentials' }, 401)
    }
  }

  // compute admin flag
  const today = new Date()
  const adminGrant = await prisma.roleGrant.findFirst({
    where: {
      granteeUserId: user.id,
      role: { code: 'sys_admin' },
      startDate: { lte: today },
      OR: [ { endDate: null }, { endDate: { gte: today } } ],
    }, select: { id: true }
  })
  const isAdmin = !!adminGrant

  const now = Math.floor(Date.now() / 1000)
  const token = await signJWT_HS256({ sub: Number(user.id), name: user.name, email: user.email ?? undefined, isAdmin, iat: now, exp: now + 24 * 3600 }, c.env.JWT_SECRET)

  // best-effort audit
  try { await prisma.auditLog.create({ data: { actorUserId: BigInt(user.id), action: 'login', objectType: 'user' } }) } catch {}

  return c.json({ ok: true, token, user: { id: Number(user.id), name: user.name, email: user.email ?? null, employeeNo: user.employeeNo ?? null, isAdmin } })
})

// Change password (requires current password). Enforce min length 6.
app.post('/api/auth/change-password', auth, async (c) => {
  const prisma: any = getPrisma(c.env)
  let body: any
  try { body = await c.req.json() } catch { return c.json({ ok: false, error: 'Invalid JSON' }, 400) }
  const currentPassword = typeof body.currentPassword === 'string' ? body.currentPassword : ''
  const newPassword = typeof body.newPassword === 'string' ? body.newPassword : ''
  if (newPassword.length < 6) return c.json({ ok: false, error: 'password too short' }, 400)

  const userPayload = c.get('user') as JWTPayload
  const sub = (userPayload as any)?.sub ?? (userPayload as any)?.userId ?? (userPayload as any)?.id
  if (sub == null) return c.json({ ok: false, error: 'No subject in token' }, 400)
  const userId = BigInt(sub)

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, passwordHash: true } })
  if (!user) return c.json({ ok: false, error: 'not found' }, 404)

  if (user.passwordHash) {
    const ok = await verifyPassword(currentPassword, user.passwordHash)
    if (!ok) {
      try { await prisma.auditLog.create({ data: { actorUserId: userId, action: 'change_password_failed', objectType: 'user' } }) } catch {}
      return c.json({ ok: false, error: 'current password incorrect' }, 401)
    }
  } else {
    // No existing password: require empty currentPassword to avoid accidental overwrites
    if (currentPassword && currentPassword.length > 0) return c.json({ ok: false, error: 'current password incorrect' }, 401)
  }

  const newHash = await hashPassword(newPassword)
  await prisma.user.update({ where: { id: userId }, data: { passwordHash: newHash, passwordChangedAt: new Date() } })
  try { await prisma.auditLog.create({ data: { actorUserId: userId, action: 'change_password', objectType: 'user' } }) } catch {}

  // Optionally force re-login by hint (server remains stateless); client may choose to logout.
  return c.json({ ok: true })
})

// Admin guard for all admin routes
app.use('/api/admin/*', auth, requireAdmin)

// Register admin CRUD routes
registerAdminRoutes(app as any)


app.get('/', (c) => c.text('Hello Hono!'))

app.get('/health', async (c) => {
  try {
    const sql = neon(c.env.DATABASE_URL)
    const rows = await sql`select 1 as ok`
    return c.json({ ok: rows[0]?.ok === 1 })
  } catch (e: any) {
    return c.json({ ok: false, error: e?.message ?? String(e) }, 500)
  }
})

// Dev helper to mint a token (remove before prod)
app.get('/dev/token', async (c) => {
  const sub = Number(c.req.query('sub') ?? '1')
  const name = c.req.query('name') ?? 'Alice'
  const email = c.req.query('email') ?? 'alice@example.com'
  const now = Math.floor(Date.now() / 1000)
  const token = await signJWT_HS256({ sub, name, email, iat: now, exp: now + 3600 }, c.env.JWT_SECRET)
  return c.json({ token })
})

async function auth(c: any, next: any) {
  const header = c.req.header('authorization') || ''
  const token = header.toLowerCase().startsWith('bearer ')
    ? header.slice(7).trim()
    : undefined
  if (!token) return c.json({ error: 'Unauthorized' }, 401)
  const payload = await verifyJWT_HS256(token, c.env.JWT_SECRET)
  if (!payload) return c.json({ error: 'Unauthorized' }, 401)

  // Optional: enforce token invalidation after password change
  try {
    if (String((c.env as any).JWT_ENFORCE_PW_CHANGE || '').toLowerCase() === 'true') {
      const sub = (payload as any)?.sub ?? (payload as any)?.userId ?? (payload as any)?.id
      if (sub != null) {
        const prisma: any = getPrisma(c.env)
        const u = await prisma.user.findUnique({ where: { id: BigInt(sub) }, select: { passwordChangedAt: true } })
        const changedAt = u?.passwordChangedAt ? Math.floor(new Date(u.passwordChangedAt).getTime() / 1000) : 0
        const iat = Number((payload as any).iat || 0)
        if (changedAt && iat && iat < changedAt) {
          return c.json({ error: 'Token invalid due to password change' }, 401)
        }
      }
    }
  } catch {}

  c.set('user', payload)
  await next()
}

app.get('/me', auth, (c) => {
  const user = c.get('user')
  return c.json({ user })
})

app.get('/subordinates', auth, async (c) => {
  const user = c.get('user') as JWTPayload
  const prisma = getPrisma(c.env)
  const now = new Date()
  const subId = user?.sub ?? user?.userId ?? user?.id
  if (subId == null) return c.json({ error: 'No subject in token' }, 400)
  const viewerId = BigInt(subId)

  const useClosure = String(c.env.VISIBILITY_USE_CLOSURE || '').toLowerCase() === 'true'
  const options = useClosure ? { drivers: makeClosureDrivers(prisma) } : undefined
  const ids = await resolveVisibleUsers(prisma, viewerId, 'direct', now, options)
  const filtered = ids.filter((id) => id !== viewerId)
  if (filtered.length === 0) return c.json({ items: [] })

  const users = await prisma.user.findMany({
    where: { id: { in: filtered } },
    select: { id: true, name: true, email: true },
    orderBy: { id: 'asc' },
  })
  return c.json({
    items: users.map((u) => ({ id: Number(u.id), name: u.name, email: u.email })),
  })
})


// Create Work Item (POST /api/work-items)
app.post('/api/work-items', auth, async (c) => {
  const prisma = getPrisma(c.env)
  const user = c.get('user') as JWTPayload
  const sub = user?.sub ?? user?.userId ?? user?.id
  if (sub == null) return c.json({ error: 'No subject in token' }, 400)
  const viewerId = BigInt(sub)

  // parse and validate body
  let body: any
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400)
  }
  const workDateStr = String(body.workDate || '')
  const title = String(body.title || '').trim()
  const type = String(body.type || 'done')
  const durationMinutes = body.durationMinutes != null ? Number(body.durationMinutes) : undefined
  const tags = Array.isArray(body.tags) ? body.tags.map((t: any) => String(t)).slice(0, 20) : undefined
  const detail = body.detail != null ? String(body.detail) : undefined

  // title <= 20 chars (counting JS code points)
  if (!title) return c.json({ error: 'title is required' }, 400)
  if ([...title].length > 20) return c.json({ error: 'title must be <= 20 characters' }, 400)

  // type enum
  const allowedTypes = new Set(['done', 'progress', 'temp', 'assist'])
  if (!allowedTypes.has(type)) return c.json({ error: 'invalid type' }, 400)

  // date strict YYYY-MM-DD
  const re = /^\d{4}-\d{2}-\d{2}$/
  if (!re.test(workDateStr)) return c.json({ error: 'workDate must be YYYY-MM-DD' }, 400)
  const workDate = new Date(workDateStr + 'T00:00:00Z')
  if (isNaN(workDate.getTime())) return c.json({ error: 'invalid workDate' }, 400)

  if (durationMinutes != null) {
    if (!Number.isInteger(durationMinutes) || durationMinutes < 0) return c.json({ error: 'durationMinutes must be a non-negative integer' }, 400)
  }

  // resolve creator's primary org as of today
  const today = new Date()
  const rows = await prisma.$queryRaw<{ org_id: bigint }[]>`
    select "orgId" as org_id from "user_org_memberships"
    where "userId" = ${viewerId}
      and is_primary = true
      and start_date <= ${today} and (end_date is null or end_date >= ${today})
    order by start_date desc
    limit 1
  `
  if (rows.length === 0) return c.json({ error: 'no primary org for user' }, 400)
  const orgId = rows[0].org_id

  // write
  try {
    const created = await prisma.workItem.create({
      data: {
        creatorId: viewerId,
        orgId,
        workDate,
        title,
        type,
        durationMinutes: durationMinutes ?? null,
        tags: tags && tags.length ? tags.join(',') : null,
        detail: detail ?? null,
      },
      select: { id: true },
    })

    // audit (best-effort)
    await prisma.auditLog.create({
      data: {
        actorUserId: viewerId,
        action: 'create',
        objectType: 'work_item',
        objectId: created.id,
      }
    }).catch(() => {})

    return c.json({ id: Number(created.id) }, 201)
  } catch (e: any) {
    return c.json({ error: 'failed to create', detail: e?.message ?? String(e) }, 500)
  }
})

export default app

// List Work Items (GET /api/work-items)
app.get('/api/work-items', auth, canRead, async (c) => {
  const prisma = getPrisma(c.env)
  const user = c.get('user') as JWTPayload
  const sub = user?.sub ?? user?.userId ?? user?.id
  if (sub == null) return c.json({ error: 'No subject in token' }, 400)
  const viewerId = BigInt(sub)

  const scope = (c.get('scope') as any) || 'self'
  const range = c.get('range') as { start: Date; end: Date }
  const from = range.start
  const to = range.end
  const fromStr = from.toISOString().slice(0,10)
  const toStr = to.toISOString().slice(0,10)
  const q = c.req.query()

  const limit = Math.min(Math.max(Number(q.limit ?? 100), 1), 500)
  const offset = Math.max(Number(q.offset ?? 0), 0)

  const useClosure = String(c.env.VISIBILITY_USE_CLOSURE || '').toLowerCase() === 'true'
  const options = useClosure ? { drivers: makeClosureDrivers(prisma) } : undefined
  const visibleIds = await resolveVisibleUsers(prisma, viewerId, scope as any, new Date(), options)
  if (visibleIds.length === 0) return c.json({ items: [], total: 0 })

  const items = await prisma.workItem.findMany({
    where: {
      creatorId: { in: visibleIds },
      workDate: { gte: from, lte: to },
    },
    select: {
      id: true,
      creatorId: true,
      orgId: true,
      workDate: true,
      title: true,
      type: true,
      durationMinutes: true,
      tags: true,
      detail: true,
    },
    orderBy: [{ workDate: 'asc' }, { id: 'asc' }],
    take: limit,
    skip: offset,
  })

  // count total (best-effort; could be optimized later)
  const total = await prisma.workItem.count({
    where: {
      creatorId: { in: visibleIds },
      workDate: { gte: from, lte: to },
    }
  })

  // audit (best-effort)
  await audit(prisma, {
    actorUserId: viewerId,
    action: 'list',
    objectType: 'work_item',
    detail: { scope, from: fromStr, to: toStr, count: items.length },
  })

  return c.json({
    items: items.map(it => ({
      id: Number(it.id),
      creatorId: Number(it.creatorId),
      orgId: Number(it.orgId),
      workDate: it.workDate.toISOString().slice(0,10),
      title: it.title,
      type: it.type,
      durationMinutes: it.durationMinutes ?? undefined,
      tags: it.tags ? it.tags.split(',').filter(Boolean) : [],
      detail: it.detail ?? undefined,
    })),
    total,
    limit,
    offset,
  })
})

// Weekly aggregation API (GET /api/reports/weekly)
function parseISOWeek(week: string): { start: Date; end: Date } | null {
  const m = /^(\d{4})W(\d{2})$/.exec(String(week))
  if (!m) return null
  const year = Number(m[1]); const w = Number(m[2])
  if (w < 1 || w > 53) return null
  const jan4 = new Date(Date.UTC(year, 0, 4))
  const dow = jan4.getUTCDay() || 7 // Mon=1..Sun=7
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

app.get('/api/reports/weekly', auth, canRead, async (c) => {
  const prisma = getPrisma(c.env)
  const user = c.get('user') as JWTPayload
  const sub = user?.sub ?? user?.userId ?? user?.id
  if (sub == null) return c.json({ error: 'No subject in token' }, 400)
  const viewerId = BigInt(sub)

  const scope = (c.get('scope') as any) || 'self'
  const range = c.get('range') as { start: Date; end: Date }
  const start = range.start
  const end = range.end

  const useClosure = String(c.env.VISIBILITY_USE_CLOSURE || '').toLowerCase() === 'true'
  const options = useClosure ? { drivers: makeClosureDrivers(prisma) } : undefined
  const visibleIds = await resolveVisibleUsers(prisma, viewerId, scope as any, new Date(), options)
  if (visibleIds.length === 0) return c.json({ ok: true, range: { start: start!.toISOString().slice(0,10), end: end!.toISOString().slice(0,10) }, data: [] })

  const rows = await prisma.$queryRaw<{
    creator_id: bigint
    work_date: Date
    item_count: bigint
    total_minutes: bigint
    done_count: bigint
    progress_count: bigint
    temp_count: bigint
    assist_count: bigint
  }[]>`
    select creator_id, work_date,
           count(*) as item_count,
           coalesce(sum(duration_minutes), 0) as total_minutes,
           sum(case when type = 'done' then 1 else 0 end) as done_count,
           sum(case when type = 'progress' then 1 else 0 end) as progress_count,
           sum(case when type = 'temp' then 1 else 0 end) as temp_count,
           sum(case when type = 'assist' then 1 else 0 end) as assist_count
    from work_items
    where creator_id in (${Prisma.join(visibleIds)})
      and work_date between ${start!} and ${end!}
    group by creator_id, work_date
    order by creator_id asc, work_date asc
  `

  // audit (best-effort)
  await audit(prisma, {
    actorUserId: viewerId,
    action: 'report_weekly',
    objectType: 'work_item',
    detail: { scope, start: start.toISOString().slice(0,10), end: end.toISOString().slice(0,10), rows: rows.length },
  })

  return c.json({
    ok: true,
    range: { start: start!.toISOString().slice(0,10), end: end!.toISOString().slice(0,10) },
    data: rows.map(r => ({
      creatorId: Number(r.creator_id),
      workDate: r.work_date.toISOString().slice(0,10),
      itemCount: Number(r.item_count),
      totalMinutes: Number(r.total_minutes),
      typeCounts: {
        done: Number(r.done_count),
        progress: Number(r.progress_count),
        temp: Number(r.temp_count),
        assist: Number(r.assist_count),
      }
    }))
  })
})


// --- Export pipeline: producer endpoints ---
app.post('/api/reports/weekly/export', auth, canExport, async (c) => {
  const user = c.get('user') as JWTPayload
  const sub = user?.sub ?? user?.userId ?? user?.id
  if (sub == null) return c.json({ error: 'No subject in token' }, 400)
  const viewerId = BigInt(sub)

  const scope = (c.get('scope') as any) || 'self'
  const range = c.get('range') as { start: Date; end: Date }

  const jobId = (crypto as any).randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2)
  const objectKey = `weekly/${jobId}.xlsx`

  // enqueue or inline process export task (zero-cost inline driver)
  const payload = { jobId, viewerId: Number(viewerId), scope, start: range.start.toISOString().slice(0,10), end: range.end.toISOString().slice(0,10), objectKey }
  const driver = String((c.env as any).QUEUE_DRIVER || '').toLowerCase()
  if (driver === 'inline' || !(c.env as any).EXPORT_QUEUE) {
    await processExportJob(payload as any, c.env)
  } else {
    await c.env.EXPORT_QUEUE.send(payload)
  }

  // unified audit (best-effort)
  try {
    const prisma = getPrisma(c.env)
    await audit(prisma, { actorUserId: viewerId, action: 'export_request', objectType: 'work_item', detail: { scope, start: payload.start, end: payload.end, jobId } })
  } catch {}

  return c.json({ ok: true, jobId })
})

app.get('/api/reports/weekly/export/status', auth, async (c) => {
  const id = String(c.req.query('id') || '')
  if (!id) return c.json({ error: 'id required' }, 400)
  const key = `weekly/${id}.xlsx`
  const head = await c.env.R2_EXPORTS.head(key)
  return c.json({ ok: true, status: head ? 'ready' : 'pending' })
})

app.get('/api/reports/weekly/export/download', auth, async (c) => {
  const id = String(c.req.query('id') || '')
  if (!id) return c.json({ error: 'id required' }, 400)
  const key = `weekly/${id}.xlsx`
  const obj = await c.env.R2_EXPORTS.get(key)
  if (!obj) return c.json({ error: 'not found' }, 404)

  // audit download (best-effort)
  try {
    const user = c.get('user') as JWTPayload
    const sub = (user as any)?.sub ?? (user as any)?.userId ?? (user as any)?.id
    if (sub != null) {
      const prisma = getPrisma(c.env)
      await audit(prisma, { actorUserId: BigInt(sub), action: 'export_download', objectType: 'work_item', detail: { jobId: id } })
    }
  } catch {}

  const excelMime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  return new Response(obj.body, { headers: { 'content-type': obj.httpMetadata?.contentType || excelMime, 'content-disposition': `attachment; filename=\"${id}.xlsx\"` } })
})

// --- Export pipeline: queue consumer ---

// Minimal ZIP (STORE) builder for Workers (single file)
function crc32(buf: Uint8Array): number {
  const table = (crc32 as any)._tbl || ((crc32 as any)._tbl = (() => {
    const t = new Uint32Array(256)
    for (let i=0;i<256;i++){
      let c=i
      for (let k=0;k<8;k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1)
      t[i]=c>>>0
    }
    return t
  })())
  let crc = 0 ^ -1
  for (let i=0;i<buf.length;i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xFF]
  return (crc ^ -1) >>> 0
}

function u16(n: number){ return new Uint8Array([n & 0xFF, (n>>>8)&0xFF]) }
function u32(n: number){ return new Uint8Array([n & 0xFF, (n>>>8)&0xFF, (n>>>16)&0xFF, (n>>>24)&0xFF]) }

function buildZipSingle(name: string, content: Uint8Array): Uint8Array {
  const nameBytes = new TextEncoder().encode(name)
  const crc = crc32(content)
  const comp = content // store (no compression)
  const now = new Date()
  const dosTime = ((now.getHours() << 11) | (now.getMinutes() << 5) | (Math.floor(now.getSeconds()/2))) & 0xFFFF
  const dosDate = (((now.getFullYear()-1980) << 9) | ((now.getMonth()+1) << 5) | now.getDate()) & 0xFFFF

  // Local file header
  const lf = [
    new TextEncoder().encode('PK\x03\x04'), // sig
    u16(20), // version needed
    u16(0), // flags
    u16(0), // method STORE
    u16(dosTime), u16(dosDate),
    u32(crc), u32(comp.length), u32(comp.length),
    u16(nameBytes.length), u16(0), // extra len
    nameBytes,
    comp,
  ]
  let offset = 0
  for (const part of lf) offset += part.length

  // Central directory header
  const cd = [
    new TextEncoder().encode('PK\x01\x02'),
    u16(20), u16(20), u16(0), u16(0), // versions, flags, method
    u16(dosTime), u16(dosDate),
    u32(crc), u32(comp.length), u32(comp.length),
    u16(nameBytes.length), u16(0), u16(0), // extra, comment, disk
    u16(0), u16(0), // int/ext attrs
    u32(lf.reduce((a,p)=>a+p.length,0) - (nameBytes.length + comp.length + 30)), // relative offset of local header
    nameBytes,
  ]
  const cdSize = cd.reduce((a,p)=>a+p.length,0)

  // End of central directory
  const eocd = [
    new TextEncoder().encode('PK\x05\x06'),
    u16(0), u16(0), // disk num
    u16(1), u16(1), // entries
    u32(cdSize),
    u32(lf.reduce((a,p)=>a+p.length,0)),
    u16(0), // comment len
  ]

  const total = lf.reduce((a,p)=>a+p.length,0) + cdSize + eocd.reduce((a,p)=>a+p.length,0)
  const out = new Uint8Array(total)
  let pos = 0
  for (const part of lf) { out.set(part, pos); pos += part.length }
  for (const part of cd) { out.set(part, pos); pos += part.length }
  for (const part of eocd) { out.set(part, pos); pos += part.length }
  return out
}

export type ExportJob = { jobId: string; viewerId: number; scope: 'self'|'direct'|'subtree'; start: string; end: string; objectKey: string }

async function processExportJob(job: ExportJob, env: Bindings): Promise<void> {
  // build workbook (always produce at least meta sheet)
  const wb = XLSX.utils.book_new()
  const wsMeta = XLSX.utils.aoa_to_sheet([["jobId","scope","start","end"], [job.jobId, job.scope, job.start, job.end]])
  XLSX.utils.book_append_sheet(wb, wsMeta, 'Summary')

  try {
    const prisma = getPrisma(env as any)
    // resolve visible users for viewer within scope
    const useClosure = String((env as any).VISIBILITY_USE_CLOSURE || '').toLowerCase() === 'true'
    const options = useClosure ? { drivers: makeClosureDrivers(prisma) } : undefined
    const viewerId = BigInt(job.viewerId ?? 0)
    const visibleIds = await resolveVisibleUsers(prisma, viewerId, job.scope as any, new Date(), options)

    // time range
    const start = new Date(String(job.start) + 'T00:00:00Z')
    const end = new Date(String(job.end) + 'T23:59:59Z')

    // aggregate by creator/day
    const aggRows = visibleIds.length ? await prisma.$queryRaw<{
      creator_id: bigint
      work_date: Date
      item_count: bigint
      total_minutes: bigint
      done_count: bigint
      progress_count: bigint
      temp_count: bigint
      assist_count: bigint
    }[]>`
      select creator_id, work_date,
             count(*) as item_count,
             coalesce(sum(duration_minutes), 0) as total_minutes,
             sum(case when type = 'done' then 1 else 0 end) as done_count,
             sum(case when type = 'progress' then 1 else 0 end) as progress_count,
             sum(case when type = 'temp' then 1 else 0 end) as temp_count,
             sum(case when type = 'assist' then 1 else 0 end) as assist_count
      from work_items
      where creator_id in (${Prisma.join(visibleIds)})
        and work_date between ${start} and ${end}
      group by creator_id, work_date
      order by creator_id asc, work_date asc
    ` : []

    // users map for names
    const users = visibleIds.length ? await prisma.user.findMany({ where: { id: { in: visibleIds } }, select: { id: true, name: true } }) : []
    const nameMap = new Map<number, string>(users.map(u => [Number(u.id), u.name]))

    // reduce to by-user totals
    const byUser = new Map<number, { itemCount: number; totalMinutes: number; done: number; progress: number; temp: number; assist: number }>()
    for (const r of aggRows) {
      const uid = Number(r.creator_id)
      const cur = byUser.get(uid) || { itemCount: 0, totalMinutes: 0, done: 0, progress: 0, temp: 0, assist: 0 }
      cur.itemCount += Number(r.item_count)
      cur.totalMinutes += Number(r.total_minutes)
      cur.done += Number(r.done_count)
      cur.progress += Number(r.progress_count)
      cur.temp += Number(r.temp_count)
      cur.assist += Number(r.assist_count)
      byUser.set(uid, cur)
    }

    // by user sheet
    const byUserRows: any[][] = [["creatorId","creatorName","itemCount","totalMinutes","done","progress","temp","assist"]]
    const idsSorted = Array.from(byUser.keys()).sort((a,b)=>a-b)
    for (const uid of idsSorted) {
      const t = byUser.get(uid)!
      byUserRows.push([uid, nameMap.get(uid) || '', t.itemCount, t.totalMinutes, t.done, t.progress, t.temp, t.assist])
    }
    if (byUserRows.length > 1) {
      const wsByUser = XLSX.utils.aoa_to_sheet(byUserRows)
      XLSX.utils.book_append_sheet(wb, wsByUser, 'ByUser')
    }

    // details rows
    const details = visibleIds.length ? await prisma.workItem.findMany({
      where: { creatorId: { in: visibleIds }, workDate: { gte: start, lte: end } },
      select: { creatorId: true, workDate: true, type: true, durationMinutes: true, title: true },
      orderBy: [{ workDate: 'asc' }, { id: 'asc' }],
    }) : []
    const detailRows: any[][] = [["date","creatorId","creatorName","type","minutes","title"]]
    for (const d of details) {
      const uid = Number(d.creatorId)
      detailRows.push([
        d.workDate.toISOString().slice(0,10),
        uid,
        nameMap.get(uid) || '',
        d.type,
        d.durationMinutes ?? '',
        d.title,
      ])
    }
    if (detailRows.length > 1) {
      const wsDetails = XLSX.utils.aoa_to_sheet(detailRows)
      XLSX.utils.book_append_sheet(wb, wsDetails, 'Details')
    }
  } catch {}

  const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer
  await env.R2_EXPORTS.put(job.objectKey, new Uint8Array(wbout), { httpMetadata: { contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' } })
  try {
    const prisma = getPrisma(env as any)
    await prisma.auditLog.create({ data: { actorUserId: BigInt(job.viewerId ?? 0), action: 'export', objectType: 'work_item', detail: { jobId: job.jobId, scope: job.scope, start: job.start, end: job.end, format: 'xlsx' } } })
  } catch {}
}

export async function queue(batch: any, env: Bindings): Promise<void> {
  for (const msg of batch.messages ?? []) {
    try {
      await processExportJob(msg.body as any, env)
      msg.ack()
    } catch (e) {
      // Let runtime retry on failure by not acking
    }
  }
}


