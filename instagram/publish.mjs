#!/usr/bin/env node
// Publicador de Instagram contra la Graph API de Meta.
//
//   node instagram/publish.mjs doctor              verifica token, cuenta y cupo
//   node instagram/publish.mjs plan                muestra el calendario y qué está por salir
//   node instagram/publish.mjs run --dry           simula la tanda pendiente sin publicar
//   node instagram/publish.mjs run                 publica lo aprobado cuya hora ya pasó
//   node instagram/publish.mjs run --id <id>       publica ese post ahora, aunque falte la hora
//   node instagram/publish.mjs limit               cupo de publicaciones de las últimas 24 h
//
// Nunca publica un post en estado "draft": aprobar es un acto humano.
import { readFileSync, writeFileSync, renameSync } from 'node:fs'
import { resolve } from 'node:path'
import { loadEnv, get, post, sleep, redact, GraphError, API_VERSION, HOST, ROOT } from './graph.mjs'

const CALENDAR = resolve(ROOT, 'calendar.json')
const IMAGE_EXT = /\.(jpe?g|png|webp)$/i
const VIDEO_EXT = /\.(mp4|mov|m4v)$/i
const MAX_CAPTION = 2200
const MAX_HASHTAGS = 30

// ---------- calendario ----------

function readCalendar() {
  try {
    return JSON.parse(readFileSync(CALENDAR, 'utf8'))
  } catch (err) {
    if (err.code === 'ENOENT') throw new Error(`No existe ${CALENDAR}. Copiá el ejemplo del README.`)
    throw new Error(`calendar.json tiene JSON inválido: ${err.message}`)
  }
}

// Escritura atómica: si el proceso muere a mitad, el calendario no queda corrupto.
function writeCalendar(calendar) {
  const tmp = `${CALENDAR}.tmp`
  writeFileSync(tmp, `${JSON.stringify(calendar, null, 2)}\n`)
  renameSync(tmp, CALENDAR)
}

function mediaUrl(item) {
  const entry = typeof item === 'string' ? { url: item } : { ...item }
  if (!entry.url) throw new Error('Un item de media no tiene "url"')
  if (!/^https?:\/\//i.test(entry.url)) {
    const base = process.env.MEDIA_BASE_URL
    if (!base) {
      throw new Error(
        `"${entry.url}" es una ruta relativa y falta MEDIA_BASE_URL. ` +
          'Poné la URL pública base en instagram/.env, o usá una URL completa.'
      )
    }
    entry.url = `${base.replace(/\/$/, '')}/${entry.url.replace(/^\//, '')}`
  }
  if (!entry.kind) {
    if (IMAGE_EXT.test(entry.url)) entry.kind = 'image'
    else if (VIDEO_EXT.test(entry.url)) entry.kind = 'video'
    else throw new Error(`No puedo deducir si "${entry.url}" es imagen o video: agregá "kind": "image" | "video"`)
  }
  return entry
}

// Revisa lo que Meta rechazaría, antes de gastar una llamada a la API.
function validate(p) {
  const problems = []
  if (!p.id) problems.push('falta "id"')
  if (!['draft', 'approved', 'published', 'failed'].includes(p.status)) {
    problems.push(`status inválido: ${JSON.stringify(p.status)}`)
  }
  if (!['image', 'carousel', 'reel', 'story'].includes(p.type)) {
    problems.push(`type inválido: ${JSON.stringify(p.type)}`)
  }
  if (!p.publish_at || Number.isNaN(Date.parse(p.publish_at))) {
    problems.push('publish_at ausente o no es una fecha ISO válida')
  }

  const media = Array.isArray(p.media) ? p.media : []
  if (media.length === 0) problems.push('no tiene media')
  let items = []
  let resolved = true
  try {
    items = media.map(mediaUrl)
  } catch (err) {
    problems.push(err.message)
    resolved = false
  }

  if (p.type === 'carousel' && (media.length < 2 || media.length > 10)) {
    problems.push(`un carrusel lleva entre 2 y 10 items (tiene ${media.length})`)
  }
  if (p.type !== 'carousel' && media.length > 1) {
    problems.push(`un post "${p.type}" lleva un solo archivo (tiene ${media.length})`)
  }
  // Sin URLs resueltas no sabemos el tipo de archivo; no acumulamos errores derivados.
  if (resolved) {
    if (p.type === 'image' && items[0]?.kind !== 'image') problems.push('type "image" necesita un archivo de imagen')
    if (p.type === 'reel' && items[0]?.kind !== 'video') problems.push('type "reel" necesita un archivo de video')
  }

  const caption = p.caption || ''
  if (caption.length > MAX_CAPTION) problems.push(`el caption tiene ${caption.length} caracteres (máximo ${MAX_CAPTION})`)
  const hashtags = caption.match(/#[\p{L}\p{N}_]+/gu) || []
  if (hashtags.length > MAX_HASHTAGS) problems.push(`${hashtags.length} hashtags (máximo ${MAX_HASHTAGS})`)
  if (p.type === 'story' && caption) problems.push('las stories no llevan caption por API')

  return { problems, items }
}

// ---------- cuenta ----------

async function account() {
  const id = process.env.IG_USER_ID
  if (!id) throw new Error('Falta IG_USER_ID. Corré "doctor" para descubrirlo.')
  return get(id, { fields: 'id,username,followers_count,media_count' })
}

// El token sirve para un host y no para el otro. En vez de hacerle adivinar al
// usuario cuál eligió al crear la app, probamos los dos.
const ME_FIELDS = { 'graph.instagram.com': 'id,username', 'graph.facebook.com': 'id,name' }

async function detectHost() {
  const candidates = process.env.GRAPH_HOST ? [process.env.GRAPH_HOST] : Object.keys(ME_FIELDS)
  const failures = []
  for (const host of candidates) {
    try {
      const me = await get('me', { fields: ME_FIELDS[host] || 'id' }, { host })
      return { host, me }
    } catch (err) {
      failures.push(`${host} → ${err.message}`)
    }
  }
  throw new GraphError(`El token no funciona:\n  ${failures.join('\n  ')}`)
}

// ---------- publicación ----------

async function createContainer(igId, params) {
  const { id } = await post(`${igId}/media`, params)
  return id
}

// Un contenedor recién creado no está listo: hay que esperar a FINISHED. Los videos
// tardan minutos; las imágenes, segundos.
async function waitForContainer(containerId, { timeoutMs, log }) {
  const startedAt = Date.now()
  let lastStatus = ''
  while (Date.now() - startedAt < timeoutMs) {
    const { status_code: code, status } = await get(containerId, { fields: 'status_code,status' })
    if (code === 'FINISHED') return
    if (code === 'ERROR' || code === 'EXPIRED') {
      throw new GraphError(`El contenedor quedó en ${code}: ${redact(status) || 'sin detalle de Meta'}`)
    }
    if (status !== lastStatus) {
      lastStatus = status
      log(`   procesando… (${code})`)
    }
    await sleep(5000)
  }
  throw new GraphError(`El contenedor no terminó de procesar en ${Math.round(timeoutMs / 1000)} s`)
}

async function buildContainer(igId, p, items, log) {
  const common = {
    caption: p.caption || undefined,
    location_id: p.location_id || undefined,
    user_tags: p.user_tags || undefined,
  }

  if (p.type === 'image') {
    return createContainer(igId, { image_url: items[0].url, alt_text: p.alt_text || undefined, ...common })
  }

  if (p.type === 'reel') {
    return createContainer(igId, {
      media_type: 'REELS',
      video_url: items[0].url,
      cover_url: p.cover_url || undefined,
      thumb_offset: p.thumb_offset ?? undefined,
      share_to_feed: p.share_to_feed ?? true,
      audio_name: p.audio_name || undefined,
      ...common,
    })
  }

  if (p.type === 'story') {
    const item = items[0]
    return createContainer(igId, {
      media_type: 'STORIES',
      ...(item.kind === 'video' ? { video_url: item.url } : { image_url: item.url }),
    })
  }

  // Carrusel: un contenedor hijo por archivo, todos FINISHED, y recién ahí el padre.
  const children = []
  for (const [i, item] of items.entries()) {
    log(`   subiendo ${i + 1}/${items.length}…`)
    const childId = await createContainer(igId, {
      is_carousel_item: true,
      ...(item.kind === 'video' ? { media_type: 'VIDEO', video_url: item.url } : { image_url: item.url }),
      alt_text: item.alt_text || undefined,
    })
    await waitForContainer(childId, { timeoutMs: item.kind === 'video' ? 300000 : 60000, log })
    children.push(childId)
  }
  return createContainer(igId, { media_type: 'CAROUSEL', children: children.join(','), ...common })
}

async function publishPost(igId, p, items, log) {
  const containerId = await buildContainer(igId, p, items, log)
  const isVideo = items.some((i) => i.kind === 'video')
  await waitForContainer(containerId, { timeoutMs: isVideo ? 300000 : 60000, log })

  const { id: mediaId } = await post(`${igId}/media_publish`, { creation_id: containerId })
  const { permalink } = await get(mediaId, { fields: 'permalink' }).catch(() => ({ permalink: null }))
  return { media_id: mediaId, permalink, published_at: new Date().toISOString() }
}

// ---------- comandos ----------

const fmt = (iso, tz) => {
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) return String(iso ?? '¿sin fecha?').padEnd(17)
  return new Date(ms)
    .toLocaleString('es-AR', { timeZone: tz, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
    .padEnd(17)
}

async function cmdDoctor() {
  console.log(`Graph API ${API_VERSION()}\n`)

  if (!process.env.IG_ACCESS_TOKEN) {
    console.log('✗ Falta IG_ACCESS_TOKEN. Seguí instagram/README.md y volvé a correr esto.')
    process.exitCode = 1
    return
  }

  let host, me
  try {
    ;({ host, me } = await detectHost())
    console.log(`✓ Token válido en ${host} — /me = ${me.username ? `@${me.username}` : me.name || me.id}`)
    if (!process.env.GRAPH_HOST) console.log(`   fijalo en el .env:  GRAPH_HOST=${host}`)
  } catch (err) {
    console.log(`✗ ${err.message}`)
    process.exitCode = 1
    return
  }

  if (!process.env.IG_USER_ID) {
    console.log('\n○ Falta IG_USER_ID. Candidatos:')
    if (host === 'graph.instagram.com') {
      console.log(`   ${me.id}  (@${me.username}) — la cuenta del propio token`)
    } else {
      // Con Facebook Login la cuenta de Instagram cuelga de una página.
      const { data = [] } = await get('me/accounts', { fields: 'name,instagram_business_account{id,username}' }, { host })
      const linked = data.filter((page) => page.instagram_business_account)
      for (const page of linked) {
        const ig = page.instagram_business_account
        console.log(`   ${ig.id}  (@${ig.username}) — vía la página "${page.name}"`)
      }
      if (!linked.length) {
        console.log('   ninguno: ninguna de tus páginas tiene una cuenta de Instagram profesional vinculada')
      }
    }
    console.log('\n   Poné el que corresponda como IG_USER_ID en instagram/.env')
    process.exitCode = 1
    return
  }

  try {
    const acc = await account()
    console.log(`✓ Cuenta @${acc.username} — ${acc.followers_count ?? '?'} seguidores, ${acc.media_count ?? '?'} posts`)
  } catch (err) {
    console.log(`✗ No puedo leer IG_USER_ID=${process.env.IG_USER_ID}: ${err.message}`)
    process.exitCode = 1
    return
  }

  try {
    await cmdLimit()
  } catch (err) {
    console.log(`⚠ No pude leer el cupo: ${err.message}`)
  }

  // Un token de corta duración se muere en ~1 h y deja la Routine colgada a la madrugada.
  try {
    const { data } = await get(
      'debug_token',
      { input_token: process.env.IG_ACCESS_TOKEN },
      { host: 'graph.facebook.com' }
    )
    if (data?.expires_at === 0) console.log('✓ Token sin vencimiento')
    else if (data?.expires_at) {
      const days = Math.round((data.expires_at * 1000 - Date.now()) / 86400000)
      console.log(`${days > 7 ? '✓' : '⚠'} El token vence en ${days} día(s) — renovalo con "refresh-token"`)
    }
  } catch {
    // debug_token pide un app token; que falle no dice nada malo del token de publicación.
  }
}

async function cmdLimit() {
  const { data } = await get(`${process.env.IG_USER_ID}/content_publishing_limit`, { fields: 'config,quota_usage' })
  const { quota_usage: used = 0, config } = data?.[0] || {}
  const total = config?.quota_total ?? 100
  console.log(`✓ Cupo: ${used}/${total} publicaciones en las últimas 24 h`)
}

function cmdPlan() {
  const cal = readCalendar()
  const tz = cal.timezone || 'America/Argentina/Buenos_Aires'
  const now = Date.now()
  const posts = [...(cal.posts || [])].sort((a, b) => Date.parse(a.publish_at) - Date.parse(b.publish_at))

  if (!posts.length) return console.log('El calendario está vacío.')

  // Con ids repetidos, "run --id" publicaría el que no era.
  const seen = new Set()
  const duplicated = new Set()
  for (const p of posts) {
    if (seen.has(p.id)) duplicated.add(p.id)
    seen.add(p.id)
  }
  for (const id of duplicated) console.log(`⚠ el id "${id}" está repetido: renombrá uno`)

  const mark = { draft: '○ borrador', approved: '● aprobado', published: '✓ publicado', failed: '✗ falló' }
  let pending = 0
  for (const p of posts) {
    const { problems } = validate(p)
    const due = Date.parse(p.publish_at) <= now && p.status === 'approved'
    if (due) pending++
    console.log(
      `${due ? '→' : ' '} ${fmt(p.publish_at, tz)} ${String(mark[p.status] ?? p.status).padEnd(12)} ` +
        `${String(p.type ?? '?').padEnd(8)} ${p.id ?? '¿sin id?'}`
    )
    if (p.result?.permalink) console.log(`     ${p.result.permalink}`)
    if (p.error) console.log(`     último error: ${p.error}`)
    for (const problem of problems) console.log(`     ⚠ ${problem}`)
  }
  console.log(`\n${pending} post(s) listos para salir ahora.`)
}

async function cmdRun(flags) {
  const cal = readCalendar()
  const tz = cal.timezone || 'America/Argentina/Buenos_Aires'
  const now = Date.now()
  // Si la Routine estuvo caída, no vaciamos la cola de golpe sobre el feed.
  const maxLateMs = Number(flags['max-late'] ?? process.env.MAX_LATE_HOURS ?? 6) * 3600000

  const due = (cal.posts || []).filter((p) => {
    if (flags.id) return p.id === flags.id
    if (p.status !== 'approved') return false
    const at = Date.parse(p.publish_at)
    if (at > now) return false
    if (!flags.force && now - at > maxLateMs) {
      console.log(`⏭  ${p.id}: su horario pasó hace más de ${maxLateMs / 3600000} h. Reprogramalo o usá --force.`)
      return false
    }
    return true
  })

  if (flags.id && !due.length) throw new Error(`No hay ningún post con id "${flags.id}" en el calendario.`)
  if (!due.length) return console.log('Nada para publicar.')
  if (flags.id) {
    const target = due[0]
    if (target.status === 'published') {
      throw new Error(`"${flags.id}" ya se publicó el ${target.result?.published_at}. Usá otro id.`)
    }
    // --id saltea el horario, nunca la aprobación.
    if (target.status === 'draft') {
      throw new Error(`"${flags.id}" está en borrador. Pasalo a "approved" en calendar.json y volvé a correr esto.`)
    }
  }

  const igId = process.env.IG_USER_ID
  if (!igId && !flags.dry) throw new Error('Falta IG_USER_ID. Corré "doctor".')

  for (const p of due) {
    const { problems, items } = validate(p)
    console.log(`\n${p.id} — ${p.type}, programado ${fmt(p.publish_at, tz)}`)
    if (problems.length) {
      for (const problem of problems) console.log(`   ✗ ${problem}`)
      p.status = 'failed'
      p.error = `Validación: ${problems.join('; ')}`
      process.exitCode = 1
      continue
    }
    if (flags.dry) {
      console.log(`   (dry-run) publicaría: ${items.map((i) => i.url).join(', ')}`)
      continue
    }

    try {
      p.result = await publishPost(igId, p, items, (m) => console.log(m))
      p.status = 'published'
      delete p.error
      console.log(`   ✓ publicado — ${p.result.permalink || p.result.media_id}`)
    } catch (err) {
      p.status = 'failed'
      p.error = err.message
      process.exitCode = 1
      console.log(`   ✗ ${err.message}`)
    }
    writeCalendar(cal) // guardamos post a post: si algo explota, no repetimos lo ya publicado
  }

  if (!flags.dry) writeCalendar(cal)
}

async function cmdRefreshToken() {
  const host = HOST()
  let token, seconds

  if (host === 'graph.instagram.com') {
    // Instagram Login: el token largo se renueva contra sí mismo, a partir de las 24 h de vida.
    ;({ access_token: token, expires_in: seconds } = await get(
      'refresh_access_token',
      { grant_type: 'ig_refresh_token' },
      { version: '' }
    ))
  } else {
    // Facebook Login: el canje se firma con la app, así que hacen falta id y secreto.
    const { META_APP_ID: id, META_APP_SECRET: secret } = process.env
    if (!id || !secret) {
      throw new Error(
        'Con GRAPH_HOST=graph.facebook.com el canje necesita META_APP_ID y META_APP_SECRET ' +
          '(Configuración → Básica, en el panel de tu app).'
      )
    }
    ;({ access_token: token, expires_in: seconds } = await get('oauth/access_token', {
      grant_type: 'fb_exchange_token',
      client_id: id,
      client_secret: secret,
      fb_exchange_token: process.env.IG_ACCESS_TOKEN,
    }))
  }

  console.log(`Token renovado, vence en ${Math.round((seconds || 0) / 86400)} días.`)
  console.log('Pegá este valor en IG_ACCESS_TOKEN (instagram/.env o las env vars del entorno):\n')
  console.log(token)
}

// ---------- entrada ----------

function parseArgs(argv) {
  const flags = {}
  const rest = []
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (!arg.startsWith('--')) {
      rest.push(arg)
      continue
    }
    const key = arg.slice(2)
    const next = argv[i + 1]
    if (next && !next.startsWith('--')) {
      flags[key] = next
      i++
    } else flags[key] = true
  }
  return { flags, rest }
}

const { flags, rest } = parseArgs(process.argv.slice(2))
const command = rest[0] || 'plan'

loadEnv()

const commands = {
  doctor: cmdDoctor,
  plan: cmdPlan,
  run: () => cmdRun(flags),
  limit: cmdLimit,
  'refresh-token': cmdRefreshToken,
}

if (!commands[command]) {
  console.error(`Comando desconocido: ${command}\nUsá: ${Object.keys(commands).join(' | ')}`)
  process.exit(1)
}

try {
  await commands[command]()
} catch (err) {
  console.error(`\n✗ ${redact(err.message)}`)
  if (err.traceId) console.error(`  fbtrace_id: ${err.traceId}`)
  process.exit(1)
}
