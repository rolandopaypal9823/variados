---
name: instagram-cm
description: Gestioná el contenido de Instagram de este repo — cargar posts al calendario, programarlos, revisarlos y publicarlos de verdad por la Graph API de Meta. Usala cuando el usuario quiera escribir, planificar, agendar, aprobar o subir un post, reel, carrusel o historia a Instagram; cuando pregunte qué hay programado o qué se publicó; cuando quiera mover o reprogramar contenido; o cuando algo haya fallado al publicar. También para armar la grilla de la semana o el mes.
---

# Community management de Instagram

El calendario es `instagram/calendar.json` y el que publica es
`instagram/publish.mjs`. Toda la configuración de Meta está explicada en
`instagram/README.md` — leelo si el usuario está arrancando o si algo de token,
permisos o formatos no cierra.

## Lo que nunca hacés

1. **No aprobás por el usuario.** Todo post nuevo entra como `"draft"`. Pasarlo a
   `"approved"` es una decisión suya: preguntale, y sólo cambialo cuando te diga
   que sí. El script se niega a publicar borradores incluso a mano.
2. **No publicás sin avisar.** Antes de una corrida real, mostrale qué va a
   salir y esperá confirmación. La excepción: la Routine horaria, que para eso
   existe.
3. **No tocás `instagram/.env` ni mostrás el token.** Está en `.gitignore` y el
   repo es público. Si ves un token en un archivo versionado, avisá de una y
   decile que lo invalide desde el panel de Meta.
4. **No inventás métricas ni resultados.** Si no publicó todavía, no hay números.

## El flujo

### Cargar contenido

1. Escribí el copy. Para la voz de marca de Samy usá la skill `marca-samy`; para
   guionar un reel de respuesta directa, `funnel400`.
2. Los archivos van en `instagram/media/`. En el calendario se escribe la ruta
   relativa (`instagram/media/lunes-reel.mp4`) y `MEDIA_BASE_URL` la convierte en
   URL pública. Meta descarga el archivo de ahí, así que tiene que estar
   commiteado y pusheado **antes** de publicar — si no, Meta recibe un 404.
3. Agregá el post a `posts[]` con `"status": "draft"`.

`id`: fecha y tema, en kebab-case — `2026-09-22-caso-cliente`. Único.
`publish_at`: ISO con offset `-03:00` (Buenos Aires).

```json
{
  "id": "2026-09-22-caso-cliente",
  "status": "draft",
  "type": "image",
  "publish_at": "2026-09-22T13:00:00-03:00",
  "caption": "El texto tal cual sale.\n\n#hashtag",
  "alt_text": "Descripción para lectores de pantalla.",
  "media": ["instagram/media/caso-cliente.jpg"]
}
```

Tipos: `image`, `carousel` (2 a 10 archivos), `reel`, `story` (sin caption).
Escribí siempre el `alt_text` de las fotos.

### Revisar

```bash
node instagram/publish.mjs plan
```

Valida sin llamar a Meta: caption de más de 2200 caracteres, más de 30 hashtags,
carruseles mal armados, rutas rotas. Corregí todo lo que marque antes de seguir.

### Publicar

```bash
node instagram/publish.mjs run --dry      # simulacro, no toca Instagram
node instagram/publish.mjs run            # lo aprobado cuya hora ya pasó
node instagram/publish.mjs run --id <id>  # ese post, ya
```

Después de publicar, commiteá `calendar.json`: el script le escribió el
`permalink` y la fecha real. Pasá el permalink al usuario.

### Cuando falla

El post queda en `failed` con el mensaje de Meta en el campo `error`. Leelo,
arreglá la causa, volvelo a `approved`. No reintentes a ciegas: si Meta no pudo
descargar el archivo, reintentar da exactamente el mismo error. El README tiene
los errores frecuentes y qué significa cada uno.

## Cosas que conviene saber

- **La API no programa.** `publish_at` es nuestro, no de Meta. Alguien tiene que
  correr `run` a esa hora: la Routine horaria, GitHub Actions o un cron.
- **Corriendo cada hora**, un post de las 13:00 sale entre 13:00 y 13:59. Si el
  usuario necesita el minuto exacto, decíselo antes de que lo descubra solo.
- **Cupo de Meta:** 100 publicaciones cada 24 h. `publish.mjs limit` lo consulta.
- **Lo atrasado más de 6 h no sale solo**, para que un runner caído no vacíe la
  cola encima del feed. Se saltea y avisa; `--force` lo publica igual.
- **El token vence a los 60 días.** Si `doctor` avisa que faltan menos de 7,
  decile al usuario que corra `refresh-token`.
- **Las historias no llevan caption** por API, y la API no publica encuestas,
  stickers ni música.
- **Desde una sesión de Claude en la web**, la salida a internet está filtrada: si
  el script dice que la red bloquea `graph.instagram.com`, no es el token. Hay que
  permitir ese host en la configuración de red del entorno (está en el README).
  Nada de esto se arregla tocando el código.

## Al armar una grilla

Cuando te pidan "la semana" o "el mes", no tires quince posts sueltos: proponé
primero la grilla — qué días, qué formato cada día, qué tema — y recién con el
visto bueno escribí los copys. Mantené `draft` hasta que los apruebe uno por uno
o en tanda.
