import type { R2Bucket } from '@cloudflare/workers-types';
import {
  AuditLogRecord,
  AuditLogsFile,
  DataFile,
  ManagerEdgeRecord,
  ManagerEdgesFile,
  OrgUnitRecord,
  OrgUnitsFile,
  RoleGrantRecord,
  RoleGrantsFile,
  RoleRecord,
  RolesFile,
  UserOrgMembershipRecord,
  UserOrgMembershipsFile,
  UserRecord,
  UsersFile,
  WorkItemRecord,
  WorkItemsFile,
  WorkItemsMeta,
  RoleScope,
} from './types';

const JSON_CONTENT_TYPE = 'application/json';

const USERS_KEY = 'data/users.json';
const ORG_UNITS_KEY = 'data/org_units.json';
const USER_ORG_MEMBERSHIPS_KEY = 'data/user_org_memberships.json';
const MANAGER_EDGES_KEY = 'data/manager_edges.json';
const ROLES_KEY = 'data/roles.json';
const ROLE_GRANTS_KEY = 'data/role_grants.json';
const AUDIT_LOGS_KEY = 'data/audit_logs.json';
const WORK_ITEMS_META_KEY = 'data/work_items/meta.json';

function defaultDataFile<T>(): DataFile<T> {
  return { meta: { lastId: 0 }, items: [] };
}

function defaultWorkItemsFile(): WorkItemsFile {
  return { meta: { lastId: 0 }, items: [] };
}

function nowIso() {
  return new Date().toISOString();
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

const WORK_ITEMS_PREFIX = 'data/work_items/user/';
export class R2DataStore {
  private cache = new Map<string, { data: any; etag: string | null }>();

  constructor(private bucket: R2Bucket) {}

  private async loadRaw<T>(key: string, fallback: T): Promise<{ data: T; etag: string | null }> {
    const cached = this.cache.get(key);
    if (cached) {
      return { data: clone(cached.data), etag: cached.etag };
    }
    const obj = await this.bucket.get(key);
    if (!obj) {
      const data = clone(fallback);
      this.cache.set(key, { data: clone(data), etag: null });
      return { data, etag: null };
    }
    const data = (await obj.json()) as T;
    const etag = (obj as any).etag ?? obj.httpEtag ?? null;
    this.cache.set(key, { data: clone(data), etag });
    return { data: clone(data), etag };
  }

  private async saveRaw<T>(key: string, data: T, etag: string | null): Promise<string | null> {
    const body = JSON.stringify(data);
    const options: any = { httpMetadata: { contentType: JSON_CONTENT_TYPE } };
    if (etag) {
      options.onlyIf = { etagMatches: etag };
    }
    const res = await this.bucket.put(key, body, options);
    const newEtag = (res as any)?.etag ?? res?.httpEtag ?? null;
    this.cache.set(key, { data: clone(data), etag: newEtag });
    return newEtag;
  }

  private async withFile<T>(key: string, fallback: T, mutator: (data: T) => T | void): Promise<T> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const { data, etag } = await this.loadRaw(key, fallback);
      const working = clone(data);
      const mutated = mutator(working);
      const finalData = mutated !== undefined ? (mutated as T) : working;
      try {
        const newEtag = await this.saveRaw(key, finalData, etag);
        this.cache.set(key, { data: clone(finalData), etag: newEtag });
        return finalData;
      } catch (err: any) {
        if (err && err.name === 'R2Error' && err.code === 'Error' /* generic */) {
          this.cache.delete(key);
          continue;
        }
        // optimistic retry on any error that looks like precondition failed
        if (err && err.status === 412) {
          this.cache.delete(key);
          continue;
        }
        throw err;
      }
    }
    throw new Error(`Failed to update ${key} after retries`);
  }

  async readUsers(): Promise<UsersFile> {
    const { data } = await this.loadRaw<UsersFile>(USERS_KEY, defaultDataFile<UserRecord>());
    return data;
  }

  async writeUsers(mutator: (file: UsersFile) => void | UsersFile): Promise<UsersFile> {
    return this.withFile(USERS_KEY, defaultDataFile<UserRecord>(), mutator);
  }

  async readOrgUnits(): Promise<OrgUnitsFile> {
    const { data } = await this.loadRaw<OrgUnitsFile>(ORG_UNITS_KEY, defaultDataFile<OrgUnitRecord>());
    return data;
  }

  async writeOrgUnits(mutator: (file: OrgUnitsFile) => void | OrgUnitsFile): Promise<OrgUnitsFile> {
    return this.withFile(ORG_UNITS_KEY, defaultDataFile<OrgUnitRecord>(), mutator);
  }

  async readUserOrgMemberships(): Promise<UserOrgMembershipsFile> {
    const { data } = await this.loadRaw<UserOrgMembershipsFile>(USER_ORG_MEMBERSHIPS_KEY, defaultDataFile<UserOrgMembershipRecord>());
    return data;
  }

  async writeUserOrgMemberships(mutator: (file: UserOrgMembershipsFile) => void | UserOrgMembershipsFile): Promise<UserOrgMembershipsFile> {
    return this.withFile(USER_ORG_MEMBERSHIPS_KEY, defaultDataFile<UserOrgMembershipRecord>(), mutator);
  }

  async readManagerEdges(): Promise<ManagerEdgesFile> {
    const { data } = await this.loadRaw<ManagerEdgesFile>(MANAGER_EDGES_KEY, defaultDataFile<ManagerEdgeRecord>());
    return data;
  }

  async writeManagerEdges(mutator: (file: ManagerEdgesFile) => void | ManagerEdgesFile): Promise<ManagerEdgesFile> {
    return this.withFile(MANAGER_EDGES_KEY, defaultDataFile<ManagerEdgeRecord>(), mutator);
  }

  async readRoles(): Promise<RolesFile> {
    const { data } = await this.loadRaw<RolesFile>(ROLES_KEY, defaultDataFile<RoleRecord>());
    return data;
  }

  async writeRoles(mutator: (file: RolesFile) => void | RolesFile): Promise<RolesFile> {
    return this.withFile(ROLES_KEY, defaultDataFile<RoleRecord>(), mutator);
  }

  async readRoleGrants(): Promise<RoleGrantsFile> {
    const { data } = await this.loadRaw<RoleGrantsFile>(ROLE_GRANTS_KEY, defaultDataFile<RoleGrantRecord>());
    return data;
  }

  async writeRoleGrants(mutator: (file: RoleGrantsFile) => void | RoleGrantsFile): Promise<RoleGrantsFile> {
    return this.withFile(ROLE_GRANTS_KEY, defaultDataFile<RoleGrantRecord>(), mutator);
  }

  async readAuditLogs(): Promise<AuditLogsFile> {
    const { data } = await this.loadRaw<AuditLogsFile>(AUDIT_LOGS_KEY, defaultDataFile<AuditLogRecord>());
    return data;
  }

  async writeAuditLogs(mutator: (file: AuditLogsFile) => void | AuditLogsFile): Promise<AuditLogsFile> {
    return this.withFile(AUDIT_LOGS_KEY, defaultDataFile<AuditLogRecord>(), mutator);
  }

  private workItemsKey(userId: number) {
    return `data/work_items/user/${userId}.json`;
  }

  async readUserWorkItems(userId: number): Promise<WorkItemsFile> {
    const key = this.workItemsKey(userId);
    const { data } = await this.loadRaw<WorkItemsFile>(key, defaultWorkItemsFile());
    return data;
  }

  async writeUserWorkItems(userId: number, mutator: (file: WorkItemsFile) => void | WorkItemsFile): Promise<WorkItemsFile> {
    const key = this.workItemsKey(userId);
    return this.withFile(key, defaultWorkItemsFile(), mutator);
  }

  async readWorkItemsMeta(): Promise<WorkItemsMeta> {
    const { data } = await this.loadRaw<WorkItemsMeta>(WORK_ITEMS_META_KEY, { lastId: 0 });
    return data;
  }

  async writeWorkItemsMeta(mutator: (meta: WorkItemsMeta) => void | WorkItemsMeta): Promise<WorkItemsMeta> {
    return this.withFile(WORK_ITEMS_META_KEY, { lastId: 0 }, mutator);
  }

  // ---- Public high level helpers ----

  async nextId(file: DataFile<any>): Promise<number> {
    const current = file.meta?.lastId ?? 0;
    const next = current + 1;
    file.meta = { lastId: next };
    return next;
  }

  async nextWorkItemId(): Promise<number> {
    let nextId = 0;
    await this.writeWorkItemsMeta((meta) => {
      const value = (meta?.lastId ?? 0) + 1;
      meta.lastId = value;
      nextId = value;
    });
    return nextId;
  }

  async findUserByEmployeeNo(employeeNo: string): Promise<UserRecord | null> {
    const users = await this.readUsers();
    return users.items.find((u) => (u.employeeNo || '').toLowerCase() === employeeNo.toLowerCase()) ?? null;
  }

  async findUserByEmail(email: string): Promise<UserRecord | null> {
    const users = await this.readUsers();
    return users.items.find((u) => (u.email || '').toLowerCase() === email.toLowerCase()) ?? null;
  }

  async findUserById(id: number): Promise<UserRecord | null> {
    const users = await this.readUsers();
    return users.items.find((u) => u.id === id) ?? null;
  }

  async upsertUser(user: Partial<UserRecord> & { id?: number }): Promise<UserRecord> {
    const updated = await this.writeUsers((file) => {
      const now = nowIso();
      if (user.id != null) {
        const idx = file.items.findIndex((u) => u.id === user.id);
        if (idx === -1) {
          throw new Error('user not found');
        }
        const existing = file.items[idx];
        file.items[idx] = {
          ...existing,
          ...user,
          updatedAt: now,
        } as UserRecord;
        return file;
      }
      const nextId = (file.meta.lastId ?? 0) + 1;
      file.meta.lastId = nextId;
      const newUser: UserRecord = {
        id: nextId,
        employeeNo: user.employeeNo ?? null,
        name: user.name ?? '',
        email: user.email ?? null,
        phone: user.phone ?? null,
        jobTitle: user.jobTitle ?? null,
        grade: user.grade ?? null,
        active: user.active ?? true,
        passwordHash: user.passwordHash ?? null,
        passwordChangedAt: user.passwordChangedAt ?? null,
        createdAt: now,
        updatedAt: now,
      };
      file.items.push(newUser);
      user.id = nextId;
      return file;
    });
    const finalId = user.id!;
    const saved = updated.items.find((u) => u.id === finalId);
    if (!saved) {
      throw new Error('failed to persist user');
    }
    return saved;
  }

  async recordAuditLog(entry: Omit<AuditLogRecord, 'id' | 'createdAt'>): Promise<void> {
    await this.writeAuditLogs((file) => {
      const nextId = (file.meta.lastId ?? 0) + 1;
      file.meta.lastId = nextId;
      const record: AuditLogRecord = {
        id: nextId,
        actorUserId: entry.actorUserId,
        action: entry.action,
        objectType: entry.objectType ?? null,
        objectId: entry.objectId ?? null,
        detail: entry.detail ?? null,
        createdAt: nowIso(),
      };
      file.items.push(record);
    });
  }

  async countAuditLogsSince(actorUserId: number, since: Date): Promise<number> {
    const logs = await this.readAuditLogs();
    const sinceMs = since.getTime();
    return logs.items.filter((log) => log.actorUserId === actorUserId && Date.parse(log.createdAt) >= sinceMs).length;
  }

  async listRoles(): Promise<RoleRecord[]> {
    const roles = await this.readRoles();
    return roles.items.slice();
  }

  async ensureRole(code: string, name?: string): Promise<RoleRecord> {
    const rolesFile = await this.writeRoles((file) => {
      const existing = file.items.find((r) => r.code === code);
      if (existing) return file;
      const nextId = (file.meta.lastId ?? 0) + 1;
      file.meta.lastId = nextId;
      const now = nowIso();
      file.items.push({ id: nextId, code, name: name ?? code, createdAt: now, updatedAt: now });
    });
    const created = rolesFile.items.find((r) => r.code === code)!;
    return created;
  }

  async listRoleGrants(): Promise<RoleGrantRecord[]> {
    const grants = await this.readRoleGrants();
    return grants.items.slice();
  }

  async addRoleGrant(data: Omit<RoleGrantRecord, 'id' | 'createdAt' | 'updatedAt'>): Promise<RoleGrantRecord> {
    let created: RoleGrantRecord | null = null;
    await this.writeRoleGrants((file) => {
      const nextId = (file.meta.lastId ?? 0) + 1;
      file.meta.lastId = nextId;
      const now = nowIso();
      const record: RoleGrantRecord = {
        id: nextId,
        granteeUserId: data.granteeUserId,
        roleId: data.roleId,
        domainOrgId: data.domainOrgId,
        scope: data.scope,
        startDate: data.startDate,
        endDate: data.endDate ?? null,
        createdAt: now,
        updatedAt: now,
      };
      file.items.push(record);
      created = record;
    });
    return created!;
  }

  async deleteRoleGrant(id: number): Promise<void> {
    await this.writeRoleGrants((file) => {
      file.items = file.items.filter((g) => g.id !== id);
    });
  }

  async listOrgUnits(): Promise<OrgUnitRecord[]> {
    const orgs = await this.readOrgUnits();
    return orgs.items.slice();
  }

  async addOrgUnit(data: Omit<OrgUnitRecord, 'id' | 'createdAt' | 'updatedAt'>): Promise<OrgUnitRecord> {
    let record: OrgUnitRecord | null = null;
    await this.writeOrgUnits((file) => {
      const nextId = (file.meta.lastId ?? 0) + 1;
      file.meta.lastId = nextId;
      const now = nowIso();
      const item: OrgUnitRecord = {
        id: nextId,
        name: data.name,
        parentId: data.parentId ?? null,
        type: data.type ?? 'department',
        active: data.active ?? true,
        createdAt: now,
        updatedAt: now,
      };
      file.items.push(item);
      record = item;
    });
    return record!;
  }

  async updateOrgUnit(id: number, data: Partial<OrgUnitRecord>): Promise<void> {
    await this.writeOrgUnits((file) => {
      const idx = file.items.findIndex((o) => o.id === id);
      if (idx === -1) throw new Error('org not found');
      file.items[idx] = { ...file.items[idx], ...data, updatedAt: nowIso() };
    });
  }

  async listUserOrgMemberships(): Promise<UserOrgMembershipRecord[]> {
    const items = await this.readUserOrgMemberships();
    return items.items.slice();
  }

  async setPrimaryOrg(userId: number, orgId: number, effectiveDate: Date): Promise<void> {
    const isoToday = effectiveDate.toISOString().slice(0, 10);
    const yesterday = new Date(Date.UTC(effectiveDate.getUTCFullYear(), effectiveDate.getUTCMonth(), effectiveDate.getUTCDate() - 1))
      .toISOString()
      .slice(0, 10);
    await this.writeUserOrgMemberships((file) => {
      for (const membership of file.items) {
        if (membership.userId === userId && membership.isPrimary) {
          if (!membership.endDate || membership.endDate > yesterday) {
            membership.endDate = yesterday;
          }
        }
      }
      file.items.push({
        userId,
        orgId,
        isPrimary: true,
        startDate: isoToday,
        endDate: null,
      });
    });
  }

  async listManagerEdgesRecords(): Promise<ManagerEdgeRecord[]> {
    const edges = await this.readManagerEdges();
    return edges.items.slice();
  }

  async addManagerEdge(edge: ManagerEdgeRecord): Promise<void> {
    await this.writeManagerEdges((file) => {
      const exists = file.items.some(
        (e) => e.managerId === edge.managerId && e.subordinateId === edge.subordinateId && e.startDate === edge.startDate,
      );
      if (!exists) {
        file.items.push({ ...edge });
      }
    });
  }

  async deleteManagerEdge(edge: { managerId: number; subordinateId: number; startDate: string }): Promise<void> {
    await this.writeManagerEdges((file) => {
      file.items = file.items.filter(
        (e) => !(e.managerId === edge.managerId && e.subordinateId === edge.subordinateId && e.startDate === edge.startDate),
      );
    });
  }

  async addWorkItem(userId: number, item: Omit<WorkItemRecord, 'id' | 'createdAt' | 'updatedAt'>): Promise<WorkItemRecord> {
    const id = await this.nextWorkItemId();
    let created: WorkItemRecord | null = null;
    await this.writeUserWorkItems(userId, (file) => {
      const now = nowIso();
      const record: WorkItemRecord = {
        id,
        creatorId: userId,
        orgId: item.orgId,
        workDate: item.workDate,
        title: item.title,
        type: item.type,
        durationMinutes: item.durationMinutes ?? null,
        tags: Array.isArray(item.tags) ? item.tags.slice() : [],
        detail: item.detail ?? null,
        createdAt: now,
        updatedAt: now,
      };
      file.items.push(record);
      file.meta.lastId = Math.max(file.meta.lastId ?? 0, id);
      created = record;
    });
    return created!;
  }

  async listUserWorkItemsInRange(userId: number, start: Date, end: Date): Promise<WorkItemRecord[]> {
    const file = await this.readUserWorkItems(userId);
    const startMs = Date.parse(start.toISOString());
    const endMs = Date.parse(end.toISOString());
    return file.items.filter((item) => {
      const ms = Date.parse(item.workDate + 'T00:00:00Z');
      return ms >= startMs && ms <= endMs;
    });
  }

  async listAllUsers(): Promise<UserRecord[]> {
    const file = await this.readUsers();
    return file.items.slice();
  }

  async replaceUserWorkItems(userId: number, items: WorkItemRecord[]): Promise<void> {
    await this.writeUserWorkItems(userId, (file) => {
      file.items = items.map((item) => ({ ...item }));
      const maxId = items.reduce((max, item) => Math.max(max, item.id), 0);
      file.meta.lastId = Math.max(file.meta.lastId ?? 0, maxId);
    });
  }

  async listUserWorkItemKeys(): Promise<string[]> {
    const keys: string[] = [];
    let cursor: string | undefined = undefined;
    do {
      const response: any = await (this.bucket as any).list({ prefix: WORK_ITEMS_PREFIX, cursor });
      for (const obj of response.objects ?? []) {
        keys.push(obj.key);
      }
      cursor = response.truncated ? response.cursor : undefined;
    } while (cursor);
    return keys;
  }

  async deleteKey(key: string): Promise<void> {
    await this.bucket.delete(key);
    this.cache.delete(key);
  }

  async deleteUserWorkItemsFile(userId: number): Promise<void> {
    const key = this.workItemsKey(userId);
    await this.deleteKey(key);
  }


  async filterWorkItemsByUsers(userIds: number[], start: Date, end: Date): Promise<WorkItemRecord[]> {
    const all: WorkItemRecord[] = [];
    for (const id of userIds) {
      const items = await this.listUserWorkItemsInRange(id, start, end);
      all.push(...items);
    }
    return all;
  }

  async deleteRoleGrantById(id: number): Promise<void> {
    await this.writeRoleGrants((file) => {
      file.items = file.items.filter((g) => g.id !== id);
    });
  }

  async activeRoleGrantsForUser(userId: number, asOf: Date): Promise<RoleGrantRecord[]> {
    const grants = await this.listRoleGrants();
    const asOfStr = asOf.toISOString().slice(0, 10);
    return grants.filter((g) => {
      if (g.granteeUserId !== userId) return false;
      if (g.startDate > asOfStr) return false;
      if (g.endDate && g.endDate < asOfStr) return false;
      return true;
    });
  }

  async findRoleById(id: number): Promise<RoleRecord | null> {
    const roles = await this.listRoles();
    return roles.find((r) => r.id === id) ?? null;
  }

  async findRoleByCode(code: string): Promise<RoleRecord | null> {
    const roles = await this.listRoles();
    return roles.find((r) => r.code === code) ?? null;
  }

  async removeWorkItem(userId: number, workItemId: number): Promise<void> {
    await this.writeUserWorkItems(userId, (file) => {
      file.items = file.items.filter((item) => item.id !== workItemId);
    });
  }

  async listAuditLogs(): Promise<AuditLogRecord[]> {
    const logs = await this.readAuditLogs();
    return logs.items.slice();
  }

  async getRoleGrantById(id: number): Promise<RoleGrantRecord | null> {
    const grants = await this.listRoleGrants();
    return grants.find((g) => g.id === id) ?? null;
  }

  async updateRoleGrant(id: number, updates: Partial<RoleGrantRecord>): Promise<void> {
    await this.writeRoleGrants((file) => {
      const idx = file.items.findIndex((g) => g.id === id);
      if (idx === -1) throw new Error('role grant not found');
      file.items[idx] = { ...file.items[idx], ...updates, updatedAt: nowIso() };
    });
  }
}

export function getDataDriverMode(env: { DATA_DRIVER?: string | number; R2_DATA?: any; R2_EXPORTS?: any }): 'r2' | 'neon' {
  const raw = (env.DATA_DRIVER ?? '2').toString().trim();
  if (raw === '1') return 'neon';
  const bucket = env.R2_DATA ?? env.R2_EXPORTS;
  if (!bucket) return 'neon';
  const hasPut = typeof bucket.put === 'function';
  const hasGet = typeof bucket.get === 'function';
  if (hasPut && hasGet) return 'r2';
  return 'neon';
}

export function getR2DataStore(env: any): R2DataStore {
  const bucket = env.R2_DATA ?? env.R2_EXPORTS;
  if (!bucket) {
    throw new Error('R2_DATA binding not configured');
  }
  return new R2DataStore(bucket as R2Bucket);
}


