import { getManagerEdges, getOrgUnits, getRoleGrants, getUserOrgMemberships } from '../data/store.js'
import { isEffective } from '../utils/datetime.js'

async function buildManagerMaps(asOf) {
  const edges = (await getManagerEdges()).items.filter((edge) => isEffective(edge, asOf))
  const direct = new Map()
  for (const edge of edges) {
    const list = direct.get(edge.managerId) || []
    list.push(edge.subordinateId)
    direct.set(edge.managerId, list)
  }
  return direct
}

function collectSubtree(directMap, rootId) {
  const visited = new Set()
  const stack = [rootId]
  while (stack.length) {
    const current = stack.pop()
    const next = directMap.get(current) || []
    for (const id of next) {
      if (!visited.has(id)) {
        visited.add(id)
        stack.push(id)
      }
    }
  }
  return Array.from(visited)
}

function buildOrgMaps(orgUnits) {
  const children = new Map()
  for (const org of orgUnits) {
    const parentId = org.parentId == null ? null : Number(org.parentId)
    if (!children.has(parentId)) children.set(parentId, [])
    children.get(parentId).push(Number(org.id))
  }
  return children
}

function collectOrgSubtree(childrenMap, orgId, depthLimit = Infinity) {
  const result = new Set([orgId])
  const queue = [{ id: orgId, depth: 0 }]
  while (queue.length) {
    const { id, depth } = queue.shift()
    if (depth >= depthLimit) continue
    const kids = childrenMap.get(id) || []
    for (const child of kids) {
      if (!result.has(child)) {
        result.add(child)
        queue.push({ id: child, depth: depth + 1 })
      }
    }
  }
  return Array.from(result)
}

async function getUsersByOrgIds(orgIds, asOf) {
  const memberships = (await getUserOrgMemberships()).items.filter((m) => isEffective(m, asOf))
  const set = new Set()
  for (const membership of memberships) {
    if (orgIds.includes(Number(membership.orgId))) {
      set.add(Number(membership.userId))
    }
  }
  return Array.from(set)
}

export async function resolveVisibleUserIds(viewerId, scope = 'self', asOf = new Date()) {
  const resolved = new Set([Number(viewerId)])
  const managerMap = await buildManagerMaps(asOf)

  if (scope === 'direct') {
    const ids = managerMap.get(Number(viewerId)) || []
    ids.forEach((id) => resolved.add(Number(id)))
  } else if (scope === 'subtree') {
    const ids = collectSubtree(managerMap, Number(viewerId))
    ids.forEach((id) => resolved.add(Number(id)))
  }

  const grantsData = await getRoleGrants()
  if (grantsData.items.length) {
    const orgUnits = (await getOrgUnits()).items
    const orgChildren = buildOrgMaps(orgUnits)
    const grants = grantsData.items.filter(
      (g) => Number(g.granteeUserId) === Number(viewerId) && isEffective(g, asOf)
    )
    if (grants.length) {
      const coveredOrgIds = new Set()
      for (const grant of grants) {
        const domainId = Number(grant.domainOrgId)
        const scopeVal = String(grant.scope)
        if (scopeVal === 'self') {
          coveredOrgIds.add(domainId)
        } else if (scopeVal === 'direct') {
          collectOrgSubtree(orgChildren, domainId, 1).forEach((id) => coveredOrgIds.add(id))
        } else if (scopeVal === 'subtree') {
          collectOrgSubtree(orgChildren, domainId).forEach((id) => coveredOrgIds.add(id))
        }
      }
      if (coveredOrgIds.size) {
        const users = await getUsersByOrgIds(Array.from(coveredOrgIds), asOf)
        users.forEach((id) => resolved.add(Number(id)))
      }
    }
  }

  return Array.from(resolved)
}
