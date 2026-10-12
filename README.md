# Congreso Feedback Panel

Panel Node.js para resúmenes públicos y administración protegida.

## Hostinger
- Runtime: Node.js
- Instalación: `npm install`
- Inicio: `npm start`
- Puerto: `process.env.PORT`

Configurar variables de entorno en Hostinger: `PANEL_USERNAME`, `PANEL_PASSWORD` (mínimo 14 caracteres), `SESSION_SECRET` (mínimo 32 caracteres aleatorios), `PANEL_PUBLISH_TOKEN` (secreto independiente y largo) y `COOKIE_SECURE=1` con HTTPS.

No subir `.env`, claves API, bases de datos ni resultados privados.

## Rutas
- `/`: panel público
- `/admin`: login y administración
- `/health`: comprobación básica
- `/api/public-summary`: resumen público
- `POST /api/publish`: recibe informes Python mediante `Authorization: Bearer <PANEL_PUBLISH_TOKEN>`
- `/api/admin/status`: estado privado

## Importante
Es el esqueleto inicial. La publicación autenticada de informes desde Python está preparada, pero hay que configurar `PANEL_PUBLISH_TOKEN` en Hostinger y en el `.env` local. Los logs y los controles remotos aún no están conectados. No exponer controles técnicos hasta completar esa integración y revisar la seguridad de producción.
