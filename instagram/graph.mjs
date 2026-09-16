// Cliente mínimo de la Graph API de Meta. Sin dependencias: usa fetch nativo (Node 18+).
import { readFileSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)))

// Carga instagram/.env sin pisar lo que ya venga del entorno (la Routine inyecta env vars).
export function loadEnv() {
  const envFile = resolve(ROOT, '.env')
  if (!existsSync(envFile)) return
  for (const raw of readFileSync(envFile, 'utf8').split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq === -1) continue
    const key = line.slice(0, eq).trim()
    let value = line.slice(eq + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    if (!(key in process.env)) process.env[key] = value
  }
}

export const API_VERSION = () => process.env.GRAPH_API_VERSION || 'v26.0'

// Meta tiene dos caminos de login y cada uno vive en un host distinto:
// "Instagram Login" en graph.instagram.com y "Facebook Login" en graph.facebook.com.
// "doctor" detecta cuál te toca.
export const HOST = () => process.env.GRAPH_HOST || 'graph.instagram.com'

export class GraphError extends Error {
  constructor(message, { type, code, subcode, traceId, status } = {}) {
    super(message)
    this.name = 'GraphError'
    Object.assign(this, { type, code, subcode, traceId, status })
  }
}

function token() {
  const t = process.env.IG_ACCESS_TOKEN
  if (!t) {
    throw new GraphError(
      'Falta IG_ACCESS_TOKEN. Poné el token en instagram/.env o como variable de entorno. Ver instagram/README.md.'
    )
  }
  return t
}

// Nunca imprimimos el token: si aparece en un mensaje de error, lo tachamos.
export function redact(text) {
  const t = process.env.IG_ACCESS_TOKEN
  if (!t || typeof text !== 'string') return text
  return text.split(t).join('<token>')
}

async function request(method, path, params = {}, { host = HOST(), version = API_VERSION() } = {}) {
  const url = new URL(`https://${host}/${version ? `${version}/` : ''}${path}`)
  const body = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue
    const serialized = typeof value === 'object' ? JSON.stringify(value) : String(value)
    if (method === 'GET') url.searchParams.set(key, serialized)
    else body.set(key, serialized)
  }
  if (method === 'GET') url.searchParams.set('access_token', token())
  else body.set('access_token', token())

  const res = await fetch(url, method === 'GET' ? {} : { method, body })
  const text = await res.text()
  let json
  try {
    json = JSON.parse(text)
  } catch {
    // Corriendo dentro de un entorno de Claude en la web, el proxy de salida
    // devuelve esto hasta que el host de Meta esté en la lista permitida.
    if (text.includes('not in allowlist')) {
      throw new GraphError(
        `La red de este entorno bloquea ${host}. Agregá graph.instagram.com y graph.facebook.com ` +
          'a la lista de hosts permitidos del entorno (network egress settings). Ver instagram/README.md.',
        { status: res.status }
      )
    }
    throw new GraphError(`Respuesta no-JSON de Meta (HTTP ${res.status}): ${redact(text).slice(0, 300)}`, {
      status: res.status,
    })
  }
  if (json.error) {
    const e = json.error
    throw new GraphError(redact(e.error_user_msg || e.message || 'Error desconocido de Meta'), {
      type: e.type,
      code: e.code,
      subcode: e.error_subcode,
      traceId: e.fbtrace_id,
      status: res.status,
    })
  }
  if (!res.ok) throw new GraphError(`HTTP ${res.status} de Meta`, { status: res.status })
  return json
}

export const get = (path, params, opts) => request('GET', path, params, opts)
export const post = (path, params, opts) => request('POST', path, params, opts)

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
