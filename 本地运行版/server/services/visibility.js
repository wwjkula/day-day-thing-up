import { mapUsersById } from './domain.js'

function normalizeList(value, selfId) {
  if (!Array.isArray(value)) return [selfId]
  const list = value
    .map((item) => Number(item))
    .filter((num) => Number.isFinite(num) && num > 0)
  if (!list.includes(selfId)) list.push(selfId)
  return Array.from(new Set(list))
}

export async function resolveVisibleUserIds(viewerId, scope = 'self') {
  const viewerNum = Number(viewerId)
  if (!Number.isFinite(viewerNum)) return []

  const usersMap = await mapUsersById()
  const viewer = usersMap.get(viewerNum)
  if (!viewer) return []

  const configured = normalizeList(viewer.visibleUserIds, viewerNum)
  if (scope === 'self') {
    return configured.includes(viewerNum) && configured.length === 1 ? configured : configured
  }
  return configured
}
