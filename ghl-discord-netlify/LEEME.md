# GHL → Discord

Avisa en un canal de Discord cada vez que alguien reserva una **Sesión de
Claridad**. Sin n8n y sin acciones premium de GoHighLevel.

```
GHL (workflow → acción Webhook, la gratis)
        │  POST con los datos del contacto
        ▼
Netlify Function  /hooks/ghl-discord
        │  arma el mensaje; la URL de Discord vive acá, no en GHL
        ▼
Tu canal de Discord
```

Manda dos avisos distintos según el caso:

```
📅 NUEVA AGENDA                    (naranja)
Nombre · Mail · Teléfono
Cuándo es la llamada
1..4 las respuestas del survey
📲 Escribirle para confirmar  ← link de WhatsApp con el mensaje ya escrito

📝 COMPLETÓ EL SURVEY · SIN AGENDAR   (ámbar)
Nombre · Mail · Teléfono
1..4 las respuestas del survey
📲 Escribirle por WhatsApp    ← otro mensaje, el de seguimiento
```

---

## Parte 1 · Discord

1. En el canal: **⚙️ Editar canal → Integraciones → Webhooks → Nuevo webhook**.
2. Ponele nombre (ej. "Agendas") y avatar.
3. **Copiar URL del webhook.**

Esa URL es la credencial del canal: el que la tiene escribe ahí. No va a GHL ni
a ningún archivo, solo a las variables de entorno de Netlify.

## Parte 2 · Netlify

**El drag & drop del navegador no sirve acá.** Netlify sube los archivos pero no
enruta las funciones: te queda el sitio andando y el endpoint tirando 404. Las
funciones se deployan por Git, por CLI o por API — no por el dropzone.

### Opción A · Conectar Git (sin terminal)

En el proyecto de Netlify: **Project configuration → Build & deploy →
Continuous deployment → Link repository**. Conserva el nombre del sitio, las
variables de entorno y la URL.

| Campo | Valor |
| --- | --- |
| Repository | `rolandopaypal9823/variados` |
| Branch to deploy | `claude/ghl-discord-netlify-7lwt7s` |
| Base directory | `ghl-discord-netlify` |
| Build command | *(vacío)* |
| Publish directory | `ghl-discord-netlify` |

Ojo con la branch: no es `main`.

### Opción B · Netlify CLI

Parado dentro de la carpeta `ghl-discord-netlify`:

```bash
npm install -g netlify-cli
netlify login
netlify link          # elegís el sitio flowscale-hooks
netlify deploy --prod
```

El `netlify.toml` ya dice qué publicar y dónde están las funciones.

### Las variables de entorno

**Site configuration → Environment variables → Add a variable:**

| Variable | ¿Obligatoria? | Valor |
| --- | --- | --- |
| `DISCORD_WEBHOOK_URL` | sí | La URL de la Parte 1 |
| `DISCORD_MENTION` | no | `@here` si querés que suene la notificación |
| `TIMEZONE` | no | Default `America/Argentina/Buenos_Aires` |
| `WHATSAPP_AGENDA` | no | Para cambiar el mensaje de confirmación |
| `WHATSAPP_SIN_AGENDA` | no | Para cambiar el mensaje de seguimiento |

Las variables se aplican recién en el deploy siguiente: después de cargarlas,
**Deploys → Trigger deploy**.

### Tu URL

```
https://flowscale-hooks.netlify.app/hooks/ghl-discord
```

Esa ruta es la que declara la función y la que Netlify muestra como *Endpoint*
en **Logs & metrics → Functions**. La ruta genérica `/.netlify/functions/...`
no responde cuando la función declara su propio path.

No lleva contraseña: quien la tenga puede mandarle datos al endpoint. Es una URL
larga y al azar que nadie va a adivinar, así que para este uso alcanza — del
lado de Discord la credencial real sigue protegida como variable de entorno.

## Parte 3 · Probar antes de tocar GHL

Abrí el sitio: la home es un panel de control con la URL ya lista para copiar.
Apretá **Probar endpoint**, y después **Probar agenda** y **Probar survey sin
agenda**. Si los dos mensajes de "Ana Prueba" aparecen en Discord, el puente
está andando y solo falta conectar GHL.

## Parte 4 · GoHighLevel

Son **dos workflows**, cada uno apuntando a la misma URL pero con un `?tipo=`
distinto al final. Eso es lo único que le dice a la función qué mensaje armar.

| Workflow | URL |
| --- | --- |
| Agendó | `https://flowscale-hooks.netlify.app/hooks/ghl-discord?tipo=agenda` |
| Completó el survey y no agendó | `https://flowscale-hooks.netlify.app/hooks/ghl-discord?tipo=noagenda` |

### Workflow 1 · "Agenda → Discord"

- **Trigger:** Cita Reservada Por El Cliente, filtrando por el calendario
  *Sesión de Claridad*.
- **Acción:** Webhook, `POST`, la URL con `?tipo=agenda`.

Dispara siempre que reservan, agenden a los dos minutos o a los tres días.

### Workflow 2 · "Survey sin agenda → Discord"

- **Trigger:** Survey Submitted (el survey de MKT Content).
- **Acción 1 — Esperar:** 30 minutos. Le das tiempo a que agende después de
  completar el survey.
- **Acción 2 — Condición If/Else:** ¿el contacto tiene una cita en el
  calendario *Sesión de Claridad*?
  - **Sí →** cortá acá. El Workflow 1 ya avisó, no hace falta duplicar.
  - **No →** Webhook, `POST`, la URL con `?tipo=noagenda`.

Así nadie se pierde: el que agenda entra por el 1, el que no, cae por el 2
media hora después.

### Los Datos personalizados (los mismos en los dos workflows)

Tocá **⊕ Añadir artículo** y cargá estas filas. La clave la escribís a mano; el
valor lo insertás con el **ícono de etiqueta** (el selector de campos), nunca
tipeando el merge tag:

| Clave | Valor |
| --- | --- |
| `nombre` | Nombre completo del contacto |
| `mail` | Email del contacto |
| `telefono` | Teléfono del contacto |
| `cuando` | *Appointment Start Time* — **solo en el Workflow 1** |
| `habilidad` | Campo personalizado *Habilidad* |
| `alumnos` | Campo personalizado *Alumnos* |
| `precio` | Campo personalizado *Precio* |
| `programa` | Campo personalizado *Programa* |

**Encabezados:** nada.

### El teléfono, para que el link de WhatsApp funcione

El mensaje incluye un botón que abre WhatsApp con el texto ya escrito. Para que
funcione, el teléfono tiene que tener **código de país**: `+54 9 11 5555-5555`
sirve, `11 5555-5555` no. La función limpia espacios, guiones y el `+` sola,
pero no puede adivinar el país. Si el número llega corto, el botón simplemente
no aparece y el resto del mensaje llega igual.

### Publicar

**Guardar acción → Guardar el workflow → pasar el switch de Borrador a
Publicar.** En borrador no se ejecuta nunca.

### Los mensajes de WhatsApp

Van escritos en la función, pero podés cambiarlos sin tocar código con dos
variables de entorno en Netlify. Admiten `{nombre}` y `{cuando}`:

| Variable | Qué mensaje cambia |
| --- | --- |
| `WHATSAPP_AGENDA` | El de confirmar la llamada (Samy) |
| `WHATSAPP_SIN_AGENDA` | El del survey sin agendar (Rolando) |

También hay `TIMEZONE` (default `America/Argentina/Buenos_Aires`) para la zona
horaria con la que se muestra la fecha de la cita.

Después de cambiar cualquier variable, acordate del redeploy.

## Si algún campo llega vacío ("—" en Discord)

1. **Revisá la fila en Datos personalizados**: que la clave esté escrita igual
   que en la tabla y que el valor tenga el campo insertado con el selector.
2. **Timing:** a veces GHL dispara el webhook antes de guardar las respuestas en
   el contacto. Meté una acción **Esperar → 1 minuto** antes del Webhook.
3. **Último recurso:** en Netlify → Logs → Functions queda el payload completo
   de cada llamada. Ahí ves con qué nombre viajó realmente el campo; lo agregás
   a la lista `FIELDS`, arriba de todo en `netlify/functions/ghl-discord.mjs`, y
   redeployás (push a la branch, o `netlify deploy --prod`).

La función igual es tolerante: acepta la clave con mayúsculas, con acentos, con
prefijos tipo `contact.`, dentro de `customData`, o la pregunta entera como
clave. Los Datos personalizados son para no depender de eso.

## Costos y límites

- **GHL:** $0. La acción Webhook común no es premium.
- **Netlify:** plan gratis, 125.000 invocaciones por mes.
- **Discord:** ~30 mensajes por minuto por webhook. Si contesta 429, la función
  espera lo que pide y reintenta.

## Qué hay adentro

| Archivo | Para qué |
| --- | --- |
| `netlify/functions/ghl-discord.mjs` | La función. El mapeo está arriba de todo, en `FIELDS`. |
| `netlify.toml` | Le dice a Netlify dónde está la función. |
| `index.html` | El panel para probar y copiar la URL. |
