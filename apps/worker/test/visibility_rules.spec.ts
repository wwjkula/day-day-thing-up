import { describe, it, expect } from 'vitest'
import { resolveVisibleUsers } from '../src/visibility'

// 我们不依赖真实数据库，利用 drivers 与 grants 直接驱动可见性算法
// 组织结构（id 仅用于本测试）：
// 1: 项目部(root)
// 2: 领导层
// 3: 部门A
// 4: 部门B
// 用户：
//  10: 领导
//  20: A-主任, 21: A-副主任, 22: A-员工1, 23: A-员工2
//  30: B-主任, 31: B-副主任, 32: B-员工1

const ORG = { ROOT: 1n, LEAD: 2n, A: 3n, B: 4n }
const U = { LEADER: 10n, ADIR: 20n, ADEP: 21n, A1: 22n, A2: 23n, BDIR: 30n, BDEP: 31n, B1: 32n }

// 映射：组织 -> 用户
const usersByOrg = new Map<bigint, bigint[]>([
  [ORG.LEAD, [U.LEADER]],
  [ORG.A, [U.ADIR, U.ADEP, U.A1, U.A2]],
  [ORG.B, [U.BDIR, U.BDEP, U.B1]],
])

// 组织树
const orgChildren = new Map<bigint, bigint[]>([
  [ORG.ROOT, [ORG.LEAD, ORG.A, ORG.B]],
  [ORG.LEAD, []],
  [ORG.A, []],
  [ORG.B, []],
])

// 管理边：主任管副主任和员工；副主任管部分员工
const directSubs = new Map<bigint, bigint[]>([
  [U.ADIR, [U.ADEP, U.A1, U.A2]],
  [U.ADEP, [U.A2]],
])

function makeDrivers() {
  return {
    getDirectSubordinates: async (managerId: bigint) => directSubs.get(managerId) || [],
    getAllSubordinates: async (managerId: bigint) => {
      const out = new Set<bigint>()
      const stack = [...(directSubs.get(managerId) || [])]
      while (stack.length) {
        const x = stack.pop()!
        if (out.has(x)) continue
        out.add(x)
        for (const y of directSubs.get(x) || []) stack.push(y)
      }
      return Array.from(out)
    },
    getOrgDirectChildren: async (orgId: bigint) => orgChildren.get(orgId) || [],
    getOrgSubtree: async (orgId: bigint) => {
      const out = new Set<bigint>([orgId])
      const stack = [...(orgChildren.get(orgId) || [])]
      while (stack.length) {
        const x = stack.pop()!
        if (out.has(x)) continue
        out.add(x)
        for (const y of orgChildren.get(x) || []) stack.push(y)
      }
      return Array.from(out)
    },
    getUsersByOrgs: async (orgIds: bigint[]) => {
      const out = new Set<bigint>()
      for (const id of orgIds) for (const u of usersByOrg.get(id) || []) out.add(u)
      return Array.from(out)
    },
    getGrants: async () => [],
  }
}

describe('可见性规则校验', () => {
  const prismaStub: any = {} // 不使用 DB
  const now = new Date()

  it('本部门员工看不到其它部门', async () => {
    // 无授权、无管理边：只能看到自己
    const ids = await resolveVisibleUsers(prismaStub, U.A1, 'subtree', now, { drivers: makeDrivers(), grants: [] })
    expect(ids.sort((a,b)=>Number(a-b))).toEqual([U.A1])
  })

  it('副主任看不到主任', async () => {
    // 无授权，只有管理边：副主任只能看到自己 + 其直接/递归下属（A2），不包含主任
    const ids = await resolveVisibleUsers(prismaStub, U.ADEP, 'subtree', now, { drivers: makeDrivers(), grants: [] })
    expect(ids.includes(U.ADIR)).toBe(false)
    expect(ids.includes(U.A2)).toBe(true)
  })

  it('主任看不到领导层', async () => {
    // 主任获得部门域 subtree 授权，领导层不在该域
    const grants = [{ domainOrgId: ORG.A, scope: 'subtree' as any }]
    const ids = await resolveVisibleUsers(prismaStub, U.ADIR, 'subtree', now, { drivers: makeDrivers(), grants })
    expect(ids.includes(U.LEADER)).toBe(false)
    // 但能看到本部门员工与副主任
    expect(ids.includes(U.ADEP)).toBe(true)
    expect(ids.includes(U.A1)).toBe(true)
    expect(ids.includes(U.A2)).toBe(true)
  })
})

