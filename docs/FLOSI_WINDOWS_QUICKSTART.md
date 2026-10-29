# Flosi QA — prueba controlada en tu usuario habitual

Windows 11 x64, **Node 24.19.0, npm 11.17.0**, Git, RTX 3050 Ti 4 GB. Esta guía sustituye **para la modalidad QA de esta rama** la exigencia anterior de otra cuenta/VM. No valida Windows desde Linux, no declara aislamiento absoluto y no autoriza distribución. Los procedimientos históricos se conservan en [FLOSI_WINDOWS_QA.md](FLOSI_WINDOWS_QA.md).

## Antes de empezar

- Salir de OpenWhispr oficial mediante su bandeja y esperar a que termine. No usar ambas copias simultáneamente; cerrar también copias anteriores de QA o procesos Electron de desarrollo. El script no mata procesos ajenos.
- PowerShell **x64 sin elevación**, terminal habitual; no trabajar en `C:\Windows\System32`. No cambiar ExecutionPolicy, TLS, sandbox, Defender ni SmartScreen. Si una política corporativa impide ejecutar scripts, usar los comandos Node equivalentes de abajo o resolverla con IT.
- Usar un checkout nuevo y exclusivo del fork. No copiar `.env`, modelos, historial, cookies ni credenciales oficiales. No introducir claves API o cuentas reales en QA. Los nombres de variables heredadas incompatibles se muestran sin sus valores.
- Datos por defecto: `%LOCALAPPDATA%\FlosiQA`. La ruta debe ser local, ASCII y sin espacios. Si tu perfil no cumple, **detenerse** o elegir mediante `-DataRoot` una carpeta nueva y privada con ACL válidas en una ruta compatible. No usar carpetas oficiales, compartidas, OneDrive, junctions ni raíces enteras. No se crean fallbacks en ProgramData/OpenWhispr ni se modifican permisos existentes.
- El preflight exige al menos 4 GiB libres para ejecutar. Preparación nueva: presupuesto conservador **12 GiB CPU, 16 GiB con CUDA o LLM, 18 GiB ambos**, incluida reserva. Con unos 24 GB libres cabe la preparación mínima prevista, pero se vuelve a comprobar el disco; no se supone que GB y GiB sean iguales ni se descargan todos los modelos.

## Obtener, preparar y ejecutar

Ejecutar este bloque una sola vez. La rama se captura a un commit completo y se deja detached para repetir exactamente esa copia. Comparar el SHA mostrado con el commit revisado del PR/entrega antes de `Prepare`; si difiere, detenerse. No se hace pull automático en siguientes ejecuciones.

```powershell
$ErrorActionPreference = 'Stop'
$checkout = Join-Path $env:USERPROFILE 'source\flosi-qa-openwhispr'
if (Test-Path -LiteralPath $checkout) { throw 'La carpeta existe; preservarla y elegir un checkout nuevo.' }
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $checkout) | Out-Null
git clone --branch codex/flosi-windows-isolation --single-branch https://github.com/sseaccorp/openwhispr.git $checkout
if ($LASTEXITCODE -ne 0) { throw 'Falló git clone.' }
Set-Location -LiteralPath $checkout
$qaCommit = (git rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or $qaCommit -notmatch '^[a-f0-9]{40}$') { throw 'Commit inválido.' }
Write-Host "Revisar este commit antes de preparar: $qaCommit"
git checkout --detach $qaCommit
if ($LASTEXITCODE -ne 0) { throw 'Falló checkout del commit exacto.' }
```

Después de contrastar el SHA, ejecutar:

```powershell
.\scripts\flosi-qa.ps1 -Action Prepare
.\scripts\flosi-qa.ps1 -Action Check
.\scripts\flosi-qa.ps1 -Action Run
```

Equivalentes si la política de scripts PowerShell impide lo anterior, **sin debilitar esa política**:

```powershell
node .\scripts\flosi-qa.js prepare
if ($LASTEXITCODE -ne 0) { throw 'Preparación fallida; revisar el error antes de continuar.' }
node .\scripts\flosi-qa.js check
if ($LASTEXITCODE -ne 0) { throw 'Preflight fallido; no iniciar.' }
node .\scripts\flosi-qa.js run
```

En esta rama `npm start`, `npm run dev`, empaquetado, descargas originales y cleanup quedan bloqueados antes de sus efectos. No omitir la marca/guarda para arrancar: usar el launcher.

`Prepare` instala por lockfile, reconstruye SQLite para Electron, verifica/extrae artefactos fijados y compila frontend. Usa caches de npm/Electron/electron-builder privadas y no invoca `prestart`, `prebuild`, `dist` ni descarga fuentes privadas. No sobrescribe artefactos diferentes. Guarda errores y hashes; una descarga parcial queda como `.part` para inspección, no se borra automáticamente. Si faltan compiladores para SQLite y no se consigue el prebuilt de la ABI, documentar el error e instalar el toolchain oficial con IT; no cambiar Electron para evitarlo.

La descarga mínima es **Whisper base multilingüe de 147.951.465 bytes**, VAD y helpers CPU. No `base.en`. La app conserva su apariencia OpenWhispr; distinguir por bandeja **Flosi QA (local only)** y `logs\preflight.json`, no por un rediseño. Se abre con configuración privada local, sin onboarding cloud ni cuentas.

Para una ruta de datos explícita, usar **la misma en todos los comandos**:

```powershell
$qaRoot = 'D:\FlosiQA-private'
.\scripts\flosi-qa.ps1 -Action Prepare -DataRoot $qaRoot
.\scripts\flosi-qa.ps1 -Action Check -DataRoot $qaRoot
.\scripts\flosi-qa.ps1 -Action Run -DataRoot $qaRoot
```

La carpeta elegida debe superar la comprobación de propiedad/permisos; el script no amplía permisos del disco ni toma posesión. Si no hay una ruta compatible privada, el arranque permanece bloqueado.

## CUDA y procesamiento local adicional, opcionales

Primero completar la prueba CPU. Cerrar QA antes de preparar componentes adicionales:

```powershell
.\scripts\flosi-qa.ps1 -Action Prepare -Cuda
.\scripts\flosi-qa.ps1 -Action Run
```

El pack CUDA Whisper original 0.0.10 ocupa **772.876.247 bytes comprimidos**; su hash coincide con el fijado por el manager original. Se instala únicamente bajo el perfil QA. Habilitar/deshabilitar CUDA en ajustes privados y confirmar backend en logs/Task Manager/`nvidia-smi`; tener el pack no demuestra que se usó GPU. La GPU tiene 4 GB totales, parte usada por Windows: comenzar con base, no medium/large ni combinar LLM y ASR en GPU sin medir. No se cambian modelos, parámetros ni fallbacks para producir un resultado favorable.

Para probar cleanup, traducción o asistente **locales**:

```powershell
.\scripts\flosi-qa.ps1 -Action Prepare -LocalAI
.\scripts\flosi-qa.ps1 -Action Run
```

Provisiona llama.cpp **b9763 CPU** y el modelo del catálogo original **Qwen2.5 1.5B Q5_K_M** (~1,29 GB, SHA fijado; metadata Apache-2.0 revisada en fase 2). No sustituye el catálogo ni selecciona el modelo automáticamente. En cada scope correspondiente, elegir modo **Local** y ese modelo; activar cleanup solo después. Probar traducción ES↔EN y asistente con texto sintético. Un LLM pequeño puede tener menor calidad o herramientas limitadas: comparar con el **mismo** modelo/configuración de referencia, no con un modelo cloud más potente. El código/prompt de inferencia sigue siendo el original. El modelo 3B con restricción comercial **no es el descargado**.

Puede combinarse `-Cuda -LocalAI`, con presupuesto inicial 18 GiB. No se descarga automáticamente sherpa/Parakeet/Orukeet, diarización, embeddings/Qdrant, AEC ni yt-dlp. Esas rutas requieren una ampliación explícita del manifiesto/preparación y QA nativa. El código y contratos permanecen; no declarar esas funciones aprobadas por esta prueba mínima. Calendarios/cloud/conectores/BYOK no están disponibles en QA independiente.

## Primera comprobación y comparación

Para la primera sesión, después de `Prepare` y antes de `Run`, puede usarse este inventario **solo de lectura** de las ubicaciones oficiales conocidas. Añadir a `$officialRoots` cualquier ubicación personalizada real antes de capturar. Los hashes se guardan exclusivamente en los logs privados QA; no se copian archivos oficiales. Si aparece un enlace/junction en las carpetas de referencia, el bloque se detiene y se debe delimitar su destino antes de afirmar que el inventario es completo.

```powershell
$qaRoot = Join-Path $env:LOCALAPPDATA 'FlosiQA' # usar la misma DataRoot de Prepare
$marker = Get-Content -LiteralPath (Join-Path $qaRoot 'flosi-qa.json') -Raw | ConvertFrom-Json
if ($marker.appId -ne 'com.sseaccorp.flosi.qa' -or $marker.variant -ne 'qa') { throw 'Raíz QA inválida.' }
$officialRoots = @(
    (Join-Path $env:APPDATA 'OpenWhispr'),
    (Join-Path $env:APPDATA 'open-whispr'),
    (Join-Path $env:APPDATA 'OpenWhispr-development'),
    (Join-Path $env:APPDATA 'OpenWhispr-staging'),
    (Join-Path $env:USERPROFILE '.cache\openwhispr'),
    (Join-Path $env:USERPROFILE '.openwhispr'),
    (Join-Path $env:LOCALAPPDATA 'OpenWhispr'),
    (Join-Path $env:LOCALAPPDATA 'openwhispr-updater'),
    (Join-Path $env:ProgramData 'OpenWhispr'),
    (Join-Path $env:SystemDrive 'OpenWhispr')
) | Sort-Object -Unique
function Save-OfficialProof([ValidateSet('before','after')][string]$Moment) {
    $ErrorActionPreference = 'Stop'
    $output = Join-Path $qaRoot ("logs\official-" + $Moment + '.json')
    $ancestor = Split-Path -Parent $output
    while ($ancestor) {
        if ((Get-Item -LiteralPath $ancestor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Salida con enlace/junction.' }
        $parent = Split-Path -Parent $ancestor
        if ($parent -eq $ancestor) { break }
        $ancestor = $parent
    }
    $rows = @()
    foreach ($root in $officialRoots) {
        if (-not (Test-Path -LiteralPath $root)) { $rows += [pscustomobject]@{Path=$root;Hash='ABSENT'}; continue }
        $queue = New-Object 'System.Collections.Generic.Stack[string]'
        $queue.Push($root)
        while ($queue.Count -gt 0) {
            $entry = Get-Item -LiteralPath $queue.Pop() -Force
            if ($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Referencia con enlace: $($entry.FullName)" }
            if ($entry.PSIsContainer) {
                $rows += [pscustomobject]@{Path=$entry.FullName;Hash='DIRECTORY'}
                foreach ($child in Get-ChildItem -LiteralPath $entry.FullName -Force) { $queue.Push($child.FullName) }
            } else {
                $rows += [pscustomobject]@{Path=$entry.FullName;Hash=(Get-FileHash -LiteralPath $entry.FullName -Algorithm SHA256).Hash}
            }
        }
    }
    $stream = [IO.File]::Open($output, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write)
    $writer = New-Object IO.StreamWriter($stream)
    try { $writer.Write(($rows | Sort-Object Path | ConvertTo-Json -Depth 4)) } finally { $writer.Dispose() }
}
Save-OfficialProof before
# Ejecutar QA; salir normalmente. Mantener oficial cerrado. Después:
# Save-OfficialProof after
# Compare-Object (Get-Content -Raw (Join-Path $qaRoot 'logs\official-before.json')) (Get-Content -Raw (Join-Path $qaRoot 'logs\official-after.json'))
```

No sobrescribir un inventario anterior: el bloque usa `CreateNew`. Para otra sesión, conservar esos archivos con otros nombres antes de repetir. Una comparación sin salida significa igualdad del inventario final; **no** descarta escrituras transitorias: combinarla con ProcMon. Leer modelos para hashes calienta la caché del OS; separar esta sesión de integridad del benchmark frío o aplicar exactamente la misma preparación a ambas condiciones.

Revisar además los destinos de credenciales en Windows Credential Manager sin revelar sus valores: el servicio QA esperado es `Flosi-QA` y su cuenta `qa-secrets-master-key-v1`; el backup propio es `profile\secure-keys\flosi-qa-master-key-backup.enc`. No borrar, exportar ni editar la entrada `OpenWhispr`. Los tests cloud simulan keyring; esta comprobación Windows sigue pendiente.

1. **Integridad antes/después:** con OpenWhispr oficial cerrado, generar un inventario privado SHA-256 de sus carpetas reales de perfil/modelos, sin copiar contenido. Guardarlo fuera del repo y repetir al cerrar QA, antes de volver a abrir oficial. ProcMon: filtrar árbol PID de QA y operaciones WriteFile/CreateFile/Rename/Delete/RegSetValue. Investigar toda escritura a carpetas oficiales; no aceptar hashes sin cambio como prueba de ausencia de escrituras transitorias. Estos pasos requieren ejecución Windows y son el gate de la primera sesión.
2. **Micrófono:** seleccionar dispositivo en ajustes QA, dictar una frase ficticia, cambiar/desconectar y recuperar USB/Bluetooth. No conceder permisos de captura a ciegas; validar micrófono y WASAPI por separado.
3. **Dictado:** al menos 20 entradas ES y 20 EN con nombres/cifras/puntuación; repetir con mismos pesos, idioma, backend y cleanup en ambas aplicaciones. Guardar hashes de audio/modelo y resultado literal, WER/CER y latencia mediana/p95. Probar referencia y QA de forma secuencial; nunca abrir oficial mientras QA está activa.
4. **Pegado/hotkeys:** Notepad, navegador, ChatGPT web/desktop y una app de escritorio. Texto ficticio; verificar foco, exactamente un pegado, portapapeles/restauración y cancelación. **No enviar mensajes en ChatGPT**. Probar tap/hold, atajo ocupado y layouts ES/EN. El propio preflight no escribe al portapapeles.
5. **GPU:** mismo audio y base; confirmar CPU frente a CUDA real y registrar VRAM/backend/fallback. Usar el procedimiento de métricas de [QA Windows](FLOSI_WINDOWS_QA.md). La presencia de NVIDIA o el exit code de una herramienta no certifica inferencia CUDA.
6. **Persistencia/estabilidad:** reiniciar QA y verificar historial sintético, notas y ajustes privados; 200 ciclos de hotkey/pegado, 500 dictados o 2 horas inicialmente; después sesión de 8 horas. Registrar RAM/CPU/VRAM de main y sidecars, errores, cancelación y recuperación. No forzar apagado de la instalación oficial.
7. **Red e independencia:** tras preparar, observar conexiones por PID: ninguna conexión cloud de la app. Las pruebas de cleanup/traducción/asistente solo cuentan como locales si se confirma su modelo/backend; ASR local no demuestra postprocesado offline. No introducir cuentas o claves para desbloquear botones.

La metodología y umbrales propuestos ES/EN, frío/caliente, WER, puntuación, nombres, p95 y soak permanecen en [FLOSI_WINDOWS_QA.md](FLOSI_WINDOWS_QA.md). No se vuelven a etiquetar como resultados obtenidos.

## Cierre, errores y evidencias

Salir mediante bandeja → Quit/Salir. El launcher espera a su propio Electron y deja los logs en `Q\logs`; no mata procesos ajenos ni borra caches/modelos. Antes de abrir oficial, comprobar Task Manager y que no quedan sidecars QA. Si un sidecar sobrevive, conservar PID, ruta y parent PID para diagnóstico; no ejecutar `taskkill /IM` genérico ni scripts de limpieza heredados.

Con QA cerrada:

```powershell
.\scripts\flosi-qa.ps1 -Action Report
```

Guardar `environment.json`, `preflight.json`, `artifacts.json`, el log de ejecución y, cuando corresponda, `Q\profile\logs` del debugLogger original. El reporte no incluye transcripciones, credenciales ni inventario del perfil oficial. Los logs de ejecución originales pueden contener audio/texto/rutas: mantenerlos privados y revisar antes de compartir. Un `Check` aprobado verifica condiciones de arranque, **no** micrófono, GPU, escritorio ni calidad real.

Si aparece 403, firma/SmartScreen, ACL, dependencia ausente, colisión o raíz incompatible: conservar error, URL sin tokens y hash/versión; detener el paso dependiente. No quitar protecciones ni reutilizar carpetas oficiales para continuar. Ver [pendientes](FLOSI_NEXT_STEPS.md) y [resultados automatizados](FLOSI_ISOLATION_TESTS.md).
