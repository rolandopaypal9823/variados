# Publicador de Instagram

Calendario de contenido en un JSON + un script que publica en Instagram por la
Graph API de Meta. Sin dependencias: sólo Node 18+.

Está pensado para **tus propias cuentas**. Publicar en cuentas de terceros exige
App Review y Verificación de Negocio de Meta (2–4 semanas); esto no.

## Qué se puede publicar

| Tipo | En el calendario | Notas |
|---|---|---|
| Foto | `"type": "image"` | JPEG o PNG. Acepta `alt_text`. |
| Carrusel | `"type": "carousel"` | Entre 2 y 10 archivos, fotos y/o videos mezclados. |
| Reel | `"type": "reel"` | MP4/MOV. `share_to_feed` y `cover_url` opcionales. |
| Historia | `"type": "story"` | Foto o video. Sin caption: la API no lo acepta. |

Límite de Meta: **100 publicaciones cada 24 h** por cuenta. Un carrusel cuenta
como una sola.

## Puesta en marcha

### 1. La cuenta de Instagram tiene que ser profesional

En la app: Configuración → Tipo de cuenta → cambiar a **Empresa** o **Creador**.
Con una cuenta personal la API no publica.

### 2. Crear la app en Meta

1. Entrá a [developers.facebook.com/apps](https://developers.facebook.com/apps)
   y creá una app. Caso de uso: **Otro** → tipo **Empresa**.
2. Agregale el producto **Instagram** → *API con inicio de sesión de Instagram*.
3. En esa sección, conectá tu cuenta de Instagram.

### 3. Permisos

Pedí estos alcances al generar el token:

- `instagram_business_basic` — leer la cuenta
- `instagram_business_content_publish` — publicar

Mientras la app esté en **modo desarrollo** funcionan sobre tus propias cuentas
sin pasar por App Review. Eso es justo lo que necesitamos.

### 4. El token

En la sección de Instagram de tu app hay un generador de tokens. Generá uno y
**canjealo por uno de larga duración** (60 días) — el corto vive una hora y te
deja la automatización muerta a la madrugada.

Copiá `.env.example` a `.env` y completá:

```bash
cp instagram/.env.example instagram/.env
```

`instagram/.env` está en `.gitignore`. **Este repo es público: un token
commiteado es un token robado.** Si se te escapa uno, invalidalo desde el panel
de la app de Meta antes que nada.

Después:

```bash
node instagram/publish.mjs doctor
```

Te dice si el token sirve, en qué host, cuál es tu `IG_USER_ID`, cuánto cupo te
queda y cuándo vence el token. Cargá en el `.env` el `IG_USER_ID` y el
`GRAPH_HOST` que te muestre.

Meta tiene dos caminos de login y cada uno vive en un host distinto:
`graph.instagram.com` si seguiste el paso 2 tal cual, `graph.facebook.com` si tu
app usa inicio de sesión de Facebook y la cuenta cuelga de una página. `doctor`
prueba los dos y te dice cuál es el tuyo; no tenés que adivinar.

Cada 60 días, para renovar sin volver al panel:

```bash
node instagram/publish.mjs refresh-token
```

### 5. Si corrés esto desde una sesión de Claude en la web

El entorno filtra la salida a internet y, por defecto, la API de Meta **no está
permitida**. Vas a ver:

```
La red de este entorno bloquea graph.instagram.com.
```

Agregá `graph.instagram.com` y `graph.facebook.com` a los hosts permitidos en la
configuración de red del entorno ([cómo se
configura](https://code.claude.com/docs/en/claude-code-on-the-web)). Desde tu
máquina, esto no aplica: corré y listo.

## Dónde viven los archivos

Meta no recibe archivos subidos: **descarga cada archivo de una URL pública**.
Como este repo es público, alcanza con dejar el material en `instagram/media/` y
apuntar `MEDIA_BASE_URL` a las URLs raw de GitHub. En el calendario escribís la
ruta relativa (`instagram/media/reel-lunes.mp4`) y el script arma la URL.

También podés poner una URL completa de cualquier lado (Netlify, S3, Cloudinary).
Los links de Google Drive **no** sirven: Meta no puede descargarlos.

Requisitos de Meta: foto JPEG/PNG de hasta 8 MB; video MP4/MOV de hasta 1 GB y
15 minutos para reels.

## El calendario

`calendar.json` es la única fuente de verdad. Un post:

```json
{
  "id": "2026-09-22-caso-cliente",
  "status": "approved",
  "type": "image",
  "publish_at": "2026-09-22T13:00:00-03:00",
  "caption": "El texto tal cual sale.\n\n#hashtag",
  "alt_text": "Descripción para lectores de pantalla.",
  "media": ["instagram/media/caso-cliente.jpg"]
}
```

`status` recorre: `draft` → `approved` → `published` (o `failed`).
**Nada sale a Instagram mientras esté en `draft`**, ni siquiera forzándolo por
id. Aprobar es decisión tuya, no del script.

`publish_at` es ISO 8601 con offset. Para Buenos Aires, `-03:00`.

Campos por tipo: `alt_text` (foto), `cover_url` / `thumb_offset` /
`share_to_feed` (reel), `location_id` y `user_tags` (foto, carrusel y reel).

## Uso diario

```bash
node instagram/publish.mjs plan          # qué hay cargado y qué está por salir
node instagram/publish.mjs run --dry     # simula la tanda pendiente
node instagram/publish.mjs run           # publica lo aprobado cuya hora ya pasó
node instagram/publish.mjs run --id 2026-09-22-caso-cliente   # ese post, ahora
node instagram/publish.mjs limit         # cupo de las últimas 24 h
```

`plan` valida sin llamar a Meta: te marca captions pasados de largo, más de 30
hashtags, carruseles mal armados y rutas de archivos rotas.

Publicado un post, el script le escribe el `permalink` y la fecha real en el
calendario y lo pasa a `published`.

## La programación de verdad

La API de Instagram **no** programa: no existe "publicar el jueves a las 13". El
que tiene que estar despierto a esa hora y llamar a la API sos vos — o algo que
corra por vos. Por eso `publish_at` vive acá y algo ejecuta `run` cada hora.

Opciones, de menos a más infraestructura:

- **Una Routine de Claude** que cada hora abra una sesión, corra `run` y
  commitee el calendario actualizado. Sin servidor. Es lo que usamos.
- **GitHub Actions** con `schedule`, guardando el token en Secrets.
- **Un cron en cualquier VPS** que ya tengas.

Corriendo cada hora, un post programado 13:00 sale entre 13:00 y 13:59. Si
necesitás el minuto exacto, bajá el intervalo.

### El seguro contra la cola acumulada

Si el runner estuvo caído dos días, al volver **no** vacía la cola de golpe
sobre el feed. Todo lo que tenga más de `MAX_LATE_HOURS` (6 por defecto) de
atraso se saltea y te avisa. Para publicar igual algo atrasado: `run --force`.

## Cuando algo falla

El post queda en `failed` con el mensaje de Meta guardado en el calendario, y
`plan` te lo muestra. No se reintenta solo: arreglás lo que haya que arreglar,
lo volvés a poner en `approved` y sale en la próxima corrida.

Errores típicos:

- *"The user is not an Instagram Business"* — la cuenta sigue siendo personal (paso 1).
- *"Media type not supported"* — el archivo no cumple formato o pesa de más.
- El contenedor queda en `ERROR` — casi siempre Meta no pudo descargar la URL.
  Abrila en una ventana de incógnito: si no carga sin login, Meta tampoco puede.
- *"Application does not have permission for this action"* — al token le falta
  `instagram_business_content_publish`; regeneralo con ese alcance.

Los contenedores de Meta vencen a las 24 h, así que el script siempre los crea
en el momento de publicar, nunca por adelantado.
