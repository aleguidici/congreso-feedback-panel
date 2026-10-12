# Mejora visual del panel del Congreso

Este paquete modifica únicamente el frontend público. No incluye cambios a `server.js`, credenciales ni al script Python.

## Cómo actualizar GitHub
1. Descomprimir el ZIP.
2. En el repositorio `congreso-feedback-panel`, reemplazar estos tres archivos manteniendo las carpetas:
   - `public/index.html`
   - `public/app.js`
   - `public/style.css`
3. Hacer commit en la rama `main`.
4. Esperar que Hostinger complete el nuevo despliegue y recargar el panel con Ctrl+F5.

## Qué cambia
- Renderiza de forma segura los elementos Markdown más habituales de Gemini: títulos, negritas, cursivas, listas, citas y código.
- Separa visualmente resumen general, contexto de la charla y análisis reciente.
- Oculta las tarjetas de temas/preguntas/dificultades cuando la API todavía no envía datos estructurados, para no mostrar tarjetas vacías.
- No cambia el script Python, el endpoint de publicación ni la base de datos.

La revisión del título/contexto de la charla y la extracción de categorías se hará en una fase posterior.
