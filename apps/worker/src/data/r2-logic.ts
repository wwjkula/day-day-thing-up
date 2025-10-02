import { R2DataStore } from './r2-store';
import {
  AuditLogRecord,
  ManagerEdgeRecord,
  OrgUnitRecord,
  RoleGrantRecord,
  RoleScope,
  UserOrgMembershipRecord,
  UserRecord,
  WorkItemRecord,
} from './types';

export interface VisibleUsersResult {
  visibleUserIds: number[];
  grants: RoleGrantRecord[];
}

function isEffectiveRange(start: string, end: string | null, asOf: string): boolean {
  if (start && start > asOf) return false;
  if (end && end < asOf) return false;
  return true;
}

function asDateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function effectiveEdges(edges: ManagerEdgeRecord[], asOf: string): Map<number, number[]> {
  const map = new Map<number, number[]>();
  for (const edge of edges) {
    if (!isEffectiveRange(edge.startDate, edge.endDate, asOf)) continue;
    if (!map.has(edge.managerId)) map.set(edge.managerId, []);
    map.get(edge.managerId)!.push(edge.subordinateId);
  }
  return map;
}

function buildOrgChildren(orgs: OrgUnitRecord[]): Map<number, number[]> {
  const map = new Map<number, number[]>();
  for (const org of orgs) {
    if (org.parentId == null) continue;
    if (!map.has(org.parentId)) {
      map.set(org.parentId, []);
    }
    map.get(org.parentId)!.push(org.id);
  }
  return map;
}

function collectOrgSubtree(orgChildren: Map<number, number[]>, orgId: number, includeSelf = true): number[] {
  const result: number[] = [];
  const stack: number[] = [];
  if (includeSelf) result.push(orgId);
  stack.push(orgId);
  while (stack.length) {
    const current = stack.pop()!;
    const children = orgChildren.get(current);
    if (!children) continue;
    for (const child of children) {
      result.push(child);
      stack.push(child);
    }
  }
  return Array.from(new Set(result));
}

function collectOrgDirect(orgChildren: Map<number, number[]>, orgId: number, includeSelf = true): number[] {
  const result = includeSelf ? [orgId] : [];
  const children = orgChildren.get(orgId);
  if (children) {
    result.push(...children);
  }
  return Array.from(new Set(result));
}

function activeMembershipsForOrg(memberships: UserOrgMembershipRecord[], orgIds: Set<number>, asOf: string): number[] {
  const result = new Set<number>();
  for (const m of memberships) {
    if (!orgIds.has(m.orgId)) continue;
    if (!isEffectiveRange(m.startDate, m.endDate, asOf)) continue;
    result.add(m.userId);
  }
  return Array.from(result);
}

export async function resolveVisibleUsersR2(
  store: R2DataStore,
  viewerId: number,
  scope: 'self' | 'direct' | 'subtree',
  asOf: Date,
): Promise<VisibleUsersResult> {
  const asOfStr = asDateString(asOf);
  const result = new Set<number>([viewerId]);
  const edges = await store.listManagerEdgesRecords();
  const orgs = await store.listOrgUnits();
  const memberships = await store.listUserOrgMemberships();
  const grants = await store.activeRoleGrantsForUser(viewerId, asOf);

  const edgeMap = effectiveEdges(edges, asOfStr);
  if (scope === 'direct') {
    const direct = edgeMap.get(viewerId) || [];
    for (const id of direct) result.add(id);
  } else if (scope === 'subtree') {
    const stack = [viewerId];
    const visited = new Set<number>();
    visited.add(viewerId);
    while (stack.length) {
      const current = stack.pop()!;
      const children = edgeMap.get(current) || [];
      for (const child of children) {
        if (visited.has(child)) continue;
        result.add(child);
        visited.add(child);
        stack.push(child);
      }
    }
  }

  if (grants.length > 0) {
    const orgChildren = buildOrgChildren(orgs);
    const coveredOrgIds = new Set<number>();
    for (const grant of grants) {
      let ids: number[] = [];
      if (grant.scope === 'self') {
        ids = collectOrgDirect(orgChildren, grant.domainOrgId, true);
      } else if (grant.scope === 'direct') {
        ids = collectOrgDirect(orgChildren, grant.domainOrgId, true);
      } else if (grant.scope === 'subtree') {
        ids = collectOrgSubtree(orgChildren, grant.domainOrgId, true);
      }
      for (const id of ids) coveredOrgIds.add(id);
    }
    if (coveredOrgIds.size > 0) {
      const users = activeMembershipsForOrg(memberships, coveredOrgIds, asOfStr);
      for (const id of users) result.add(id);
    }
  }

  return { visibleUserIds: Array.from(result), grants };
}

export async function getPrimaryOrgIdR2(store: R2DataStore, userId: number, asOf: Date): Promise<number | null> {
  const memberships = await store.listUserOrgMemberships();
  const asOfStr = asDateString(asOf);
  for (const membership of memberships) {
    if (membership.userId !== userId) continue;
    if (!membership.isPrimary) continue;
    if (!isEffectiveRange(membership.startDate, membership.endDate, asOfStr)) continue;
    return membership.orgId;
  }
  return null;
}

export async function listActiveUsers(store: R2DataStore, userIds: number[]): Promise<UserRecord[]> {
  const users = await store.listAllUsers();
  const set = new Set(userIds);
  return users.filter((u) => set.has(u.id));
}

export function enumerateDates(start: Date, end: Date): string[] {
  const dates: string[] = [];
  const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
  const endUtc = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate());
  while (cursor.getTime() <= endUtc) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

export async function buildMissingReportR2(
  store: R2DataStore,
  viewerId: number,
  scope: 'self' | 'direct' | 'subtree',
  range: { start: Date; end: Date },
) {
  const { visibleUserIds } = await resolveVisibleUsersR2(store, viewerId, scope, new Date());
  const users = await listActiveUsers(store, visibleUserIds);
  const activeUsers = users.filter((u) => u.active);
  const missingMap = new Map<number, string[]>();
  const dates = enumerateDates(range.start, range.end);
  for (const user of activeUsers) {
    const items = await store.listUserWorkItemsInRange(user.id, range.start, range.end);
    const present = new Set(items.map((item) => item.workDate));
    const missing: string[] = [];
    for (const date of dates) {
      if (!present.has(date)) missing.push(date);
    }
    if (missing.length) missingMap.set(user.id, missing);
  }
  return {
    startDay: range.start,
    endDay: range.end,
    startStr: range.start.toISOString().slice(0, 10),
    endStr: range.end.toISOString().slice(0, 10),
    totalVisible: users.length,
    totalActiveVisible: activeUsers.length,
    activeUsers,
    missingMap,
  };
}

export interface WeeklyAggregateResult {
  rows: Array<{
    creatorId: number;
    creatorName: string | null;
    workDate: string;
    itemCount: number;
    totalMinutes: number;
    typeCounts: { done: number; progress: number; temp: number; assist: number };
  }>;
  details: Array<{
    creatorId: number;
    creatorName: string | null;
    items: Array<{ id: number; workDate: string; title: string; type: string; durationMinutes: number | null }>;
  }>;
}

export async function buildWeeklyAggregateR2(
  store: R2DataStore,
  viewerId: number,
  scope: 'self' | 'direct' | 'subtree',
  range: { start: Date; end: Date },
): Promise<WeeklyAggregateResult> {
  const { visibleUserIds } = await resolveVisibleUsersR2(store, viewerId, scope, new Date());
  const users = await listActiveUsers(store, visibleUserIds);
  const nameMap = new Map<number, string | null>();
  for (const user of users) {
    nameMap.set(user.id, user.name ?? null);
  }
  const rows: WeeklyAggregateResult['rows'] = [];
  const detailMap = new Map<number, { creatorId: number; creatorName: string | null; items: WeeklyAggregateResult['details'][0]['items'] }>();
  for (const userId of visibleUserIds.sort((a, b) => a - b)) {
    const items = await store.listUserWorkItemsInRange(userId, range.start, range.end);
    const grouped = new Map<string, { itemCount: number; totalMinutes: number; done: number; progress: number; temp: number; assist: number }>();
    for (const item of items) {
      const key = item.workDate;
      if (!grouped.has(key)) {
        grouped.set(key, { itemCount: 0, totalMinutes: 0, done: 0, progress: 0, temp: 0, assist: 0 });
      }
      const bucket = grouped.get(key)!;
      bucket.itemCount += 1;
      bucket.totalMinutes += item.durationMinutes ?? 0;
      (bucket as any)[item.type] += 1;
    }
    for (const [date, agg] of Array.from(grouped.entries()).sort()) {
      rows.push({
        creatorId: userId,
        creatorName: nameMap.get(userId) ?? null,
        workDate: date,
        itemCount: agg.itemCount,
        totalMinutes: agg.totalMinutes,
        typeCounts: {
          done: agg.done,
          progress: agg.progress,
          temp: agg.temp,
          assist: agg.assist,
        },
      });
    }
    const details = items
      .sort((a, b) => (a.workDate === b.workDate ? a.id - b.id : a.workDate.localeCompare(b.workDate)))
      .map((item) => ({
        id: item.id,
        workDate: item.workDate,
        title: item.title,
        type: item.type,
        durationMinutes: item.durationMinutes,
      }));
    detailMap.set(userId, {
      creatorId: userId,
      creatorName: nameMap.get(userId) ?? null,
      items: details,
    });
  }
  return { rows, details: Array.from(detailMap.values()) };
}

export async function listWorkItemsPaginatedR2(
  store: R2DataStore,
  viewerId: number,
  scope: 'self' | 'direct' | 'subtree',
  range: { start: Date; end: Date },
  limit: number,
  offset: number,
) {
  const { visibleUserIds } = await resolveVisibleUsersR2(store, viewerId, scope, new Date());
  const allItems: Array<WorkItemRecord & { creatorName: string | null }> = [];
  const users = await listActiveUsers(store, visibleUserIds);
  const nameMap = new Map<number, string | null>();
  for (const user of users) nameMap.set(user.id, user.name ?? null);
  for (const userId of visibleUserIds) {
    const items = await store.listUserWorkItemsInRange(userId, range.start, range.end);
    for (const item of items) {
      allItems.push({ ...item, creatorName: nameMap.get(userId) ?? null });
    }
  }
  allItems.sort((a, b) => {
    if (a.workDate === b.workDate) return a.id - b.id;
    return a.workDate.localeCompare(b.workDate);
  });
  const total = allItems.length;
  const slice = allItems.slice(offset, offset + limit);
  return { total, items: slice };
}

export function filterUsersWithKeyword(users: UserRecord[], keyword: string): UserRecord[] {
  if (!keyword) return users;
  const lower = keyword.toLowerCase();
  return users.filter((user) => {
    return (
      (user.name && user.name.toLowerCase().includes(lower)) ||
      (user.email && user.email.toLowerCase().includes(lower)) ||
      (user.employeeNo && user.employeeNo.toLowerCase().includes(lower))
    );
  });
}

export function paginate<T>(items: T[], limit: number, offset: number): { total: number; items: T[] } {
  const total = items.length;
  const sliced = items.slice(offset, offset + limit);
  return { total, items: sliced };
}

export async function ensureAuditLog(
  store: R2DataStore,
  data: { actorUserId: number; action: string; objectType?: string; objectId?: number; detail?: any },
): Promise<void> {
  await store.recordAuditLog({
    actorUserId: data.actorUserId,
    action: data.action,
    objectType: data.objectType ?? null,
    objectId: data.objectId ?? null,
    detail: data.detail ?? null,
  });
}

export function toDateRangeFromStrings(start: string, end: string): { start: Date; end: Date } {
  const s = new Date(start + 'T00:00:00Z');
  const e = new Date(end + 'T23:59:59Z');
  return { start: s, end: e };
}

