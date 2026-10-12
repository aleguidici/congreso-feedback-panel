# Historial con nuevas actualizaciones arriba

Reemplazá en el repositorio `congreso-feedback-panel`:
- `server.js` (raíz)
- `public/index.html`
- `public/app.js`
- `public/style.css`

Hacé commit en `main` y esperá el redeploy de Hostinger.

## Comportamiento
- Los informes más recientes aparecen arriba.
- Cuando llega uno nuevo, el panel lo agrega arriba pero conserva la posición visual del lector.
- Aparece un botón flotante centrado: **Hay nuevas actualizaciones**.
- Al pulsarlo, la página sube suavemente al informe más reciente y abre su contenido.
- El botón desaparece al pulsarlo.
- El historial del servidor conserva hasta 300 informes.

No reemplaces `package.json` ni modifiques las variables de entorno o el script Python. No hagas este despliegue durante el evento sin antes respaldar el historial, porque los archivos de datos pueden depender del almacenamiento persistente de Hostinger.
