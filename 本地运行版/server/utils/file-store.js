import fs from 'node:fs/promises'
import path from 'node:path'

const writeQueue = new Map()

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true })
}

export async function readJson(fullPath, fallback) {
  try {
    const data = await fs.readFile(fullPath, 'utf8')
    return JSON.parse(data)
  } catch (err) {
    if (err.code === 'ENOENT') return fallback
    throw err
  }
}

export async function writeJson(fullPath, payload) {
  const dir = path.dirname(fullPath)
  await ensureDir(dir)
  const json = JSON.stringify(payload, null, 2)
  const tmp = `${fullPath}.tmp-${Date.now()}`
  const prev = writeQueue.get(fullPath) || Promise.resolve()
  const next = prev.then(async () => {
    await fs.writeFile(tmp, json, 'utf8')
    let lastError
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        await fs.rename(tmp, fullPath)
        lastError = undefined
        break
      } catch (err) {
        lastError = err
        const code = err?.code
        if (code === 'EPERM' || code === 'EACCES' || code === 'EBUSY') {
          await fs.unlink(fullPath).catch(() => {})
          await delay(50 * (attempt + 1))
          continue
        }
        throw err
      }
    }
    if (lastError) {
      await fs.unlink(tmp).catch(() => {})
      throw lastError
    }
  })
  writeQueue.set(fullPath, next.catch(() => {}))
  return next
}

export async function readText(fullPath, fallback = '') {
  try {
    return await fs.readFile(fullPath, 'utf8')
  } catch (err) {
    if (err.code === 'ENOENT') return fallback
    throw err
  }
}

export async function writeText(fullPath, content) {
  const dir = path.dirname(fullPath)
  await ensureDir(dir)
  await fs.writeFile(fullPath, content, 'utf8')
}

export async function listFiles(fullPath) {
  try {
    return await fs.readdir(fullPath)
  } catch (err) {
    if (err.code === 'ENOENT') return []
    throw err
  }
}
