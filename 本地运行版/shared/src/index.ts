export type WorkItemType = 'done' | 'progress' | 'temp' | 'assist' | 'plan';
export type VisibilityScope = 'self' | 'direct' | 'subtree';

// Request DTOs
export interface CreateWorkItemRequest {
  workDate: string; // YYYY-MM-DD
  title: string; // <= 20 chars (Chinese characters counted separately at UI)
  type?: WorkItemType;
  durationMinutes?: number;
  tags?: string[];
  detail?: string;
}

export interface ListWorkItemsQuery {
  from: string; // YYYY-MM-DD
  to: string; // YYYY-MM-DD
  scope?: VisibilityScope | 'subordinates'; // 'subordinates' is alias for 'direct'
  limit?: number;
  offset?: number;
}

// Response DTOs
export interface WorkItemResponse {
  id: number;
  creatorId: number;
  orgId: number;
  workDate: string; // YYYY-MM-DD
  title: string;
  type: WorkItemType;
  durationMinutes?: number;
  tags: string[];
  detail?: string;
}

export interface ListWorkItemsResponse {
  items: WorkItemResponse[];
  total: number;
  limit: number;
  offset: number;
}

export interface CreateWorkItemResponse {
  id: number;
}

// Weekly report (for future use)
export interface WeeklyReportQuery {
  week: string; // e.g. 2025W37
  domainOrgId?: number;
}

// Missing weekly report
export interface MissingWeeklyUser {
  userId: number;
  name: string | null;
  email: string | null;
  employeeNo: string | null;
  missingDates: string[];
}

export interface MissingWeeklyStats {
  totalActiveVisible: number;
  missingUsers: number;
  missingDates: number;
}

export interface MissingWeeklyResponse {
  ok: true;
  range: { start: string; end: string };
  stats: MissingWeeklyStats;
  data: MissingWeeklyUser[];
}

export interface MissingWeeklyRemindResponse {
  ok: true;
  notified: number;
  targets: Array<{ userId: number; missingDates: string[] }>;
  skipped: Array<{ userId: number; reason: 'not_visible' | 'no_missing' }>;
}

export interface DailyOverviewMetrics {
  completedCount: number;
  completedMinutes: number;
  planCount: number;
  hasPlan: boolean;
  missing: boolean;
}

export interface DailyOverviewUser {
  userId: number;
  name: string | null;
  orgId: number | null;
  orgName: string | null;
  metrics: DailyOverviewMetrics;
  completed: WorkItemResponse[];
  plans: WorkItemResponse[];
}

export interface DailyOverviewOrgMetrics {
  userCount: number;
  completedUsers: number;
  completedCount: number;
  completedMinutes: number;
  planUsers: number;
  planCount: number;
  missingUsers: number;
}

export interface DailyOverviewOrg {
  orgId: number;
  parentId: number | null;
  name: string;
  metrics: DailyOverviewOrgMetrics;
}

export interface DailyOverviewResponse {
  ok: true;
  date: string;
  nextDate: string;
  scope: VisibilityScope;
  totals: DailyOverviewOrgMetrics;
  users: DailyOverviewUser[];
  orgs: DailyOverviewOrg[];
}

export interface WeeklyOverviewDay {
  date: string;
  completedCount: number;
  completedMinutes: number;
  planCount: number;
  completed: WorkItemResponse[];
  plans: WorkItemResponse[];
}

export interface WeeklyOverviewSummary {
  completedCount: number;
  completedMinutes: number;
  typeCounts: Record<'done' | 'progress' | 'temp' | 'assist', number>;
  planCount: number;
  missingDays: string[];
}

export interface WeeklyOverviewUser {
  userId: number;
  name: string | null;
  employeeNo: string | null;
  orgId: number | null;
  orgName: string | null;
  days: WeeklyOverviewDay[];
  summary: WeeklyOverviewSummary;
}

export interface WeeklyOverviewOrg {
  orgId: number;
  parentId: number | null;
  name: string;
  summary: WeeklyOverviewSummary & {
    userCount: number;
    completedUsers: number;
    planUsers: number;
  };
}

export interface WeeklyOverviewResponse {
  ok: true;
  range: { start: string; end: string };
  scope: VisibilityScope;
  users: WeeklyOverviewUser[];
  orgs: WeeklyOverviewOrg[];
}

// Validation helpers (pure functions, no runtime deps)
export function validateWorkItemTitle(title: string): { valid: boolean; error?: string } {
  if (!title || typeof title !== 'string') return { valid: false, error: 'title is required' };
  const trimmed = title.trim();
  if (!trimmed) return { valid: false, error: 'title cannot be empty' };
  if ([...trimmed].length > 20) return { valid: false, error: 'title must be <= 20 characters' };
  return { valid: true };
}

export function validateWorkItemType(type: string): { valid: boolean; error?: string } {
  const allowedTypes = new Set<string>(['done', 'progress', 'temp', 'assist', 'plan']);
  if (!allowedTypes.has(type)) return { valid: false, error: 'invalid type' };
  return { valid: true };
}

export function validateDateString(dateStr: string): { valid: boolean; error?: string } {
  const re = /^\d{4}-\d{2}-\d{2}$/;
  if (!re.test(dateStr)) return { valid: false, error: 'date must be YYYY-MM-DD' };
  const date = new Date(dateStr + 'T00:00:00Z');
  if (isNaN(date.getTime())) return { valid: false, error: 'invalid date' };
  return { valid: true };
}

export function validateVisibilityScope(scope: string): { valid: boolean; normalized: VisibilityScope; error?: string } {
  const normalized = scope === 'subordinates' ? 'direct' : scope;
  if (normalized === 'self' || normalized === 'direct' || normalized === 'subtree') {
    return { valid: true, normalized: normalized as VisibilityScope };
  }
  return { valid: false, normalized: 'self', error: 'scope must be self|direct|subtree|subordinates' };
}
