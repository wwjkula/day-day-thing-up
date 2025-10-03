import path from 'node:path'
import { DATA_DIR } from '../config.js'
import { readJson, writeJson, listFiles } from '../utils/file-store.js'

const USERS_FILE = path.join(DATA_DIR, 'users.json')
const ORGS_FILE = path.join(DATA_DIR, 'org_units.json')
const MANAGER_EDGES_FILE = path.join(DATA_DIR, 'manager_edges.json')
const ROLES_FILE = path.join(DATA_DIR, 'roles.json')
const ROLE_GRANTS_FILE = path.join(DATA_DIR, 'role_grants.json')
const USER_ORG_MEMBERSHIPS_FILE = path.join(DATA_DIR, 'user_org_memberships.json')
const AUDIT_LOG_FILE = path.join(DATA_DIR, 'audit_logs.json')
const WORK_ITEMS_ROOT = path.join(DATA_DIR, 'work_items')
const WORK_ITEMS_META = path.join(WORK_ITEMS_ROOT, 'meta.json')
const WORK_ITEMS_USER_DIR = path.join(WORK_ITEMS_ROOT, 'user')

const defaultCollection = () => ({ meta: { lastId: 0 }, items: [] })

async function loadCollection(filePath) {
  return readJson(filePath, defaultCollection())
}

async function saveCollection(filePath, payload) {
  await writeJson(filePath, payload)
}

export async function getUsers() {
  const data = await loadCollection(USERS_FILE)
  return data
}

export async function getUserById(id) {
  const data = await getUsers()
  return data.items.find((u) => u.id === Number(id)) || null
}

export async function getUserByEmployeeNo(employeeNo) {
  if (!employeeNo) return null
  const data = await getUsers()
  return data.items.find((u) => (u.employeeNo || '').toLowerCase() === employeeNo.toLowerCase()) || null
}

export async function getUserByEmail(email) {
  if (!email) return null
  const data = await getUsers()
  return data.items.find((u) => (u.email || '').toLowerCase() === email.toLowerCase()) || null
}

export async function upsertUser(user) {
  const data = await getUsers()
  const idx = data.items.findIndex((u) => u.id === user.id)
  const now = new Date().toISOString()
  if (idx === -1) {
    const id = user.id || ++data.meta.lastId
    const record = { ...user, id, createdAt: now, updatedAt: now }
    data.items.push(record)
    await saveCollection(USERS_FILE, data)
    return record
  }
  const current = data.items[idx]
  const record = { ...current, ...user, updatedAt: now }
  data.items[idx] = record
  await saveCollection(USERS_FILE, data)
  return record
}

export async function replaceUsers(updater) {
  const data = await loadCollection(USERS_FILE)
  const result = await updater(data)
  if (result !== false) {
    await saveCollection(USERS_FILE, data)
  }
  return data
}

export async function getOrgUnits() {
  return loadCollection(ORGS_FILE)
}

export async function saveOrgUnits(data) {
  await saveCollection(ORGS_FILE, data)
}

export async function getManagerEdges() {
  return loadCollection(MANAGER_EDGES_FILE)
}

export async function saveManagerEdges(data) {
  await saveCollection(MANAGER_EDGES_FILE, data)
}

export async function getRoles() {
  return loadCollection(ROLES_FILE)
}

export async function saveRoles(data) {
  await saveCollection(ROLES_FILE, data)
}

export async function getRoleGrants() {
  return loadCollection(ROLE_GRANTS_FILE)
}

export async function saveRoleGrants(data) {
  await saveCollection(ROLE_GRANTS_FILE, data)
}

export async function getUserOrgMemberships() {
  return loadCollection(USER_ORG_MEMBERSHIPS_FILE)
}

export async function saveUserOrgMemberships(data) {
  await saveCollection(USER_ORG_MEMBERSHIPS_FILE, data)
}

export async function getAuditLogs() {
  return loadCollection(AUDIT_LOG_FILE)
}

export async function appendAuditLog(entry) {
  const data = await loadCollection(AUDIT_LOG_FILE)
  const now = new Date().toISOString()
  const id = ++data.meta.lastId
  data.items.push({ id, createdAt: now, ...entry })
  await saveCollection(AUDIT_LOG_FILE, data)
}

async function loadWorkItemCollection(userId) {
  const file = path.join(WORK_ITEMS_USER_DIR, `${userId}.json`)
  return readJson(file, { meta: { lastId: 0 }, items: [] })
}

async function saveWorkItemCollection(userId, data) {
  const file = path.join(WORK_ITEMS_USER_DIR, `${userId}.json`)
  await writeJson(file, data)
}

async function nextWorkItemId() {
  const meta = await readJson(WORK_ITEMS_META, { lastId: 0 })
  meta.lastId = Number(meta.lastId || 0) + 1
  await writeJson(WORK_ITEMS_META, meta)
  return meta.lastId
}

export async function addWorkItem(userId, payload) {
  const collection = await loadWorkItemCollection(userId)
  const id = await nextWorkItemId()
  const now = new Date().toISOString()
  const record = {
    id,
    creatorId: Number(userId),
    createdAt: now,
    updatedAt: now,
    ...payload,
  }
  collection.meta.lastId = Math.max(collection.meta.lastId || 0, id)
  collection.items.push(record)
  await saveWorkItemCollection(userId, collection)
  return record
}

export async function listWorkItemsForUsers(userIds, { startDate, endDate }) {
  const result = []
  for (const id of userIds) {
    const collection = await loadWorkItemCollection(id)
    for (const item of collection.items) {
      if (item.workDate >= startDate && item.workDate <= endDate) {
        result.push(item)
      }
    }
  }
  return result
}

export async function listWorkItemsPaginated(userIds, { startDate, endDate, limit = 50, offset = 0 }) {
  const rows = await listWorkItemsForUsers(userIds, { startDate, endDate })
  rows.sort((a, b) => {
    if (a.workDate === b.workDate) return a.id - b.id
    return a.workDate.localeCompare(b.workDate)
  })
  const slice = rows.slice(offset, offset + limit)
  return { items: slice, total: rows.length }
}

export async function getAllWorkItems() {
  const files = await listFiles(WORK_ITEMS_USER_DIR)
  const items = []
  for (const file of files) {
    if (!file.endsWith('.json')) continue
    const collection = await loadWorkItemCollection(path.basename(file, '.json'))
    items.push(...collection.items)
  }
  return items
}
