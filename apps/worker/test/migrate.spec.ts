import { describe, it, expect, vi } from 'vitest'
import { migrateNeonToR2 } from '../src/migrate'
import { R2DataStore } from '../src/data/r2-store'
import { createInMemoryR2 } from './utils/inMemoryR2'

describe('migrateNeonToR2', () => {
  it('moves neon records into R2 JSON files grouped by user', async () => {
    const bucket = createInMemoryR2({
      'data/work_items/user/99.json': JSON.stringify({ meta: { lastId: 99 }, items: [{ id: 1 }] }),
    })
    const store = new R2DataStore(bucket as any)

    const prisma: any = {
      user: {
        findMany: vi.fn(async () => [
          {
            id: 1n,
            employeeNo: 'E001',
            name: 'Alice',
            email: 'alice@example.com',
            phone: '123',
            jobTitle: 'Engineer',
            grade: 'P5',
            active: true,
            passwordHash: 'hash1',
            passwordChangedAt: new Date('2024-01-01T00:00:00Z'),
          },
          {
            id: 2n,
            employeeNo: 'E002',
            name: 'Bob',
            email: null,
            phone: null,
            jobTitle: null,
            grade: null,
            active: true,
            passwordHash: null,
            passwordChangedAt: null,
          },
        ]),
      },
      orgUnit: {
        findMany: vi.fn(async () => [
          { id: 10n, name: '总部', parentId: null, type: 'group', active: true },
          { id: 11n, name: '研发部', parentId: 10n, type: 'department', active: true },
        ]),
      },
      userOrgMembership: {
        findMany: vi.fn(async () => [
          { userId: 1n, orgId: 11n, isPrimary: true, startDate: new Date('2024-01-01T00:00:00Z'), endDate: null },
          { userId: 2n, orgId: 11n, isPrimary: true, startDate: new Date('2024-01-05T00:00:00Z'), endDate: null },
        ]),
      },
      managerEdge: {
        findMany: vi.fn(async () => [
          { managerId: 1n, subordinateId: 2n, startDate: new Date('2024-01-01T00:00:00Z'), endDate: null, priority: 10 },
        ]),
      },
      role: {
        findMany: vi.fn(async () => [
          { id: 7n, code: 'sys_admin', name: '系统管理员', createdAt: new Date(), updatedAt: new Date() },
        ]),
      },
      roleGrant: {
        findMany: vi.fn(async () => [
          {
            id: 8n,
            granteeUserId: 1n,
            roleId: 7n,
            domainOrgId: 10n,
            scope: 'subtree',
            startDate: new Date('2024-01-01T00:00:00Z'),
            endDate: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ]),
      },
      workItem: {
        findMany: vi.fn(async () => [
          {
            id: 12n,
            creatorId: 1n,
            orgId: 11n,
            workDate: new Date('2024-09-18T00:00:00Z'),
            title: '完成需求A',
            type: 'done',
            durationMinutes: 60,
            tags: '重点, 拓展',
            detail: { foo: 'bar' },
            createdAt: new Date('2024-09-18T01:00:00Z'),
            updatedAt: new Date('2024-09-18T02:00:00Z'),
          },
          {
            id: 13n,
            creatorId: 2n,
            orgId: 11n,
            workDate: new Date('2024-09-17T00:00:00Z'),
            title: '客户沟通',
            type: 'progress',
            durationMinutes: null,
            tags: null,
            detail: null,
            createdAt: new Date('2024-09-17T03:00:00Z'),
            updatedAt: new Date('2024-09-17T04:00:00Z'),
          },
          {
            id: 10n,
            creatorId: 1n,
            orgId: 11n,
            workDate: new Date('2024-09-17T00:00:00Z'),
            title: '代码评审',
            type: 'assist',
            durationMinutes: 30,
            tags: '评审',
            detail: null,
            createdAt: new Date('2024-09-17T05:00:00Z'),
            updatedAt: new Date('2024-09-17T06:00:00Z'),
          },
        ]),
      },
      auditLog: {
        findMany: vi.fn(async () => [
          {
            id: 5n,
            actorUserId: 1n,
            action: 'login',
            objectType: 'user',
            objectId: 1n,
            detail: { ip: '127.0.0.1' },
            createdAt: new Date('2024-09-18T06:00:00Z'),
          },
        ]),
      },
    }

    const summary = await migrateNeonToR2(prisma, store)

    expect(summary).toEqual({
      users: 2,
      orgUnits: 2,
      memberships: 2,
      managerEdges: 1,
      roles: 1,
      roleGrants: 1,
      workItems: 3,
      auditLogs: 1,
    })

    const usersFile = await store.readUsers()
    expect(usersFile.items.map((u) => u.name)).toEqual(['Alice', 'Bob'])

    const user1 = await store.readUserWorkItems(1)
    expect(user1.items.map((item) => item.id)).toEqual([10, 12])
    expect(user1.items[0].tags).toEqual(['评审'])
    expect(user1.items[1].tags).toEqual(['重点', '拓展'])

    const user2 = await store.readUserWorkItems(2)
    expect(user2.items).toHaveLength(1)
    expect(user2.items[0].id).toBe(13)

    const meta = await store.readWorkItemsMeta()
    expect(meta.lastId).toBe(13)

    const orphan = await bucket.get('data/work_items/user/99.json')
    expect(orphan).toBeNull()
  })
})
