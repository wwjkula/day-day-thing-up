import { isUserAdmin } from '../services/domain.js'

export function normalizeScope(raw) {
  const s = String(raw || 'self').toLowerCase()
  if (s === 'subordinates') return 'direct'
  if (s === 'self' || s === 'direct' || s === 'subtree') return s
  return 'self'
}

function parseISOWeek(week) {
  const match = /^(\d{4})W(\d{2})$/.exec(String(week))
  if (!match) return null
  const year = Number(match[1])
  const weekNum = Number(match[2])
  if (weekNum < 1 || weekNum > 53) return null
  const jan4 = new Date(Date.UTC(year, 0, 4))
  const dayOfWeek = jan4.getUTCDay() || 7
  const monday = new Date(jan4)
  monday.setUTCDate(jan4.getUTCDate() - (dayOfWeek - 1))
  const start = new Date(monday)
  start.setUTCDate(monday.getUTCDate() + (weekNum - 1) * 7)
  start.setUTCHours(0, 0, 0, 0)
  const end = new Date(start)
  end.setUTCDate(start.getUTCDate() + 6)
  end.setUTCHours(23, 59, 59, 999)
  return { start, end }
}

export function parseRangeFromQuery(query) {
  const week = query.week ? String(query.week) : undefined
  const reDate = /^\d{4}-\d{2}-\d{2}$/
  if (week) {
    const r = parseISOWeek(week)
    if (!r) return { error: 'week must be YYYYWww (ISO week)' }
    return r
  }
  const fromStr = String(query.from || '')
  const toStr = String(query.to || '')
  if (!reDate.test(fromStr) || !reDate.test(toStr)) return { error: 'from/to must be YYYY-MM-DD' }
  const start = new Date(`${fromStr}T00:00:00Z`)
  const end = new Date(`${toStr}T23:59:59Z`)
  if (isNaN(start.getTime()) || isNaN(end.getTime()) || start > end) return { error: 'invalid date range' }
  return { start, end }
}

export function canRead(req, res, next) {
  const scope = normalizeScope(req.query.scope)
  const range = parseRangeFromQuery(req.query)
  if ('error' in range) return res.status(400).json({ error: range.error })
  req.scope = scope
  req.range = range
  next()
}

export async function requireAdmin(req, res, next) {
  const actorId = req.user?.sub
  if (actorId == null) return res.status(401).json({ error: 'Unauthorized' })
  if (req.user?.isAdmin) return next()
  if (await isUserAdmin(actorId)) return next()
  return res.status(403).json({ error: 'Forbidden' })
}
