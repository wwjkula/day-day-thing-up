import { Prisma, PrismaClient } from '@prisma/client'

function isEffectiveRange(asOf: Date) {
  return Prisma.sql`start_date <= ${asOf} AND (end_date IS NULL OR end_date >= ${asOf})`
}

type Drivers = {
  getDirectSubordinates?: (managerId: bigint, asOf: Date) => Promise<bigint[]>
  getAllSubordinates?: (managerId: bigint, asOf: Date) => Promise<bigint[]>
  getOrgDirectChildren?: (orgId: bigint) => Promise<bigint[]>
  getOrgSubtree?: (orgId: bigint) => Promise<bigint[]>
  getUsersByOrgs?: (orgIds: bigint[], asOf: Date) => Promise<bigint[]>
  getGrants?: () => Promise<{ domainOrgId: bigint; scope: 'self' | 'direct' | 'subtree' }[]>
}

async function getDirectSubordinates(prisma: PrismaClient, managerId: bigint, asOf: Date): Promise<bigint[]> {
  const rows = await prisma.$queryRaw<{ id: bigint }[]>`
    select subordinate_id as id
    from manager_edges
    where manager_id = ${Prisma.sql`${managerId}::bigint`}
      and ${isEffectiveRange(asOf)}
  `
  return rows.map(r => r.id)
}

async function getAllSubordinates(prisma: PrismaClient, managerId: bigint, asOf: Date): Promise<bigint[]> {
  const rows = await prisma.$queryRaw<{ id: bigint }[]>`
    with recursive sub(id) as (
      select ${Prisma.sql`${managerId}::bigint`} -- anchor
      union all
      select me.subordinate_id from manager_edges me
      join sub on me.manager_id = sub.id
      where ${isEffectiveRange(asOf)}
    )
    select id from sub where id <> ${managerId}
  `
  return rows.map(r => r.id)
}

async function getOrgDirectChildren(prisma: PrismaClient, orgId: bigint): Promise<bigint[]> {
  const rows = await prisma.$queryRaw<{ id: bigint }[]>`
    select id from org_units where parent_id = ${Prisma.sql`${orgId}::bigint`}
  `
  return rows.map(r => r.id)
}

async function getOrgSubtree(prisma: PrismaClient, orgId: bigint): Promise<bigint[]> {
  const rows = await prisma.$queryRaw<{ id: bigint }[]>`
    with recursive orgs(id) as (
      select ${Prisma.sql`${orgId}::bigint`}
      union all
      select ou.id from org_units ou
      join orgs on ou.parent_id = orgs.id
    )
    select id from orgs
  `
  return rows.map(r => r.id)
}

async function getUsersByOrgs(prisma: PrismaClient, orgIds: bigint[], asOf: Date): Promise<bigint[]> {
  if (orgIds.length === 0) return []
  const rows = await prisma.$queryRaw<{ id: bigint }[]>`
    select distinct uom."userId" as id
    from "user_org_memberships" uom
    where uom."orgId" in (${Prisma.join(orgIds.map(id => Prisma.sql`${id}::bigint`))})
      and ${isEffectiveRange(asOf)}
  `
  return rows.map(r => r.id)
}

export async function resolveVisibleUsers(
  prisma: PrismaClient,
  viewerId: bigint,
  scope: 'self' | 'direct' | 'subtree',
  asOf: Date,
  options?: { drivers?: Drivers; grants?: { domainOrgId: bigint; scope: 'self' | 'direct' | 'subtree' }[] }
): Promise<bigint[]> {
  const result = new Set<bigint>()
  result.add(viewerId)

  const drv = options?.drivers

  // Managerial visibility by scope
  if (scope === 'direct') {
    const ids = drv?.getDirectSubordinates
      ? await drv.getDirectSubordinates(viewerId, asOf)
      : await getDirectSubordinates(prisma, viewerId, asOf)
    for (const id of ids) result.add(id)
  } else if (scope === 'subtree') {
    const ids = drv?.getAllSubordinates
      ? await drv.getAllSubordinates(viewerId, asOf)
      : await getAllSubordinates(prisma, viewerId, asOf)
    for (const id of ids) result.add(id)
  }

  // Role grants based domain visibility (self/direct/subtree on org tree)
  const grants = options?.grants ?? (drv?.getGrants
    ? await drv.getGrants()
    : await prisma.roleGrant.findMany({
        where: {
          granteeUserId: viewerId,
          startDate: { lte: asOf },
          OR: [{ endDate: null }, { endDate: { gte: asOf } }],
        },
        select: { domainOrgId: true, scope: true },
      }))

  let coveredOrgIds: bigint[] = []
  for (const g of grants) {
    const s = String((g as any).scope)
    if (s === 'self') {
      coveredOrgIds.push(g.domainOrgId)
    } else if (s === 'direct') {
      const children = drv?.getOrgDirectChildren
        ? await drv.getOrgDirectChildren(g.domainOrgId)
        : await getOrgDirectChildren(prisma, g.domainOrgId)
      coveredOrgIds.push(g.domainOrgId, ...children)
    } else if (s === 'subtree') {
      const subtree = drv?.getOrgSubtree
        ? await drv.getOrgSubtree(g.domainOrgId)
        : await getOrgSubtree(prisma, g.domainOrgId)
      coveredOrgIds.push(...subtree)
    }
  }
  if (coveredOrgIds.length > 0) {
    coveredOrgIds = Array.from(new Set(coveredOrgIds))
    const usersFromDomains = drv?.getUsersByOrgs
      ? await drv.getUsersByOrgs(coveredOrgIds, asOf)
      : await getUsersByOrgs(prisma, coveredOrgIds, asOf)
    for (const id of usersFromDomains) result.add(id)
  }

  return Array.from(result)
}


export function makeClosureDrivers(prisma: PrismaClient): Drivers {
  return {
    getOrgDirectChildren: async (orgId: bigint) => {
      const rows = await prisma.$queryRaw<{ id: bigint }[]>`
        select descendant_id as id from org_closure
        where ancestor_id = ${orgId} and depth = 1
      `
      return rows.map(r => r.id)
    },
    getOrgSubtree: async (orgId: bigint) => {
      const rows = await prisma.$queryRaw<{ id: bigint }[]>`
        select descendant_id as id from org_closure
        where ancestor_id = ${orgId}
      `
      return rows.map(r => r.id)
    },
    getUsersByOrgs: async (orgIds: bigint[], asOf: Date) => {
      return getUsersByOrgs(prisma, orgIds, asOf)
    },
  }
}

