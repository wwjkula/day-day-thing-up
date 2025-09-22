import bcrypt from 'bcryptjs'

// In Workers, bcryptjs is pure JS and works without native bindings.
// We keep a small wrapper to allow swapping algorithms if needed.

export async function hashPassword(plain: string): Promise<string> {
  if (typeof plain !== 'string' || plain.length < 1) throw new Error('invalid password')
  const saltRounds = 10
  return await bcrypt.hash(plain, saltRounds)
}

export async function verifyPassword(plain: string, hash: string | null | undefined): Promise<boolean> {
  if (!hash) return false
  try {
    return await bcrypt.compare(plain || '', hash)
  } catch {
    return false
  }
}

