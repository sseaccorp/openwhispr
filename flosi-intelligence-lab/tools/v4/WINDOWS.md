# Windows PowerShell: primera comparación controlada v3/v4

**Esta entrega no autoriza ni ejecuta inferencia.** Los bloques offline no consumen API. El bloque real requiere una autorización posterior del operador y una clave ya configurada localmente como `GROQ_API_KEY`; no compartirla en chat, imprimirla, incorporarla a archivos o persistirla en perfiles. No se instala ni se inicia Flosi QA. Requisito: Git y Node.js 22 o posterior; probado localmente con Node 24.19.0 en Linux, pendiente Windows.

## 1. Checkout nuevo sin tocar el de recuperación

Abrir PowerShell dentro del repositorio Windows existente. Estos comandos solo leen su estado y crean un clon hermano nuevo; no hacen stash, clean, reset, cambios de rama ni escritura en el checkout original. No se copian resultados Windows al nuevo clon.

```powershell
$ErrorActionPreference = 'Stop'
$flosiOriginal = (git rev-parse --show-toplevel).Trim()
if ($LASTEXITCODE -ne 0) { throw 'Abrir PowerShell dentro del repositorio original.' }
git --no-optional-locks -C $flosiOriginal status --short --branch
if ($LASTEXITCODE -ne 0) { throw 'No se pudo inspeccionar el checkout original.' }
$flosiClone = Join-Path (Split-Path -Parent $flosiOriginal) ('flosi-v4-p0-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
if (Test-Path -LiteralPath $flosiClone) { throw 'El clon destino ya existe.' }
git clone --single-branch --branch codex/flosi-intelligence-v4-p0 https://github.com/sseaccorp/openwhispr.git $flosiClone
if ($LASTEXITCODE -ne 0) { throw 'Clon fallido; conservar el checkout original.' }
git -C $flosiClone rev-parse HEAD
if ($LASTEXITCODE -ne 0) { throw 'No se pudo identificar el commit.' }
Set-Location (Join-Path $flosiClone 'flosi-intelligence-lab')
node --version
if ($LASTEXITCODE -ne 0) { throw 'Node.js no disponible.' }
$flosiHash = (Get-FileHash -Algorithm SHA256 -LiteralPath 'prompts/v4.json').Hash.ToLowerInvariant()
if ($flosiHash -ne 'eea5087aac218db999328c0dd33f8ed25364c7bc7da645367a6aed7fdef60c8e') { throw 'Prompt v4 distinto del candidato congelado.' }
node --import ./tools/v4/offline-guard.mjs tools/v4/cli.mjs verify
if ($LASTEXITCODE -ne 0) { throw 'Freeze incompatible. No editar hashes para eludirlo.' }
```

Verificar que el commit impreso corresponde al PR revisado. El SHA de v4 y `verify` fijan también datos, código y parámetros. No sustituir el evaluador por la copia Windows de recuperación para hacer coincidir un hash.

## 2. Pruebas y planes offline

No usar `npm test` ni `node src/cli.mjs validate` en esta misión: abren el reservado original.

```powershell
node --import ./tools/v4/offline-guard.mjs --test --experimental-test-isolation=none tools/v4/test/v4.test.mjs
if ($LASTEXITCODE -ne 0) { throw 'Fallaron pruebas v4.' }
node --import ./tools/v4/offline-guard.mjs --test --experimental-test-isolation=none --test-skip-pattern='50 synthetic cases|prompts contain no reserved case|CLI validates offline' test/lab.test.mjs
if ($LASTEXITCODE -ne 0) { throw 'Fallaron pruebas históricas seleccionadas.' }
node --import ./tools/v4/offline-guard.mjs --test --experimental-test-isolation=none tools/test/recover.test.mjs
if ($LASTEXITCODE -ne 0) { throw 'Fallaron pruebas de recuperación.' }

foreach ($flosiProbe in @('fetch','http','https','net','tls','reserved')) {
    $flosiProbeLines = & node --import ./tools/v4/offline-guard.mjs tools/v4/test/guard-probe.mjs $flosiProbe 2>&1
    $flosiProbeExit = $LASTEXITCODE
    $flosiProbeLines | ForEach-Object { Write-Output $_ }
    $flosiCounter = if ($flosiProbe -eq 'reserved') { '"networkAttempts":0,"reservedAttempts":1' } else { '"networkAttempts":1,"reservedAttempts":0' }
    if ($flosiProbeExit -ne 1 -or (($flosiProbeLines -join "`n") -notmatch [regex]::Escape($flosiCounter))) { throw ('Guard no verificado: ' + $flosiProbe) }
}

$flosiStamp = (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ')
node --import ./tools/v4/offline-guard.mjs tools/v4/cli.mjs prepare --corpus historical --prompt v3 --out "runs/plan-$flosiStamp-v3"
if ($LASTEXITCODE -ne 0) { throw 'Plan v3 fallido.' }
node --import ./tools/v4/offline-guard.mjs tools/v4/cli.mjs prepare --corpus historical --prompt v4 --out "runs/plan-$flosiStamp-v4"
if ($LASTEXITCODE -ne 0) { throw 'Plan v4 fallido.' }
node --import ./tools/v4/offline-guard.mjs tools/v4/cli.mjs prepare --corpus challenge --prompt v4 --out "runs/plan-$flosiStamp-newdev-v4"
if ($LASTEXITCODE -ne 0) { throw 'Plan de desarrollo nuevo fallido.' }
```

Los tres procesos de tests deben informar cero intentos de red y cero intentos de lectura del reservado. Los probes deben informar exactamente un bloqueo deliberado cada uno y terminar con 1; el probe `reserved` usa una ruta sintética inexistente. `prepare` informa cero solicitudes. No son respuestas del modelo.

## 3. Ejecución REAL posterior: 30 históricos por versión

**Solo después de autorización posterior.** No ejecutar este bloque como parte de la entrega offline. Son **hasta 60 solicitudes nuevas**, límite conservador de USD 0,10 por lote / USD 0,20 entre ambos, según tarifas declaradas. No se garantiza coste facturado; si la reserva excede un límite el programa rechaza el lote antes de llamar. No aumentar presupuestos ni relanzar automáticamente.

El operador debe verificar las tarifas vigentes de este modelo en `https://groq.com/pricing/` y configurar, solo en su proceso local, `FLOSI_LAB_INPUT_USD_PER_MILLION` y `FLOSI_LAB_OUTPUT_USD_PER_MILLION` con punto decimal. No se publican tarifas supuestamente actuales. El programa no carga `.env` ni consulta precios/modelos por red.

```powershell
if ((Read-Host 'Autorización posterior: escriba AUTORIZO-60 para hasta 60 solicitudes y límite estimado conjunto USD 0.20') -cne 'AUTORIZO-60') { throw 'Sin autorización posterior; no ejecutar API.' }
if ([string]::IsNullOrWhiteSpace($env:GROQ_API_KEY)) { throw 'Falta la clave ya configurada localmente. No compartirla ni guardarla en el repositorio.' }
if ([string]::IsNullOrWhiteSpace($env:FLOSI_LAB_INPUT_USD_PER_MILLION) -or [string]::IsNullOrWhiteSpace($env:FLOSI_LAB_OUTPUT_USD_PER_MILLION)) { throw 'Faltan tarifas vigentes verificadas, con punto decimal.' }
node --import ./tools/v4/offline-guard.mjs tools/v4/cli.mjs verify
if ($LASTEXITCODE -ne 0) { throw 'Freeze incompatible; no llamar al proveedor.' }

$flosiStamp = (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ')
$flosiV3 = "runs/real-pair-$flosiStamp-v3"
$flosiV4 = "runs/real-pair-$flosiStamp-v4"
$flosiComparison = "runs/real-pair-$flosiStamp-comparison"

# Sin offline-guard exclusivamente en estos dos comandos autorizados.
node tools/v4/cli.mjs run --corpus historical --prompt v3 --limit 30 --max-requests 30 --max-cost-usd 0.10 --interval-seconds 15 --allow-paid-api --prices-verified --out $flosiV3
if ($LASTEXITCODE -ne 0) { throw 'v3 detenido/incompleto. Conservar evidencia y no lanzar v4 ni reintentar automáticamente.' }
node tools/v4/cli.mjs run --corpus historical --prompt v4 --limit 30 --max-requests 30 --max-cost-usd 0.10 --interval-seconds 15 --allow-paid-api --prices-verified --out $flosiV4
if ($LASTEXITCODE -ne 0) { throw 'v4 detenido/incompleto. Conservar evidencia; no reintentar automáticamente.' }

node --import ./tools/v4/offline-guard.mjs tools/v4/cli.mjs compare --baseline $flosiV3 --candidate $flosiV4 --out $flosiComparison
if ($LASTEXITCODE -ne 0) { throw 'Comparación rechazada; no editar artefactos ni hashes.' }
Get-Content -LiteralPath (Join-Path $flosiComparison 'comparison.md')
```

La espera mínima conjunta es de 900 segundos más las peticiones. Latencias registradas excluyen la espera. Un 429 u otro fallo detiene sin retry; guardar manifiesto, journal y filas, comprobar el estado del proveedor y decidir una nueva autorización antes de cualquier repetición. No existe recuperación automática de este formato. Una interrupción en vuelo deja coste incierto y estado `running`.

## 4. Desarrollo nuevo: comparación separada, autorización distinta

Solo si ambos lotes anteriores se completaron, se revisaron todos sus outputs y no hubo regresiones bloqueantes. Son **64 solicitudes adicionales**, hasta USD 0,10 por lote; no se mezclan con los 30 históricos ni se presentan como holdout. El bloque no se ejecuta automáticamente al completar el anterior.

```powershell
if ((Read-Host 'Nueva autorización posterior: escriba AUTORIZO-64 para 64 solicitudes adicionales y límite estimado conjunto USD 0.20') -cne 'AUTORIZO-64') { throw 'Sin autorización nueva.' }
$flosiStamp = (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ')
$flosiNewV3 = "runs/newdev-$flosiStamp-v3"
$flosiNewV4 = "runs/newdev-$flosiStamp-v4"
$flosiNewComparison = "runs/newdev-$flosiStamp-comparison"
node tools/v4/cli.mjs run --corpus challenge --prompt v3 --limit 32 --max-requests 32 --max-cost-usd 0.10 --interval-seconds 15 --allow-paid-api --prices-verified --out $flosiNewV3
if ($LASTEXITCODE -ne 0) { throw 'Desarrollo v3 detenido. No continuar.' }
node tools/v4/cli.mjs run --corpus challenge --prompt v4 --limit 32 --max-requests 32 --max-cost-usd 0.10 --interval-seconds 15 --allow-paid-api --prices-verified --out $flosiNewV4
if ($LASTEXITCODE -ne 0) { throw 'Desarrollo v4 detenido. No reintentar automáticamente.' }
node --import ./tools/v4/offline-guard.mjs tools/v4/cli.mjs compare --baseline $flosiNewV3 --candidate $flosiNewV4 --out $flosiNewComparison
if ($LASTEXITCODE -ne 0) { throw 'Comparación de desarrollo rechazada.' }
Get-Content -LiteralPath (Join-Path $flosiNewComparison 'comparison.md')
```

## Revisión y archivos históricos

Conservar salidas crudas y revisar todas las filas de A/C antes de valorar B. Verificar específicamente EN-14, EN-03, ES-07, ES-09, ES-14 y los controles de v3 enumerados en README. `comparison.json` contiene métricas D y alertas por regla; `review-template.json` contiene hashes y rúbricas, con todo pendiente. Cero alertas no es aceptación comercial.

No copiar ni reescribir los directorios recuperados Windows. El comparador nuevo exige el formato nuevo y la congelación actual; **no acepta** `real-v3-complete30-recovered-win2` como si fuera un lote fresco ni compara con él latencias/coste de sesiones diferentes. Las herramientas históricas de recuperación y sus artefactos siguen independientes. El checkout anterior puede conservar archivos no publicados; no se lleva ninguno sobre él.
