import { getOrgUnits, getRoleGrants, getRoles, saveRoles, getUserOrgMemberships, getUsers } from '../data/store.js'
import { isEffective } from '../utils/datetime.js'

export async function listUsers() {
  return (await getUsers()).items
}

export async function mapUsersById() {
  const items = await listUsers()
  const map = new Map()
  for (const user of items) {
    map.set(Number(user.id), user)
  }
  return map
}

export async function getPrimaryOrgId(userId, asOf = new Date()) {
  const memberships = (await getUserOrgMemberships()).items
  const filtered = memberships.filter(
    (m) => Number(m.userId) === Number(userId) && !!m.isPrimary && isEffective(m, asOf)
  )
  if (!filtered.length) return null
  // Choose latest by startDate descending
  filtered.sort((a, b) => b.startDate.localeCompare(a.startDate))
  return Number(filtered[0].orgId)
}

export async function listOrgUnits() {
  return (await getOrgUnits()).items
}

export async function ensureRole(code, name) {
  const data = await getRoles()
  const existing = data.items.find((role) => role.code === code)
  if (existing) return existing
  const now = new Date().toISOString()
  const id = ++data.meta.lastId
  const record = { id, code, name: name || code, createdAt: now, updatedAt: now }
  data.items.push(record)
  await saveRoles(data)
  return record
}

export async function isUserAdmin(userId, asOf = new Date()) {
  const grants = (await getRoleGrants()).items
  if (!grants.length) return false
  const roles = (await getRoles()).items
  const roleMap = new Map(roles.map((r) => [Number(r.id), r.code]))
  return grants.some(
    (g) =>
      Number(g.granteeUserId) === Number(userId) &&
      isEffective(g, asOf) &&
      roleMap.get(Number(g.roleId)) === 'sys_admin'
  )
}

export async function listRoleGrantsForUser(userId, asOf = new Date()) {
  return (await getRoleGrants()).items.filter(
    (g) => Number(g.granteeUserId) === Number(userId) && isEffective(g, asOf)
  )
}
