# GoHighLevel → Discord

Avisa en un canal de Discord cada vez que alguien completa el formulario de
**MKT Content** en GoHighLevel. No usa n8n ni acciones premium de GHL: la
acción **Webhook** de GHL (la gratis) le pega a una función de Netlify, y esa
función arma el mensaje y lo publica en Discord.

```
GHL (workflow → acción Webhook)
        │  POST con los datos del contacto
        ▼
Netlify Function  /hooks/ghl-discord
        │  arma el embed, guarda la URL de Discord como env var
        ▼
Canal de Discord
```

Archivos: `netlify/functions/ghl-discord.mjs` y `netlify.toml`.

---

## 1. Crear el webhook en Discord

En el canal donde querés los avisos: **⚙️ Editar canal → Integraciones →
Webhooks → Nuevo webhook**. Ponele nombre y avatar, y copiá la URL.

Esa URL es la credencial del canal: el que la tiene puede escribir ahí. No va
al repo ni a GHL, solo a las variables de entorno de Netlify.

## 2. Publicar el sitio en Netlify

En Netlify: **Add new project → Import an existing project** y conectá este
repo. Netlify detecta `netlify.toml` y deploya la función sola (no hace falta
build ni dependencias).

Si la landing ya está subida por drag-and-drop, dejala como está y creá un
sitio nuevo desde el repo: no se pisan.

## 3. Variables de entorno

En **Site configuration → Environment variables**:

| Variable | Obligatoria | Valor |
| --- | --- | --- |
| `DISCORD_WEBHOOK_URL` | sí | La URL del paso 1 |
| `HOOK_SECRET` | recomendada | Un token cualquiera, ej. `43c278c364fd759c377a2f213b715c54` |
| `DISCORD_MENTION` | no | `@here` si querés que suene la notificación |

Sin `HOOK_SECRET` el endpoint funciona igual, pero cualquiera que descubra la
URL puede escribir en el canal. Después de cargarlas, hacé un **redeploy** para
que la función las tome.

## 4. Probar antes de tocar GHL

Con el sitio publicado, abrí en el navegador:

```
https://TU-SITIO.netlify.app/hooks/ghl-discord?key=TU_HOOK_SECRET
```

Tiene que responder `ok, el endpoint esta vivo...`. Después mandá una agenda
de prueba:

```bash
curl -X POST "https://TU-SITIO.netlify.app/hooks/ghl-discord?key=TU_HOOK_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "full_name": "Ana Prueba",
    "email": "ana@ejemplo.com",
    "phone": "+5491155555555",
    "habilidad": "Reparación de crédito",
    "c.alumnos": "Entre 10 y 50",
    "precio": "Entre $1.000 y $3.000",
    "P.programa": "La mayoría se queda ahí cuando termina."
  }'
```

Si el mensaje aparece en Discord, lo único que falta es que GHL le pegue a esa
misma URL.

## 5. El workflow en GHL

1. **Trigger:** el que corresponda (Form Submitted / Appointment Booked del
   formulario de MKT Content).
2. **Acción → Webhook** (la común, gratis — *no* la Custom Webhook premium).
3. **Método:** POST.
4. **URL:** `https://TU-SITIO.netlify.app/hooks/ghl-discord?key=TU_HOOK_SECRET`
5. Guardá, publicá el workflow y mandá una agenda de prueba real.

## 6. Los campos personalizados

La función busca cada respuesta por su *query key*, ignorando mayúsculas,
acentos, puntos y espacios. Estos son los que espera:

| Pregunta | Query key |
| --- | --- |
| ¿Qué habilidad enseñas en tu curso o mentoría? | `habilidad` |
| ¿Cuántos alumnos activos tienes hoy? | `c.alumnos` |
| ¿A cuánto vendes tu programa hoy? | `precio` |
| ¿Qué pasa hoy con tus alumnos cuando terminan tu programa…? | `P.programa` |

Nombre, mail y teléfono salen de los campos estándar del contacto
(`full_name`, `email`, `phone`).

**Si algún campo llega vacío (aparece "—" en Discord):** entrá a Netlify →
**Logs → Functions → ghl-discord**. Cada llamada deja registrado el payload
completo que mandó GHL, así ves con qué nombre exacto viajó el campo. Copiá esa
clave y agregala a la lista correspondiente en `FIELDS`, arriba de todo en
`netlify/functions/ghl-discord.mjs`. Es el único lugar del archivo que hay que
tocar para ajustar el mapeo.

## Costos y límites

- Netlify free: 125.000 invocaciones de función por mes.
- Discord: ~30 mensajes por minuto por webhook y 5 cada 5 segundos por canal.
  Si Discord responde 429, la función espera lo que pide y reintenta una vez.
