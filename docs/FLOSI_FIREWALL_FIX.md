# Corrección de firewall Orukeet — Windows 11

Rama independiente `codex/flosi-orukeet-firewall-fix`, desde `a22615dd527e0cfab4e393bbd17abfcc3d3c417c`. Se conserva `codex/flosi-orukeet-qa` y el PR #3. No cambian motores, modelos, parámetros, prompts, interfaz, dependencias ni firma. No hay instalador/release/merge.

## Causa: qué sabemos y qué falta

El usuario confirmó un fallo real en Windows 11: `New-NetFirewallRule`, `RemoteAddress`, «Uno o más de los prefijos de dirección no es válido», HRESULT `0x80070057`. La versión anterior enviaba **tres valores juntos**:

```text
0.0.0.0-126.255.255.255
128.0.0.0-255.255.255.255
::/0
```

Ese HRESULT no identifica un elemento del array. **No se ha verificado aún cuál rechaza ese Windows ni se atribuye el fallo exclusivamente a `::/0`.** Son hipótesis por contrastar los prefijos de longitud cero, los extremos especiales de los rangos o el tratamiento de la combinación por el proveedor NetSecurity. No se presenta una validación de IP de .NET como prueba del parser de Windows Firewall.

Microsoft documenta IPv4/IPv6, CIDR y rangos como formatos de `RemoteAddress`, pero eso no certifica esos extremos/combinaciones en el equipo: [New-NetFirewallRule](https://learn.microsoft.com/powershell/module/netsecurity/new-netfirewallrule), [fuente de la documentación](https://github.com/MicrosoftDocs/windows-powershell-docs/blob/main/docset/winserver2025-ps/NetSecurity/New-NetFirewallRule.md).

`Diagnose` prueba realmente el proveedor nativo: cada valor original por separado, su combinación, controles IPv4/IPv6 ordinarios, variantes de extremos/no mezcla, dos mitades IPv6 y las nuevas listas. Son **28 creaciones de prueba deshabilitadas**, repartidas por dirección. Registra aceptación, representación devuelta, equivalencia numérica, error, categoría, ID y HRESULT de la excepción. No utiliza `-WhatIf`, que no demostraría aceptación real.

Las sondas son siempre `Block`, `Enabled=False`, para la ruta/SHA del EXE QA. Usa nombres/grupo con GUID y elimina únicamente su propio objeto después de validar nombre, grupo, descripción, programa, dirección y estado deshabilitado. Un error de limpieza/identidad detiene el diagnóstico y conserva el objeto para revisión; no hay borrado por patrón. No inicia el servidor ni altera reglas de producción.

## Política v2 y manejo de instalaciones parciales

- Cuatro reglas: entrada/salida × IPv4/IPv6, vinculadas al mismo EXE QA y a su ruta privada verificada. Perfil/protocolo/puertos/interfaces completos, acción `Block`; no se crean reglas permisivas.
- IPv4: ocho CIDR sin `/0` cubren exactamente todo IPv4 salvo `127.0.0.0/8`.
- IPv6: 127 CIDR generados sin `/0` cubren `::2` hasta el máximo IPv6; excluyen `::1` y la dirección no especificada `::`, que no es un peer remoto. No se omiten redes públicas, privadas, link-local, ULA o multicast. Esta representación documentada debe ser aceptada y verificada por NetSecurity real antes de darla por compatible en ese Windows.
- Las familias están separadas; el comprobador compara conjuntos numéricos, no solo cadenas. Acepta normalizaciones equivalentes de rangos/CIDR/máscaras y rechaza huecos, direcciones añadidas o keywords dinámicas.
- El esquema `v2` tiene nombres/grupo distintos por hash de ruta. Las reglas antiguas, incluso parciales, se validan y se conservan. No se borran/reemplazan reglas ajenas ni antiguas. Una identidad/filtro distinto bloquea la operación antes de la primera escritura.
- Primero valida todos los objetos existentes, crea los faltantes **deshabilitados**, vuelve a validar el conjunto y después habilita. Una caída entre operaciones deja reglas restrictivas reconocibles para reintentar; nunca se borran reglas válidas para hacer rollback. `Check` exige las cuatro reglas habilitadas en ActiveStore, servicios/perfiles operativos y filtros completos.
- Las consultas fallidas por ACL/proveedor no se confunden con «regla inexistente». La ausencia se reconoce únicamente por el error CIM específico de nombre no encontrado.

No hay transacción atómica de cuatro cmdlets CIM. La seguridad ante una instalación parcial depende también de mantener QA cerrada y del gate de arranque: si falta una regla o no puede verificarse, no se permite iniciar Orukeet. No se termina ningún proceso ajeno.

El servidor original sigue escuchando `0.0.0.0`; su cliente usa `127.0.0.1`. Las reglas nuevas no bloquean loopback. Una regla legacy válida puede seguir bloqueando todo IPv6, incluido `::1`, como antes; no afecta al loopback IPv4 que necesita este motor. No se ofrece coexistencia simultánea ni aislamiento absoluto del mismo usuario/OS.

## Actualizar la copia existente sin reinstalar ni borrar datos

Cerrar QA y OpenWhispr normalmente. Usar la carpeta existente y conservar cualquier cambio local. Sustituir `$checkout`/`$qaRoot` si se eligieron otras rutas; **mantener la misma DataRoot de la fase anterior**. No trabajar desde System32 ni ejecutar la app elevada.

PowerShell normal:

```powershell
$ErrorActionPreference = 'Stop'
$checkout = Join-Path $env:USERPROFILE 'source\flosi-qa-openwhispr'
$qaRoot = Join-Path $env:LOCALAPPDATA 'FlosiQA'
Set-Location -LiteralPath $checkout
if (git status --porcelain --untracked-files=no) { throw 'Preservar primero los cambios locales.' }
git fetch --no-tags origin codex/flosi-orukeet-firewall-fix
if ($LASTEXITCODE -ne 0) { throw 'Fetch falló.' }
$fixCommit = (git rev-parse FETCH_HEAD).Trim()
# Comparar $fixCommit con el SHA revisado del PR/entrega antes de continuar.
git switch --detach $fixCommit
if ($LASTEXITCODE -ne 0) { throw 'Checkout falló.' }
```

En una PowerShell **elevada explícitamente**, solo para diagnóstico/instalación de estas reglas:

```powershell
$ErrorActionPreference = 'Stop'
$checkout = Join-Path $env:USERPROFILE 'source\flosi-qa-openwhispr'
$qaRoot = Join-Path $env:LOCALAPPDATA 'FlosiQA' # la raíz existente, también si es personalizada
Set-Location -LiteralPath $checkout
$binary = Join-Path $checkout 'resources\bin\sherpa-onnx-ws-win32-x64.exe'
$marker = Get-Content -LiteralPath (Join-Path $qaRoot 'flosi-qa.json') -Raw | ConvertFrom-Json
if ($marker.appId -ne 'com.sseaccorp.flosi.qa') { throw 'Raíz QA inesperada.' }
$json = (& .\scripts\flosi-qa-orukeet-firewall.ps1 -Mode Diagnose -Binary $binary) -join "`n"
$diagnostic = $json | ConvertFrom-Json
$reportPath = Join-Path $qaRoot ('logs\firewall-native-' + [Guid]::NewGuid().ToString('N') + '.json')
$json | Set-Content -LiteralPath $reportPath -Encoding UTF8
$diagnostic.probes | Select-Object label,direction,accepted,equivalent,hresult,error | Format-Table -Wrap
if (@($diagnostic.probes | Where-Object { ($_.label -like 'v2-*' -or $_.label -like 'control-*') -and (-not $_.accepted -or -not $_.equivalent -or -not $_.cleaned) }).Count) {
    throw "Parser/política v2 no verificados. Conservar $reportPath; no instalar ni arrancar QA."
}
.\scripts\flosi-qa-orukeet-firewall.ps1 -Mode Install -Binary $binary
.\scripts\flosi-qa-orukeet-firewall.ps1 -Mode Check -Binary $binary
```

Leer la tabla para identificar **qué entradas legacy fallan de forma independiente** y contrastar las variantes. Si todos los controles y los valores individuales pasan, pero el conjunto falla, la evidencia apunta a la combinación, no a un valor aislado. Si fallan controles ordinarios, investigar proveedor/permisos antes de culpar a un prefijo. El HRESULT externo puede ser un wrapper; conservar también `errorId`, `category` y el mensaje íntegro del JSON.

No continuar si las listas v2 no pasan. No usar un fallback `Any`, una regla Allow ni desactivar firewall para forzar éxito. Si quedan reglas antiguas incompatibles o sondas tras un cierre abrupto, inspeccionar sus identidades exactas; no ejecutar `Remove-NetFirewallRule` con patrones generales. Un reintento de `Install` reutiliza sus reglas v2 válidas y completa las faltantes.

Volver a PowerShell **sin elevación**:

```powershell
Set-Location -LiteralPath $checkout
.\scripts\flosi-qa.ps1 -Action RefreshFirewall -DataRoot $qaRoot
.\scripts\flosi-qa.ps1 -Action Check -DataRoot $qaRoot
.\scripts\flosi-qa.ps1 -Action Run -DataRoot $qaRoot
```

`RefreshFirewall` comprueba los hashes previos, ancestros de Git y un diff limitado a esta corrección/docs/tests, exige la protección v2 efectiva y actualiza únicamente el commit del inventario con respaldo. Conserva renderer, modelos, historial, preferencias, claves y dependencias. Rechaza cambios de motor/modelo/prompt/lockfile/frontend; no se necesita `Prepare` ni `AddOrukeet`. El modo es idempotente. Si hubo una modificación de artefacto o falta preparación previa, se detiene, sin “bendecir” nuevos hashes.

Si la consulta ActiveStore falla como usuario normal, no elevar la app ni saltar el gate: registrar ese bloqueo nativo. No modificar políticas de ejecución; usar el procedimiento autorizado del equipo si PowerShell impide el script.

## Validación nativa del tráfico

1. **Sin datos sensibles**, iniciar QA normalmente y seleccionar Local → Orukeet. La UI y los parámetros no cambian. No iniciar el binario manualmente para evitar el gate.
2. Ejecutar `Check` sin elevación. Leer los cuatro nombres exactos v2 y sus filtros con `Get-NetFirewallRule`, `Get-NetFirewallApplicationFilter`, `Get-NetFirewallAddressFilter`, `Get-NetFirewallPortFilter`. Confirmar ruta QA, Block, perfiles completos, Enabled y las dos direcciones. Revisar también reglas legacy conservadas.
3. En el host, confirmar que el listener pertenece al EXE QA y probar localhost:

```powershell
$binary = Join-Path $checkout 'resources\bin\sherpa-onnx-ws-win32-x64.exe'
$native = @(Get-CimInstance Win32_Process -Filter "Name='sherpa-onnx-ws-win32-x64.exe'" | Where-Object { $_.ExecutablePath -ieq $binary })
if ($native.Count -ne 1) { throw 'No hay un único servidor QA identificado.' }
$listeners = @(Get-NetTCPConnection -State Listen -OwningProcess $native[0].ProcessId | Where-Object { $_.LocalPort -ge 18930 -and $_.LocalPort -le 18953 })
if ($listeners.Count -ne 1) { throw 'Listener QA no identificado.' }
$port = $listeners[0].LocalPort
$listeners | Select-Object LocalAddress,LocalPort,OwningProcess
$local = Test-NetConnection -ComputerName 127.0.0.1 -Port $port
if (-not $local.TcpTestSucceeded) { throw 'Localhost no funciona; detener y registrar.' }
Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '127.*' } | Select-Object IPAddress,InterfaceAlias
```

Se espera `0.0.0.0` en el listener, no un falso bind loopback. Confirmar dictado local de texto ficticio. Un Test-NetConnection exitoso solo comprueba TCP; el dictado prueba el flujo ASR.

4. Desde **otro dispositivo real con ruta LAN al equipo**, usar la IP LAN correcta y el puerto observado. No usar la IP LAN desde la misma máquina, porque Windows puede tratarlo como loopback:

```powershell
# En el peer; reemplazar por IP y puerto reales del host QA.
Test-NetConnection -ComputerName '192.168.1.100' -Port 18930 -InformationLevel Detailed
```

Debe fallar (`TcpTestSucceeded=False`) mientras localhost y dictado siguen funcionando. Probar las interfaces/perfiles disponibles sin cambiar políticas de seguridad. Confirmar ruta real entre dispositivos: una red sin ruta o un router que bloquee todo no demuestra la regla del host. Si la auditoría WFP ya está habilitada, correlacionar eventos de bloqueo 5157/5152 por hora, puerto/PID/app del propio QA para atribuirlo al host; no cambiar políticas globales de auditoría automáticamente. Sin atribución suficiente, conservar esa limitación. Si el peer conecta, cerrar QA normalmente y no continuar.

5. Comprobar la salida con `Get-NetTCPConnection -OwningProcess <PID_QA>` y los filtros Outbound de ActiveStore. **Una conexión iniciada por PowerShell no prueba el bloqueo saliente del EXE Orukeet.** Este servidor no ofrece un cliente externo para generar esa prueba sin modificarlo: no se añade uno ni se cambia el motor. La eficacia de egress de ese proceso queda como verificación del plano de control; una prueba de tráfico saliente real permanece pendiente si no existe un intento propio atribuible. Lo mismo aplica a IPv6: el servidor actual es IPv4 y un fallo de conexión IPv6 por ausencia de listener no demuestra el firewall IPv6.
6. Cerrar QA desde su bandeja. Verificar desaparición de PID/listener y repetir inventario oficial de solo lectura. No matar procesos ajenos ni borrar logs/modelos/configuraciones.

## Alcance y resultados

Las simulaciones Linux verifican lógica, equivalencia matemática, estados parciales y preservación; **no verifican NetSecurity/WFP real, sus límites de listas CIDR, IPv6 nativo ni conectividad Windows**. Se requiere el JSON nativo y la prueba peer para cerrar la incidencia. Los resultados Cloud y sus fallos iniciales están en `docs/flosi-firewall-evidence/`; los resultados nativos seguirán pendientes hasta obtenerlos. Se mantienen todos los riesgos previos de seguridad/licencias y no se avanza al rediseño.
