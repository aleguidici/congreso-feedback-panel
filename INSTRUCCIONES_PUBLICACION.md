# Activar publicación de informes en Hostinger

## 1. Variables en Hostinger
Además de las cuatro variables actuales, agregá:
- `PANEL_PUBLISH_TOKEN`: un secreto largo, aleatorio y exclusivo para esta conexión.

## 2. Variables en el `.env` local de Windows
Agregá estas dos líneas (con el mismo token que configuraste en Hostinger):
```
PANEL_PUBLISH_URL=https://estadisticascongreso.guacurari.com/api/publish
PANEL_PUBLISH_TOKEN=PEGAR_AQUI_EL_MISMO_TOKEN_SECRETO
```
No compartas ni subas el `.env` a GitHub.

## 3. Actualizar GitHub
Subí los archivos del proyecto Node.js incluidos en este paquete a la raíz del repositorio `congreso-feedback-panel`, reemplazando los archivos que tienen el mismo nombre. No subas el script Python ni el `.env` a GitHub. Commit a `main` y esperá que Hostinger termine el nuevo deploy.

## 4. Actualizar el script Python
Hacé una copia de seguridad de tu `congreso_integrado.py`. Luego reemplazalo por `congreso_integrado_publicacion.py` (podés renombrar la copia a `congreso_integrado.py`). Conservá tu `congreso.db`, carpeta `audio_transcripcion`, `.env` y entorno virtual.
El script modificado agrega la publicación al final de cada análisis y no detiene el procesamiento si falla la conexión.

## 5. Verificación
Cuando se ejecute el análisis de Gemini, la consola debe mostrar:
`[PANEL] Informe publicado correctamente (200).`
Si falla, revisá el mensaje `[PANEL]` sin compartir secretos.

Nota: la versión actual publica el resumen general, el feedback reciente y la charla actual. Las tarjetas de temas/preguntas/problemas se dejan sin datos estructurados porque Gemini devuelve texto libre; no se inventan categorías. El análisis completo aparece en “Último análisis”. La administración aún no tiene controles remotos del proceso Python.
