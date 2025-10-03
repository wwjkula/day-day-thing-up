import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const ROOT_DIR = path.resolve(__dirname, '..')
export const DATA_DIR = path.join(ROOT_DIR, 'data')
export const EXPORTS_DIR = path.join(ROOT_DIR, 'exports')
export const LOGS_DIR = path.join(ROOT_DIR, 'logs')

export const PORT = Number(process.env.PORT || 8080)
export const HOST = process.env.HOST || '0.0.0.0'

export function getJwtSecret() {
  return process.env.JWT_SECRET || 'local-dev-secret'
}
