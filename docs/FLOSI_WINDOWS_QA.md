# Flosi — validación de Windows 11 / RTX 3050 Ti de 4 GB

Actualización: 29 de octubre de 2026. Sintaxis de los cinco bloques comprobada con PowerShell 7.6.0 en Linux y paso de argumentos npm comprobado por simulación; esto **no verifica PowerShell/OS Windows, hardware ni la ejecución de esos comandos Windows**. Referencia oficial v1.10.4 frente a la candidata del fork `sseaccorp/openwhispr`, rama publicada `codex/flosi-baseline`, [PR #1](https://github.com/sseaccorp/openwhispr/pull/1). Se preservan fuente `ba6d61820b4c56d7b08012c61c2ae6b43f3152f3` y auditoría `300375424f8a2f8e0c8a602a27cab9ca9637620a`. **Estas pruebas Windows todavía no se han ejecutado.** Los avisos de seguridad pendientes, incluido Electron, están en [FLOSI_SECURITY_REVIEW.md](FLOSI_SECURITY_REVIEW.md): esta candidata es para QA controlada con datos ficticios, no uso cotidiano con cuentas sensibles ni distribución comercial.

## Aislamiento obligatorio para no afectar a la instalación oficial

Para separación **completa** respecto a la instalación real, usar una **instancia Windows de QA independiente**: otro Windows arrancado en el mismo hardware o un equipo separado. Una VM solo valida CUDA si tiene acceso real a la NVIDIA comprobado dentro de ella; Windows Sandbox/vGPU genérica no lo demuestra. La preparación de SSD/VHD/boot o passthrough corresponde a IT con autorización: no se incluyen comandos destructivos ni se cambia la máquina del usuario desde Codex.

Dentro de esa instancia, usar cuenta local estándar **FlosiQA**, perfil ASCII `C:\Users\FlosiQA`, sin datos previos. La referencia oficial puede probarse en otra cuenta **FlosiRef**, con sesiones exclusivas. Mantener fuera de la prueba el Windows/perfil real. Descargar pesos independientemente; no mover, enlazar o importar modelos, caches, credenciales o DB oficiales. Una aplicación a la vez, sin ambos hooks activos.

Una cuenta QA en el mismo Windows real solo da **aislamiento operativo condicionado**, no separación total de kernel, puertos loopback o directorios globales. Exige las guardas siguientes, rutas privadas y cerrar sesión de los demás usuarios, no solo cambiar de usuario. No afirmar aislamiento completo por cambiar variables.

`OPENWHISPR_CHANNEL=development` aísla `userData` como `%APPDATA%\OpenWhispr-development`, usa protocolo de desarrollo y AppUserModelId por canal. **No basta para aislar todo en la misma cuenta**: `secretCrypto.js` mantiene un servicio de keyring fijo y varios gestores usan el home/cache directamente. `modelDirUtils.js` puede **mover** modelos del cache antiguo al fijar `OPENWHISPR_CACHE_ROOT`; no probar esa opción sobre el perfil oficial. No enlazar, mover ni borrar caches oficiales ni importar sus claves/transcripciones. No instalar un NSIS con la identidad OpenWhispr encima de la instalación oficial.

Además, `safeTempDir.js` puede usar `ProgramData\OpenWhispr\temp` si TEMP tiene espacios/no ASCII, y gestores de embeddings/Qdrant/yt-dlp usan el perfil directamente. Usar el TEMP privado de la guarda. No falsificar `HOME`, `USERPROFILE`, `APPDATA`, `LOCALAPPDATA`, `ProgramData` o `SystemDrive`; no copiar claves maestras. Loopback sin autenticación tampoco constituye una frontera entre usuarios del mismo OS.

No activar inicio automático, cuentas, cloud backup, provider keys o contexto de pantalla real. Usar Local Mode sin cambiar sus restricciones, y comprobar que cleanup, traducción y asistente son locales o están desactivados: ASR local no garantiza postprocesado local. Tras las descargas necesarias, comparar offline cuando sea viable; eso limita tráfico del ensayo, pero no corrige el aviso TLS de Electron.

## Preparación reproducible

Requisitos: Windows 11 x64 actualizado, Git, Node 24 (ver `.nvmrc`), espacio para modelos, Visual Studio Build Tools con C++/Windows SDK o MinGW compatible para los helpers Windows. Registrar versión de Windows, CPU, RAM, GPU, driver, firmware/dispositivo de audio, plan de energía y versión npm. No desactivar Defender, SmartScreen, TLS, sandbox o verificaciones de checksum para instalar/ejecutar.

En PowerShell de FlosiQA, sin elevar la aplicación. `npm.cmd` evita depender de la ExecutionPolicy de `npm.ps1`; no rebajar esa política. Primera preparación:

```powershell
$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT') { throw 'Se requiere Windows.' }
$QaIdentity = [Security.Principal.WindowsIdentity]::GetCurrent()
$QaProfilePath = [Environment]::GetFolderPath('UserProfile')
if ($QaIdentity.Name.Split('\')[-1] -ne 'FlosiQA' -or
    $QaProfilePath -ne 'C:\Users\FlosiQA' -or $QaProfilePath -match '[^\x21-\x7E]') {
    throw 'Usar la cuenta QA real y su perfil ASCII, no variables que simulen otro perfil.'
}
if ($env:OPENWHISPR_CACHE_ROOT) { throw 'Override de cache heredado: revisar en una sesión QA limpia.' }
$QaInheritedNames = 'GH_TOKEN','GITHUB_TOKEN','OPENAI_API_KEY','ANTHROPIC_API_KEY',
    'GROQ_API_KEY','GEMINI_API_KEY','HF_TOKEN','OPENWHISPR_API_URL','VITE_OPENWHISPR_API_URL'
foreach ($QaEnvName in $QaInheritedNames) {
    if ([Environment]::GetEnvironmentVariable($QaEnvName)) {
        throw "Configuración externa heredada: $QaEnvName. No imprimir su valor."
    }
}
$QaRoot = Join-Path $QaProfilePath 'FlosiQA'
$QaLogs = Join-Path $QaRoot 'logs'
$QaTemp = Join-Path $env:LOCALAPPDATA 'FlosiQA\Temp'
New-Item -ItemType Directory -Force -Path $QaRoot,$QaLogs,$QaTemp | Out-Null
if ($QaTemp -match '[^\x21-\x7E]') { throw 'TEMP debe ser privado y ASCII.' }
$env:TEMP = $QaTemp
$env:TMP = $QaTemp
$env:npm_config_cache = Join-Path $env:LOCALAPPDATA 'FlosiQA\npm-cache'
$env:NODE_ENV = 'development'
$env:OPENWHISPR_CHANNEL = 'development'
$QaOtherProcesses = Get-Process -ErrorAction SilentlyContinue | Where-Object {
    $_.ProcessName -match '^(OpenWhispr|electron|whisper-server.*|llama-server.*|sherpa-onnx.*|qdrant.*|windows-key-listener|windows-mic-listener|windows-system-audio-helper)$'
}
if ($QaOtherProcesses) {
    $QaOtherProcesses | Select-Object Id,ProcessName
    throw 'Cerrar apps/sidecars desde su propia sesión; no matar procesos ajenos.'
}
quser
whoami /user
$QaSource = Join-Path $QaRoot 'openwhispr'
if (Test-Path $QaSource) { throw 'El destino existe. Revisar o elegir checkout nuevo; no sobrescribir.' }
git clone --no-checkout https://github.com/sseaccorp/openwhispr.git $QaSource
if ($LASTEXITCODE -ne 0) { throw 'Falló clone.' }
Set-Location $QaSource
git fetch origin codex/flosi-baseline
if ($LASTEXITCODE -ne 0) { throw 'Falló fetch.' }
# Comprobar que este SHA coincide con el commit de preparación revisado en el PR.
$QaCommit = (git rev-parse origin/codex/flosi-baseline).Trim()
if ($QaCommit -notmatch '^[0-9a-f]{40}$') { throw 'SHA no válido.' }
git switch --detach $QaCommit
if ($LASTEXITCODE -ne 0) { throw 'Falló checkout del SHA exacto.' }
git merge-base --is-ancestor 300375424f8a2f8e0c8a602a27cab9ca9637620a HEAD
if ($LASTEXITCODE -ne 0) { throw 'No conserva la auditoría.' }
if (git status --porcelain) { throw 'El checkout no está limpio.' }
if ((git remote get-url origin).Trim() -ne 'https://github.com/sseaccorp/openwhispr.git') { throw 'Remoto inesperado.' }
$QaExpectedLock = '9dfb56d340c4e7490ea88a0d819dd38ad273a788ea10ab0431d913369ea97a92'
if ((Get-FileHash package-lock.json -Algorithm SHA256).Hash.ToLowerInvariant() -ne $QaExpectedLock) { throw 'Lockfile distinto al revisado.' }
$QaCommit | Set-Content (Join-Path $QaLogs 'source-commit.txt')
git remote -v
git status --short
node --version
npm.cmd --version
function Invoke-QaNpm {
    param([Parameter(ValueFromRemainingArguments=$true)][string[]]$QaArguments)
    & npm.cmd @QaArguments
    if ($LASTEXITCODE -ne 0) { throw "npm falló: $QaArguments" }
}
Invoke-QaNpm ci
Invoke-QaNpm run quality-check
Invoke-QaNpm run i18n:check
npm.cmd audit --audit-level=high --json | Set-Content (Join-Path $QaLogs 'npm-audit.json')
$QaAuditExit = $LASTEXITCODE
"npm audit exit=$QaAuditExit" | Set-Content (Join-Path $QaLogs 'npm-audit-exit.txt')
# Exit 1 sigue esperado por riesgos pendientes; no ocultarlo como aprobado.
if ($QaAuditExit -gt 1) { throw 'Audit no completó: revisar conexión/error.' }
```

Para repetir una corrida, usar en `$QaCommit` el SHA completo de `source-commit.txt`, no volver a tomar un head mutable. No usar `reset --hard`, force checkout, `git clean` ni actualizar a latest. Electron 41.10.7, better-sqlite3 12.9.0 y ONNX Runtime Node 1.27.0 siguen fijados por el lockfile. Comprobar Node 24; referencia cloud 24.19.0/npm 11.9.0. Una cuenta estándar puede no listar todos los procesos de otras sesiones: un listado vacío no sustituye la instancia QA independiente.

Para tests Node y ejecución Electron, SQLite necesita **dos ABIs distintos**. Parar todos los procesos antes de reconstruir. Primero los tests:

```powershell
Invoke-QaNpm rebuild better-sqlite3
$env:REQUIRE_DB_TESTS = '1'
node --import tsx --test --test-concurrency=4 "test/**/*.test.js" *> (Join-Path $QaLogs 'tests.txt')
if ($LASTEXITCODE -ne 0) { throw 'Falló la suite; conservar su log.' }
Remove-Item Env:REQUIRE_DB_TESTS
Invoke-QaNpm run build:renderer
# Restaurar la ABI Electron antes de arrancar el escritorio:
& .\node_modules\.bin\electron-builder.cmd install-app-deps
if ($LASTEXITCODE -ne 0) { throw 'No abrir Electron con ABI incorrecta de SQLite.' }
```

Preparar artefactos con los scripts originales, registrando stdout/stderr y códigos de salida:

```powershell
Invoke-QaNpm run compile:native
Invoke-QaNpm run download:whisper-cpp
Invoke-QaNpm run download:llama-server
Invoke-QaNpm run download:sherpa-onnx
Invoke-QaNpm run download:windows-fast-paste
Invoke-QaNpm run download:windows-key-listener
Invoke-QaNpm run download:windows-mic-listener
Invoke-QaNpm run download:windows-system-audio-helper
Invoke-QaNpm run download:nircmd
Invoke-QaNpm run download:meeting-aec-helper
Invoke-QaNpm run download:qdrant
Invoke-QaNpm run download:embedding-model '--' '--for-build'
Invoke-QaNpm run download:whisper-vad-model
Invoke-QaNpm run download:diarization-models '--' '--output-dir' 'resources/bin/diarization-models'
$QaRequired = 'whisper-server-win32-x64.exe','sherpa-onnx-ws-win32-x64.exe',
    'windows-key-listener.exe','windows-fast-paste.exe','windows-mic-listener.exe',
    'windows-system-audio-helper.exe','nircmd.exe'
foreach ($QaBinary in $QaRequired) {
    $QaBinaryPath = Join-Path 'resources\bin' $QaBinary
    if (!(Test-Path $QaBinaryPath) -or (Get-Item $QaBinaryPath).Length -eq 0) {
        throw "Falta artefacto requerido: $QaBinary"
    }
}
$env:NODE_ENV = 'development'
$env:OPENWHISPR_CHANNEL = 'development'
Invoke-QaNpm run dev
```

`dev` ejecuta también prepasos con efectos secundarios: compila helpers y descarga dependencias; los pesos de ASR/LLM se seleccionan/descargan en la aplicación. Las fuentes comerciales son opcionales, sin acceso deben funcionar las fuentes de fallback originales. No usar tokens de OpenWhispr para forzar ese acceso. No ejecutar workflows release ni `build --publish`.

Si aparece HTTP 403, registrar URL **sin query/token**, host de redirección, hora, método, código y cuerpo de error sanitizado. Separar denegación del proxy, rate limit GitHub, falta de permiso y acceso gated de HF; tramitar acceso por la configuración soportada. No usar `strict-ssl=false`, `NODE_TLS_REJECT_UNAUTHORIZED=0`, `--no-sandbox`, bypass del proxy, otro modelo o un stub del motor como solución.

## Matriz manual de aceptación

| Área                            | Procedimiento y evidencia que guardar                                                                                                                                                                                                                                  | Aceptación propuesta                                                                                                                                                                                       |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Arranque y privacidad           | Abrir local sin cuenta; anotar rutas de DB/audio/modelos, procesos sidecar, settings y backend de claves; cerrar/reabrir. Revisar conexiones por proceso con herramientas Windows en el perfil QA.                                                                     | Perfil oficial intacto; persistencia QA correcta; sin envío de audio/texto/capturas cuando ASR, cleanup, traducción y asistente se configuran todos como locales. Descargas iniciales documentadas aparte. |
| Micrófono                       | Permitir/denegar/restaurar permiso; mic interno/USB/Bluetooth; silencio, mute, cambio de dispositivo predeterminado, desconexión a mitad de dictado, reconexión.                                                                                                       | Inicio/parada fiables, error recuperable y sin capturar indefinidamente; no perder dictado silenciosamente ni atribuir éxito a audio vacío.                                                                |
| Atajos                          | 100 ciclos tap y 100 hold, modificadores, ES/EN, foco en otras apps, tecla retenida, repetición, colisión con otra app, pantalla bloqueada y resume. Comprobar voice assistant/translation/meeting por separado.                                                       | Ningún dictado duplicado, tecla atascada o grabación fuera del intervalo solicitado; fallo de registro visible y rollback conservado.                                                                      |
| Pegado                          | ChatGPT web en Chrome/Edge y app desktop si está instalada en QA (texto ficticio, **no enviar el mensaje**), Notepad, Word, Outlook, VS Code y Windows Terminal; texto seleccionado, caret, cambio de foco, rich clipboard e imagen, dictado consecutivo, app elevada. | Texto correcto una vez en destino correcto; portapapeles restaurado según comportamiento original; limitaciones de privilegios reportadas, sin elevar toda la app como parche.                             |
| ASR CPU                         | Whisper tiny/base y modelo elegido por usuario, Parakeet v3 y Orukeet fijados; español/inglés; silencio, ruido, nombres, cifras, dictado corto/largo.                                                                                                                  | Comparación con los mismos audios y parámetros; datos brutos y procesados separados. No comparar un modelo EN con español como si fuera multilingüe.                                                       |
| GPU                             | NVIDIA CUDA en hardware físico y, si hay hardware, AMD/Intel Vulkan; mismo modelo que CPU; driver/backend, VRAM y fallo de arranque.                                                                                                                                   | Backend confirmado en logs; medir ventaja y uso real; fallback CPU produce resultado y aviso sin perder audio. No afirmar GPU por ver una GPU detectada.                                                   |
| Cleanup, traducción y asistente | Mismo GGUF, cuantización, hash, prompt y settings; ES↔EN; respuesta vacía, salida inválida, cancelación; edición seleccionada y herramientas locales.                                                                                                                  | No corromper ni borrar el texto de entrada; nombres y puntuación evaluados; no ruta cloud implícita. Herramientas evaluadas individualmente.                                                               |
| Reuniones y hablantes           | Teams y Zoom, 2–4 hablantes, altavoces/auriculares, mic+loopback, superposición, pausa/resume, cambio de salida, reconexión y finalización inesperada.                                                                                                                 | Audio remoto capturado, sin duplicar eco, línea temporal estable, guardado recuperable; etiquetas/huellas evaluadas con verdad de terreno.                                                                 |
| Archivos y notas                | WAV/MP3/M4A/MP4, archivo vacío/corrupto, lote, archivo de 60 min, cancelar; editar notas, FTS, búsqueda semántica, detener Qdrant; exportar MD/TXT/SRT/JSON.                                                                                                           | Progreso/cancelación útiles; avisar pérdida parcial o diarización fallida; búsqueda FTS disponible si falla semántica; tiempos y UTF-8 correctos.                                                          |
| Persistencia y estabilidad      | 2 h continuas, 8 h de uso intermitente, 500 dictados; suspensión/reinicio; copia de DB con WAL usando backup consistente, caída controlada del sidecar y espacio insuficiente en disco QA.                                                                             | Sin fuga creciente, DB corrupta, procesos huérfanos ni pérdida silenciosa; conservar evidencia de recuperación. No matar procesos con datos oficiales.                                                     |
| Distribución, fase posterior    | En VM limpia: instalador firmado propio, instalación/upgrade/downgrade previsto/desinstalación, updater propio, inicio automático y coexistencia.                                                                                                                      | Pendiente hasta tener identidad/feed/certificado Flosi y cierre legal. No usar identidad ni firma del editor original.                                                                                     |

## RTX 3050 Ti de 4 GB: backend real y límites de memoria

No se ha probado esta tarjeta. Comenzar con **Whisper base multilingüe** (no base.en), CPU y cleanup desactivado. Repetir el mismo audio/peso/SHA-256 en CUDA cambiando solo el backend. Descargar el pack mediante la opción existente de la app y conservar sus hashes; registrar versión del release y driver requerido, no sustituir DLL ni instalar toolkits como arreglo genérico.

4 GB incluyen memoria del escritorio/driver, no son 4 GB libres para IA. Cerrar consumidores de VRAM en QA y mantener la misma condición en A/B. Probar small solo después y con margen real. Medium/large/turbo y LLM grandes no se dan por viables. Parakeet/Orukeet/sherpa local no se consideran acelerados por NVIDIA sin confirmar el backend del binario. Ante error/OOM, conservar evidencia del fallback CPU **con el mismo modelo**, no cambiar modelos/umbrales para fingir éxito. No hace falta provocar OOM deliberadamente.

En otra PowerShell de la misma cuenta:

```powershell
nvidia-smi.exe --query-gpu=name,driver_version,memory.total,memory.used,utilization.gpu --format=csv
if ($LASTEXITCODE -ne 0) { throw 'GPU no medida; pendiente.' }
# Ctrl+C termina la captura de métricas, no el driver.
nvidia-smi.exe --query-gpu=timestamp,name,driver_version,memory.used,utilization.gpu,temperature.gpu --format=csv -l 1 |
    Tee-Object -FilePath (Join-Path $QaLogs 'gpu.csv')
```

En WDDM pueden faltar métricas por proceso; anotarlo sin inventar datos. Confirmar en logs ejecutable CUDA y ausencia/presencia de fallback, además del uso de GPU. Capturar RAM/CPU de Electron y todos los sidecars. El nombre de GPU y la UI «detectada» no prueban inferencia GPU.

## Verificación de rutas y procedencia

Antes de audio, confirmar `userData` en `%APPDATA%\OpenWhispr-development` (DB de desarrollo, audio, spool, logs y secure-keys), Credential Manager/DPAPI del SID QA, caches de ASR/GGUF/embeddings/Qdrant/yt-dlp del perfil QA o recursos del checkout, y pack GPU en `userData\bin` QA. Temporales deben estar en `$QaTemp`. Si aparece `ProgramData\OpenWhispr`, `C:\OpenWhispr` o un perfil oficial, detener y revisar; no borrar ni migrar esas rutas. El canal por sí solo no aísla keyring/cache. No activar autostart ni registrar identidades productivas manualmente.

```powershell
$QaManifest = [ordered]@{
    sourceCommit = (git rev-parse HEAD).Trim()
    lockSha256 = (Get-FileHash package-lock.json -Algorithm SHA256).Hash
    windows = (Get-CimInstance Win32_OperatingSystem).Version
    node = (& node --version)
    npm = (& npm.cmd --version)
    profileSid = $QaIdentity.User.Value
    tempPath = $env:TEMP
    channel = $env:OPENWHISPR_CHANNEL
    nativeTests = 'pendientes: adjuntar resultados, esta plantilla no certifica éxito'
}
$QaManifest | ConvertTo-Json | Set-Content (Join-Path $QaLogs 'manifest.json')
Get-ChildItem resources\bin -File -Recurse | Where-Object { $_.Extension -in '.exe','.dll' } |
    Get-FileHash -Algorithm SHA256 | Export-Csv (Join-Path $QaLogs 'binaries.csv') -NoTypeInformation
```

Registrar también hashes de los pesos usados y del pack GPU descargado; nunca exportar .env, cookies, tokens, master keys o secure-keys. Los helpers por prefijo/latest pueden variar: que el comando termine no prueba equivalencia de artefactos. Esta guía construye frontend/helpers y ejecuta Electron de desarrollo; **no valida un NSIS**. La configuración productiva fuerza identidad/firma Gizmo Labs y publicación upstream: no usarla para distribuir Flosi ni ejecutar un instalador sobre la referencia.

## Protocolo de comparación y métricas

1. Usar referencia **oficial firmada v1.10.4** en FlosiRef/instancia QA, sin instalar el fork sobre ella. Registrar firma con `Get-AuthenticodeSignature`, versión y hash con `Get-FileHash`; identificar versiones/hashes de los sidecars **realmente instalados**. El source v1.10.4 no demuestra por sí solo que los artefactos descargados hoy sean iguales a los del instalador oficial. Mantener Windows/driver/plan de energía equivalentes; si difieren, registrar el confusor. Guardar exportación sanitizada de settings y prompts, idiomas, cuantización, threads, VAD, backend, flags, temperaturas y versiones de modelo. Cualquier diferencia invalida una afirmación de equivalencia exacta.
2. Corpus inicial propuesto: 40 clips ES y 40 EN (al menos 30 min por idioma), más 10 bilingües y 10 de silencio/ruido. Incluir acentos, nombres propios, puntuación, números y habla rápida. Usar audio propio/licenciado, transcripción de referencia corregida por humanos y SHA-256 por archivo. Para reuniones, 3 grabaciones de 20 min con segmentos y hablantes anotados, incluyendo solapamientos.
3. Ejecutar el mismo archivo mediante la importación de ambas aplicaciones para aislar el ASR. Para el dictado de escritorio, reproducir el mismo audio mediante una fuente de audio controlada, con nivel/frecuencia/micrófono idénticos, y añadir voz humana real como prueba distinta. No equiparar importación a todo el flujo de dictado. Alternar orden A/B; 5 repeticiones calientes y 3 frías por configuración, cerrando procesos entre condiciones frías. No mezclar CPU y GPU ni cache caliente y frío.
4. Medir WER `(sustituciones + borrados + inserciones) / palabras de referencia`, CER, acierto de nombres/cifras y F1 de puntuación. Conservar resultado literal y normalizado: case/acento/puntuación pueden ocultar regresiones si se eliminan de la única métrica. Cleanup/traducción se evalúan aparte, con revisión humana de fidelidad, omisiones y alucinaciones.
5. Tiempos: inicio de captura, fin de voz, primer parcial, resultado ASR, fin de cleanup/traducción y pegado confirmado. Reportar mediana/p95 y real-time factor; si un hito no tiene instrumentación fiable, marcarlo no medido. PowerShell/PerfMon/Task Manager o WPR pueden registrar CPU, RAM privada/working set, handles y procesos; `nvidia-smi` puede registrar uso/VRAM si el driver lo soporta. Incluir todos los sidecars. Reportar idle/cold/warm separados.
6. Diarización: DER/JER, error de asignación por hablante y consistencia de huellas entre sesiones; acordar cómo se trata el solapamiento y el collar temporal antes de medir. Las etiquetas plausibles visualmente no prueban exactitud.
7. Criterios iniciales a ratificar antes de medir: cero pérdida/corrupción de datos, cero duplicados en los 200 ciclos de atajo, WER no peor en más de 1 punto porcentual absoluto, p95 de fin-de-voz a pegado no peor en más del 10% y memoria estable sin crecimiento sostenido entre rondas. Conservar intervalos/variación; estos umbrales son propuestas, **no resultados logrados**. Para un LLM no determinista usar distribuciones y revisión pareada, no igualdad byte a byte.

Formato mínimo de registro: `run_id, app_commit, binary_sha256, model_sha256, audio_sha256, language, settings_hash, backend, cold_warm, transcript_raw, transcript_final, WER, CER, punctuation_F1, name_accuracy, timings_ms, cpu, ram_peak, vram_peak, hotkey_result, paste_result, errors, evidence_path`. Guardar corpus y contenido sensible fuera del repositorio público. Publicar únicamente agregados o datos sintéticos autorizados.

## Límites de la evidencia cloud

Las pruebas unitarias/DOM y HTTP locales validan orquestación y contratos; una prueba de binario en Linux valida solo ese artefacto Linux. Ninguna verifica micrófono Windows, WASAPI real, CUDA/NVIDIA, foco/portapapeles de aplicaciones Windows, firma, SmartScreen, NSIS ni calidad de sesiones largas. Esas filas siguen pendientes hasta adjuntar un registro de ejecución Windows con hardware y resultados.
