export type IsoDateString = string; // YYYY-MM-DD or ISO timestamp strings

export interface DataFile<T> {
  meta: {
    lastId: number;
  };
  items: T[];
}

export interface UserRecord {
  id: number;
  employeeNo: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  jobTitle: string | null;
  grade: string | null;
  active: boolean;
  passwordHash: string | null;
  passwordChangedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OrgUnitRecord {
  id: number;
  name: string;
  parentId: number | null;
  type: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface UserOrgMembershipRecord {
  userId: number;
  orgId: number;
  isPrimary: boolean;
  startDate: IsoDateString;
  endDate: IsoDateString | null;
}

export interface ManagerEdgeRecord {
  managerId: number;
  subordinateId: number;
  startDate: IsoDateString;
  endDate: IsoDateString | null;
  priority: number;
}

export interface RoleRecord {
  id: number;
  code: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export type RoleScope = 'self' | 'direct' | 'subtree';

export interface RoleGrantRecord {
  id: number;
  granteeUserId: number;
  roleId: number;
  domainOrgId: number;
  scope: RoleScope;
  startDate: IsoDateString;
  endDate: IsoDateString | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorkItemRecord {
  id: number;
  creatorId: number;
  orgId: number;
  workDate: IsoDateString;
  title: string;
  type: 'done' | 'progress' | 'temp' | 'assist';
  durationMinutes: number | null;
  tags: string[];
  detail: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AuditLogRecord {
  id: number;
  actorUserId: number;
  action: string;
  objectType: string | null;
  objectId: number | null;
  detail: any;
  createdAt: string;
}

export interface WorkItemsFile {
  meta: {
    lastId: number;
  };
  items: WorkItemRecord[];
}

export interface WorkItemsMeta {
  lastId: number;
}

export type UsersFile = DataFile<UserRecord>;
export type OrgUnitsFile = DataFile<OrgUnitRecord>;
export type UserOrgMembershipsFile = DataFile<UserOrgMembershipRecord>;
export type ManagerEdgesFile = DataFile<ManagerEdgeRecord>;
export type RolesFile = DataFile<RoleRecord>;
export type RoleGrantsFile = DataFile<RoleGrantRecord>;
export type AuditLogsFile = DataFile<AuditLogRecord>;
