import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import XLSX from 'xlsx'
import { EXPORTS_DIR } from '../config.js'
import { weeklyAggregate } from './work.js'
import { appendAuditLog } from '../data/store.js'
import { mapUsersById } from './domain.js'

export async function ensureExportsDir() {
  await fs.mkdir(EXPORTS_DIR, { recursive: true })
}

export async function createWeeklyExport(actorId, scope, { from, to }) {
  await ensureExportsDir()
  const jobId = randomUUID()
  const { data, details } = await weeklyAggregate(actorId, scope, { from, to })

  const usersMap = await mapUsersById()
  const byUserMap = new Map()

  for (const row of data) {
    const { creatorId, itemCount, totalMinutes, typeCounts } = row
    if (!byUserMap.has(creatorId)) {
      byUserMap.set(creatorId, {
        creatorId,
        creatorName: row.creatorName ?? usersMap.get(creatorId)?.name ?? null,
        itemCount: 0,
        totalMinutes: 0,
        done: 0,
        progress: 0,
        temp: 0,
        assist: 0,
      })
    }
    const agg = byUserMap.get(creatorId)
    agg.itemCount += itemCount
    agg.totalMinutes += totalMinutes
    agg.done += typeCounts.done
    agg.progress += typeCounts.progress
    agg.temp += typeCounts.temp
    agg.assist += typeCounts.assist
  }

  const wb = XLSX.utils.book_new()

  const summarySheet = XLSX.utils.aoa_to_sheet([
    ['jobId', 'scope', 'start', 'end'],
    [jobId, scope, from, to],
  ])
  XLSX.utils.book_append_sheet(wb, summarySheet, 'Summary')

  const byUserRows = [['creatorId', 'creatorName', 'itemCount', 'totalMinutes', 'done', 'progress', 'temp', 'assist']]
  const sortedAgg = Array.from(byUserMap.values()).sort((a, b) => a.creatorId - b.creatorId)
  for (const agg of sortedAgg) {
    byUserRows.push([
      agg.creatorId,
      agg.creatorName ?? '',
      agg.itemCount,
      agg.totalMinutes,
      agg.done,
      agg.progress,
      agg.temp,
      agg.assist,
    ])
  }
  if (byUserRows.length > 1) {
    const byUserSheet = XLSX.utils.aoa_to_sheet(byUserRows)
    XLSX.utils.book_append_sheet(wb, byUserSheet, 'ByUser')
  }

  const detailRows = [['date', 'creatorId', 'creatorName', 'type', 'minutes', 'title']]
  details
    .slice()
    .sort((a, b) => a.creatorId - b.creatorId)
    .forEach((entry) => {
      entry.items.forEach((item) => {
        detailRows.push([
          item.workDate,
          entry.creatorId,
          entry.creatorName ?? usersMap.get(entry.creatorId)?.name ?? '',
          item.type,
          item.durationMinutes ?? '',
          item.title,
        ])
      })
    })
  if (detailRows.length > 1) {
    const detailSheet = XLSX.utils.aoa_to_sheet(detailRows)
    XLSX.utils.book_append_sheet(wb, detailSheet, 'Details')
  }

  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
  const filePath = path.join(EXPORTS_DIR, `${jobId}.xlsx`)
  await fs.writeFile(filePath, buffer)

  await appendAuditLog({
    actorUserId: Number(actorId),
    action: 'export_ready',
    objectType: 'work_item',
    detail: { scope, start: from, end: to, jobId },
  })

  return { jobId, filePath }
}
