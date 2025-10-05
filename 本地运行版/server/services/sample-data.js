import path from 'node:path'

import { DATA_DIR } from '../config.js'
import { readJson, writeJson, listFiles } from '../utils/file-store.js'
import { listUsers, getPrimaryOrgId } from './domain.js'
import { addWorkItem } from '../data/store.js'
import { parseISODate, toISODate } from '../utils/datetime.js'

const WORK_ITEMS_DIR = path.join(DATA_DIR, 'work_items')
const USER_WORK_DIR = path.join(WORK_ITEMS_DIR, 'user')
const GLOBAL_META_PATH = path.join(WORK_ITEMS_DIR, 'meta.json')
const SAMPLE_PREFIX = '【示例】'

function ensureDate(value, label) {
  if (!value) throw new Error(`${label} is required`)
  const str = String(value)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(str)) throw new Error(`${label} must be YYYY-MM-DD`)
  const parsed = parseISODate(str)
  if (Number.isNaN(parsed.getTime())) throw new Error(`${label} is invalid`)
  return toISODate(parsed)
}

function enumerateDates(start, end) {
  const dates = []
  const current = parseISODate(start)
  const last = parseISODate(end)
  if (current > last) return dates
  while (current <= last) {
    dates.push(toISODate(current))
    current.setUTCDate(current.getUTCDate() + 1)
  }
  return dates
}

function nextDate(dateStr) {
  const d = parseISODate(dateStr)
  d.setUTCDate(d.getUTCDate() + 1)
  return toISODate(d)
}

function sampleTitle(user, dateStr, kind) {
  const base = user?.name || `用户${user?.id ?? ''}`
  return `${SAMPLE_PREFIX}${base} ${dateStr} 示例${kind === 'plan' ? '计划' : '工作'}`
}

export async function generateSampleWorkData({ startDate, endDate }) {
  const start = ensureDate(startDate, 'startDate')
  const end = ensureDate(endDate ?? startDate, 'endDate')
  if (start > end) throw new Error('startDate must be <= endDate')

  const dates = enumerateDates(start, end)
  if (!dates.length) return { created: 0, processedUsers: 0 }

  const users = (await listUsers()).filter((user) => user && user.active !== false)
  let created = 0

  for (const user of users) {
    const userId = Number(user.id)
    if (!Number.isFinite(userId)) continue
    const userFile = path.join(USER_WORK_DIR, `${userId}.json`)
    const data = await readJson(userFile, { meta: { lastId: 0 }, items: [] })
    const items = Array.isArray(data.items) ? data.items : []
    const sampleKeys = new Set(
      items
        .filter((item) => typeof item?.title === 'string' && item.title.startsWith(SAMPLE_PREFIX))
        .map((item) => `${item.type}|${item.workDate}`)
    )

    for (const workDate of dates) {
      const orgId = await getPrimaryOrgId(userId, parseISODate(workDate))
      const workKey = `done|${workDate}`
      if (!sampleKeys.has(workKey)) {
        const title = sampleTitle(user, workDate, 'done')
        await addWorkItem(userId, {
          orgId,
          workDate,
          title,
          type: 'done',
          durationMinutes: 120,
          tags: [],
          detail: `${title} - 示例工作内容`,
        })
        sampleKeys.add(workKey)
        created += 1
      }

      const planWorkDate = nextDate(workDate)
      const planKey = `plan|${planWorkDate}`
      if (!sampleKeys.has(planKey)) {
        const title = sampleTitle(user, planWorkDate, 'plan')
        const planOrgId = await getPrimaryOrgId(userId, parseISODate(planWorkDate))
        await addWorkItem(userId, {
          orgId: planOrgId,
          workDate: planWorkDate,
          title,
          type: 'plan',
          durationMinutes: null,
          tags: [],
          detail: `${title} - 示例计划`,
        })
        sampleKeys.add(planKey)
        created += 1
      }
    }
  }

  return { created, processedUsers: users.length, startDate: start, endDate: end }
}

export async function clearAllWorkItems() {
  const users = await listUsers()
  const activeIds = users.map((user) => Number(user.id)).filter((id) => Number.isFinite(id))
  let cleared = 0
  for (const userId of activeIds) {
    const filePath = path.join(USER_WORK_DIR, `${userId}.json`)
    await writeJson(filePath, { meta: { lastId: 0 }, items: [] })
    cleared += 1
  }

  const extraFiles = await listFiles(USER_WORK_DIR)
  for (const name of extraFiles) {
    if (!name.endsWith('.json')) continue
    const userId = Number(name.replace(/\.json$/, ''))
    if (!activeIds.includes(userId)) {
      const filePath = path.join(USER_WORK_DIR, name)
      await writeJson(filePath, { meta: { lastId: 0 }, items: [] })
      cleared += 1
    }
  }

  await writeJson(GLOBAL_META_PATH, { lastId: 0 })
  return { cleared, processedUsers: activeIds.length }
}
