# Landing — Configuración del Dashboard

Landing de una sola página (`index.html`) con los pasos para que el cliente ponga a andar su dashboard.

## Para dejarla lista

1. **El zip del dashboard:** el botón del paso 1 apunta a Google Drive (`https://drive.google.com/uc?export=download&id=1u5t9XGNQZjLthAleTf07PHDr5F6xUGrt`). Para cambiar el archivo, actualizá ese link en `index.html`.
2. **El Loom:** cuando tengas el video, abrí `index.html`, buscá el bloque `loom-frame` (al final) y reemplazá el placeholder por:

   ```html
   <iframe src="https://www.loom.com/embed/TU_ID_DE_LOOM" allowfullscreen></iframe>
   ```

## Pasos que muestra la landing

1. Descargá tu dashboard (.zip)
2. Descomprimí la carpeta
3. Entrá a Netlify y creá tu cuenta
4. Creá un proyecto y subí la carpeta
5. Exportá tus datos de Meta (Meta Business → Contenido → Exportar datos) y subilos al dashboard

## Publicar

Es HTML puro, sin build. Subí la carpeta a Netlify (o abrí `index.html` directo en el navegador para probar).

---

## Integración GHL → Discord

Este repo también incluye la función que avisa en Discord cuando alguien agenda
desde el formulario de MKT Content (`netlify/functions/ghl-discord.mjs`). Los
pasos para dejarla andando están en [`GHL-DISCORD.md`](GHL-DISCORD.md).
