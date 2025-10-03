export function toISODate(date) {
  return date.toISOString().slice(0, 10)
}

export function parseISODate(dateStr) {
  return new Date(`${dateStr}T00:00:00Z`)
}

export function withinRange(dateStr, startInclusive, endInclusive) {
  const date = parseISODate(dateStr)
  return date >= startInclusive && date <= endInclusive
}

export function isEffective({ startDate, endDate }, asOf) {
  const start = startDate ? parseISODate(startDate) : new Date(0)
  const end = endDate ? parseISODate(endDate) : new Date('9999-12-31T00:00:00Z')
  return start <= asOf && end >= asOf
}

export function mondayOfWeek(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
  const day = (d.getUTCDay() + 6) % 7
  d.setUTCDate(d.getUTCDate() - day)
  return d
}

export function sundayOfWeek(date) {
  const monday = mondayOfWeek(date)
  const sunday = new Date(monday)
  sunday.setUTCDate(monday.getUTCDate() + 6)
  return sunday
}
