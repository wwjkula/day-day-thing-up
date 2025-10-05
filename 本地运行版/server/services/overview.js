import { listWorkItemsForUsers, getUserOrgMemberships } from '../data/store.js'
import { resolveVisibleUserIds } from './visibility.js'
import { mapUsersById, listOrgUnits } from './domain.js'
import { parseISODate, toISODate, isEffective } from '../utils/datetime.js'

function addDays(date, amount) {
  const next = new Date(date)
  next.setUTCDate(next.getUTCDate() + amount)
  return next
}

function normalizeWorkItem(item) {
  return {
    ...item,
    id: Number(item.id),
    creatorId: Number(item.creatorId),
    orgId: item.orgId != null ? Number(item.orgId) : null,
    durationMinutes: item.durationMinutes != null ? Number(item.durationMinutes) : null,
  }
}

function createPrimaryOrgResolver(memberships) {
  const byUser = new Map()
  for (const membership of memberships) {
    if (!membership || !membership.isPrimary) continue
    const userId = Number(membership.userId)
    if (!byUser.has(userId)) byUser.set(userId, [])
    byUser.get(userId).push(membership)
  }
  return (userId, asOf) => {
    const list = byUser.get(Number(userId))
    if (!list || !list.length) return null
    let chosen = null
    for (const membership of list) {
      if (!isEffective(membership, asOf)) continue
      if (!chosen || (membership.startDate || '') > (chosen.startDate || '')) {
        chosen = membership
      }
    }
    return chosen ? Number(chosen.orgId) : null
  }
}

function buildOrgLookup(orgUnits) {
  const orgMap = new Map()
  const roots = []
  for (const org of orgUnits) {
    const id = Number(org.id)
    const parentId = org.parentId != null ? Number(org.parentId) : null
    orgMap.set(id, { ...org, id, parentId })
    if (parentId == null) roots.push(id)
  }
  const ancestorCache = new Map()
  function getChain(orgId) {
    if (orgId == null || !orgMap.has(orgId)) return []
    if (ancestorCache.has(orgId)) return ancestorCache.get(orgId)
    const chain = []
    let current = orgId
    while (current != null && orgMap.has(current)) {
      chain.push(current)
      const parent = orgMap.get(current).parentId
      current = parent != null ? Number(parent) : null
    }
    ancestorCache.set(orgId, chain)
    return chain
  }
  return { orgMap, roots, getChain }
}

function initDailyMetrics() {
  return {
    userCount: 0,
    completedUsers: 0,
    completedCount: 0,
    completedMinutes: 0,
    planUsers: 0,
    planCount: 0,
    missingUsers: 0,
  }
}

function initWeeklySummary() {
  return {
    completedCount: 0,
    completedMinutes: 0,
    typeCounts: { done: 0, progress: 0, temp: 0, assist: 0 },
    planCount: 0,
    missingDays: [],
  }
}

export async function buildDailyOverview(actorId, scope, dateStr) {
  const date = parseISODate(dateStr)
  if (Number.isNaN(date.getTime())) throw new Error('invalid date')
  const nextDate = addDays(date, 1)
  const nextDateStr = toISODate(nextDate)

  const visible = await resolveVisibleUserIds(actorId, scope, date)
  const usersMap = await mapUsersById()
  const orgUnits = await listOrgUnits()
  const { orgMap, roots, getChain } = buildOrgLookup(orgUnits)
  const memberships = (await getUserOrgMemberships()).items
  const resolvePrimaryOrg = createPrimaryOrgResolver(memberships)

  const workItems = await listWorkItemsForUsers(visible, {
    startDate: dateStr,
    endDate: nextDateStr,
  })

  const userDayMap = new Map()
  for (const raw of workItems) {
    const item = normalizeWorkItem(raw)
    const userId = Number(item.creatorId)
    if (!userDayMap.has(userId)) userDayMap.set(userId, new Map())
    const dayMap = userDayMap.get(userId)
    if (!dayMap.has(item.workDate)) {
      dayMap.set(item.workDate, { completed: [], plans: [] })
    }
    const entry = dayMap.get(item.workDate)
    if (item.type === 'plan') entry.plans.push(item)
    else entry.completed.push(item)
  }

  const orgSummaries = new Map()
  function ensureOrgSummary(orgId) {
    if (!orgSummaries.has(orgId)) {
      const org = orgMap.get(orgId) || null
      orgSummaries.set(orgId, {
        orgId,
        parentId: org?.parentId ?? null,
        name: org?.name ?? '未分配组织',
        metrics: initDailyMetrics(),
      })
    }
    return orgSummaries.get(orgId)
  }

  const users = []
  const totals = initDailyMetrics()
  const rootChainFallback = roots.length ? roots : []

  const sortedVisible = Array.from(new Set(visible.map((id) => Number(id))))
    .filter((id) => {
      const user = usersMap.get(id)
      return user && user.active !== false
    })
    .sort((a, b) => {
      const userA = usersMap.get(a)
      const userB = usersMap.get(b)
      const nameA = (userA?.name || '').localeCompare(userB?.name || '', 'zh-CN')
      if (nameA !== 0) return nameA
      return a - b
    })

  for (const userId of sortedVisible) {
    const user = usersMap.get(userId)
    if (!user) continue
    const dayMap = userDayMap.get(userId) || new Map()
    const todayEntry = dayMap.get(dateStr) || { completed: [], plans: [] }
    const tomorrowEntry = dayMap.get(nextDateStr) || { completed: [], plans: [] }

    const completed = todayEntry.completed.slice()
    const plans = tomorrowEntry.plans.slice()
    const completedCount = completed.length
    const completedMinutes = completed.reduce((acc, item) => acc + (item.durationMinutes || 0), 0)
    const planCount = plans.length
    const hasPlan = planCount > 0
    const missing = completedCount === 0

    const orgId = resolvePrimaryOrg(userId, date)
    const org = orgId != null ? orgMap.get(orgId) : null

    users.push({
      userId,
      name: user.name ?? null,
      orgId: orgId ?? null,
      orgName: org?.name ?? null,
      metrics: {
        completedCount,
        completedMinutes,
        planCount,
        hasPlan,
        missing,
      },
      completed,
      plans,
    })

    totals.userCount += 1
    if (completedCount > 0) totals.completedUsers += 1
    totals.completedCount += completedCount
    totals.completedMinutes += completedMinutes
    if (planCount > 0) totals.planUsers += 1
    totals.planCount += planCount
    if (missing) totals.missingUsers += 1

    const orgChain = orgId != null ? getChain(orgId) : []
    const chain = orgChain.length ? orgChain : rootChainFallback
    for (const oid of chain) {
      const summary = ensureOrgSummary(oid)
      summary.metrics.userCount += 1
      if (completedCount > 0) summary.metrics.completedUsers += 1
      summary.metrics.completedCount += completedCount
      summary.metrics.completedMinutes += completedMinutes
      if (planCount > 0) summary.metrics.planUsers += 1
      summary.metrics.planCount += planCount
      if (missing) summary.metrics.missingUsers += 1
    }
  }

  const orgs = Array.from(orgSummaries.values()).sort((a, b) => {
    const parentA = a.parentId ?? -1
    const parentB = b.parentId ?? -1
    if (parentA !== parentB) return parentA - parentB
    return a.name.localeCompare(b.name, 'zh-CN')
  })

  return {
    ok: true,
    date: dateStr,
    nextDate: nextDateStr,
    scope,
    totals,
    users,
    orgs,
  }
}

export async function buildWeeklyOverview(actorId, scope, range) {
  const { from, to } = range
  const start = parseISODate(from)
  const end = parseISODate(to)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) {
    throw new Error('invalid range')
  }

  const dates = []
  for (let d = new Date(start); d <= end; d = addDays(d, 1)) {
    dates.push(toISODate(d))
  }

  const visible = await resolveVisibleUserIds(actorId, scope, end)
  const usersMap = await mapUsersById()
  const orgUnits = await listOrgUnits()
  const { orgMap, roots, getChain } = buildOrgLookup(orgUnits)
  const memberships = (await getUserOrgMemberships()).items
  const resolvePrimaryOrg = createPrimaryOrgResolver(memberships)

  const workItems = await listWorkItemsForUsers(visible, {
    startDate: from,
    endDate: to,
  })

  const userDayMap = new Map()
  for (const raw of workItems) {
    const item = normalizeWorkItem(raw)
    const userId = Number(item.creatorId)
    if (!userDayMap.has(userId)) userDayMap.set(userId, new Map())
    const dayMap = userDayMap.get(userId)
    if (!dayMap.has(item.workDate)) {
      dayMap.set(item.workDate, { completed: [], plans: [] })
    }
    const entry = dayMap.get(item.workDate)
    if (item.type === 'plan') entry.plans.push(item)
    else entry.completed.push(item)
  }

  const orgSummaries = new Map()
  function ensureWeeklySummary(orgId) {
    if (!orgSummaries.has(orgId)) {
      const org = orgMap.get(orgId) || null
      orgSummaries.set(orgId, {
        orgId,
        parentId: org?.parentId ?? null,
        name: org?.name ?? '未分配组织',
        summary: {
          ...initWeeklySummary(),
          userCount: 0,
          completedUsers: 0,
          planUsers: 0,
        },
      })
    }
    return orgSummaries.get(orgId)
  }

  const users = []
  const rootChainFallback = roots.length ? roots : []

  const sortedVisible = Array.from(new Set(visible.map((id) => Number(id))))
    .filter((id) => {
      const user = usersMap.get(id)
      return user && user.active !== false
    })
    .sort((a, b) => {
      const userA = usersMap.get(a)
      const userB = usersMap.get(b)
      const nameA = (userA?.name || '').localeCompare(userB?.name || '', 'zh-CN')
      if (nameA !== 0) return nameA
      return a - b
    })

  for (const userId of sortedVisible) {
    const user = usersMap.get(userId)
    if (!user) continue
    const orgId = resolvePrimaryOrg(userId, end)
    const org = orgId != null ? orgMap.get(orgId) : null
    const dayMap = userDayMap.get(userId) || new Map()

    const days = dates.map((dateKey) => {
      const entry = dayMap.get(dateKey) || { completed: [], plans: [] }
      const completed = entry.completed.slice()
      const plans = entry.plans.slice()
      const completedCount = completed.length
      const completedMinutes = completed.reduce((acc, item) => acc + (item.durationMinutes || 0), 0)
      const planCount = plans.length
      return {
        date: dateKey,
        completedCount,
        completedMinutes,
        planCount,
        completed,
        plans,
      }
    })

    const summary = initWeeklySummary()
    const missingDays = []
    for (const day of days) {
      summary.completedCount += day.completedCount
      summary.completedMinutes += day.completedMinutes
      summary.planCount += day.planCount
      if (day.completedCount === 0) missingDays.push(day.date)
      for (const item of day.completed) {
        if (item.type === 'plan') continue
        if (summary.typeCounts[item.type] != null) {
          summary.typeCounts[item.type] += 1
        }
      }
    }
    summary.missingDays = missingDays

    users.push({
      userId,
      name: user.name ?? null,
      orgId: orgId ?? null,
      orgName: org?.name ?? null,
      days,
      summary,
    })

    const chain = (orgId != null ? getChain(orgId) : rootChainFallback)
    for (const oid of chain) {
      const record = ensureWeeklySummary(oid)
      record.summary.userCount += 1
      if (summary.completedCount > 0) record.summary.completedUsers += 1
      if (summary.planCount > 0) record.summary.planUsers += 1
      record.summary.completedCount += summary.completedCount
      record.summary.completedMinutes += summary.completedMinutes
      record.summary.planCount += summary.planCount
      for (const type of ['done', 'progress', 'temp', 'assist']) {
        record.summary.typeCounts[type] += summary.typeCounts[type]
      }
    }
  }

  const orgs = Array.from(orgSummaries.values()).sort((a, b) => {
    const parentA = a.parentId ?? -1
    const parentB = b.parentId ?? -1
    if (parentA !== parentB) return parentA - parentB
    return a.name.localeCompare(b.name, 'zh-CN')
  })

  // Ensure missingDays exists on org summaries (empty by default)
  for (const org of orgs) {
    if (!org.summary.missingDays) org.summary.missingDays = []
  }

  return {
    ok: true,
    range: { start: from, end: to },
    scope,
    users,
    orgs,
  }
}
