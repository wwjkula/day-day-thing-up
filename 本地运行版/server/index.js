import express from 'express'
import morgan from 'morgan'
import path from 'node:path'
import fs from 'node:fs/promises'
import jwt from 'jsonwebtoken'
import bcrypt from 'bcryptjs'
import { fileURLToPath } from 'node:url'

import {
  HOST,
  PORT,
  ROOT_DIR,
  getJwtSecret,
} from './config.js'
import {
  getUserByEmployeeNo,
  getUserByEmail,
  getUserById,
  replaceUsers,
  appendAuditLog,
  getOrgUnits,
  saveOrgUnits,
  getRoleGrants,
  saveRoleGrants,
  getRoles,
  saveUserOrgMemberships,
  getUserOrgMemberships,
  getAuditLogs,
} from './data/store.js'
import { isUserAdmin, listUsers, mapUsersById, listRoleGrantsForUser, getPrimaryOrgId, listOrgUnits } from './services/domain.js'
import { normalizeScope, canRead, requireAdmin, parseRangeFromQuery } from './middlewares/permissions.js'
import { createWorkItem, listWorkItems, weeklyAggregate, calculateMissingReport, modifyWorkItem, deleteWorkItem } from './services/work.js'
import { resolveVisibleUserIds } from './services/visibility.js'
import { generateSampleWorkData, clearAllWorkItems } from './services/sample-data.js'
import { parseISODate, toISODate } from './utils/datetime.js'
import { buildDailyOverview, buildWeeklyOverview } from './services/overview.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const app = express()
const JWT_SECRET = getJwtSecret()

app.use(express.json({ limit: '2mb' }))
app.use(morgan('dev'))

app.use(async (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store')
  next()
})

function sanitizeUser(user, isAdmin) {
  return {
    id: Number(user.id),
    name: user.name,
    email: user.email ?? null,
    employeeNo: user.employeeNo ?? null,
    isAdmin: !!isAdmin,
  }
}

function normalizeVisibleUserIds(raw, selfId) {
  const base = Array.isArray(raw) ? raw : [selfId]
  const numbers = base
    .map((value) => Number(value))
    .filter((num) => Number.isFinite(num) && num > 0)
  if (!numbers.includes(selfId)) numbers.push(selfId)
  const unique = Array.from(new Set(numbers))
  unique.sort((a, b) => a - b)
  return unique
}

async function loginRateLimited(userId) {
  const logs = (await getAuditLogs()).items
  const since = Date.now() - 5 * 60_000
  const count = logs
    .filter((log) => Number(log.actorUserId) === Number(userId) && log.action === 'login_failed')
    .filter((log) => new Date(log.createdAt).getTime() >= since).length
  return count >= 5
}

async function recordAudit(entry) {
  await appendAuditLog(entry)
}

async function authenticate(req, res, next) {
  const header = req.headers['authorization'] || ''
  const token = header.toLowerCase().startsWith('bearer ')
    ? header.slice(7).trim()
    : null
  if (!token) return res.status(401).json({ error: 'Unauthorized' })
  try {
    const payload = jwt.verify(token, JWT_SECRET)
    const userId = Number(payload.sub)
    const user = await getUserById(userId)
    if (!user || user.active === false) return res.status(401).json({ error: 'Unauthorized' })
    if (user.passwordChangedAt) {
      const changedAt = new Date(user.passwordChangedAt).getTime()
      if (payload.iat && payload.iat * 1000 < changedAt) {
        return res.status(401).json({ error: 'Token invalidated' })
      }
    }
    const admin = await isUserAdmin(userId)
    req.user = {
      ...sanitizeUser(user, admin),
      sub: userId,
    }
    next()
  } catch (err) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
}

function rangeInfo(range) {
  return { start: toISODate(range.start), end: toISODate(range.end) }
}

app.post('/api/auth/login', async (req, res) => {
  const body = req.body || {}
  const employeeNo = body.employeeNo ? String(body.employeeNo).trim() : ''
  const email = body.email ? String(body.email).trim() : ''
  const password = body.password != null ? String(body.password) : ''
  if (!employeeNo && !email) return res.status(400).json({ ok: false, error: 'employeeNo required' })

  let user = null
  if (employeeNo) user = await getUserByEmployeeNo(employeeNo)
  if (!user && email) user = await getUserByEmail(email)
  if (!user) return res.status(401).json({ ok: false, error: 'invalid credentials' })

  const rateLimited = await loginRateLimited(user.id)
  if (rateLimited) {
    await recordAudit({ actorUserId: user.id, action: 'login_denied_rate_limit', objectType: 'user' })
    return res.status(429).json({ ok: false, code: 'RATE_LIMITED', error: 'too many failed logins' })
  }

  if (user.passwordHash) {
    const ok = await bcrypt.compare(password || '', user.passwordHash)
    if (!ok) {
      await recordAudit({ actorUserId: user.id, action: 'login_failed', objectType: 'user' })
      return res.status(401).json({ ok: false, error: 'invalid credentials' })
    }
  }

  const isAdmin = await isUserAdmin(user.id)
  const payload = {
    sub: Number(user.id),
    name: user.name,
    employeeNo: user.employeeNo ?? null,
    email: user.email ?? null,
    isAdmin,
  }
  const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '24h' })
  await recordAudit({ actorUserId: user.id, action: 'login', objectType: 'user' })
  return res.json({ ok: true, token, user: sanitizeUser(user, isAdmin) })
})

app.post('/api/auth/change-password', authenticate, async (req, res) => {
  const body = req.body || {}
  const currentPassword = typeof body.currentPassword === 'string' ? body.currentPassword : ''
  const newPassword = typeof body.newPassword === 'string' ? body.newPassword : ''
  if (newPassword.length < 6) return res.status(400).json({ ok: false, error: 'password too short' })

  const user = await getUserById(req.user.sub)
  if (!user) return res.status(404).json({ ok: false, error: 'not found' })

  if (user.passwordHash) {
    const ok = await bcrypt.compare(currentPassword, user.passwordHash)
    if (!ok) {
      await recordAudit({ actorUserId: req.user.sub, action: 'change_password_failed', objectType: 'user' })
      return res.status(401).json({ ok: false, error: 'current password incorrect' })
    }
  } else if (currentPassword) {
    return res.status(401).json({ ok: false, error: 'current password incorrect' })
  }

  const hash = await bcrypt.hash(newPassword, 10)
  await replaceUsers(async (data) => {
    const idx = data.items.findIndex((u) => u.id === req.user.sub)
    if (idx === -1) return false
    data.items[idx] = {
      ...data.items[idx],
      passwordHash: hash,
      passwordChangedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
  })
  await recordAudit({ actorUserId: req.user.sub, action: 'change_password', objectType: 'user' })
  return res.json({ ok: true })
})

app.get('/me', authenticate, async (req, res) => {
  res.json({ user: req.user })
})

app.get('/subordinates', authenticate, async (req, res) => {
  const viewerId = req.user.sub
  const visible = await resolveVisibleUserIds(viewerId, 'direct', new Date())
  const filtered = visible.filter((id) => id !== viewerId)
  if (!filtered.length) return res.json({ items: [] })
  const map = await mapUsersById()
  const items = filtered
    .map((id) => map.get(id))
    .filter(Boolean)
    .map((u) => ({ id: u.id, name: u.name, email: u.email ?? null }))
  return res.json({ items })
})

app.post('/api/work-items', authenticate, async (req, res) => {
  const result = await createWorkItem(req.user.sub, req.body || {})
  if (!result.ok) return res.status(400).json({ error: result.error })
  return res.status(201).json({ id: result.record.id })
})


app.patch('/api/work-items/:id', authenticate, async (req, res) => {
  const idNum = Number(req.params.id)
  if (!Number.isFinite(idNum)) return res.status(400).json({ error: 'invalid id' })
  const result = await modifyWorkItem(req.user.sub, idNum, req.body || {})
  if (!result.ok) {
    if (result.error === 'not found') return res.status(404).json({ error: 'not found' })
    return res.status(400).json({ error: result.error || 'unable to update' })
  }
  res.json({ ok: true })
})

app.delete('/api/work-items/:id', authenticate, async (req, res) => {
  const idNum = Number(req.params.id)
  if (!Number.isFinite(idNum)) return res.status(400).json({ error: 'invalid id' })
  const result = await deleteWorkItem(req.user.sub, idNum)
  if (!result.ok) {
    if (result.error === 'not found') return res.status(404).json({ error: 'not found' })
    return res.status(400).json({ error: result.error || 'unable to delete' })
  }
  res.json({ ok: true })
})

app.get('/api/work-items', authenticate, canRead, async (req, res) => {
  const scope = req.scope || 'self'
  const { start, end } = req.range
  const limit = Math.min(Math.max(Number(req.query.limit ?? 50), 1), 200)
  const offset = Math.max(Number(req.query.offset ?? 0), 0)
  const rangeFrom = toISODate(start)
  const rangeTo = toISODate(end)
  const result = await listWorkItems(req.user.sub, scope, { from: rangeFrom, to: rangeTo, limit, offset })
  await recordAudit({
    actorUserId: req.user.sub,
    action: 'list',
    objectType: 'work_item',
    detail: { scope, from: rangeFrom, to: rangeTo, count: result.total },
  })
  return res.json({ ...result })
})

app.get('/api/reports/weekly', authenticate, canRead, async (req, res) => {
  const scope = req.scope || 'self'
  const range = req.range
  const from = toISODate(range.start)
  const to = toISODate(range.end)
  const result = await weeklyAggregate(req.user.sub, scope, { from, to })
  await recordAudit({
    actorUserId: req.user.sub,
    action: 'report_weekly',
    objectType: 'work_item',
    detail: { scope, start: from, end: to, rows: result.data.length },
  })
  return res.json({ ok: true, range: { start: from, end: to }, data: result.data, details: result.details })
})

app.get('/api/reports/missing-weekly', authenticate, canRead, async (req, res) => {
  const scope = req.scope || 'self'
  const from = toISODate(req.range.start)
  const to = toISODate(req.range.end)
  const report = await calculateMissingReport(req.user.sub, scope, { from, to })
  await recordAudit({
    actorUserId: req.user.sub,
    action: 'report_missing_weekly',
    objectType: 'work_item',
    detail: { scope, start: from, end: to, missingUsers: report.data.length },
  })
  return res.json(report)
})

app.get('/api/reports/daily-overview', authenticate, async (req, res) => {
  const scope = normalizeScope(req.query.scope)
  const dateStr = typeof req.query.date === 'string' ? req.query.date.trim() : ''
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return res.status(400).json({ error: 'date must be YYYY-MM-DD' })
  }
  try {
    const overview = await buildDailyOverview(req.user.sub, scope, dateStr)
    await recordAudit({
      actorUserId: req.user.sub,
      action: 'report_daily_overview',
      objectType: 'work_item',
      detail: { scope, date: dateStr },
    })
    return res.json(overview)
  } catch (err) {
    return res.status(400).json({ error: 'invalid date range' })
  }
})

app.get('/api/reports/weekly-overview', authenticate, async (req, res) => {
  const scope = normalizeScope(req.query.scope)
  const range = parseRangeFromQuery(req.query)
  if ('error' in range) return res.status(400).json({ error: range.error })
  const from = toISODate(range.start)
  const to = toISODate(range.end)
  try {
    const overview = await buildWeeklyOverview(req.user.sub, scope, { from, to })
    await recordAudit({
      actorUserId: req.user.sub,
      action: 'report_weekly_overview',
      objectType: 'work_item',
      detail: { scope, start: from, end: to },
    })
    return res.json(overview)
  } catch (err) {
    return res.status(400).json({ error: 'invalid date range' })
  }
})

app.post('/api/reports/missing-weekly/remind', authenticate, canRead, async (req, res) => {
  const body = req.body || {}
  const requested = Array.isArray(body.userIds)
    ? Array.from(new Set(body.userIds.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0)))
    : []
  if (!requested.length) return res.status(400).json({ error: 'userIds required' })
  const scope = req.scope || 'self'
  const from = toISODate(req.range.start)
  const to = toISODate(req.range.end)
  const report = await calculateMissingReport(req.user.sub, scope, { from, to })
  const missingMap = new Map(report.data.map((entry) => [entry.userId, entry.missingDates]))
  const visible = await resolveVisibleUserIds(req.user.sub, scope, req.range.end)
  const visibleSet = new Set(visible)
  const targets = []
  const skipped = []
  for (const id of requested) {
    if (!visibleSet.has(id)) {
      skipped.push({ userId: id, reason: 'not_visible' })
      continue
    }
    const dates = missingMap.get(id) || []
    if (!dates.length) {
      skipped.push({ userId: id, reason: 'no_missing' })
      continue
    }
    targets.push({ userId: id, missingDates: dates })
  }
  await recordAudit({
    actorUserId: req.user.sub,
    action: 'missing_notify',
    objectType: 'work_item',
    detail: { scope, start: from, end: to, targetUserIds: targets.map((t) => t.userId), skipped },
  })
  return res.json({ ok: true, notified: targets.length, targets, skipped })
})

// --- Admin APIs ---

app.use('/api/admin', authenticate, requireAdmin)

app.get('/api/admin/orgs', async (req, res) => {
  const items = (await getOrgUnits()).items.map((org) => ({
    id: Number(org.id),
    name: org.name,
    parentId: org.parentId != null ? Number(org.parentId) : null,
    type: org.type,
    active: org.active !== false,
  }))
  res.json({ items })
})

app.get('/api/admin/orgs/tree', async (req, res) => {
  const items = await listOrgUnits()
  const map = new Map()
  items.forEach((org) => {
    map.set(Number(org.id), { id: Number(org.id), label: org.name, name: org.name, type: org.type, active: org.active !== false, children: [] })
  })
  const roots = []
  for (const org of items) {
    const node = map.get(Number(org.id))
    if (org.parentId && map.has(Number(org.parentId))) {
      map.get(Number(org.parentId)).children.push(node)
    } else {
      roots.push(node)
    }
  }
  res.json({ items: roots })
})

app.post('/api/admin/orgs', async (req, res) => {
  const body = req.body || {}
  const name = String(body.name || '').trim()
  if (!name) return res.status(400).json({ error: 'name required' })
  const data = await getOrgUnits()
  const now = new Date().toISOString()
  const id = ++data.meta.lastId
  data.items.push({
    id,
    name,
    parentId: body.parentId != null ? Number(body.parentId) : null,
    type: body.type ? String(body.type) : 'department',
    active: body.active != null ? !!body.active : true,
    createdAt: now,
    updatedAt: now,
  })
  await saveOrgUnits(data)
  await recordAudit({ actorUserId: req.user.sub, action: 'admin_create_org', objectType: 'org_unit', objectId: id })
  res.status(201).json({ id })
})

app.put('/api/admin/orgs/:id', async (req, res) => {
  const idNum = Number(req.params.id)
  if (!Number.isFinite(idNum)) return res.status(400).json({ error: 'invalid id' })
  const body = req.body || {}
  const data = await getOrgUnits()
  const idx = data.items.findIndex((org) => Number(org.id) === idNum)
  if (idx === -1) return res.status(404).json({ error: 'not found' })
  data.items[idx] = {
    ...data.items[idx],
    name: body.name != null ? String(body.name) : data.items[idx].name,
    parentId: body.parentId !== undefined ? (body.parentId == null ? null : Number(body.parentId)) : data.items[idx].parentId,
    type: body.type != null ? String(body.type) : data.items[idx].type,
    active: body.active != null ? !!body.active : data.items[idx].active,
    updatedAt: new Date().toISOString(),
  }
  await saveOrgUnits(data)
  await recordAudit({ actorUserId: req.user.sub, action: 'admin_update_org', objectType: 'org_unit', objectId: idNum })
  res.json({ ok: true })
})

app.get('/api/admin/users', async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit ?? 50), 1), 200)
  const offset = Math.max(Number(req.query.offset ?? 0), 0)
  const keyword = String(req.query.q || '').trim().toLowerCase()
  const all = await listUsers()
  const filtered = keyword
    ? all.filter((u) => {
        return [u.name, u.email, u.employeeNo]
          .map((v) => (v || '').toString().toLowerCase())
          .some((val) => val.includes(keyword))
      })
    : all
  const items = filtered.slice(offset, offset + limit).map((u) => ({
    id: Number(u.id),
    name: u.name,
    email: u.email ?? null,
    employeeNo: u.employeeNo ?? null,
    jobTitle: u.jobTitle ?? null,
    active: u.active !== false,
    visibleUserIds: Array.isArray(u.visibleUserIds)
      ? u.visibleUserIds.map((id) => Number(id)).filter((num) => Number.isFinite(num))
      : [Number(u.id)],
  }))
  res.json({ items, total: filtered.length, limit, offset })
})

app.post('/api/admin/users', async (req, res) => {
  const body = req.body || {}
  const name = String(body.name || '').trim()
  if (!name) return res.status(400).json({ error: 'name required' })
  let newId = null
  const now = new Date().toISOString()
  await replaceUsers(async (data) => {
    const id = ++data.meta.lastId
    newId = id
    const visibleUserIds = normalizeVisibleUserIds(body.visibleUserIds, id)
    data.items.push({
      id,
      name,
      email: body.email ? String(body.email) : null,
      employeeNo: body.employeeNo ? String(body.employeeNo) : null,
      jobTitle: body.jobTitle ? String(body.jobTitle) : null,
      active: body.active != null ? !!body.active : true,
      passwordHash: null,
      passwordChangedAt: null,
      createdAt: now,
      updatedAt: now,
      visibleUserIds,
    })
  })
  const id = Number(newId)
  await recordAudit({ actorUserId: req.user.sub, action: 'admin_create_user', objectType: 'user', objectId: id })
  res.status(201).json({ id })
})

app.put('/api/admin/users/:id', async (req, res) => {
  const idNum = Number(req.params.id)
  if (!Number.isFinite(idNum)) return res.status(400).json({ error: 'invalid id' })
  const body = req.body || {}
  try {
    await replaceUsers(async (data) => {
      const idx = data.items.findIndex((u) => Number(u.id) === idNum)
      if (idx === -1) throw new Error('not_found')
      data.items[idx] = {
        ...data.items[idx],
        name: body.name != null ? String(body.name) : data.items[idx].name,
        email: body.email !== undefined ? (body.email ? String(body.email) : null) : data.items[idx].email,
        employeeNo: body.employeeNo !== undefined ? (body.employeeNo ? String(body.employeeNo) : null) : data.items[idx].employeeNo,
        jobTitle: body.jobTitle !== undefined ? (body.jobTitle ? String(body.jobTitle) : null) : data.items[idx].jobTitle,
        active: body.active != null ? !!body.active : data.items[idx].active,
        updatedAt: new Date().toISOString(),
        visibleUserIds:
          body.visibleUserIds !== undefined
            ? normalizeVisibleUserIds(body.visibleUserIds, idNum)
            : normalizeVisibleUserIds(data.items[idx].visibleUserIds, idNum),
      }
    })
  } catch (err) {
    if (err.message === 'not_found') return res.status(404).json({ error: 'not found' })
    throw err
  }
  await recordAudit({ actorUserId: req.user.sub, action: 'admin_update_user', objectType: 'user', objectId: idNum })
  res.json({ ok: true })
})

app.patch('/api/admin/users/:id/primary-org', async (req, res) => {
  const idNum = Number(req.params.id)
  const orgId = Number(req.body?.orgId)
  if (!Number.isFinite(idNum) || !Number.isFinite(orgId)) return res.status(400).json({ error: 'invalid payload' })
  const data = await getUserOrgMemberships()
  let updated = false
  data.items = data.items.filter((m) => !(Number(m.userId) === idNum && m.isPrimary))
  data.items.push({
    userId: idNum,
    orgId,
    isPrimary: true,
    startDate: toISODate(new Date()),
    endDate: null,
  })
  data.meta.lastId = Math.max(data.meta.lastId || 0, data.items.length)
  await saveUserOrgMemberships(data)
  await recordAudit({ actorUserId: req.user.sub, action: 'admin_set_primary_org', objectType: 'user', objectId: idNum, detail: { orgId } })
  res.json({ ok: true })
})

app.get('/api/admin/users/:id/primary-org', async (req, res) => {
  const idNum = Number(req.params.id)
  if (!Number.isFinite(idNum)) return res.status(400).json({ error: 'invalid id' })
  const data = await getUserOrgMemberships()
  const active = data.items
    .filter((m) => Number(m.userId) === idNum && m.isPrimary)
    .filter((m) => m.endDate == null || m.endDate === '')
    .sort((a, b) => {
      const aStart = a.startDate || ''
      const bStart = b.startDate || ''
      if (aStart === bStart) return 0
      return aStart < bStart ? 1 : -1
    })
  const record = active.length ? active[0] : null
  res.json({ orgId: record ? Number(record.orgId) : null })
})



app.get('/api/admin/roles', async (req, res) => {
  const roles = (await getRoles()).items.map((role) => ({
    id: Number(role.id),
    code: role.code,
    name: role.name,
  }))
  res.json({ items: roles })
})

app.get('/api/admin/role-grants', async (req, res) => {
  const grants = (await getRoleGrants()).items
  const roles = await getRoles()
  const roleMap = new Map(roles.items.map((r) => [Number(r.id), r]))
  const users = await mapUsersById()
  const items = grants.map((g) => ({
    id: Number(g.id),
    granteeUserId: Number(g.granteeUserId),
    granteeName: users.get(Number(g.granteeUserId))?.name ?? null,
    roleId: Number(g.roleId),
    roleCode: roleMap.get(Number(g.roleId))?.code ?? '',
    roleName: roleMap.get(Number(g.roleId))?.name ?? '',
    domainOrgId: Number(g.domainOrgId),
    scope: g.scope,
    startDate: g.startDate,
    endDate: g.endDate,
  }))
  res.json({ items })
})

app.post('/api/admin/role-grants', async (req, res) => {
  const body = req.body || {}
  const granteeUserId = Number(body.granteeUserId)
  const domainOrgId = Number(body.domainOrgId)
  const scope = normalizeScope(body.scope)
  const startDate = body.startDate ? String(body.startDate) : toISODate(new Date())
  const endDate = body.endDate ? String(body.endDate) : null
  let roleId = body.roleId ? Number(body.roleId) : undefined
  if (!roleId && body.roleCode) {
    const roles = await getRoles()
    const match = roles.items.find((r) => r.code === body.roleCode)
    if (match) roleId = Number(match.id)
  }
  if (!Number.isInteger(granteeUserId) || !Number.isInteger(domainOrgId) || !roleId) {
    return res.status(400).json({ error: 'invalid payload' })
  }
  const data = await getRoleGrants()
  const now = new Date().toISOString()
  const id = ++data.meta.lastId
  data.items.push({
    id,
    granteeUserId,
    roleId,
    domainOrgId,
    scope,
    startDate,
    endDate,
    createdAt: now,
    updatedAt: now,
  })
  await saveRoleGrants(data)
  await recordAudit({ actorUserId: req.user.sub, action: 'admin_create_role_grant', objectType: 'role_grant', objectId: id })
  res.status(201).json({ id })
})

app.delete('/api/admin/role-grants/:id', async (req, res) => {
  const idNum = Number(req.params.id)
  if (!Number.isFinite(idNum)) return res.status(400).json({ error: 'invalid id' })
  const data = await getRoleGrants()
  const before = data.items.length
  data.items = data.items.filter((g) => Number(g.id) !== idNum)
  if (data.items.length === before) return res.status(404).json({ error: 'not found' })
  await saveRoleGrants(data)
  await recordAudit({ actorUserId: req.user.sub, action: 'admin_delete_role_grant', objectType: 'role_grant', objectId: idNum })
  res.json({ ok: true })
})

app.post('/api/admin/work-items/sample-data', async (req, res) => {
  const body = req.body || {}
  try {
    const result = await generateSampleWorkData({
      startDate: body.startDate,
      endDate: body.endDate,
    })
    await recordAudit({
      actorUserId: req.user.sub,
      action: 'admin_generate_sample_work',
      objectType: 'work_item',
      detail: {
        startDate: result.startDate,
        endDate: result.endDate,
        created: result.created,
        processedUsers: result.processedUsers,
      },
    })
    res.json({ ok: true, ...result })
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message || 'failed to generate sample data' })
  }
})

app.delete('/api/admin/work-items', async (req, res) => {
  try {
    const result = await clearAllWorkItems()
    await recordAudit({
      actorUserId: req.user.sub,
      action: 'admin_clear_work_items',
      objectType: 'work_item',
      detail: { cleared: result.cleared },
    })
    res.json({ ok: true, ...result })
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message || 'failed to clear work items' })
  }
})

app.post('/api/admin/migrate/r2', async (req, res) => {
  res.status(400).json({ ok: false, error: 'Not supported in local mode' })
})

app.get('/dev/token', async (req, res) => {
  const sub = Number(req.query.sub ?? 1)
  const name = String(req.query.name ?? 'DevUser')
  const email = String(req.query.email ?? 'dev@example.com')
  const isAdmin = await isUserAdmin(sub)
  const token = jwt.sign({ sub, name, email, isAdmin }, JWT_SECRET, { expiresIn: '1h' })
  res.json({ token })
})

const distDir = path.join(ROOT_DIR, 'web', 'dist')
app.use(express.static(distDir))

app.get('*', async (req, res) => {
  const indexHtml = path.join(distDir, 'index.html')
  try {
    const html = await fs.readFile(indexHtml, 'utf8')
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.send(html)
  } catch (err) {
    res.status(500).send('Frontend build not found. Please run npm run build:web first.')
  }
})

app.listen(PORT, HOST, () => {
  console.log(`Local server listening on http://${HOST}:${PORT}`)
})
