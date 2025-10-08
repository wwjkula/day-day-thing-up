import { addWorkItem, listWorkItemsForUsers, listWorkItemsPaginated, updateWorkItem, removeWorkItem } from '../data/store.js'
import { appendAuditLog } from '../data/store.js'
import { resolveVisibleUserIds } from './visibility.js'
import { getPrimaryOrgId, mapUsersById } from './domain.js'
import { parseISODate, toISODate } from '../utils/datetime.js'

const allowedTypes = new Set(['done', 'progress', 'temp', 'assist', 'plan'])

export function validateWorkItemInput(body) {
  const errors = []
  const title = typeof body.title === 'string' ? body.title.trim() : ''
  if (!title) errors.push('title is required')
  if ([...title].length > 20) errors.push('title must be <= 20 characters')

  const workDate = typeof body.workDate === 'string' ? body.workDate : ''
  if (!/^\d{4}-\d{2}-\d{2}$/.test(workDate)) errors.push('workDate must be YYYY-MM-DD')
  else if (isNaN(parseISODate(workDate).getTime())) errors.push('invalid workDate')

  const type = typeof body.type === 'string' ? body.type : 'done'
  if (!allowedTypes.has(type)) errors.push('invalid type')

  if (body.durationMinutes != null) {
    const duration = Number(body.durationMinutes)
    if (!Number.isInteger(duration) || duration < 0) errors.push('durationMinutes must be a non-negative integer')
  }

  return { valid: errors.length === 0, errors, title, workDate, type }
}

export async function createWorkItem(actorId, body) {
  const { valid, errors, title, workDate, type } = validateWorkItemInput(body)
  if (!valid) {
    return { ok: false, error: errors[0] }
  }

  const durationMinutes = body.durationMinutes != null ? Number(body.durationMinutes) : null
  const tags = Array.isArray(body.tags) ? body.tags.map((t) => String(t)).slice(0, 20) : []
  const detail = body.detail != null ? String(body.detail) : null

  const orgId = await getPrimaryOrgId(actorId, parseISODate(workDate))
  if (orgId == null) {
    return { ok: false, error: 'no primary org for user' }
  }

  const record = await addWorkItem(actorId, {
    orgId,
    workDate,
    title,
    type,
    durationMinutes,
    tags,
    detail,
  })

  await appendAuditLog({
    actorUserId: Number(actorId),
    action: 'create_work_item',
    objectType: 'work_item',
    objectId: record.id,
    detail: { workDate },
  })

  return { ok: true, record }
}

export function validateWorkItemPatch(body) {
  const errors = []
  const patch = {}

  if (body.title !== undefined) {
    const title = typeof body.title === 'string' ? body.title.trim() : ''
    if (!title) errors.push('title is required')
    else if ([...title].length > 20) errors.push('title must be <= 20 characters')
    else patch.title = title
  }

  if (body.workDate !== undefined) {
    const workDate = typeof body.workDate === 'string' ? body.workDate : ''
    if (!/^\d{4}-\d{2}-\d{2}$/.test(workDate)) errors.push('workDate must be YYYY-MM-DD')
    else if (isNaN(parseISODate(workDate).getTime())) errors.push('invalid workDate')
    else patch.workDate = workDate
  }

  if (body.type !== undefined) {
    const type = typeof body.type === 'string' ? body.type : ''
    if (!allowedTypes.has(type)) errors.push('invalid type')
    else patch.type = type
  }

  if (body.durationMinutes !== undefined) {
    if (body.durationMinutes === null) {
      patch.durationMinutes = null
    } else {
      const duration = Number(body.durationMinutes)
      if (!Number.isInteger(duration) || duration < 0) errors.push('durationMinutes must be a non-negative integer')
      else patch.durationMinutes = duration
    }
  }

  if (body.tags !== undefined) {
    patch.tags = Array.isArray(body.tags) ? body.tags.map((t) => String(t)).slice(0, 20) : []
  }

  return { valid: errors.length === 0, errors, patch }
}


export async function listWorkItems(actorId, scope, { from, to, limit = 50, offset = 0 }) {
  const actor = Number(actorId)
  const effectiveScope = scope === 'self' ? 'self' : scope
  const endDate = parseISODate(to)
  const visible =
    effectiveScope === 'self'
      ? [actor]
      : await resolveVisibleUserIds(actor, effectiveScope, endDate)
  const { items, total } = await listWorkItemsPaginated(visible, {
    startDate: from,
    endDate: to,
    limit,
    offset,
  })
  return { items, total, limit, offset }
}

export async function modifyWorkItem(actorId, itemId, body) {
  const { valid, errors, patch } = validateWorkItemPatch(body)
  if (!valid) return { ok: false, error: errors[0] }

  const actor = Number(actorId)
  const record = await updateWorkItem(actor, itemId, patch)
  if (!record) return { ok: false, error: 'not found' }

  await appendAuditLog({
    actorUserId: actor,
    action: 'update_work_item',
    objectType: 'work_item',
    objectId: Number(itemId),
    detail: Object.keys(patch),
  })

  return { ok: true }
}

export async function deleteWorkItem(actorId, itemId) {
  const actor = Number(actorId)
  const removed = await removeWorkItem(actor, itemId)
  if (!removed) return { ok: false, error: 'not found' }

  await appendAuditLog({
    actorUserId: actor,
    action: 'delete_work_item',
    objectType: 'work_item',
    objectId: Number(itemId),
  })

  return { ok: true }
}


export async function weeklyAggregate(actorId, scope, { from, to }) {
  const visible = await resolveVisibleUserIds(actorId, scope, parseISODate(to))
  const items = await listWorkItemsForUsers(visible, { startDate: from, endDate: to })
  const usersMap = await mapUsersById()

  const summary = []
  const groupedByUserDay = new Map()

  for (const item of items) {
    if (item.type === 'plan') continue
    const key = `${item.creatorId}|${item.workDate}`
    const current = groupedByUserDay.get(key) || {
      creatorId: Number(item.creatorId),
      creatorName: usersMap.get(Number(item.creatorId))?.name ?? null,
      workDate: item.workDate,
      itemCount: 0,
      totalMinutes: 0,
      typeCounts: { done: 0, progress: 0, temp: 0, assist: 0 },
      details: [],
    }
    current.itemCount += 1
    if (item.durationMinutes) current.totalMinutes += Number(item.durationMinutes)
    if (current.typeCounts[item.type] != null) current.typeCounts[item.type] += 1
    current.details.push(item)
    groupedByUserDay.set(key, current)
  }

  groupedByUserDay.forEach((value) => {
    summary.push({
      creatorId: value.creatorId,
      creatorName: value.creatorName,
      workDate: value.workDate,
      itemCount: value.itemCount,
      totalMinutes: value.totalMinutes,
      typeCounts: value.typeCounts,
    })
  })

  const details = []
  groupedByUserDay.forEach((value) => {
    const mapKey = `${value.creatorId}`
    let entry = details.find((d) => d.creatorId === value.creatorId)
    if (!entry) {
      entry = { creatorId: value.creatorId, creatorName: value.creatorName, items: [] }
      details.push(entry)
    }
    entry.items.push(
      ...value.details.map((item) => ({
        id: item.id,
        workDate: item.workDate,
        title: item.title,
        type: item.type,
        durationMinutes: item.durationMinutes ?? null,
      }))
    )
  })

  details.forEach((entry) => {
    entry.items.sort((a, b) => {
      if (a.workDate === b.workDate) return a.id - b.id
      return a.workDate.localeCompare(b.workDate)
    })
  })

  summary.sort((a, b) => {
    if (a.creatorId === b.creatorId) return a.workDate.localeCompare(b.workDate)
    return a.creatorId - b.creatorId
  })

  return { data: summary, details }
}

export async function calculateMissingReport(actorId, scope, { from, to }) {
  const visible = await resolveVisibleUserIds(actorId, scope, parseISODate(to))
  const usersMap = await mapUsersById()
  const start = parseISODate(from)
  const end = parseISODate(to)
  const days = []
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    days.push(toISODate(new Date(d)))
  }

  const workItems = await listWorkItemsForUsers(visible, { startDate: from, endDate: to })
  const seen = new Set(
    workItems
      .filter((item) => item.type !== 'plan')
      .map((item) => `${item.creatorId}|${item.workDate}`)
  )

  const missing = []
  let missingDatesTotal = 0
  let totalActiveVisible = 0

  for (const uid of visible) {
    const user = usersMap.get(Number(uid))
    if (!user || user.active === false) continue
    totalActiveVisible += 1
    const missingDates = []
    for (const day of days) {
      if (!seen.has(`${uid}|${day}`)) missingDates.push(day)
    }
    if (missingDates.length) {
      missingDatesTotal += missingDates.length
      missing.push({
        userId: Number(uid),
        name: user.name ?? null,
        email: user.email ?? null,
        employeeNo: user.employeeNo ?? null,
        missingDates,
      })
    }
  }

  return {
    ok: true,
    range: { start: from, end: to },
    stats: {
      totalActiveVisible,
      missingUsers: missing.length,
      missingDates: missingDatesTotal,
    },
    data: missing.sort((a, b) => a.userId - b.userId),
  }
}
