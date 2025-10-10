export type VisibilityScope = 'self' | 'direct' | 'subtree'

import type {
  MissingWeeklyResponse,
  MissingWeeklyRemindResponse,
  ListWorkItemsResponse,
  DailyOverviewResponse,
  WeeklyOverviewResponse,
} from '@drrq/shared/index'

declare global {
  interface Window {
    __AUTH__?: string
  }
}

// 生产环境可以通过 VITE_API_BASE 指向远端 API；未设置时默认走同源路径
const API_BASE = (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_API_BASE) || ''
export const withBase = (p: string) => (API_BASE ? `${API_BASE}${p}` : p)

export function authHeader(): Record<string, string> {
  return window.__AUTH__ ? { Authorization: `Bearer ${window.__AUTH__}` } : {}
}

export async function getWeekly(params: { from: string; to: string; scope: VisibilityScope }) {
  const qs = new URLSearchParams(params as any)
  const res = await fetch(withBase(`/api/reports/weekly?${qs}`), { headers: { ...authHeader() } })
  const j = await res.json()
  if (!res.ok || !j.ok) throw new Error(j.error || '加载周报失败')
  return j as { ok: true; range: { start: string; end: string }; data: any[]; details?: any[] }
}

export async function getMissingWeekly(params: { from: string; to: string; scope: VisibilityScope }): Promise<MissingWeeklyResponse> {
  const qs = new URLSearchParams(params as any)
  const res = await fetch(withBase(`/api/reports/missing-weekly?${qs}`), { headers: { ...authHeader() } })
  const j = await res.json()
  if (!res.ok || !j.ok) throw new Error(j.error || '加载缺报信息失败')
  return j as MissingWeeklyResponse
}

export async function postMissingWeeklyRemind(params: { from: string; to: string; scope: VisibilityScope; userIds: number[] }): Promise<MissingWeeklyRemindResponse> {
  const { userIds, ...rest } = params
  const qs = new URLSearchParams(rest as any)
  const res = await fetch(withBase(`/api/reports/missing-weekly/remind?${qs}`), {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeader() },
    body: JSON.stringify({ userIds }),
  })
  const j = await res.json()
  if (!res.ok || !j.ok) throw new Error(j.error || '发送提醒失败')
  return j as MissingWeeklyRemindResponse
}


export async function updateWorkItem(id: number, payload: { title: string; workDate: string; type: string; durationMinutes: number | null }) {
  const res = await fetch(withBase(`/api/work-items/${id}`), {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', ...authHeader() },
    body: JSON.stringify(payload),
  })
  return res.json()
}

export async function deleteWorkItem(id: number) {
  const res = await fetch(withBase(`/api/work-items/${id}`), {
    method: 'DELETE',
    headers: { ...authHeader() },
  })
  return res.json()
}
export async function listWorkItems(params: { from: string; to: string; scope: VisibilityScope }): Promise<ListWorkItemsResponse> {
  const qs = new URLSearchParams({ ...params } as any)
  const res = await fetch(withBase(`/api/work-items?${qs}`), { headers: { ...authHeader() } })
  if (!res.ok) {
    const j = await res.json().catch(() => ({}))
    throw new Error((j as any).error || res.statusText)
  }
  return res.json()
}

export async function getDailyOverview(params: { date: string; scope: VisibilityScope }): Promise<DailyOverviewResponse> {
  const qs = new URLSearchParams({ date: params.date, scope: params.scope } as any)
  const res = await fetch(withBase(`/api/reports/daily-overview?${qs}`), { headers: { ...authHeader() } })
  const j = await res.json()
  if (!res.ok || !j.ok) throw new Error(j.error || '加载日视图失败')
  return j as DailyOverviewResponse
}

export async function getWeeklyOverview(params: { from: string; to: string; scope: VisibilityScope }): Promise<WeeklyOverviewResponse> {
  const qs = new URLSearchParams({ from: params.from, to: params.to, scope: params.scope } as any)
  const res = await fetch(withBase(`/api/reports/weekly-overview?${qs}`), { headers: { ...authHeader() } })
  const j = await res.json()
  if (!res.ok || !j.ok) throw new Error(j.error || '加载周视图失败')
  return j as WeeklyOverviewResponse
}

// --- Auth APIs ---
export async function authLogin(payload: { employeeNo?: string; email?: string; password?: string }) {
  const res = await fetch(withBase('/api/auth/login'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })
  return res.json()
}

export async function authChangePassword(payload: { currentPassword: string; newPassword: string }) {
  const res = await fetch(withBase('/api/auth/change-password'), {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeader() },
    body: JSON.stringify(payload),
  })
  return res.json()
}

export async function getMe() {
  const res = await fetch(withBase('/me'), { headers: { ...authHeader() } })
  return res.json()
}

// --- Admin APIs ---
export async function adminListUsers(params: { q?: string; limit?: number; offset?: number } = {}) {
  const qs = new URLSearchParams(params as any)
  const res = await fetch(withBase(`/api/admin/users?${qs}`), { headers: { ...authHeader() } })
  return res.json()
}

export async function adminGetPrimaryOrg(userId: number): Promise<{ orgId: number | null }> {
  const res = await fetch(withBase(`/api/admin/users/${userId}/primary-org`), {
    headers: { ...authHeader() },
  })
  return res.json()
}

// (deprecated admin edge management APIs removed)

export async function adminMigrateToR2() {
  const res = await fetch(withBase('/api/admin/migrate/r2'), {
    method: 'POST',
    headers: { ...authHeader() },
  })
  return res.json()
}

export async function adminGenerateSampleWorkItems(payload: { startDate: string; endDate?: string }) {
  const res = await fetch(withBase('/api/admin/work-items/sample-data'), {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeader() },
    body: JSON.stringify(payload),
  })
  const j = await res.json()
  if (!res.ok || !j.ok) throw new Error(j.error || '生成示例数据失败')
  return j as { ok: true; created: number; processedUsers: number; startDate: string; endDate: string }
}

export async function adminClearWorkItems(): Promise<{ ok: true; cleared: number; processedUsers: number }> {
  const res = await fetch(withBase('/api/admin/work-items'), {
    method: 'DELETE',
    headers: { ...authHeader() },
  })
  const j = await res.json()
  if (!res.ok || !j.ok) throw new Error(j.error || '清空工作记录失败')
  return j as { ok: true; cleared: number; processedUsers: number }
}

// --- Suggestions ---
export interface SuggestionReply {
  id: number
  authorUserId: number
  authorName?: string | null
  content: string
  createdAt: string
}

export interface SuggestionItem {
  id: number
  creatorUserId?: number
  content: string
  readAt: string | null
  createdAt: string
  updatedAt: string
  replies: SuggestionReply[]
}

export async function postSuggestion(payload: { content: string }): Promise<{ ok: boolean; id?: number; error?: string }> {
  const res = await fetch(withBase('/api/suggestions'), {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeader() },
    body: JSON.stringify(payload),
  })
  return res.json()
}

export async function listMySuggestions(params: { limit?: number; offset?: number } = {}): Promise<{ ok: true; items: SuggestionItem[] }> {
  const qs = new URLSearchParams(params as any)
  const res = await fetch(withBase(`/api/suggestions?${qs}`), { headers: { ...authHeader() } })
  return res.json()
}

export async function deleteSuggestion(id: number): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(withBase(`/api/suggestions/${id}`), {
    method: 'DELETE',
    headers: { ...authHeader() },
  })
  return res.json()
}

export async function adminListSuggestions(params: { status?: 'unread' | 'read'; q?: string; limit?: number; offset?: number } = {}) {
  const qs = new URLSearchParams(params as any)
  const res = await fetch(withBase(`/api/admin/suggestions?${qs}`), { headers: { ...authHeader() } })
  return res.json()
}

export async function adminReplySuggestion(id: number, payload: { content: string }) {
  const res = await fetch(withBase(`/api/admin/suggestions/${id}/replies`), {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeader() },
    body: JSON.stringify(payload),
  })
  return res.json()
}

export async function adminMarkSuggestionRead(id: number, read: boolean) {
  const res = await fetch(withBase(`/api/admin/suggestions/${id}/read`), {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', ...authHeader() },
    body: JSON.stringify({ read }),
  })
  return res.json()
}

