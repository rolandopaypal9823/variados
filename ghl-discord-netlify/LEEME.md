# GHL → Discord

Avisa en un canal de Discord cada vez que alguien reserva una **Sesión de
Claridad**. Sin n8n y sin acciones premium de GoHighLevel.

```
GHL (workflow → acción Webhook, la gratis)
        │  POST con los datos del contacto
        ▼
Netlify Function  /.netlify/functions/ghl-discord
        │  arma el mensaje; la URL de Discord vive acá, no en GHL
        ▼
Tu canal de Discord
```

El mensaje que llega:

```
📅 NUEVA AGENDA
Nombre · Mail · Teléfono
1. ¿Qué habilidad enseña?
2. ¿Cuántos alumnos activos?
3. ¿A cuánto vende su programa?
4. ¿Qué pasa con sus alumnos cuando terminan?
```

---

## Parte 1 · Discord

1. En el canal: **⚙️ Editar canal → Integraciones → Webhooks → Nuevo webhook**.
2. Ponele nombre (ej. "Agendas") y avatar.
3. **Copiar URL del webhook.**

Esa URL es la credencial del canal: el que la tiene escribe ahí. No va a GHL ni
a ningún archivo, solo a las variables de entorno de Netlify.

## Parte 2 · Netlify

1. Arrastrá **esta carpeta** a [app.netlify.com/drop](https://app.netlify.com/drop).
   Te crea el sitio al instante con un nombre random.
2. **Site configuration → Change site name** → poné `flowscale-hooks`. Así la
   URL es la de más abajo y ya podés pegarla en GHL.
3. **Site configuration → Environment variables → Add a variable:**

   | Variable | ¿Obligatoria? | Valor |
   | --- | --- | --- |
   | `DISCORD_WEBHOOK_URL` | sí | La URL de la Parte 1 |
   | `DISCORD_MENTION` | no | `@here` si querés que suene la notificación |

4. **Volvé a arrastrar la carpeta.** Las variables recién se aplican en el
   deploy siguiente.

Tu URL queda:

```
https://flowscale-hooks.netlify.app/.netlify/functions/ghl-discord
```

Esta URL no lleva contraseña: quien la tenga puede mandarle datos al endpoint.
Es una URL larga y al azar que nadie va a adivinar, así que para este uso
alcanza — no hay nada sensible del lado de GHL, y del lado de Discord la
credencial real (la URL del webhook) sigue protegida como variable de entorno.

(Si el nombre `flowscale-hooks` está ocupado, elegí otro y cambiá esa parte.)

## Parte 3 · Probar antes de tocar GHL

Abrí el sitio: la home es un panel de control con la URL ya lista para copiar.
Apretá **Probar endpoint** y después **Mandar agenda de prueba**. Si "Ana Prueba"
aparece en Discord, el puente está andando y solo falta conectar GHL.

## Parte 4 · GoHighLevel

### El trigger

**Cita Reservada Por El Cliente**, filtrando por el calendario *Sesión de
Claridad*. (Si en vez de eso usás un formulario, el trigger es *Form
Submitted* — el resto es igual.)

### La acción Webhook

En el panel de la acción:

- **Método:** `POST`
- **URL:** la de la Parte 2, con el `?key=` incluido
- **Encabezados:** nada
- **Datos personalizados:** acá está todo el mapeo ↓

### El mapeo: Datos personalizados

Esta es la parte importante. En vez de dejar que GHL mande los campos con el
nombre que se le ocurra, vos le decís con qué clave mandar cada dato. Tocá
**⊕ Añadir artículo** siete veces y cargá:

| Clave (escribila tal cual) | Valor |
| --- | --- |
| `nombre` | Nombre completo del contacto |
| `mail` | Email del contacto |
| `telefono` | Teléfono del contacto |
| `habilidad` | Campo personalizado *Habilidad* |
| `alumnos` | Campo personalizado *Alumnos* |
| `precio` | Campo personalizado *Precio* |
| `programa` | Campo personalizado *Programa* |

**La clave la escribís a mano, el valor lo insertás con el ícono de etiqueta**
(el selector de campos). Nunca tipees el merge tag: elegilo del selector y GHL
pone la referencia correcta sola.

Opcional: una octava fila con clave `cuando` y el valor *Appointment Start Time*
para que el mensaje muestre la fecha de la cita. Si no la cargás, ese renglón
simplemente no aparece.

### Publicar

**Guardar acción**, después **Guardar** el workflow, y arriba a la derecha pasá
el switch de **Borrador** a **Publicar**. En borrador no se ejecuta nunca — es
el olvido más común.

### Probar de verdad

Reservá una cita vos mismo en el calendario y mirá Discord.

- **¿No aparece nada?** Workflow → **Registros de ejecución**. Si tu prueba no
  figura, el problema es el trigger o que quedó en borrador.
- **¿Corrió pero no llegó?** Netlify → **Logs → Functions → ghl-discord**.

## Si algún campo llega vacío ("—" en Discord)

1. **Revisá la fila en Datos personalizados**: que la clave esté escrita igual
   que en la tabla y que el valor tenga el campo insertado con el selector.
2. **Timing:** a veces GHL dispara el webhook antes de guardar las respuestas en
   el contacto. Meté una acción **Esperar → 1 minuto** antes del Webhook.
3. **Último recurso:** en Netlify → Logs → Functions queda el payload completo
   de cada llamada. Ahí ves con qué nombre viajó realmente el campo; lo agregás
   a la lista `FIELDS`, arriba de todo en `netlify/functions/ghl-discord.mjs`, y
   volvés a arrastrar la carpeta.

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
