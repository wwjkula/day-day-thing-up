import { PrismaClient } from '@prisma/client'
import { R2DataStore } from './data/r2-store'
import type { AuditLogRecord, ManagerEdgeRecord, OrgUnitRecord, RoleGrantRecord, RoleRecord, UserOrgMembershipRecord, UserRecord, WorkItemRecord } from './data/types'

interface MigrationSummary {
  users: number
  orgUnits: number
  memberships: number
  managerEdges: number
  roles: number
  roleGrants: number
  workItems: number
  auditLogs: number
}

function isoFromDate(date: Date | null | undefined): string | null {
  return date ? date.toISOString() : null
}

function dateString(date: Date | null | undefined): string | null {
  return date ? date.toISOString().slice(0, 10) : null
}

function splitTags(raw: string | null): string[] {
  if (!raw) return []
  return raw.split(',').map((t) => t.trim()).filter(Boolean)
}

function ensureSafeNumber(value: bigint | number): number {
  const num = typeof value === 'bigint' ? Number(value) : value
  if (!Number.isSafeInteger(num)) {
    throw new Error(`Value ${value.toString()} exceeds safe integer range`)
  }
  return num
}

export async function migrateNeonToR2(prisma: PrismaClient, store: R2DataStore): Promise<MigrationSummary> {
  const [usersRaw, orgsRaw, membershipsRaw, edgesRaw, rolesRaw, roleGrantsRaw, workItemsRaw, auditLogsRaw] = await Promise.all([
    prisma.user.findMany(),
    prisma.orgUnit.findMany(),
    prisma.userOrgMembership.findMany(),
    prisma.managerEdge.findMany(),
    prisma.role.findMany(),
    prisma.roleGrant.findMany(),
    prisma.workItem.findMany(),
    prisma.auditLog.findMany(),
  ])

  const nowIso = new Date().toISOString()

  const users: UserRecord[] = usersRaw.map((u) => ({
    id: ensureSafeNumber(u.id),
    employeeNo: u.employeeNo ?? null,
    name: u.name ?? '',
    email: u.email ?? null,
    phone: u.phone ?? null,
    jobTitle: u.jobTitle ?? null,
    grade: u.grade ?? null,
    active: u.active,
    passwordHash: u.passwordHash ?? null,
    passwordChangedAt: isoFromDate(u.passwordChangedAt),
    createdAt: nowIso,
    updatedAt: nowIso,
  }))
  const maxUserId = users.reduce((max, u) => Math.max(max, u.id), 0)
  await store.writeUsers((file) => {
    file.items = users
    file.meta.lastId = maxUserId
  })

  const orgs: OrgUnitRecord[] = orgsRaw.map((o) => ({
    id: ensureSafeNumber(o.id),
    name: o.name,
    parentId: o.parentId ? ensureSafeNumber(o.parentId) : null,
    type: o.type ?? 'department',
    active: o.active,
    createdAt: nowIso,
    updatedAt: nowIso,
  }))
  const maxOrgId = orgs.reduce((max, o) => Math.max(max, o.id), 0)
  await store.writeOrgUnits((file) => {
    file.items = orgs
    file.meta.lastId = maxOrgId
  })

  const memberships: UserOrgMembershipRecord[] = membershipsRaw.map((m) => ({
    userId: ensureSafeNumber(m.userId),
    orgId: ensureSafeNumber(m.orgId),
    isPrimary: m.isPrimary,
    startDate: dateString(m.startDate)!,
    endDate: dateString(m.endDate),
  }))
  await store.writeUserOrgMemberships((file) => {
    file.items = memberships
    file.meta.lastId = memberships.length
  })

  const managerEdges: ManagerEdgeRecord[] = edgesRaw.map((edge) => ({
    managerId: ensureSafeNumber(edge.managerId),
    subordinateId: ensureSafeNumber(edge.subordinateId),
    startDate: dateString(edge.startDate)!,
    endDate: dateString(edge.endDate),
    priority: edge.priority ?? 100,
  }))
  await store.writeManagerEdges((file) => {
    file.items = managerEdges
    file.meta.lastId = managerEdges.length
  })

  const roles: RoleRecord[] = rolesRaw.map((role) => ({
    id: ensureSafeNumber(role.id),
    code: role.code,
    name: role.name,
    createdAt: nowIso,
    updatedAt: nowIso,
  }))
  const maxRoleId = roles.reduce((max, r) => Math.max(max, r.id), 0)
  await store.writeRoles((file) => {
    file.items = roles
    file.meta.lastId = maxRoleId
  })

  const roleGrants: RoleGrantRecord[] = roleGrantsRaw.map((grant) => ({
    id: ensureSafeNumber(grant.id),
    granteeUserId: ensureSafeNumber(grant.granteeUserId),
    roleId: ensureSafeNumber(grant.roleId),
    domainOrgId: ensureSafeNumber(grant.domainOrgId),
    scope: String(grant.scope) as RoleGrantRecord['scope'],
    startDate: dateString(grant.startDate)!,
    endDate: dateString(grant.endDate),
    createdAt: nowIso,
    updatedAt: nowIso,
  }))
  const maxGrantId = roleGrants.reduce((max, g) => Math.max(max, g.id), 0)
  await store.writeRoleGrants((file) => {
    file.items = roleGrants
    file.meta.lastId = maxGrantId
  })

  const workItems: WorkItemRecord[] = workItemsRaw.map((item) => ({
    id: ensureSafeNumber(item.id),
    creatorId: ensureSafeNumber(item.creatorId),
    orgId: ensureSafeNumber(item.orgId),
    workDate: dateString(item.workDate)!,
    title: item.title,
    type: item.type as WorkItemRecord['type'],
    durationMinutes: item.durationMinutes ?? null,
    tags: splitTags(item.tags ?? null),
    detail: item.detail ?? null,
    createdAt: isoFromDate(item.createdAt)!,
    updatedAt: isoFromDate(item.updatedAt)!,
  }))
  const workItemsByUser = new Map<number, WorkItemRecord[]>()
  let maxWorkItemId = 0
  for (const record of workItems) {
    maxWorkItemId = Math.max(maxWorkItemId, record.id)
    if (!workItemsByUser.has(record.creatorId)) {
      workItemsByUser.set(record.creatorId, [])
    }
    workItemsByUser.get(record.creatorId)!.push(record)
  }

  const existingKeys = await store.listUserWorkItemKeys()
  const existingUserIds = existingKeys
    .map((key) => {
      const match = /data\/work_items\/user\/(\d+)\.json$/.exec(key)
      return match ? Number(match[1]) : null
    })
    .filter((id): id is number => id != null)

  const userIdSet = new Set(users.map((u) => u.id))
  for (const userId of userIdSet) {
    const items = (workItemsByUser.get(userId) ?? []).sort((a, b) => (a.workDate === b.workDate ? a.id - b.id : a.workDate.localeCompare(b.workDate)))
    const maxIdForUser = items.reduce((max, item) => Math.max(max, item.id), 0)
    await store.writeUserWorkItems(userId, (file) => {
      file.items = items
      file.meta.lastId = maxIdForUser
    })
  }

  for (const userId of existingUserIds) {
    if (!userIdSet.has(userId)) {
      await store.deleteUserWorkItemsFile(userId)
    }
  }

  await store.writeWorkItemsMeta((meta) => {
    meta.lastId = maxWorkItemId
  })

  const auditLogs: AuditLogRecord[] = auditLogsRaw.map((log) => ({
    id: ensureSafeNumber(log.id),
    actorUserId: ensureSafeNumber(log.actorUserId),
    action: log.action,
    objectType: log.objectType ?? null,
    objectId: log.objectId != null ? ensureSafeNumber(log.objectId) : null,
    detail: log.detail ? JSON.parse(JSON.stringify(log.detail)) : null,
    createdAt: isoFromDate(log.createdAt)!,
  }))
  const maxAuditId = auditLogs.reduce((max, log) => Math.max(max, log.id), 0)
  await store.writeAuditLogs((file) => {
    file.items = auditLogs
    file.meta.lastId = maxAuditId
  })

  return {
    users: users.length,
    orgUnits: orgs.length,
    memberships: memberships.length,
    managerEdges: managerEdges.length,
    roles: roles.length,
    roleGrants: roleGrants.length,
    workItems: workItems.length,
    auditLogs: auditLogs.length,
  }
}
