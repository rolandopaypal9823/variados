/**
 * GoHighLevel -> Discord
 *
 * Recibe el webhook de un workflow de GHL (la accion "Webhook", la gratis) y
 * publica la agenda como un embed en un canal de Discord.
 *
 * Variables de entorno (Netlify -> Site configuration -> Environment variables):
 *   DISCORD_WEBHOOK_URL  obligatoria   URL del webhook del canal de Discord
 *   DISCORD_MENTION      opcional      ej. "@here", para que suene la notificacion
 *   TIMEZONE             opcional      zona horaria para mostrar la fecha de la
 *                                      cita (default America/Argentina/Buenos_Aires)
 *   WHATSAPP_TEMPLATE    opcional      mensaje precargado del link de WhatsApp.
 *                                      Admite {nombre} y {cuando}.
 */

export const config = { path: "/hooks/ghl-discord" };


/**
 * Los campos del formulario. Cada entrada lista los nombres con los que GHL
 * puede mandar ese dato: la query key, el nombre del campo o la pregunta
 * entera. La busqueda ignora mayusculas, acentos, puntos y espacios, asi que
 * "P.programa", "programa" y "Contact.Programa" caen todos en el mismo lugar.
 */
const FIELDS = {
  habilidad: [
    "habilidad",
    "contact.habilidad",
    "que habilidad ensenas en tu curso o mentoria",
  ],
  alumnos: [
    "c.alumnos",
    "alumnos",
    "contact.alumnos",
    "cuantos alumnos activos tienes hoy",
  ],
  precio: [
    "precio",
    "c.precio",
    "contact.precio",
    "a cuanto vendes tu programa hoy",
  ],
  programa: [
    "p.programa",
    "programa",
    "contact.programa",
    "que pasa hoy con tus alumnos cuando terminan tu programa",
  ],
  email: ["mail", "email", "contact.email"],
  telefono: ["telefono", "phone", "contact.phone"],
  cuando: [
    "cuando",
    "fecha",
    "appointment_start_time",
    "appointmentstarttime",
    "start_time",
    "starttime",
  ],
};

/** Rutas anidadas del payload de la cita, por si no se mapea "cuando" a mano. */
const RUTAS_CITA = [
  "calendar.startTime",
  "calendar.start_time",
  "appointment.startTime",
  "appointment.start_time",
];

const TIMEZONE = process.env.TIMEZONE || "America/Argentina/Buenos_Aires";

/**
 * Los dos escenarios. Cual se usa lo decide el parametro ?tipo= de la URL, asi
 * cada workflow de GHL apunta a su variante sin configurar nada extra.
 * Las plantillas admiten {nombre} y {cuando}.
 */
const ESCENARIOS = {
  agenda: {
    titulo: "\u{1F4C5} NUEVA AGENDA",
    color: 0xc96f45, // naranja FlowScale
    pie: "GoHighLevel · Sesión de Claridad",
    boton: "\u{1F4F2} Escribirle para confirmar",
    mostrarCuando: true,
    plantilla:
      process.env.WHATSAPP_AGENDA ||
      "Hola {nombre}, acá Samy. Te escribo para confirmar tu llamada agendada el {cuando}. " +
        "Avisame si confirmás así coordinamos la sesión y te explico en detalle cómo ayudarte " +
        "a elevar el valor y los resultados de tu programa.",
    plantillaSinFecha:
      "Hola {nombre}, acá Samy. Te escribo para confirmar tu llamada agendada. " +
      "Avisame si confirmás así coordinamos la sesión y te explico en detalle cómo ayudarte " +
      "a elevar el valor y los resultados de tu programa.",
  },
  noagenda: {
    titulo: "\u{1F4DD} COMPLETÓ EL SURVEY · SIN AGENDAR",
    color: 0xd9a441, // ambar, para distinguirlo de un vistazo
    pie: "GoHighLevel · Survey MKT Content",
    boton: "\u{1F4F2} Escribirle por WhatsApp",
    mostrarCuando: false,
    plantilla:
      process.env.WHATSAPP_SIN_AGENDA ||
      "Hola {nombre}, por acá Rolando del equipo de Samy Bruttman. Vimos que te registraste " +
        "para tener información sobre cómo instalar nuestros módulos de MKT en esta página: " +
        "https://start.flowscalely.com/mkt\n\n" +
        "¿Me querés contar un poco sobre qué problema tenés ahora con la adquisición de clientes, " +
        "tuya y de tus alumnos? Así veo cómo podemos ayudarte y te doy algunas recomendaciones.",
  },
};
ESCENARIOS.noagenda.plantillaSinFecha = ESCENARIOS.noagenda.plantilla;

/** Deja una clave comparable: sin acentos, sin signos, todo junto y en minuscula. */
const norm = (value) =>
  String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // marcas de acento que deja NFD
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

/** Indexa el payload de GHL por clave normalizada. Solo el primer nivel y
 *  customData: entrar en location o workflow traeria claves como "name" que
 *  pisarian las del contacto. */
function indexPayload(payload) {
  const index = new Map();
  const add = (obj) => {
    if (!obj || typeof obj !== "object") return;
    for (const [key, value] of Object.entries(obj)) {
      if (value === null || value === undefined || value === "") continue;
      if (typeof value === "object") continue;
      const clean = norm(key);
      if (!index.has(clean)) index.set(clean, String(value).trim());
    }
  };
  add(payload);
  add(payload?.customData);
  add(payload?.custom_data);
  return index;
}

/** Busca el primer nombre que exista. Si ninguno coincide exacto, prueba por
 *  prefijo y sufijo (del nombre mas especifico al mas generico) para tolerar
 *  variantes como "contact.programa" o que GHL mande la pregunta entera como
 *  clave. Comparar por prefijo y sufijo en vez de "contiene" evita que
 *  "programa" enganche la respuesta de "¿A cuanto vendes tu programa hoy?". */
function pick(index, names) {
  for (const name of names) {
    const value = index.get(norm(name));
    if (value) return value;
  }
  const targets = names.map(norm).sort((a, b) => b.length - a.length);
  for (const target of targets) {
    if (target.length < 6) continue;
    for (const [key, value] of index) {
      if (key.startsWith(target) || key.endsWith(target)) return value;
      if (key.length >= 6 && (target.startsWith(key) || target.endsWith(key))) return value;
    }
  }
  return "";
}

const clip = (text, max) =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;

/** Discord rechaza los campos vacios, y corta en 256 / 1024 caracteres. */
const field = (name, value, inline = false) => ({
  name: clip(name, 256),
  value: clip(value || "—", 1024),
  inline,
});

/** Lee una ruta anidada del payload, ej. "calendar.startTime". */
function leerRuta(payload, ruta) {
  const valor = ruta
    .split(".")
    .reduce((acc, clave) => (acc == null ? acc : acc[clave]), payload);
  return typeof valor === "string" ? valor.trim() : "";
}

/** Solo reformateamos lo que es inequivocamente una fecha: ISO o epoch.
 *  new Date() es tan permisivo que "jueves que viene a las 3" le devuelve una
 *  fecha valida e inventada, y mostrar una fecha equivocada es peor que
 *  mostrar el texto crudo. */
const ES_FECHA = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/;
const ES_EPOCH = /^\d{10}(\d{3})?$/;

function formatearFecha(valor) {
  if (!valor) return "";
  const texto = String(valor).trim();
  if (!ES_FECHA.test(texto) && !ES_EPOCH.test(texto)) return texto;

  const fecha = new Date(ES_EPOCH.test(texto) ? Number(texto.padEnd(13, "0")) : texto);
  if (Number.isNaN(fecha.getTime())) return texto;

  const formateada = new Intl.DateTimeFormat("es-AR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: TIMEZONE,
  }).format(fecha);

  // "viernes, 4 de septiembre, 15:00" -> "viernes 4 de septiembre, 15:00 hs"
  return `${formateada.replace(",", "")} hs`;
}

/** encodeURIComponent deja los parentesis sin escapar y esos rompen el link
 *  markdown del embed, asi que los codificamos a mano. */
const encodeParaLink = (texto) =>
  encodeURIComponent(texto).replace(/\(/g, "%28").replace(/\)/g, "%29");

/** Arma el link de WhatsApp con el mensaje precargado. wa.me necesita el
 *  numero completo con codigo de pais y solo digitos. */
function linkWhatsApp(escenario, telefono, nombre, cuando) {
  const digitos = String(telefono).replace(/\D/g, "").replace(/^00/, "");
  if (digitos.length < 8) return "";

  const plantilla = cuando ? escenario.plantilla : escenario.plantillaSinFecha;
  const mensaje = plantilla
    .replaceAll("{nombre}", nombre || "")
    .replaceAll("{cuando}", cuando || "");

  return `https://wa.me/${digitos}?text=${encodeParaLink(mensaje)}`;
}

/** Que escenario mostrar. Lo manda el ?tipo= de la URL (un workflow de GHL por
 *  variante); si no viene, lo inferimos de si hay fecha de cita. */
function detectarEscenario(url, index, cuando) {
  const crudo = norm(new URL(url).searchParams.get("tipo") || pick(index, ["tipo"]) || "");
  if (crudo === "agenda" || crudo === "si") return ESCENARIOS.agenda;
  if (crudo === "noagenda" || crudo === "sinagenda" || crudo === "no") {
    return ESCENARIOS.noagenda;
  }
  return cuando ? ESCENARIOS.agenda : ESCENARIOS.noagenda;
}

async function readBody(req) {
  const type = req.headers.get("content-type") || "";
  const raw = await req.text();
  if (type.includes("application/x-www-form-urlencoded")) {
    return Object.fromEntries(new URLSearchParams(raw));
  }
  try {
    return JSON.parse(raw);
  } catch {
    return { raw };
  }
}

const post = (url, body) =>
  fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

/** Discord permite ~30 mensajes por minuto por webhook. Si contesta 429 nos
 *  dice cuanto esperar; reintentamos una sola vez para no colgar la funcion. */
async function sendToDiscord(url, body) {
  let res = await post(url, body);
  if (res.status === 429) {
    const data = await res.json().catch(() => ({}));
    const wait = Math.min(Number(data.retry_after) || 1, 5);
    console.warn(`Discord pidio esperar ${wait}s, reintentando.`);
    await new Promise((resolve) => setTimeout(resolve, wait * 1000));
    res = await post(url, body);
  }
  return res;
}

export default async (req) => {
  if (req.method === "GET") {
    return new Response("ok, el endpoint esta vivo y esperando el webhook de GHL");
  }
  if (req.method !== "POST") {
    return new Response("method not allowed", { status: 405 });
  }

  const discordUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!discordUrl) {
    console.error("Falta la variable DISCORD_WEBHOOK_URL.");
    return new Response("missing DISCORD_WEBHOOK_URL", { status: 500 });
  }

  const payload = await readBody(req);
  // Queda en los logs de Netlify: es la forma de ver con que nombre exacto
  // llego cada campo personalizado la primera vez que probas el workflow.
  console.log("Payload de GHL:", JSON.stringify(payload));

  const index = indexPayload(payload);
  const nombre =
    pick(index, ["nombre", "full_name", "fullname", "contact_name"]) ||
    [pick(index, ["first_name"]), pick(index, ["last_name"])]
      .filter(Boolean)
      .join(" ");

  const telefono = pick(index, FIELDS.telefono);
  const cuando = formatearFecha(
    pick(index, FIELDS.cuando) ||
      RUTAS_CITA.map((ruta) => leerRuta(payload, ruta)).find(Boolean) ||
      ""
  );
  const escenario = detectarEscenario(req.url, index, cuando);
  const whatsapp = linkWhatsApp(escenario, telefono, nombre, cuando);
  const preguntas = [
    field("1. ¿Qué habilidad enseña?", pick(index, FIELDS.habilidad)),
    field("2. ¿Cuántos alumnos activos?", pick(index, FIELDS.alumnos)),
    field("3. ¿A cuánto vende su programa?", pick(index, FIELDS.precio)),
    field("4. ¿Qué pasa con sus alumnos cuando terminan?", pick(index, FIELDS.programa)),
  ];

  const body = {
    ...(process.env.DISCORD_MENTION ? { content: process.env.DISCORD_MENTION } : {}),
    embeds: [
      {
        title: escenario.titulo,
        color: escenario.color,
        fields: [
          field("Nombre", nombre, true),
          field("Mail", pick(index, FIELDS.email), true),
          field("Teléfono", telefono, true),
          ...(escenario.mostrarCuando && cuando
            ? [field("Cuándo es la llamada", cuando)]
            : []),
          ...preguntas,
          ...(whatsapp
            ? [field("WhatsApp", `[${escenario.boton}](${whatsapp})`)]
            : []),
        ],
        timestamp: new Date().toISOString(),
        footer: { text: escenario.pie },
      },
    ],
  };

  const res = await sendToDiscord(discordUrl, body);
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.error("Discord rechazo el mensaje:", res.status, detail);
    return new Response("discord error", { status: 502 });
  }

  return new Response("ok");
};
