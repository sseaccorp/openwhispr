# Flosi — validación pendiente en Windows 11

Referencia fija: OpenWhispr oficial v1.10.4 frente al commit `ba6d61820b4c56d7b08012c61c2ae6b43f3152f3` del fork `sseaccorp/openwhispr`, rama `codex/flosi-baseline`. Este documento es un procedimiento: **estas pruebas Windows todavía no se han ejecutado**. Los resultados cloud están en [FLOSI_BASELINE.md](FLOSI_BASELINE.md).

## Aislamiento obligatorio para no afectar a la instalación oficial

Usar una **cuenta local de Windows dedicada a QA**, sin datos OpenWhispr previos, en el mismo equipo físico cuando se mida GPU/micrófono. Una VM separada sirve para instalación y fallos; no certifica CUDA, dispositivos ni latencia del equipo físico. Mantener intacta la cuenta del usuario y su instalación oficial. Ejecutar una aplicación a la vez por sesión; no comparar con ambos hooks de teclado activos.

`OPENWHISPR_CHANNEL=development` aísla `userData` como `%APPDATA%\OpenWhispr-development`, usa protocolo de desarrollo y AppUserModelId por canal. **No basta para aislar todo en la misma cuenta**: `secretCrypto.js` mantiene un servicio de keyring fijo y varios gestores usan el home/cache directamente. `modelDirUtils.js` puede **mover** modelos del cache antiguo al fijar `OPENWHISPR_CACHE_ROOT`; no probar esa opción sobre el perfil oficial. No enlazar, mover ni borrar caches oficiales ni importar sus claves/transcripciones. No instalar un NSIS con la identidad OpenWhispr encima de la instalación oficial.

En la cuenta QA, usar checkout y descargas propios en una ruta ASCII sin espacios, por ejemplo `C:\FlosiQA\openwhispr`. No activar inicio automático, no iniciar sesión en servicios OpenWhispr y mantener las funciones cloud sin configurar durante la aceptación local. La ausencia de cuenta debe verificarse con el flujo Local Mode existente, sin alterar sus restricciones.

## Preparación reproducible

Requisitos: Windows 11 x64 actualizado, Git, Node 24 (ver `.nvmrc`), espacio para modelos, Visual Studio Build Tools con C++/Windows SDK o MinGW compatible para los helpers Windows. Registrar versión de Windows, CPU, RAM, GPU, driver, firmware/dispositivo de audio, plan de energía y versión npm. No desactivar Defender, SmartScreen, TLS, sandbox o verificaciones de checksum para instalar/ejecutar.

En PowerShell, dentro de la cuenta QA:

```powershell
git clone https://github.com/sseaccorp/openwhispr.git C:\FlosiQA\openwhispr
Set-Location C:\FlosiQA\openwhispr
git remote -v
git status --short
git cat-file -t ba6d61820b4c56d7b08012c61c2ae6b43f3152f3
# Si la rama no se ha publicado, crearla en este commit y aplicar el parche documental entregado.
git switch -c codex/flosi-baseline ba6d61820b4c56d7b08012c61c2ae6b43f3152f3
node --version
npm --version
npm ci
npm run quality-check
npm run i18n:check
npm audit --audit-level=high
```

Si ya existe la rama, inspeccionarla y usar `git switch codex/flosi-baseline`; no usar `-C`, `reset --hard` ni sobrescribir trabajo. Esta auditoría no publicó la rama. El lockfile fija Electron 41.10.7, better-sqlite3 12.9.0 y ONNX Runtime Node 1.27.0; no instalar versiones «latest» ni regenerar el lockfile para reproducir la baseline.

Para tests Node y ejecución Electron, SQLite necesita **dos ABIs distintos**. Parar todos los procesos antes de reconstruir. Primero los tests:

```powershell
npm rebuild better-sqlite3
$env:REQUIRE_DB_TESTS = '1'
node --import tsx --test --test-concurrency=4 "test/**/*.test.js"
Remove-Item Env:REQUIRE_DB_TESTS
npm run build:renderer
# Restaurar la ABI Electron antes de arrancar el escritorio:
& .\node_modules\.bin\electron-builder.cmd install-app-deps
```

Preparar artefactos con los scripts originales, registrando stdout/stderr y códigos de salida:

```powershell
npm run compile:native
npm run download:whisper-cpp
npm run download:llama-server
npm run download:sherpa-onnx
npm run download:windows-fast-paste
npm run download:windows-key-listener
npm run download:windows-mic-listener
npm run download:windows-system-audio-helper
npm run download:nircmd
npm run download:meeting-aec-helper
npm run download:qdrant
npm run download:embedding-model -- --for-build
npm run download:whisper-vad-model
npm run download:diarization-models -- --output-dir resources/bin/diarization-models
$env:NODE_ENV = 'development'
$env:OPENWHISPR_CHANNEL = 'development'
npm run dev
```

`dev` ejecuta también prepasos con efectos secundarios: compila helpers y descarga dependencias; los pesos de ASR/LLM se seleccionan/descargan en la aplicación. Las fuentes comerciales son opcionales, sin acceso deben funcionar las fuentes de fallback originales. No usar tokens de OpenWhispr para forzar ese acceso. No ejecutar workflows release ni `build --publish`.

Si aparece HTTP 403, registrar URL **sin query/token**, host de redirección, hora, método, código y cuerpo de error sanitizado. Separar denegación del proxy, rate limit GitHub, falta de permiso y acceso gated de HF; tramitar acceso por la configuración soportada. No usar `strict-ssl=false`, `NODE_TLS_REJECT_UNAUTHORIZED=0`, `--no-sandbox`, bypass del proxy, otro modelo o un stub del motor como solución.

## Matriz manual de aceptación

| Área                            | Procedimiento y evidencia que guardar                                                                                                                                                                            | Aceptación propuesta                                                                                                                                                                                       |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Arranque y privacidad           | Abrir local sin cuenta; anotar rutas de DB/audio/modelos, procesos sidecar, settings y backend de claves; cerrar/reabrir. Revisar conexiones por proceso con herramientas Windows en el perfil QA.               | Perfil oficial intacto; persistencia QA correcta; sin envío de audio/texto/capturas cuando ASR, cleanup, traducción y asistente se configuran todos como locales. Descargas iniciales documentadas aparte. |
| Micrófono                       | Permitir/denegar/restaurar permiso; mic interno/USB/Bluetooth; silencio, mute, cambio de dispositivo predeterminado, desconexión a mitad de dictado, reconexión.                                                 | Inicio/parada fiables, error recuperable y sin capturar indefinidamente; no perder dictado silenciosamente ni atribuir éxito a audio vacío.                                                                |
| Atajos                          | 100 ciclos tap y 100 hold, modificadores, ES/EN, foco en otras apps, tecla retenida, repetición, colisión con otra app, pantalla bloqueada y resume. Comprobar voice assistant/translation/meeting por separado. | Ningún dictado duplicado, tecla atascada o grabación fuera del intervalo solicitado; fallo de registro visible y rollback conservado.                                                                      |
| Pegado                          | Notepad, Word, Outlook, Chrome/Edge, VS Code y Windows Terminal; texto seleccionado, caret, cambio de foco, rich clipboard e imagen, dictado consecutivo, app elevada.                                           | Texto correcto una vez en destino correcto; portapapeles restaurado según comportamiento original; limitaciones de privilegios reportadas, sin elevar toda la app como parche.                             |
| ASR CPU                         | Whisper tiny/base y modelo elegido por usuario, Parakeet v3 y Orukeet fijados; español/inglés; silencio, ruido, nombres, cifras, dictado corto/largo.                                                            | Comparación con los mismos audios y parámetros; datos brutos y procesados separados. No comparar un modelo EN con español como si fuera multilingüe.                                                       |
| GPU                             | NVIDIA CUDA en hardware físico y, si hay hardware, AMD/Intel Vulkan; mismo modelo que CPU; driver/backend, VRAM y fallo de arranque.                                                                             | Backend confirmado en logs; medir ventaja y uso real; fallback CPU produce resultado y aviso sin perder audio. No afirmar GPU por ver una GPU detectada.                                                   |
| Cleanup, traducción y asistente | Mismo GGUF, cuantización, hash, prompt y settings; ES↔EN; respuesta vacía, salida inválida, cancelación; edición seleccionada y herramientas locales.                                                            | No corromper ni borrar el texto de entrada; nombres y puntuación evaluados; no ruta cloud implícita. Herramientas evaluadas individualmente.                                                               |
| Reuniones y hablantes           | Teams y Zoom, 2–4 hablantes, altavoces/auriculares, mic+loopback, superposición, pausa/resume, cambio de salida, reconexión y finalización inesperada.                                                           | Audio remoto capturado, sin duplicar eco, línea temporal estable, guardado recuperable; etiquetas/huellas evaluadas con verdad de terreno.                                                                 |
| Archivos y notas                | WAV/MP3/M4A/MP4, archivo vacío/corrupto, lote, archivo de 60 min, cancelar; editar notas, FTS, búsqueda semántica, detener Qdrant; exportar MD/TXT/SRT/JSON.                                                     | Progreso/cancelación útiles; avisar pérdida parcial o diarización fallida; búsqueda FTS disponible si falla semántica; tiempos y UTF-8 correctos.                                                          |
| Persistencia y estabilidad      | 2 h continuas, 8 h de uso intermitente, 500 dictados; suspensión/reinicio; copia de DB con WAL usando backup consistente, caída controlada del sidecar y espacio insuficiente en disco QA.                       | Sin fuga creciente, DB corrupta, procesos huérfanos ni pérdida silenciosa; conservar evidencia de recuperación. No matar procesos con datos oficiales.                                                     |
| Distribución, fase posterior    | En VM limpia: instalador firmado propio, instalación/upgrade/downgrade previsto/desinstalación, updater propio, inicio automático y coexistencia.                                                                | Pendiente hasta tener identidad/feed/certificado Flosi y cierre legal. No usar identidad ni firma del editor original.                                                                                     |

## Protocolo de comparación y métricas

1. Registrar versión oficial 1.10.4 y hash de instalador/ejecutable; identificar versiones/hashes de los sidecars **realmente instalados**. El source v1.10.4 no demuestra por sí solo que los artefactos descargados hoy sean iguales a los del instalador oficial. Guardar exportación sanitizada de settings y prompts, idiomas, cuantización, threads, VAD, backend, flags, temperaturas y versiones de modelo. Cualquier diferencia invalida una afirmación de equivalencia exacta.
2. Corpus inicial propuesto: 40 clips ES y 40 EN (al menos 30 min por idioma), más 10 bilingües y 10 de silencio/ruido. Incluir acentos, nombres propios, puntuación, números y habla rápida. Usar audio propio/licenciado, transcripción de referencia corregida por humanos y SHA-256 por archivo. Para reuniones, 3 grabaciones de 20 min con segmentos y hablantes anotados, incluyendo solapamientos.
3. Ejecutar el mismo archivo mediante la importación de ambas aplicaciones para aislar el ASR. Para el dictado de escritorio, reproducir el mismo audio mediante una fuente de audio controlada, con nivel/frecuencia/micrófono idénticos, y añadir voz humana real como prueba distinta. No equiparar importación a todo el flujo de dictado. Alternar orden A/B; 5 repeticiones calientes y 3 frías por configuración, cerrando procesos entre condiciones frías. No mezclar CPU y GPU ni cache caliente y frío.
4. Medir WER `(sustituciones + borrados + inserciones) / palabras de referencia`, CER, acierto de nombres/cifras y F1 de puntuación. Conservar resultado literal y normalizado: case/acento/puntuación pueden ocultar regresiones si se eliminan de la única métrica. Cleanup/traducción se evalúan aparte, con revisión humana de fidelidad, omisiones y alucinaciones.
5. Tiempos: inicio de captura, fin de voz, primer parcial, resultado ASR, fin de cleanup/traducción y pegado confirmado. Reportar mediana/p95 y real-time factor; si un hito no tiene instrumentación fiable, marcarlo no medido. PowerShell/PerfMon/Task Manager o WPR pueden registrar CPU, RAM privada/working set, handles y procesos; `nvidia-smi` puede registrar uso/VRAM si el driver lo soporta. Incluir todos los sidecars. Reportar idle/cold/warm separados.
6. Diarización: DER/JER, error de asignación por hablante y consistencia de huellas entre sesiones; acordar cómo se trata el solapamiento y el collar temporal antes de medir. Las etiquetas plausibles visualmente no prueban exactitud.
7. Criterios iniciales a ratificar antes de medir: cero pérdida/corrupción de datos, cero duplicados en los 200 ciclos de atajo, WER no peor en más de 1 punto porcentual absoluto, p95 de fin-de-voz a pegado no peor en más del 10% y memoria estable sin crecimiento sostenido entre rondas. Conservar intervalos/variación; estos umbrales son propuestas, **no resultados logrados**. Para un LLM no determinista usar distribuciones y revisión pareada, no igualdad byte a byte.

Formato mínimo de registro: `run_id, app_commit, binary_sha256, model_sha256, audio_sha256, language, settings_hash, backend, cold_warm, transcript_raw, transcript_final, WER, CER, punctuation_F1, name_accuracy, timings_ms, cpu, ram_peak, vram_peak, hotkey_result, paste_result, errors, evidence_path`. Guardar corpus y contenido sensible fuera del repositorio público. Publicar únicamente agregados o datos sintéticos autorizados.

## Límites de la evidencia cloud

Las pruebas unitarias/DOM y HTTP locales validan orquestación y contratos; una prueba de binario en Linux valida solo ese artefacto Linux. Ninguna verifica micrófono Windows, WASAPI real, CUDA/NVIDIA, foco/portapapeles de aplicaciones Windows, firma, SmartScreen, NSIS ni calidad de sesiones largas. Esas filas siguen pendientes hasta adjuntar un registro de ejecución Windows con hardware y resultados.
