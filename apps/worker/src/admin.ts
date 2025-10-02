import { Hono } from 'hono'
import { Prisma, PrismaClient } from '@prisma/client'
import { PrismaNeonHTTP } from '@prisma/adapter-neon'
import type { JWTPayload } from './auth'
import { audit as auditHelper } from './middlewares/permissions'
import { getDataDriverMode, getR2DataStore } from './data/r2-store'
import { migrateNeonToR2 } from './migrate'
import { ensureAuditLog, filterUsersWithKeyword, paginate } from './data/r2-logic'

export type Bindings = { DATABASE_URL: string; JWT_SECRET: string; DATA_DRIVER?: string; R2_EXPORTS: any; R2_DATA?: any }

declare global { var __PRISMA_ADMIN__: PrismaClient | undefined }
function getPrisma(env: Bindings) {
  if (!globalThis.__PRISMA_ADMIN__) {
    const adapter = new PrismaNeonHTTP(env.DATABASE_URL, {})
    globalThis.__PRISMA_ADMIN__ = new PrismaClient({ adapter })
  }
  return globalThis.__PRISMA_ADMIN__ as PrismaClient
}

function requireAuth(c: any): JWTPayload | null {
  const user = c.get('user') as JWTPayload | undefined
  if (!user) return null
  return user
}

const toOrgPayload = (record: { id: number; name: string; parentId: number | null; type: string; active: boolean }) => ({
  id: record.id,
  name: record.name,
  parentId: record.parentId,
  type: record.type,
  active: record.active,
})

const toUserPayload = (record: { id: number; name: string; email: string | null; employeeNo: string | null; jobTitle: string | null; grade: string | null; active: boolean }) => ({
  id: record.id,
  name: record.name,
  email: record.email,
  employeeNo: record.employeeNo,
  jobTitle: record.jobTitle,
  grade: record.grade,
  active: record.active,
})

function actorNumber(user: JWTPayload | null): number {
  const raw = user?.sub ?? (user as any)?.userId ?? (user as any)?.id
  return raw != null ? Number(raw) : 0
}

function actorBigInt(user: JWTPayload | null): bigint {
  const raw = user?.sub ?? (user as any)?.userId ?? (user as any)?.id ?? 0
  return BigInt(raw)
}

export function registerAdminRoutes(app: Hono<{ Bindings: Bindings; Variables: { user?: JWTPayload } }>) {
  app.post('/api/admin/migrate/r2', async (c) => {
    const auth = requireAuth(c); if (!auth) return c.json({ error: 'Unauthorized' }, 401)
    let store: ReturnType<typeof getR2DataStore>
    try {
      store = getR2DataStore(c.env)
    } catch (err: any) {
      return c.json({ ok: false, error: err?.message || 'R2 存储未配置' }, 500)
    }
    try {
      const prisma = getPrisma(c.env)
      const summary = await migrateNeonToR2(prisma, store)
      await ensureAuditLog(store, {
        actorUserId: actorNumber(auth),
        action: 'admin_migrate_neon_to_r2',
        objectType: 'migration',
        detail: summary,
      })
      return c.json({ ok: true, summary })
    } catch (err: any) {
      return c.json({ ok: false, error: err?.message || '数据迁移失败' }, 500)
    }
  })

  // --- ORG UNITS ---
  app.get('/api/admin/orgs', async (c) => {
    const auth = requireAuth(c); if (!auth) return c.json({ error: 'Unauthorized' }, 401)
    const mode = getDataDriverMode(c.env as any)
    if (mode === 'r2') {
      const store = getR2DataStore(c.env)
      const items = await store.listOrgUnits()
      return c.json({ items: items.map(toOrgPayload) })
    }
    const prisma = getPrisma(c.env)
    const items = await prisma.orgUnit.findMany({
      select: { id: true, name: true, parentId: true, type: true, active: true },
      orderBy: { id: 'asc' },
    })
    return c.json({ items: items.map(i => ({ id: Number(i.id), name: i.name, parentId: i.parentId ? Number(i.parentId) : null, type: i.type, active: i.active })) })
  })

  app.get('/api/admin/orgs/tree', async (c) => {
    const auth = requireAuth(c); if (!auth) return c.json({ error: 'Unauthorized' }, 401)
    const mode = getDataDriverMode(c.env as any)
    let items: Array<{ id: number; name: string; parentId: number | null; type: string; active: boolean }>
    if (mode === 'r2') {
      const store = getR2DataStore(c.env)
      items = (await store.listOrgUnits()).map(toOrgPayload)
    } else {
      const prisma = getPrisma(c.env)
      const raw = await prisma.orgUnit.findMany({
        select: { id: true, name: true, parentId: true, type: true, active: true },
        orderBy: { id: 'asc' },
      })
      items = raw.map(i => ({ id: Number(i.id), name: i.name, parentId: i.parentId ? Number(i.parentId) : null, type: i.type, active: i.active }))
    }
    const map = new Map<number, any>()
    items.forEach(i => map.set(i.id, { id: i.id, label: i.name, name: i.name, type: i.type, active: i.active, children: [] as any[] }))
    const roots: any[] = []
    for (const i of items) {
      const node = map.get(i.id)!
      const pid = i.parentId
      if (pid && map.has(pid)) map.get(pid).children.push(node)
      else roots.push(node)
    }
    return c.json({ items: roots })
  })

  app.post('/api/admin/orgs', async (c) => {
    const auth = requireAuth(c); if (!auth) return c.json({ error: 'Unauthorized' }, 401)
    const mode = getDataDriverMode(c.env as any)
    let body: any; try { body = await c.req.json() } catch { return c.json({ error: 'Invalid JSON' }, 400) }
    const name = String(body.name || '').trim()
    if (!name) return c.json({ error: 'name required' }, 400)
    const parentId = body.parentId != null ? Number(body.parentId) : null
    const type = String(body.type || 'department')
    const active = body.active != null ? !!body.active : true
    if (mode === 'r2') {
      const store = getR2DataStore(c.env)
      const created = await store.addOrgUnit({ name, parentId, type, active })
      await ensureAuditLog(store, { actorUserId: actorNumber(auth), action: 'admin_create_org', objectType: 'org_unit', objectId: created.id })
      return c.json({ id: created.id }, 201)
    }
    const prisma = getPrisma(c.env)
    const data: any = { name, type, active }
    if (parentId != null) data.parentId = BigInt(parentId)
    const created = await prisma.orgUnit.create({ data, select: { id: true } })
    await auditHelper(prisma as any, { actorUserId: actorBigInt(auth), action: 'admin_create_org', objectType: 'org_unit', objectId: created.id })
    return c.json({ id: Number(created.id) }, 201)
  })

  app.put('/api/admin/orgs/:id', async (c) => {
    const auth = requireAuth(c); if (!auth) return c.json({ error: 'Unauthorized' }, 401)
    const idNum = Number(c.req.param('id'))
    if (!Number.isFinite(idNum)) return c.json({ error: 'invalid id' }, 400)
    let body: any; try { body = await c.req.json() } catch { return c.json({ error: 'Invalid JSON' }, 400) }
    const mode = getDataDriverMode(c.env as any)
    if (mode === 'r2') {
      const store = getR2DataStore(c.env)
      const updates: any = {}
      if (body.name !== undefined) updates.name = body.name == null ? '' : String(body.name)
      if (body.type !== undefined) updates.type = body.type == null ? 'department' : String(body.type)
      if (body.parentId !== undefined) updates.parentId = body.parentId == null ? null : Number(body.parentId)
      if (body.active !== undefined) updates.active = !!body.active
      await store.updateOrgUnit(idNum, updates)
      await ensureAuditLog(store, { actorUserId: actorNumber(auth), action: 'admin_update_org', objectType: 'org_unit', objectId: idNum })
      return c.json({ ok: true })
    }
    const prisma = getPrisma(c.env)
    const id = BigInt(idNum)
    const data: any = {}
    if (body.name != null) data.name = String(body.name)
    if (body.type != null) data.type = String(body.type)
    if (body.parentId !== undefined) data.parentId = body.parentId == null ? null : BigInt(Number(body.parentId))
    if (body.active != null) data.active = !!body.active
    await prisma.orgUnit.update({ where: { id }, data })
    await auditHelper(prisma as any, { actorUserId: actorBigInt(auth), action: 'admin_update_org', objectType: 'org_unit', objectId: id })
    return c.json({ ok: true })
  })

  // --- USERS ---
  app.get('/api/admin/users', async (c) => {
    const auth = requireAuth(c); if (!auth) return c.json({ error: 'Unauthorized' }, 401)
    const q = c.req.query()
    const limit = Math.min(Math.max(Number(q.limit ?? 50), 1), 200)
    const offset = Math.max(Number(q.offset ?? 0), 0)
    const keyword = String(q.q || '').trim()
    const mode = getDataDriverMode(c.env as any)
    if (mode === 'r2') {
      const store = getR2DataStore(c.env)
      const all = (await store.listAllUsers()).map(u => ({ id: u.id, name: u.name, email: u.email, employeeNo: u.employeeNo, jobTitle: u.jobTitle, grade: u.grade, active: u.active }))
      const filtered = filterUsersWithKeyword(all as any, keyword)
      const { total, items } = paginate(filtered, limit, offset)
      return c.json({ items: items.map(toUserPayload), total, limit, offset })
    }
    const prisma = getPrisma(c.env)
    const where = keyword ? {
      OR: [
        { name: { contains: keyword } },
        { email: { contains: keyword } },
        { employeeNo: { contains: keyword } },
      ]
    } : {}
    const [items, total] = await Promise.all([
      prisma.user.findMany({ where, orderBy: { id: 'asc' }, take: limit, skip: offset, select: { id: true, name: true, email: true, employeeNo: true, jobTitle: true, grade: true, active: true } }),
      prisma.user.count({ where })
    ])
    return c.json({ items: items.map(u => ({ id: Number(u.id), name: u.name, email: u.email, employeeNo: u.employeeNo, jobTitle: u.jobTitle, grade: u.grade, active: u.active })), total, limit, offset })
  })

  app.post('/api/admin/users', async (c) => {
    const auth = requireAuth(c); if (!auth) return c.json({ error: 'Unauthorized' }, 401)
    const mode = getDataDriverMode(c.env as any)
    let body: any; try { body = await c.req.json() } catch { return c.json({ error: 'Invalid JSON' }, 400) }
    const name = String(body.name || '').trim(); if (!name) return c.json({ error: 'name required' }, 400)
    const payload = {
      name,
      email: body.email ? String(body.email) : null,
      employeeNo: body.employeeNo ? String(body.employeeNo) : null,
      jobTitle: body.jobTitle ? String(body.jobTitle) : null,
      grade: body.grade ? String(body.grade) : null,
      active: body.active != null ? !!body.active : true,
    }
    if (mode === 'r2') {
      const store = getR2DataStore(c.env)
      const created = await store.upsertUser(payload)
      await ensureAuditLog(store, { actorUserId: actorNumber(auth), action: 'admin_create_user', objectType: 'user', objectId: created.id })
      return c.json({ id: created.id }, 201)
    }
    const prisma = getPrisma(c.env)
    const created = await prisma.user.create({ data: payload, select: { id: true } })
    await auditHelper(prisma as any, { actorUserId: actorBigInt(auth), action: 'admin_create_user', objectType: 'user', objectId: created.id })
    return c.json({ id: Number(created.id) }, 201)
  })

  app.put('/api/admin/users/:id', async (c) => {
    const auth = requireAuth(c); if (!auth) return c.json({ error: 'Unauthorized' }, 401)
    const mode = getDataDriverMode(c.env as any)
    const idNum = Number(c.req.param('id'))
    if (!Number.isFinite(idNum)) return c.json({ error: 'invalid id' }, 400)
    let body: any; try { body = await c.req.json() } catch { return c.json({ error: 'Invalid JSON' }, 400) }
    if (mode === 'r2') {
      const store = getR2DataStore(c.env)
      const updates: any = { id: idNum }
      for (const key of ['name','email','employeeNo','jobTitle','grade'] as const) {
        if (body[key] !== undefined) updates[key] = body[key] == null ? null : String(body[key])
      }
      if (body.active !== undefined) updates.active = !!body.active
      await store.upsertUser(updates)
      await ensureAuditLog(store, { actorUserId: actorNumber(auth), action: 'admin_update_user', objectType: 'user', objectId: idNum })
      return c.json({ ok: true })
    }
    const prisma = getPrisma(c.env)
    const id = BigInt(idNum)
    const data: any = {}
    for (const k of ['name','email','employeeNo','jobTitle','grade']) if (body[k] !== undefined) data[k] = body[k] == null ? null : String(body[k])
    if (body.active != null) data.active = !!body.active
    await prisma.user.update({ where: { id }, data })
    await auditHelper(prisma as any, { actorUserId: actorBigInt(auth), action: 'admin_update_user', objectType: 'user', objectId: id })
    return c.json({ ok: true })
  })

  app.patch('/api/admin/users/:id/primary-org', async (c) => {
    const auth = requireAuth(c); if (!auth) return c.json({ error: 'Unauthorized' }, 401)
    const mode = getDataDriverMode(c.env as any)
    const idNum = Number(c.req.param('id'))
    if (!Number.isFinite(idNum)) return c.json({ error: 'invalid id' }, 400)
    let body: any; try { body = await c.req.json() } catch { return c.json({ error: 'Invalid JSON' }, 400) }
    const orgIdNum = Number(body.orgId)
    if (!Number.isFinite(orgIdNum)) return c.json({ error: 'orgId required' }, 400)
    if (mode === 'r2') {
      const store = getR2DataStore(c.env)
      const today = new Date()
      await store.setPrimaryOrg(idNum, orgIdNum, today)
      await ensureAuditLog(store, { actorUserId: actorNumber(auth), action: 'admin_set_primary_org', objectType: 'user', objectId: idNum, detail: { orgId: orgIdNum } })
      return c.json({ ok: true })
    }
    const prisma = getPrisma(c.env)
    const id = BigInt(idNum)
    const orgId = BigInt(orgIdNum)
    const today = new Date(); const y = today.getUTCFullYear(), m = today.getUTCMonth(), d = today.getUTCDate()
    const t0 = new Date(Date.UTC(y, m, d))
    await prisma.userOrgMembership.updateMany({ where: { userId: id, isPrimary: true, endDate: null }, data: { endDate: new Date(t0.getTime() - 24*3600*1000) } })
    await prisma.userOrgMembership.create({ data: { userId: id, orgId, isPrimary: true, startDate: t0, endDate: null } })
    await auditHelper(prisma as any, { actorUserId: actorBigInt(auth), action: 'admin_set_primary_org', objectType: 'user', objectId: id, detail: { orgId: Number(orgId) } })
    return c.json({ ok: true })
  })

  // --- MANAGER EDGES ---
  app.get('/api/admin/manager-edges', async (c) => {
    const auth = requireAuth(c); if (!auth) return c.json({ error: 'Unauthorized' }, 401)
    const mode = getDataDriverMode(c.env as any)
    const q = c.req.query()
    if (mode === 'r2') {
      const store = getR2DataStore(c.env)
      const edges = await store.listManagerEdgesRecords()
      const users = await store.listAllUsers()
      const nameMap = new Map(users.map(u => [u.id, u.name]))
      const managerId = q.managerId ? Number(q.managerId) : undefined
      const subordinateId = q.subordinateId ? Number(q.subordinateId) : undefined
      const filtered = edges.filter(e => (!managerId || e.managerId === managerId) && (!subordinateId || e.subordinateId === subordinateId))
      return c.json({
        items: filtered.map(e => ({
          managerId: e.managerId,
          managerName: nameMap.get(e.managerId) ?? null,
          subordinateId: e.subordinateId,
          subordinateName: nameMap.get(e.subordinateId) ?? null,
          startDate: e.startDate,
          endDate: e.endDate,
          priority: e.priority,
        })),
      })
    }
    const prisma = getPrisma(c.env)
    const managerId = q.managerId ? BigInt(Number(q.managerId)) : undefined
    const subordinateId = q.subordinateId ? BigInt(Number(q.subordinateId)) : undefined
    const where: any = {}
    if (managerId) where.managerId = managerId
    if (subordinateId) where.subordinateId = subordinateId
    const items = await prisma.managerEdge.findMany({
      where,
      orderBy: [{ managerId: 'asc' }, { subordinateId: 'asc' }, { startDate: 'asc' }],
      select: {
        managerId: true,
        subordinateId: true,
        startDate: true,
        endDate: true,
        priority: true,
        manager: { select: { name: true } },
        subordinate: { select: { name: true } },
      },
    })
    return c.json({
      items: items.map(e => ({
        managerId: Number(e.managerId),
        managerName: e.manager?.name ?? null,
        subordinateId: Number(e.subordinateId),
        subordinateName: e.subordinate?.name ?? null,
        startDate: e.startDate.toISOString().slice(0, 10),
        endDate: e.endDate ? e.endDate.toISOString().slice(0, 10) : null,
        priority: e.priority,
      })),
    })
  })

  app.post('/api/admin/manager-edges', async (c) => {
    const auth = requireAuth(c); if (!auth) return c.json({ error: 'Unauthorized' }, 401)
    let body: any; try { body = await c.req.json() } catch { return c.json({ error: 'Invalid JSON' }, 400) }
    const managerId = Number(body.managerId)
    const subordinateId = Number(body.subordinateId)
    const startDate = String(body.startDate || '').trim()
    const endDate = body.endDate ? String(body.endDate) : null
    const priority = body.priority != null ? Number(body.priority) : 100
    if (!Number.isFinite(managerId) || !Number.isFinite(subordinateId) || !startDate) return c.json({ error: 'invalid payload' }, 400)
    const mode = getDataDriverMode(c.env as any)
    if (mode === 'r2') {
      const store = getR2DataStore(c.env)
      await store.addManagerEdge({ managerId, subordinateId, startDate, endDate, priority })
      await ensureAuditLog(store, { actorUserId: actorNumber(auth), action: 'admin_create_manager_edge', objectType: 'manager_edge', detail: { managerId, subordinateId } })
      return c.json({ ok: true }, 201)
    }
    const prisma = getPrisma(c.env)
    await prisma.managerEdge.create({ data: { managerId: BigInt(managerId), subordinateId: BigInt(subordinateId), startDate: new Date(startDate + 'T00:00:00Z'), endDate: endDate ? new Date(endDate + 'T00:00:00Z') : null, priority } })
    await auditHelper(prisma as any, { actorUserId: actorBigInt(auth), action: 'admin_create_manager_edge', objectType: 'manager_edge', detail: { managerId, subordinateId } })
    return c.json({ ok: true }, 201)
  })

  app.delete('/api/admin/manager-edges', async (c) => {
    const auth = requireAuth(c); if (!auth) return c.json({ error: 'Unauthorized' }, 401)
    let body: any; try { body = await c.req.json() } catch { return c.json({ error: 'Invalid JSON' }, 400) }
    const managerId = Number(body.managerId)
    const subordinateId = Number(body.subordinateId)
    const startDate = String(body.startDate || '').trim()
    if (!Number.isFinite(managerId) || !Number.isFinite(subordinateId) || !startDate) return c.json({ error: 'invalid payload' }, 400)
    const mode = getDataDriverMode(c.env as any)
    if (mode === 'r2') {
      const store = getR2DataStore(c.env)
      await store.deleteManagerEdge({ managerId, subordinateId, startDate })
      await ensureAuditLog(store, { actorUserId: actorNumber(auth), action: 'admin_delete_manager_edge', objectType: 'manager_edge', detail: { managerId, subordinateId } })
      return c.json({ ok: true })
    }
    const prisma = getPrisma(c.env)
    await prisma.managerEdge.delete({ where: { managerId_subordinateId_startDate: { managerId: BigInt(managerId), subordinateId: BigInt(subordinateId), startDate: new Date(startDate + 'T00:00:00Z') } } as any })
    await auditHelper(prisma as any, { actorUserId: actorBigInt(auth), action: 'admin_delete_manager_edge', objectType: 'manager_edge', detail: { managerId, subordinateId } })
    return c.json({ ok: true })
  })

  // --- ROLES & GRANTS ---
  app.get('/api/admin/roles', async (c) => {
    if (!requireAuth(c)) return c.json({ error: 'Unauthorized' }, 401)
    const mode = getDataDriverMode(c.env as any)
    if (mode === 'r2') {
      const store = getR2DataStore(c.env)
      const items = await store.listRoles()
      return c.json({ items: items.map(r => ({ id: r.id, code: r.code, name: r.name })) })
    }
    const prisma = getPrisma(c.env)
    const items = await prisma.role.findMany({ orderBy: { id: 'asc' }, select: { id: true, code: true, name: true } })
    return c.json({ items: items.map(r => ({ id: Number(r.id), code: r.code, name: r.name })) })
  })

  app.get('/api/admin/role-grants', async (c) => {
    if (!requireAuth(c)) return c.json({ error: 'Unauthorized' }, 401)
    const mode = getDataDriverMode(c.env as any)
    if (mode === 'r2') {
      const store = getR2DataStore(c.env)
      const grants = await store.listRoleGrants()
      const roles = await store.listRoles()
      const users = await store.listAllUsers()
      const roleMap = new Map(roles.map(r => [r.id, r]))
      const userMap = new Map(users.map(u => [u.id, u]))
      return c.json({
        items: grants.map(g => ({
          id: g.id,
          granteeUserId: g.granteeUserId,
          granteeName: userMap.get(g.granteeUserId)?.name ?? null,
          roleId: g.roleId,
          roleCode: roleMap.get(g.roleId)?.code ?? '',
          roleName: roleMap.get(g.roleId)?.name ?? '',
          domainOrgId: g.domainOrgId,
          scope: g.scope,
          startDate: g.startDate,
          endDate: g.endDate,
        })),
      })
    }
    const prisma = getPrisma(c.env)
    const items = await prisma.roleGrant.findMany({
      orderBy: { id: 'asc' },
      select: {
        id: true,
        granteeUserId: true,
        roleId: true,
        domainOrgId: true,
        scope: true,
        startDate: true,
        endDate: true,
        role: { select: { code: true, name: true } },
        grantee: { select: { name: true } },
      },
    })
    return c.json({
      items: items.map(g => ({
        id: Number(g.id),
        granteeUserId: Number(g.granteeUserId),
        granteeName: g.grantee?.name ?? null,
        roleId: Number(g.roleId),
        roleCode: g.role.code,
        roleName: g.role.name,
        domainOrgId: Number(g.domainOrgId),
        scope: g.scope,
        startDate: g.startDate.toISOString().slice(0, 10),
        endDate: g.endDate ? g.endDate.toISOString().slice(0, 10) : null,
      })),
    })
  })

  app.post('/api/admin/role-grants', async (c) => {
    const auth = requireAuth(c); if (!auth) return c.json({ error: 'Unauthorized' }, 401)
    let body: any; try { body = await c.req.json() } catch { return c.json({ error: 'Invalid JSON' }, 400) }
    const granteeUserId = Number(body.granteeUserId)
    const domainOrgId = Number(body.domainOrgId)
    const scope = String(body.scope || 'self') as any
    const startDate = String(body.startDate || '').trim()
    const endDate = body.endDate ? String(body.endDate) : null
    if (!Number.isFinite(granteeUserId) || !Number.isFinite(domainOrgId) || !startDate) return c.json({ error: 'invalid payload' }, 400)
    const mode = getDataDriverMode(c.env as any)
    if (mode === 'r2') {
      const store = getR2DataStore(c.env)
      let roleId = body.roleId ? Number(body.roleId) : undefined
      if (!roleId && body.roleCode) {
        const role = await store.ensureRole(String(body.roleCode), body.roleName ? String(body.roleName) : undefined)
        roleId = role.id
      }
      if (!roleId) return c.json({ error: 'roleId or roleCode required' }, 400)
      const created = await store.addRoleGrant({ granteeUserId, roleId, domainOrgId, scope, startDate, endDate })
      await ensureAuditLog(store, { actorUserId: actorNumber(auth), action: 'admin_create_role_grant', objectType: 'role_grant', objectId: created.id })
      return c.json({ id: created.id }, 201)
    }
    const prisma = getPrisma(c.env)
    let roleId = body.roleId ? Number(body.roleId) : undefined
    if (!roleId && body.roleCode) {
      const code = String(body.roleCode)
      let role = await prisma.role.findUnique({ where: { code } })
      if (!role) role = await prisma.role.create({ data: { code, name: code } })
      roleId = Number(role.id)
    }
    if (!roleId) return c.json({ error: 'roleId or roleCode required' }, 400)
    const created = await prisma.roleGrant.create({ data: { granteeUserId: BigInt(granteeUserId), roleId: BigInt(roleId), domainOrgId: BigInt(domainOrgId), scope, startDate: new Date(startDate + 'T00:00:00Z'), endDate: endDate ? new Date(endDate + 'T00:00:00Z') : null }, select: { id: true } })
    await auditHelper(prisma as any, { actorUserId: actorBigInt(auth), action: 'admin_create_role_grant', objectType: 'role_grant', objectId: created.id })
    return c.json({ id: Number(created.id) }, 201)
  })

  app.delete('/api/admin/role-grants/:id', async (c) => {
    const auth = requireAuth(c); if (!auth) return c.json({ error: 'Unauthorized' }, 401)
    const idNum = Number(c.req.param('id'))
    if (!Number.isFinite(idNum)) return c.json({ error: 'invalid id' }, 400)
    const mode = getDataDriverMode(c.env as any)
    if (mode === 'r2') {
      const store = getR2DataStore(c.env)
      await store.deleteRoleGrant(idNum)
      await ensureAuditLog(store, { actorUserId: actorNumber(auth), action: 'admin_delete_role_grant', objectType: 'role_grant', objectId: idNum })
      return c.json({ ok: true })
    }
    const prisma = getPrisma(c.env)
    const id = BigInt(idNum)
    await prisma.roleGrant.delete({ where: { id } })
    await auditHelper(prisma as any, { actorUserId: actorBigInt(auth), action: 'admin_delete_role_grant', objectType: 'role_grant', objectId: id })
    return c.json({ ok: true })
  })
}

