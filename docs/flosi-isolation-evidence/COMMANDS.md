# Evidencia de ejecución Flosi QA

Comandos, cwd, timestamps UTC, duración y exit code: `RESULTS.json` y `VERIFICATION_LOGS.zip`.

- `full-stable`: suite completa con 4 workers aprobada; `full-final` es el intento con 8 workers que falló, no un resultado final aprobado.
- `applied-paths-final`: 73 casos QA tras las últimas restricciones, aprobados.
- `quality-final-tree` y `renderer-final`: comprobaciones generales aprobadas; helpers ignorados por configuración heredada también se lintaron con `--config eslint.config.js --no-ignore`.
- `qa-entry-negative` y `platform-negative`: exit 1 esperado como prueba negativa de guardas.
- `early-regression`, `isolation-targeted`, `quality` y `native-egress-guards`: fallos iniciales corregidos sin cambiar tests previos ni motores.
- `powershell-code-final`: 12 bloques/scripts analizados; `proof-synthetic`: inventario con datos sintéticos ejecutado en Linux. No son APIs Windows.
- Los intentos de cancelación no enviaron señales a ningún PID; el intento OOM terminó con exit 1 del runner.
- El primer ensamblado de evidencia referenciaba SyncService.js; el fuente es SyncService.ts. Se corrigió y completó el archivo de invariantes y el zip antes de publicar. No era un fallo del producto o de la suite.

Los archives Windows se verificaron/extraídos, no ejecutados. Modelos/CUDA no descargados en esta fase cloud. El zip solo contiene texto de pruebas y scripts: no incluye DLL/EXE, pesos ni datos/credenciales personales. Los comandos de lectura y revisión Git se resumen por evidencias de invariantes; no se imprime el entorno ni credenciales.
