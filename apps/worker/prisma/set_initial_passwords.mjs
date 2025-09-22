import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

// One-off script: set initial password for all users whose password is empty
// Usage: node apps/worker/prisma/set_initial_passwords.mjs

const prisma = new PrismaClient()

async function main() {
  const hash = await bcrypt.hash('123456', 10)
  const res = await prisma.user.updateMany({ where: { passwordHash: null }, data: { passwordHash: hash } })
  console.log('Updated users:', res.count)
}

main().then(()=>prisma.$disconnect()).catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1) })

