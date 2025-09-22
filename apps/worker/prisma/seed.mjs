import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  // Clean slate for dev seed
  await prisma.$executeRawUnsafe(
    "TRUNCATE TABLE attachments, work_items, role_grants, roles, manager_edges, user_org_memberships, audit_logs, org_units, users RESTART IDENTITY CASCADE"
  )

  // Org units
  const root = await prisma.orgUnit.create({ data: { name: '总部', type: 'root', active: true } })
  const deptA = await prisma.orgUnit.create({ data: { name: '事业部A', parentId: root.id } })
  const deptB = await prisma.orgUnit.create({ data: { name: '事业部B', parentId: root.id } })

  // Users
  const alice = await prisma.user.create({ data: { name: 'Alice', email: 'alice@example.com', employeeNo: 'E001' } })
  const bob = await prisma.user.create({ data: { name: 'Bob', email: 'bob@example.com', employeeNo: 'E002' } })
  const carol = await prisma.user.create({ data: { name: 'Carol', email: 'carol@example.com', employeeNo: 'E003' } })

  // Memberships (primary, ongoing)
  const today = new Date()
  await prisma.userOrgMembership.createMany({
    data: [
      { userId: alice.id, orgId: root.id, isPrimary: true, startDate: today },
      { userId: bob.id,   orgId: deptA.id, isPrimary: true, startDate: today },
      { userId: carol.id, orgId: deptB.id, isPrimary: true, startDate: today },
    ],
  })

  // Manager edges (alice manages bob & carol)
  await prisma.managerEdge.createMany({
    data: [
      { managerId: alice.id, subordinateId: bob.id, startDate: today, priority: 100 },
      { managerId: alice.id, subordinateId: carol.id, startDate: today, priority: 100 },
    ],
  })

  // Roles and grants
  const adminRole = await prisma.role.create({ data: { code: 'admin', name: '系统管理员' } })
  const managerRole = await prisma.role.create({ data: { code: 'manager', name: '部门管理者' } })

  await prisma.roleGrant.createMany({
    data: [
      { granteeUserId: alice.id, roleId: adminRole.id,   domainOrgId: root.id,  scope: 'subtree', startDate: today },
      { granteeUserId: alice.id, roleId: managerRole.id, domainOrgId: root.id,  scope: 'subtree', startDate: today },
      { granteeUserId: bob.id,   roleId: managerRole.id, domainOrgId: deptA.id, scope: 'subtree', startDate: today },
    ],
  })

  // Sample work items
  await prisma.workItem.createMany({
    data: [
      { creatorId: alice.id, orgId: root.id,  workDate: today, title: '周度计划编制', type: 'plan' },
      { creatorId: bob.id,   orgId: deptA.id, workDate: today, title: '接口联调完成', type: 'done' },
      { creatorId: carol.id, orgId: deptB.id, workDate: today, title: '修复统计bug',  type: 'done' },
    ],
  })

  console.log('Seed data inserted:', { root: root.id, deptA: deptA.id, deptB: deptB.id, users: [alice.id, bob.id, carol.id] })
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e)
    await prisma.$disconnect()
    process.exit(1)
  })

