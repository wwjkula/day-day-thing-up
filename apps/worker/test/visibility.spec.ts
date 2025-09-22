import { describe, it, expect } from 'vitest'
import type { Scope } from '@prisma/client'
import { resolveVisibleUsers } from '../src/visibility'

const now = new Date('2025-09-21')

// In-memory fixtures
// Users: 1:Alice, 2:Bob, 3:Carol, 4:Dave
// Orgs: 10:root -> [11:DeptA, 12:DeptB]
// Memberships: 1->10, 2->11, 3->12, 4->12

function makeDrivers() {
  return {
    getDirectSubordinates: async (managerId: bigint) => {
      if (managerId === 1n) return [2n] // Alice -> Bob
      if (managerId === 2n) return [3n] // Bob -> Carol
      return []
    },
    getAllSubordinates: async (managerId: bigint) => {
      if (managerId === 1n) return [2n, 3n] // Alice -> Bob -> Carol
      if (managerId === 2n) return [3n]
      return []
    },
    getOrgDirectChildren: async (orgId: bigint) => {
      if (orgId === 10n) return [11n, 12n]
      return []
    },
    getOrgSubtree: async (orgId: bigint) => {
      if (orgId === 10n) return [10n, 11n, 12n]
      if (orgId === 11n) return [11n]
      if (orgId === 12n) return [12n]
      return [orgId]
    },
    getUsersByOrgs: async (orgIds: bigint[]) => {
      const map: Record<string, bigint[]> = {
        '10': [1n], // root only Alice as member in this fixture
        '11': [2n],
        '12': [3n, 4n],
      }
      const set = new Set<bigint>()
      for (const id of orgIds) for (const u of map[String(id)] ?? []) set.add(u)
      return Array.from(set)
    },
  }
}

// Minimal prisma stub (unused due to drivers), shape-compatible enough
const prismaStub: any = {}

describe('resolveVisibleUsers (drivers+grants injection)', () => {
  it('self scope returns only self', async () => {
    const drivers = makeDrivers()
    const res = await resolveVisibleUsers(prismaStub, 1n, 'self', now, { drivers, grants: [] })
    expect(res.sort()).toEqual([1n])
  })

  it('direct scope returns self + direct subs', async () => {
    const drivers = makeDrivers()
    const res = await resolveVisibleUsers(prismaStub, 1n, 'direct', now, { drivers, grants: [] })
    expect(res.sort()).toEqual([1n, 2n])
  })

  it('subtree scope returns self + transitive subs', async () => {
    const drivers = makeDrivers()
    const res = await resolveVisibleUsers(prismaStub, 1n, 'subtree', now, { drivers, grants: [] })
    expect(res.sort()).toEqual([1n, 2n, 3n])
  })

  it('grants: direct on root adds domain + children org members', async () => {
    const drivers = makeDrivers()
    const grants: { domainOrgId: bigint; scope: Scope }[] = [
      { domainOrgId: 10n, scope: 'direct' as Scope },
    ]
    const res = await resolveVisibleUsers(prismaStub, 1n, 'self', now, { drivers, grants })
    // self (1) + root(1) + children 11(2),12(3,4) => {1,2,3,4}
    expect(new Set(res)).toEqual(new Set([1n, 2n, 3n, 4n]))
  })

  it('grants: subtree on DeptB gives access to Carol & Dave', async () => {
    const drivers = makeDrivers()
    const grants: { domainOrgId: bigint; scope: Scope }[] = [
      { domainOrgId: 12n, scope: 'subtree' as Scope },
    ]
    const res = await resolveVisibleUsers(prismaStub, 2n, 'self', now, { drivers, grants })
    // self (2) + subtree(DeptB) -> users {3,4}
    expect(new Set(res)).toEqual(new Set([2n, 3n, 4n]))
  })
})

