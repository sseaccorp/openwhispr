# Habilitar Orukeet en el checkout Windows existente

> **Incidencia Windows confirmada y corrección independiente (30 de octubre de 2026):** la instalación original de firewall falló con `0x80070057`. No usar sus simulaciones como validación nativa. Ver [FLOSI_FIREWALL_FIX.md](FLOSI_FIREWALL_FIX.md): diagnóstico por valor/combinación, política v2 y actualización `RefreshFirewall` sin reinstalar ni borrar datos.

No reinstalar OpenWhispr ni borrar datos/cachés. Cerrar **ambas aplicaciones** desde sus bandejas y comprobar Task Manager; si quedan procesos ajenos, detener este procedimiento y cerrarlos normalmente. No ejecutar QA como administrador. Requisitos originales: Windows 11 x64, Node 24.19.0, npm 11.17.0, Git y un checkout/perfil QA previamente preparados. Necesita **6,31 GiB libres** en el volumen de datos y del checkout; no descarga Qwen ni todos los modelos.

Esta ampliación conserva v1.10.4. La ejecución de Orukeet en Windows y las reglas de firewall **aún no han sido verificadas en el equipo real**. El script falla de forma cerrada si no puede confirmar la protección. La cuenta habitual es válida para QA controlada, sin garantía de aislamiento absoluto del SO.

## 1. Actualizar solo el código QA y añadir el modelo

Usar el directorio del checkout existente. La ruta siguiente es la del quickstart anterior; ajustarla si se eligió otra. Nunca trabajar en System32. Si se usó `-DataRoot`, asignar **esa misma ruta** a `$qaRoot`; no crear otra ni copiar datos oficiales.

```powershell
$ErrorActionPreference = 'Stop'
$checkout = Join-Path $env:USERPROFILE 'source\flosi-qa-openwhispr'
$qaRoot = Join-Path $env:LOCALAPPDATA 'FlosiQA'
Set-Location -LiteralPath $checkout
if ((git remote get-url origin).Trim() -notmatch '^https://github\.com/sseaccorp/openwhispr(\.git)?$') { throw 'Repositorio inesperado.' }
if (git status --porcelain --untracked-files=no) { throw 'Hay cambios locales: preservarlos antes de continuar.' }
$oldCommit = (git rev-parse HEAD).Trim()
Write-Host "Conservar este commit para volver atrás: $oldCommit"
git fetch --no-tags origin codex/flosi-orukeet-qa
if ($LASTEXITCODE -ne 0) { throw 'Falló fetch; no continuar.' }
$qaCommit = (git rev-parse FETCH_HEAD).Trim()
Write-Host "Contrastar con el SHA revisado de la entrega/PR: $qaCommit"
# Detenerse aquí si no coincide con el commit revisado.
git merge-base --is-ancestor a31a82182d8bda46c4aae5853098ea77185cfdba $qaCommit
if ($LASTEXITCODE -ne 0) { throw 'La candidata no desciende de la versión validada.' }
git switch --detach $qaCommit
if ($LASTEXITCODE -ne 0) { throw 'Falló checkout; no continuar.' }
.\scripts\flosi-qa.ps1 -Action AddOrukeet -DataRoot $qaRoot
```

`AddOrukeet` conserva `node_modules`/SQLite y datos existentes, verifica el inventario anterior, comprueba espacio, descarga solo el paquete Orukeet y sherpa fijados, verifica cada archivo, hace un probe nativo `--help`, compila renderer y guarda el inventario del nuevo commit con copia del anterior en `Q/logs/artifacts-before-orukeet-*.json`. No ejecutar `Prepare` otra vez para esta ampliación. Un error detiene el proceso; no seguir con `Run`.

Si faltan DLL MSVC, obtener **Microsoft Visual C++ Redistributable 2015–2022 x64** de Microsoft con el equipo/IT y repetir; no copiar DLLs de OpenWhispr oficial ni System32. No cambiar las versiones de Node/Electron para esquivar el fallo. Si la política PowerShell bloquea scripts, no usar `Bypass` ni cambiar políticas: resolverlo por el mecanismo autorizado del equipo. El equivalente Node de esta acción es `node .\scripts\flosi-qa.js addorukeet --root $qaRoot`; la protección del paso siguiente sigue requiriendo el script Windows permitido.

## 2. Aplicar la protección específica, una vez por checkout

El binario original escucha todas las interfaces IPv4 y no ofrece `--host`. Por eso este paso necesita una **PowerShell elevada explícitamente**, solo para crear dos reglas restrictivas del ejecutable QA. No ejecuta la app, no cambia políticas globales ni reglas oficiales, no habilita servicios desactivados y preserva reglas diferentes para investigar. Revisar `scripts/flosi-qa-orukeet-firewall.ps1` antes de ejecutarlo.

En esa consola administrativa, sustituir la ruta si el checkout está en otro lugar:

```powershell
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Join-Path $env:USERPROFILE 'source\flosi-qa-openwhispr')
$binary = Join-Path (Get-Location).Path 'resources\bin\sherpa-onnx-ws-win32-x64.exe'
.\scripts\flosi-qa-orukeet-firewall.ps1 -Mode Install -Binary $binary
```

La elevación debe ser del mismo usuario mediante UAC. Si se pide la cuenta de otro administrador, ese operador debe usar la ruta absoluta del checkout del usuario QA; no preparar/ejecutar perfiles QA bajo su identidad. Cerrar la consola elevada al terminar. **No pulsar Permitir acceso** si Windows ofrece abrir el servidor a la red. Si no hay permisos o una política impide reglas locales, Orukeet queda bloqueado; no quitar el control ni desactivar Defender/Firewall. Las reglas bloquean todo tráfico no loopback del programa, entrante y saliente, incluido IPv6, en todos los perfiles.

## 3. Ejecutar como usuario habitual

Volver a la consola **sin elevación** del paso 1:

```powershell
.\scripts\flosi-qa.ps1 -Action Check -DataRoot $qaRoot
.\scripts\flosi-qa.ps1 -Action Run -DataRoot $qaRoot
```

En los ajustes existentes de QA, elegir dictado **Local → Orukeet** (`orukeet-v0.1.0`; internamente proveedor `nvidia`). No elegir OpenWhispr Cloud ni pulsar Descargar desde la UI: las descargas de UI siguen bloqueadas y el modelo ya está instalado. No se cambia la selección automáticamente. Dejar limpieza IA/cleanup, traducción y asistente **desactivados** para el primer experimento de ASR. Seleccionar español o inglés y el micrófono QA; dictar primero texto ficticio al Bloc de notas.

Cerrar QA desde su bandeja → Quit/Salir; el launcher espera a su propio proceso. No usar `taskkill /IM`, no cerrar procesos oficiales desde los scripts. Para cambiar a la oficial, comprobar antes que QA y su servidor cerraron; nunca iniciar ambas simultáneamente en esta fase.

## 4. Verificar el límite nativo antes de audio sensible

Con QA abierta y Orukeet seleccionado, en otra PowerShell normal del mismo checkout:

```powershell
$binary = Join-Path (Get-Location).Path 'resources\bin\sherpa-onnx-ws-win32-x64.exe'
.\scripts\flosi-qa-orukeet-firewall.ps1 -Mode Check -Binary $binary
Get-NetTCPConnection -State Listen |
    Where-Object { $_.LocalPort -ge 18930 -and $_.LocalPort -le 18953 } |
    Select-Object LocalAddress,LocalPort,OwningProcess
Get-CimInstance Win32_Process |
    Where-Object { $_.ExecutablePath -eq $binary } |
    Select-Object ProcessId,ParentProcessId,ExecutablePath,CommandLine
```

Se espera dirección de escucha `0.0.0.0`, **no** `127.0.0.1`; la protección se aplica mediante WFP/Firewall. Confirmar que el PID y argumentos corresponden al checkout y a `Q/cache/parakeet-models/orukeet-v0.1.0`, cwd/temp privados mediante Process Explorer/ProcMon, sin lecturas/escrituras oficiales. No aceptar un listener de otra ruta ni un puerto fuera del rango.

Desde **otro dispositivo con ruta LAN funcional hacia el equipo**, comprobar que la IP LAN y el puerto observado no admiten TCP. Si el dispositivo es Windows:

```powershell
# En el dispositivo de comprobación, sustituir la IP y el puerto observado.
Test-NetConnection -ComputerName '192.168.1.100' -Port 18930
```

Se espera `TcpTestSucceeded: False`, mientras el dictado de QA por localhost funciona. Una prueba desde la misma máquina usando su IP LAN puede ser tratada como loopback por Windows y no sustituye esta comprobación. Una LAN sin ruta o un router que bloquee todo tampoco demuestra por sí solo eficacia de la regla: guardar evidencia de ActiveStore y contexto de red. Si el peer consigue conectar, **cerrar QA inmediatamente** y conservar evidencia; no continuar hasta corregir/verificar protección. Sin peer o capacidad de observación, esa verificación queda explícitamente pendiente.

Tras cerrar QA, repetir `Get-NetTCPConnection`; no debe quedar su listener ni su PID. Comprobar el inventario de archivos oficiales antes/después con el procedimiento anterior de [FLOSI_WINDOWS_QUICKSTART.md](FLOSI_WINDOWS_QUICKSTART.md). La comparación anterior de 168 archivos es una referencia; ampliar ubicaciones si había rutas personalizadas.

## 5. Prueba funcional y comparación

Guardar `Check`/logs privados, SHA del commit, `Q/orukeet.json`, `Q/artifacts.json`, hashes del corpus y ajustes. Probar ES/EN, silencio, nombres, puntuación y audio largo; cancelación durante captura/inferencia, dictado posterior, cierre y reinicio. Probar inserción solicitada en ChatGPT **web**, otro campo del navegador, Bloc de notas y una app de escritorio, con foco/selección conocidos. Medir cada capa, CPU/RAM y uso real de GPU sin inferirlo por su presencia. Mantener las claves reales/cuentas deshabilitadas.

Seguir [FLOSI_VERSION_COMPARISON.md](FLOSI_VERSION_COMPARISON.md): mismo modelo, hashes, configuración y entrada; primero ASR bruto sin cleanup en QA, usando la salida bruta oficial si está disponible sin cambiar su configuración. No reconfigurar la oficial desde este procedimiento; si no hay una entrada/salida equivalente, registrar la comparación pendiente. **Qwen3.5 2B sigue pendiente de preparación fijada y validación**: no usar el `-LocalAI` anterior (Qwen2.5 1.5B) como sustituto equivalente.

## Preservación y vuelta atrás

No hay migración de historial/esquema ni importación oficial. Antes del cambio, conservar los logs/inventario QA. Si `AddOrukeet` falla, no se elimina historial ni se actualiza deliberadamente su configuración; archivos parciales y archivos nuevos QA se conservan para diagnóstico. La copia de inventario y el renderer del commit deben corresponder: volver solo con `git checkout a31a8218` no restaura el renderer compilado ni el inventario.

Para un rollback reproducible: seleccionar primero Whisper en QA y cerrar QA, preservar la carpeta QA y logs, volver al commit validado en el checkout y usar su acción `Prepare` para reconstruir renderer/rehacer inventario de esa versión, manteniendo sus datos privados. Esto puede reconstruir dependencias locales del checkout, pero no toca la oficial. No ejecutar `git clean`, reset/cleanup heredados ni borrados globales. Las dos reglas restrictivas pueden permanecer (solo afectan al EXE QA); su retirada, si se desea, es manual y dirigida a sus nombres exactos tras revisar ActiveStore, nunca por patrones generales ni sobre reglas oficiales.

La versión `a31a8218` no contiene el gate nativo Orukeet nuevo: no usarla para validar Orukeet, ni retirar sus reglas de protección mientras el EXE siga disponible. Para impedir un arranque accidental en el rollback se puede renombrar únicamente el EXE del checkout QA a un nombre de respaldo que no termine en `.exe`, sin sobrescribir un respaldo existente; conservar pesos y datos. Volver a ejecutar AddOrukeet en la rama nueva restaura el archivo fijado desde su descarga verificada. Nunca aplicar esta operación a la instalación oficial.
