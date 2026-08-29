# GHL → Discord

Avisa en un canal de Discord cada vez que alguien agenda desde el formulario de
**MKT Content**. Sin n8n y sin acciones premium de GoHighLevel.

```
GHL (workflow → acción Webhook, la gratis)
        │  POST con los datos del contacto
        ▼
Netlify Function  /.netlify/functions/ghl-discord
        │  arma el mensaje; la URL de Discord vive acá, no en GHL
        ▼
Tu canal de Discord
```

---

## Parte 1 · Discord

1. En el canal donde querés los avisos: **⚙️ Editar canal → Integraciones →
   Webhooks → Nuevo webhook**.
2. Ponele nombre (ej. "Agendas") y avatar.
3. **Copiar URL del webhook.** Guardala a mano, la vas a pegar en el paso 2.

Esa URL es la credencial del canal: el que la tiene puede escribir ahí. Por eso
no va a GHL ni a ningún archivo, solo a las variables de entorno de Netlify.

## Parte 2 · Netlify

1. Entrá a Netlify y arrastrá **esta carpeta** a la zona de deploy
   (o a [app.netlify.com/drop](https://app.netlify.com/drop) si es un sitio nuevo).
2. Cuando termine, andá a **Site configuration → Environment variables** y
   agregá:

   | Variable | ¿Obligatoria? | Valor |
   | --- | --- | --- |
   | `DISCORD_WEBHOOK_URL` | sí | La URL de la Parte 1 |
   | `HOOK_SECRET` | recomendada | Un token cualquiera, ej. `43c278c364fd759c377a2f213b715c54` |
   | `DISCORD_MENTION` | no | `@here` si querés que suene la notificación |

3. **Volvé a arrastrar la carpeta** (o *Deploys → Trigger deploy*). Las
   variables recién se aplican en el deploy siguiente.

Sin `HOOK_SECRET` el endpoint anda igual, pero cualquiera que descubra la URL
puede escribir en tu canal. Ponelo.

## Parte 3 · Probar antes de tocar GHL

Abrí el sitio que te dio Netlify. La página de inicio es un panel de control:
pegás tu `HOOK_SECRET`, apretás **Probar endpoint** y después **Mandar agenda de
prueba**. Si la agenda de "Ana Prueba" aparece en Discord, ya está: lo único que
falta es que GHL le pegue a esa misma URL.

El panel también te arma y copia la URL exacta para GHL. Tiene esta forma:

```
https://TU-SITIO.netlify.app/.netlify/functions/ghl-discord?key=TU_HOOK_SECRET
```

## Parte 4 · GoHighLevel, paso a paso

### A. Los campos personalizados

**Settings → Custom Fields** (Configuración → Campos personalizados). Cada
pregunta del formulario tiene que guardar en su campo, y cada campo tiene una
*Unique Key* / *Query Key*:

| Pregunta | Query key |
| --- | --- |
| ¿Qué habilidad enseñas en tu curso o mentoría? | `habilidad` |
| ¿Cuántos alumnos activos tienes hoy? | `c.alumnos` |
| ¿A cuánto vendes tu programa hoy? | `precio` |
| ¿Qué pasa hoy con tus alumnos cuando terminan tu programa…? | `P.programa` |

Si todavía no creaste el de la pregunta 3: **+ Add Field → Dropdown (Single
Options)**, nombre "Precio", cargá las tres opciones y guardá con la key
`precio`. Nombre, mail y teléfono ya son campos estándar del contacto, no hay
que crear nada.

### B. El formulario

**Sites → Forms → Builder**, abrí el de MKT Content y confirmá que cada
pregunta esté apuntando a su campo personalizado (no a un campo suelto del
formulario). Si no, la respuesta no viaja en el webhook.

### C. El workflow

1. **Automation → Workflows** y abrí el de MKT Content (o *Create Workflow →
   Start from Scratch*).
2. **Trigger:**
   - Si la persona completa un formulario: **Form Submitted**, y en el filtro
     elegí el formulario de MKT Content.
   - Si agenda en un calendario: **Customer Booked Appointment**, filtrando por
     ese calendario.
3. Tocá **+** y buscá `Webhook`. Elegí **Webhook** — la común. Si ves *Custom
   Webhook* con el ícono de premium, **esa no es**: cobra por ejecución y no
   hace falta.
4. **Method:** `POST`.
5. **URL:** pegá la que te copió el panel, con el `?key=` incluido.
6. No toques nada más (ni headers ni body): la acción manda sola todos los datos
   del contacto.
7. **Save Action.**
8. Arriba a la derecha, pasá el workflow de **Draft** a **Publish**. Si queda en
   borrador no se ejecuta nunca — es el olvido más común.

### D. La prueba real

Completá el formulario vos mismo, con datos de verdad, y mirá Discord.

Si no llega nada:

- **¿Corrió el workflow?** Workflow → pestaña **Execution Logs**. Si no aparece
  tu prueba, el problema es el trigger o que quedó en Draft.
- **¿Corrió pero no llegó?** Netlify → **Logs → Functions → ghl-discord**. Ahí
  vas a ver la llamada y el error.

**Si llegan campos vacíos ("—" en Discord):** a veces GHL dispara el webhook
antes de terminar de guardar las respuestas en el contacto. Meté una acción
**Wait → 1 minuto** justo antes del Webhook y listo.

## Si un campo sigue llegando vacío

La función busca cada respuesta ignorando mayúsculas, acentos, puntos y prefijos
tipo `contact.`, y contempla que GHL mande la pregunta entera como clave. Si aun
así falla: en **Netlify → Logs → Functions → ghl-discord** queda registrado el
payload completo de cada llamada. Buscá con qué nombre exacto viajó el campo,
copialo y agregalo a la lista `FIELDS` que está arriba de todo en
`netlify/functions/ghl-discord.mjs`. Es el único lugar del archivo que hay que
tocar. Después volvés a arrastrar la carpeta a Netlify.

## Costos y límites

- **GHL:** $0. La acción Webhook común no es premium.
- **Netlify:** plan gratis, 125.000 invocaciones de función por mes.
- **Discord:** ~30 mensajes por minuto por webhook y 5 cada 5 segundos por
  canal. Si Discord responde 429, la función espera lo que pide y reintenta.

## Qué hay adentro

| Archivo | Para qué |
| --- | --- |
| `netlify/functions/ghl-discord.mjs` | La función. El mapeo de campos está arriba de todo. |
| `netlify.toml` | Le dice a Netlify dónde está la función. |
| `index.html` | El panel de control para probar y copiar la URL. |
