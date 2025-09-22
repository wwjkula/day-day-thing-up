import { Hono } from 'hono'
import { Prisma, PrismaClient } from '@prisma/client'
import { PrismaNeonHTTP } from '@prisma/adapter-neon'
import type { JWTPayload } from './auth'
import { audit as auditHelper } from './middlewares/permissions'

// Bindings shape reused from index.ts
export type Bindings = { DATABASE_URL: string; JWT_SECRET: string; R2_EXPORTS: any }

// Local prisma getter (duplicate to avoid export changes in index.ts)
declare global { var __PRISMA_ADMIN__: PrismaClient | undefined }
function getPrisma(env: Bindings) {
  if (!globalThis.__PRISMA_ADMIN__) {
    const adapter = new PrismaNeonHTTP(env.DATABASE_URL, {})
    globalThis.__PRISMA_ADMIN__ = new PrismaClient({ adapter })
  }
  return globalThis.__PRISMA_ADMIN__ as PrismaClient
}

function requireAuth(c: any) {
  const user = c.get('user') as JWTPayload | undefined
  if (!user) return null
  return user
}

export function registerAdminRoutes(app: Hono<{ Bindings: Bindings; Variables: { user?: JWTPayload } }>) {
  // --- ORG UNITS ---
  app.get('/api/admin/orgs', async (c) => {
    if (!requireAuth(c)) return c.json({ error: 'Unauthorized' }, 401)
    const prisma = getPrisma(c.env)
    const items = await prisma.orgUnit.findMany({
      select: { id: true, name: true, parentId: true, type: true, active: true },
      orderBy: { id: 'asc' },
    })
    return c.json({ items: items.map(i => ({ id: Number(i.id), name: i.name, parentId: i.parentId ? Number(i.parentId) : null, type: i.type, active: i.active })) })
  })

  app.get('/api/admin/orgs/tree', async (c) => {
    if (!requireAuth(c)) return c.json({ error: 'Unauthorized' }, 401)
    const prisma = getPrisma(c.env)
    const items = await prisma.orgUnit.findMany({
      select: { id: true, name: true, parentId: true, type: true, active: true },
      orderBy: { id: 'asc' },
    })
    const map = new Map<number, any>()
    items.forEach(i => map.set(Number(i.id), { id: Number(i.id), label: i.name, name: i.name, type: i.type, active: i.active, children: [] as any[] }))
    const roots: any[] = []
    for (const i of items) {
      const node = map.get(Number(i.id))!
      const pid = i.parentId ? Number(i.parentId) : null
      if (pid && map.has(pid)) map.get(pid).children.push(node)
      else roots.push(node)
    }
    return c.json({ items: roots })
  })

  app.post('/api/admin/orgs', async (c) => {
    const auth = requireAuth(c); if (!auth) return c.json({ error: 'Unauthorized' }, 401)
    const prisma = getPrisma(c.env)
    let body: any; try { body = await c.req.json() } catch { return c.json({ error: 'Invalid JSON' }, 400) }
    const name = String(body.name || '').trim()
    if (!name) return c.json({ error: 'name required' }, 400)
    const data: any = { name, type: String(body.type || 'department') }
    if (body.parentId != null) data.parentId = BigInt(Number(body.parentId))
    const created = await prisma.orgUnit.create({ data, select: { id: true } })
    await auditHelper(prisma as any, { actorUserId: BigInt(auth.sub ?? auth.userId ?? auth.id ?? 0), action: 'admin_create_org', objectType: 'org_unit', objectId: created.id })
    return c.json({ id: Number(created.id) }, 201)
  })

  app.put('/api/admin/orgs/:id', async (c) => {
    const auth = requireAuth(c); if (!auth) return c.json({ error: 'Unauthorized' }, 401)
    const prisma = getPrisma(c.env)
    const id = BigInt(Number(c.req.param('id')))
    let body: any; try { body = await c.req.json() } catch { return c.json({ error: 'Invalid JSON' }, 400) }
    const data: any = {}
    if (body.name != null) data.name = String(body.name)
    if (body.type != null) data.type = String(body.type)
    if (body.parentId !== undefined) data.parentId = body.parentId == null ? null : BigInt(Number(body.parentId))
    if (body.active != null) data.active = !!body.active
    await prisma.orgUnit.update({ where: { id }, data })
    await auditHelper(prisma as any, { actorUserId: BigInt(auth.sub ?? auth.userId ?? auth.id ?? 0), action: 'admin_update_org', objectType: 'org_unit', objectId: id })
    return c.json({ ok: true })
  })

  // --- USERS ---
  app.get('/api/admin/users', async (c) => {
    if (!requireAuth(c)) return c.json({ error: 'Unauthorized' }, 401)
    const prisma = getPrisma(c.env)
    const q = c.req.query()
    const limit = Math.min(Math.max(Number(q.limit ?? 50), 1), 200)
    const offset = Math.max(Number(q.offset ?? 0), 0)
    const keyword = String(q.q || '').trim()
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
    const prisma = getPrisma(c.env)
    let body: any; try { body = await c.req.json() } catch { return c.json({ error: 'Invalid JSON' }, 400) }
    const name = String(body.name || '').trim(); if (!name) return c.json({ error: 'name required' }, 400)
    const data: any = {
      name,
      email: body.email ? String(body.email) : null,
      employeeNo: body.employeeNo ? String(body.employeeNo) : null,
      jobTitle: body.jobTitle ? String(body.jobTitle) : null,
      grade: body.grade ? String(body.grade) : null,
      active: body.active != null ? !!body.active : true,
    }
    const created = await prisma.user.create({ data, select: { id: true } })
    await auditHelper(prisma as any, { actorUserId: BigInt(auth.sub ?? auth.userId ?? auth.id ?? 0), action: 'admin_create_user', objectType: 'user', objectId: created.id })
    return c.json({ id: Number(created.id) }, 201)
  })

  app.put('/api/admin/users/:id', async (c) => {
    const auth = requireAuth(c); if (!auth) return c.json({ error: 'Unauthorized' }, 401)
    const prisma = getPrisma(c.env)
    const id = BigInt(Number(c.req.param('id')))
    let body: any; try { body = await c.req.json() } catch { return c.json({ error: 'Invalid JSON' }, 400) }
    const data: any = {}
    for (const k of ['name','email','employeeNo','jobTitle','grade']) if (body[k] !== undefined) data[k] = body[k] == null ? null : String(body[k])
    if (body.active != null) data.active = !!body.active
    await prisma.user.update({ where: { id }, data })
    await auditHelper(prisma as any, { actorUserId: BigInt(auth.sub ?? auth.userId ?? auth.id ?? 0), action: 'admin_update_user', objectType: 'user', objectId: id })
    return c.json({ ok: true })
  })

  // Set current primary org (end previous, start new today)
  app.patch('/api/admin/users/:id/primary-org', async (c) => {
    const auth = requireAuth(c); if (!auth) return c.json({ error: 'Unauthorized' }, 401)
    const prisma = getPrisma(c.env)
    const id = BigInt(Number(c.req.param('id')))
    let body: any; try { body = await c.req.json() } catch { return c.json({ error: 'Invalid JSON' }, 400) }
    const orgId = BigInt(Number(body.orgId))
    const today = new Date(); const y = today.getUTCFullYear(), m = today.getUTCMonth(), d = today.getUTCDate();
    const t0 = new Date(Date.UTC(y, m, d))
    // end previous
    await prisma.userOrgMembership.updateMany({ where: { userId: id, isPrimary: true, endDate: null }, data: { endDate: new Date(t0.getTime() - 24*3600*1000) } })
    // start new
    await prisma.userOrgMembership.create({ data: { userId: id, orgId, isPrimary: true, startDate: t0, endDate: null } })
    await auditHelper(prisma as any, { actorUserId: BigInt(auth.sub ?? auth.userId ?? auth.id ?? 0), action: 'admin_set_primary_org', objectType: 'user', objectId: id, detail: { orgId: Number(orgId) } })
    return c.json({ ok: true })
  })

  // --- MANAGER EDGES ---
  app.get('/api/admin/manager-edges', async (c) => {
    if (!requireAuth(c)) return c.json({ error: 'Unauthorized' }, 401)
    const prisma = getPrisma(c.env)
    const q = c.req.query()
    const managerId = q.managerId ? BigInt(Number(q.managerId)) : undefined
    const subordinateId = q.subordinateId ? BigInt(Number(q.subordinateId)) : undefined
    const where: any = {}
    if (managerId) where.managerId = managerId
    if (subordinateId) where.subordinateId = subordinateId
    const items = await prisma.managerEdge.findMany({ where, orderBy: [{ managerId: 'asc' }, { subordinateId: 'asc' }, { startDate: 'asc' }], select: { managerId: true, subordinateId: true, startDate: true, endDate: true, priority: true } })
    return c.json({ items: items.map(e => ({ managerId: Number(e.managerId), subordinateId: Number(e.subordinateId), startDate: e.startDate.toISOString().slice(0,10), endDate: e.endDate ? e.endDate.toISOString().slice(0,10) : null, priority: e.priority })) })
  })

  app.post('/api/admin/manager-edges', async (c) => {
    const auth = requireAuth(c); if (!auth) return c.json({ error: 'Unauthorized' }, 401)
    const prisma = getPrisma(c.env)
    let body: any; try { body = await c.req.json() } catch { return c.json({ error: 'Invalid JSON' }, 400) }
    const managerId = BigInt(Number(body.managerId))
    const subordinateId = BigInt(Number(body.subordinateId))
    const startDate = new Date(String(body.startDate) + 'T00:00:00Z')
    const endDate = body.endDate ? new Date(String(body.endDate) + 'T00:00:00Z') : null
    const priority = body.priority != null ? Number(body.priority) : 100
    await prisma.managerEdge.create({ data: { managerId, subordinateId, startDate, endDate, priority } })
    await auditHelper(prisma as any, { actorUserId: BigInt(auth.sub ?? auth.userId ?? auth.id ?? 0), action: 'admin_create_manager_edge', objectType: 'manager_edge', detail: { managerId: Number(managerId), subordinateId: Number(subordinateId) } })
    return c.json({ ok: true }, 201)
  })

  app.delete('/api/admin/manager-edges', async (c) => {
    const auth = requireAuth(c); if (!auth) return c.json({ error: 'Unauthorized' }, 401)
    const prisma = getPrisma(c.env)
    let body: any; try { body = await c.req.json() } catch { return c.json({ error: 'Invalid JSON' }, 400) }
    const managerId = BigInt(Number(body.managerId))
    const subordinateId = BigInt(Number(body.subordinateId))
    const startDate = new Date(String(body.startDate) + 'T00:00:00Z')
    await prisma.managerEdge.delete({ where: { managerId_subordinateId_startDate: { managerId, subordinateId, startDate } } as any })
    await auditHelper(prisma as any, { actorUserId: BigInt(auth.sub ?? auth.userId ?? auth.id ?? 0), action: 'admin_delete_manager_edge', objectType: 'manager_edge', detail: { managerId: Number(managerId), subordinateId: Number(subordinateId) } })
    return c.json({ ok: true })
  })

  // --- ROLE GRANTS ---
  app.get('/api/admin/role-grants', async (c) => {
    if (!requireAuth(c)) return c.json({ error: 'Unauthorized' }, 401)
    const prisma = getPrisma(c.env)
    const items = await prisma.roleGrant.findMany({ orderBy: { id: 'asc' }, select: { id: true, granteeUserId: true, roleId: true, domainOrgId: true, scope: true, startDate: true, endDate: true, role: { select: { code: true, name: true } } } })
    return c.json({ items: items.map(g => ({ id: Number(g.id), granteeUserId: Number(g.granteeUserId), roleId: Number(g.roleId), roleCode: g.role.code, roleName: g.role.name, domainOrgId: Number(g.domainOrgId), scope: g.scope, startDate: g.startDate.toISOString().slice(0,10), endDate: g.endDate ? g.endDate.toISOString().slice(0,10) : null })) })
  })

  app.post('/api/admin/role-grants', async (c) => {
    const auth = requireAuth(c); if (!auth) return c.json({ error: 'Unauthorized' }, 401)
    const prisma = getPrisma(c.env)
    let body: any; try { body = await c.req.json() } catch { return c.json({ error: 'Invalid JSON' }, 400) }
    const granteeUserId = BigInt(Number(body.granteeUserId))
    const domainOrgId = BigInt(Number(body.domainOrgId))
    const scope = String(body.scope || 'self') as any
    const startDate = new Date(String(body.startDate) + 'T00:00:00Z')
    const endDate = body.endDate ? new Date(String(body.endDate) + 'T00:00:00Z') : null
    let roleId: bigint
    if (body.roleId) roleId = BigInt(Number(body.roleId))
    else if (body.roleCode) {
      const code = String(body.roleCode)
      let role = await prisma.role.findUnique({ where: { code } })
      if (!role) role = await prisma.role.create({ data: { code, name: code } })
      roleId = role.id
    } else {
      return c.json({ error: 'roleId or roleCode required' }, 400)
    }
    const created = await prisma.roleGrant.create({ data: { granteeUserId, roleId, domainOrgId, scope, startDate, endDate }, select: { id: true } })
    await auditHelper(prisma as any, { actorUserId: BigInt(auth.sub ?? auth.userId ?? auth.id ?? 0), action: 'admin_create_role_grant', objectType: 'role_grant', objectId: created.id })
    return c.json({ id: Number(created.id) }, 201)
  })

  app.delete('/api/admin/role-grants/:id', async (c) => {
    const auth = requireAuth(c); if (!auth) return c.json({ error: 'Unauthorized' }, 401)
    const prisma = getPrisma(c.env)
    const id = BigInt(Number(c.req.param('id')))
    await prisma.roleGrant.delete({ where: { id } })
    await auditHelper(prisma as any, { actorUserId: BigInt(auth.sub ?? auth.userId ?? auth.id ?? 0), action: 'admin_delete_role_grant', objectType: 'role_grant', objectId: id })
    return c.json({ ok: true })
  })
}

