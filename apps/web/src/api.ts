export type VisibilityScope = 'self' | 'direct' | 'subtree'

declare global {
  interface Window { __AUTH__?: string }
}

// 在生产（Pages）上通过 VITE_API_BASE 指向后端 Worker 域名；
// 本地开发不设置则走相对路径并由 Vite 代理到本地 Worker。
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
  return j as { ok: true; range: { start: string; end: string }; data: any[] }
}

export async function postWeeklyExport(params: { from: string; to: string; scope: VisibilityScope }) {
  const qs = new URLSearchParams(params as any)
  const res = await fetch(withBase(`/api/reports/weekly/export?${qs}`), { method: 'POST', headers: { ...authHeader() } })
  const j = await res.json()
  if (!res.ok || !j.ok) throw new Error(j.error || '导出请求失败')
  return j as { ok: true; jobId: string }
}

export async function getExportStatus(jobId: string) {
  const res = await fetch(withBase(`/api/reports/weekly/export/status?id=${encodeURIComponent(jobId)}`), { headers: { ...authHeader() } })
  const j = await res.json()
  if (!res.ok || !j.ok) throw new Error(j.error || '状态查询失败')
  return j as { ok: true; status: 'pending' | 'ready' }
}

export function getExportDownloadUrl(jobId: string): string {
  return withBase(`/api/reports/weekly/export/download?id=${encodeURIComponent(jobId)}`)
}

export async function downloadExport(jobId: string): Promise<void> {
  const url = getExportDownloadUrl(jobId)
  const res = await fetch(url, { headers: { ...authHeader() } })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(text || `下载失败(${res.status})`)
  }
  const blob = await res.blob()
  const objectUrl = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = objectUrl
  a.download = `${jobId}.xlsx`
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1000)
}



// --- Admin APIs ---
export async function adminListOrgs() {
  const res = await fetch(withBase('/api/admin/orgs'), { headers: { ...authHeader() } });
  return res.json();
}
export async function adminGetOrgTree() {
  const res = await fetch(withBase('/api/admin/orgs/tree'), { headers: { ...authHeader() } });
  return res.json();
}
export async function adminCreateOrg(payload: { name: string; parentId?: number|null; type?: string; active?: boolean }) {
  const res = await fetch(withBase('/api/admin/orgs'), { method: 'POST', headers: { 'content-type': 'application/json', ...authHeader() }, body: JSON.stringify(payload) });
  return res.json();
}
export async function adminUpdateOrg(id: number, payload: any) {
  const res = await fetch(withBase(`/api/admin/orgs/${id}`), { method: 'PUT', headers: { 'content-type': 'application/json', ...authHeader() }, body: JSON.stringify(payload) });
  return res.json();
}

export async function adminListUsers(params: { q?: string; limit?: number; offset?: number } = {}) {
  const qs = new URLSearchParams(params as any)
  const res = await fetch(withBase(`/api/admin/users?${qs}`), { headers: { ...authHeader() } })
  return res.json();
}
export async function adminCreateUser(payload: any) {
  const res = await fetch(withBase('/api/admin/users'), { method: 'POST', headers: { 'content-type': 'application/json', ...authHeader() }, body: JSON.stringify(payload) });
  return res.json();
}
export async function adminUpdateUser(id: number, payload: any) {
  const res = await fetch(withBase(`/api/admin/users/${id}`), { method: 'PUT', headers: { 'content-type': 'application/json', ...authHeader() }, body: JSON.stringify(payload) });
  return res.json();
}
export async function adminSetPrimaryOrg(userId: number, orgId: number) {
  const res = await fetch(withBase(`/api/admin/users/${userId}/primary-org`), { method: 'PATCH', headers: { 'content-type': 'application/json', ...authHeader() }, body: JSON.stringify({ orgId }) })
  return res.json();
}

export async function adminListManagerEdges(params: { managerId?: number; subordinateId?: number } = {}) {
  const qs = new URLSearchParams(params as any)
  const res = await fetch(withBase(`/api/admin/manager-edges?${qs}`), { headers: { ...authHeader() } })
  return res.json();
}
export async function adminCreateManagerEdge(payload: any) {
  const res = await fetch(withBase('/api/admin/manager-edges'), { method: 'POST', headers: { 'content-type': 'application/json', ...authHeader() }, body: JSON.stringify(payload) })
  return res.json();
}
export async function adminDeleteManagerEdge(payload: { managerId: number; subordinateId: number; startDate: string }) {
  const res = await fetch(withBase('/api/admin/manager-edges'), { method: 'DELETE', headers: { 'content-type': 'application/json', ...authHeader() }, body: JSON.stringify(payload) })
  return res.json();
}

export async function adminListRoleGrants() {
  const res = await fetch(withBase('/api/admin/role-grants'), { headers: { ...authHeader() } })
  return res.json();
}
export async function adminCreateRoleGrant(payload: any) {
  const res = await fetch(withBase('/api/admin/role-grants'), { method: 'POST', headers: { 'content-type': 'application/json', ...authHeader() }, body: JSON.stringify(payload) })
  return res.json();
}
export async function adminDeleteRoleGrant(id: number) {
  const res = await fetch(withBase(`/api/admin/role-grants/${id}`), { method: 'DELETE', headers: { ...authHeader() } })
  return res.json();
}
