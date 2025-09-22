import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

async function main() {
  // Clean slate for dev seed
  await prisma.$executeRawUnsafe(
    "TRUNCATE TABLE attachments, work_items, role_grants, roles, manager_edges, user_org_memberships, audit_logs, org_units, users RESTART IDENTITY CASCADE"
  )

  const today = new Date()

  // Org units: 项目部（根）/ 领导层 / 九个部门
  const root = await prisma.orgUnit.create({ data: { name: '项目部', type: 'root', active: true } })
  const leadership = await prisma.orgUnit.create({ data: { name: '领导层', parentId: root.id, type: 'leadership' } })
  const deptNames = [
    '财务管理部','综合管理部','工程管理部','质量管理部','设备物资部','工程技术部','测量队','安全环保部','计划合同部'
  ]
  const depts = []
  for (const name of deptNames) {
    depts.push(await prisma.orgUnit.create({ data: { name, parentId: root.id, type: 'department' } }))
  }

  // Roles
  const sysAdminRole   = await prisma.role.create({ data: { code: 'sys_admin', name: '系统管理员' } })
  const leadershipRole = await prisma.role.create({ data: { code: 'leadership', name: '领导' } })
  const directorRole   = await prisma.role.create({ data: { code: 'director', name: '主任' } })
  const deputyRole     = await prisma.role.create({ data: { code: 'deputy_director', name: '副主任' } })
  const employeeRole   = await prisma.role.create({ data: { code: 'employee', name: '员工' } })

  // Admin user
  const admin = await prisma.user.create({ data: { name: '系统管理员', email: 'admin@example.com', employeeNo: 'ADMIN001', jobTitle: '系统管理员' } })
  await prisma.userOrgMembership.create({ data: { userId: admin.id, orgId: leadership.id, isPrimary: true, startDate: today } })
  await prisma.roleGrant.create({ data: { granteeUserId: admin.id, roleId: sysAdminRole.id, domainOrgId: root.id, scope: 'subtree', startDate: today } })

  // Leadership users
  const leader1 = await prisma.user.create({ data: { name: '张总', email: 'leader1@example.com', employeeNo: 'L001', jobTitle: '总经理' } })
  const leader2 = await prisma.user.create({ data: { name: '李副总', email: 'leader2@example.com', employeeNo: 'L002', jobTitle: '副总经理' } })
  await prisma.userOrgMembership.createMany({ data: [
    { userId: leader1.id, orgId: leadership.id, isPrimary: true, startDate: today },
    { userId: leader2.id, orgId: leadership.id, isPrimary: true, startDate: today },
  ] })
  // Leadership can查看全项目部
  await prisma.roleGrant.createMany({ data: [
    { granteeUserId: leader1.id, roleId: leadershipRole.id, domainOrgId: root.id, scope: 'subtree', startDate: today },
    { granteeUserId: leader2.id, roleId: leadershipRole.id, domainOrgId: root.id, scope: 'subtree', startDate: today },
  ] })

  // Per-department: 主任/副主任/员工各2人
  const userIdsByDept = []
  for (let i = 0; i < depts.length; i++) {
    const d = depts[i]
    const dir = await prisma.user.create({ data: { name: `${d.name}-主任`, employeeNo: `D${(i+1).toString().padStart(2,'0')}01`, jobTitle: '主任' } })
    const dep = await prisma.user.create({ data: { name: `${d.name}-副主任`, employeeNo: `D${(i+1).toString().padStart(2,'0')}02`, jobTitle: '副主任' } })
    const s1  = await prisma.user.create({ data: { name: `${d.name}-员工1`, employeeNo: `D${(i+1).toString().padStart(2,'0')}11`, jobTitle: '员工' } })
    const s2  = await prisma.user.create({ data: { name: `${d.name}-员工2`, employeeNo: `D${(i+1).toString().padStart(2,'0')}12`, jobTitle: '员工' } })

    await prisma.userOrgMembership.createMany({ data: [
      { userId: dir.id, orgId: d.id, isPrimary: true, startDate: today },
      { userId: dep.id, orgId: d.id, isPrimary: true, startDate: today },
      { userId: s1.id,  orgId: d.id, isPrimary: true, startDate: today },
      { userId: s2.id,  orgId: d.id, isPrimary: true, startDate: today },
    ] })

    // 授权：主任可以看到本部门整棵子树；副主任不授予域授权（用管理边表达管理范围）
    await prisma.roleGrant.create({ data: { granteeUserId: dir.id, roleId: directorRole.id, domainOrgId: d.id, scope: 'subtree', startDate: today } })

    // 管理边：主任管副主任与两名员工；副主任管其中一名员工
    await prisma.managerEdge.createMany({ data: [
      { managerId: dir.id, subordinateId: dep.id, startDate: today, priority: 100 },
      { managerId: dir.id, subordinateId: s1.id,  startDate: today, priority: 100 },
      { managerId: dir.id, subordinateId: s2.id,  startDate: today, priority: 100 },
      { managerId: dep.id, subordinateId: s2.id,  startDate: today, priority: 100 },
    ] })

    userIdsByDept.push({ dir: dir.id, dep: dep.id, staff: [s1.id, s2.id] })
  }

  // 少量示例工作项
  await prisma.workItem.createMany({
    data: [
      { creatorId: leader1.id, orgId: leadership.id, workDate: today, title: '领导层例会', type: 'progress' },
      { creatorId: userIdsByDept[0].dir, orgId: depts[0].id, workDate: today, title: '部门统筹', type: 'progress' },
      { creatorId: userIdsByDept[0].staff[0], orgId: depts[0].id, workDate: today, title: '台账整理', type: 'done' },
      { creatorId: userIdsByDept[0].staff[1], orgId: depts[0].id, workDate: today, title: '资料归档', type: 'done' },
    ]
  })
  // Set initial password for all users (only where not set)
  const initialHash = await bcrypt.hash('123456', 10)
  await prisma.user.updateMany({ where: { passwordHash: null }, data: { passwordHash: initialHash } })


  console.log('Seeded org/users:', {
    root: Number(root.id), leadership: Number(leadership.id),
    depts: depts.map(d=>({ id: Number(d.id), name: d.name }))
  })
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e)
    await prisma.$disconnect()
    process.exit(1)
  })

