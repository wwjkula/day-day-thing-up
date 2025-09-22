// Minimal HS256 JWT verify/sign using Web Crypto (no deps)
// Runtime: Cloudflare Workers (crypto.subtle available)

function base64urlToUint8Array(b64url: string): Uint8Array {
  // replace URL-safe chars and pad
  const pad = '='.repeat((4 - (b64url.length % 4)) % 4)
  const b64 = (b64url.replace(/-/g, '+').replace(/_/g, '/')) + pad
  const raw = atob(b64)
  const arr = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i)
  return arr
}

function uint8ArrayToBase64url(a: Uint8Array): string {
  let s = ''
  for (let i = 0; i < a.length; i++) s += String.fromCharCode(a[i])
  const b64 = btoa(s).replace(/=+$/,'').replace(/\+/g,'-').replace(/\//g,'_')
  return b64
}

async function importHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  )
}

export type JWTPayload = Record<string, any>

export async function verifyJWT_HS256(token: string, secret: string): Promise<JWTPayload | null> {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const [h, p, s] = parts
  const header = JSON.parse(new TextDecoder().decode(base64urlToUint8Array(h)))
  if (header.alg !== 'HS256') return null
  const key = await importHmacKey(secret)
  const data = new TextEncoder().encode(`${h}.${p}`)
  const sig = base64urlToUint8Array(s)
  const ok = await crypto.subtle.verify({ name: 'HMAC' }, key, sig, data)
  if (!ok) return null
  const payload: JWTPayload = JSON.parse(new TextDecoder().decode(base64urlToUint8Array(p)))
  // basic exp check if present
  if (payload.exp && Date.now() / 1000 > Number(payload.exp)) return null
  return payload
}

export async function signJWT_HS256(payload: JWTPayload, secret: string): Promise<string> {
  const header = { alg: 'HS256', typ: 'JWT' }
  const h = uint8ArrayToBase64url(new TextEncoder().encode(JSON.stringify(header)))
  const p = uint8ArrayToBase64url(new TextEncoder().encode(JSON.stringify(payload)))
  const data = new TextEncoder().encode(`${h}.${p}`)
  const key = await importHmacKey(secret)
  const sigBuf = await crypto.subtle.sign({ name: 'HMAC' }, key, data)
  const s = uint8ArrayToBase64url(new Uint8Array(sigBuf))
  return `${h}.${p}.${s}`
}

