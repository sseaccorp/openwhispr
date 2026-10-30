# Verificación de la corrección de firewall

Fecha: 30 de octubre de 2026. Base exacta: `a22615dd527e0cfab4e393bbd17abfcc3d3c417c`; rama independiente `codex/flosi-orukeet-firewall-fix`. Linux x64 Cloud, Node 24.19.0/npm 11.9.0, PowerShell portable 7.5.4 usado únicamente como herramienta de pruebas. No hay Windows/WFP real en este entorno.

| Comprobación                                               | Resultado                                                                                                                                                                                            |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm ci` por lockfile, seguido de rebuild SQLite para Node | Exit 0; sin cambios de dependencias/lockfile. Postinstall reconstruyó primero ABI Electron; después se preparó ABI Node para tests, sin aplicación abierta.                                          |
| Suite completa, SQLite requerido, cuatro workers           | **8854 tests: 8820 pass, 0 fail, 33 skipped, 1 TODO**, ocho suites, 1205,95 segundos.                                                                                                                |
| Comparación con parent                                     | Parent: 8808 pass / 33 skipped / 1 TODO. Ahora +12 pruebas JS del refresh, sin regresión detectada. No se presentan omisiones/TODO existentes como funcionalidades verificadas.                      |
| Selección enfocada                                         | **122 pass, 0 fail**: 110 previas de aislamiento/Orukeet/contratos/PE más 12 nuevas. Son parte de la suite, no se suman otra vez.                                                                    |
| Política PowerShell, escenarios finales                    | **60 casos simulados pass**, cero inesperados. Cubren aceptación/rechazo de filtros, instalación, reintentos, activación parcial, identidades y diagnóstico/limpieza. No prueban NetSecurity nativo. |
| Cobertura numérica independiente                           | Python `ipaddress` confirma cuatro reglas, ocho CIDR IPv4 por dirección y 127 CIDR IPv6, sin `/0`; conjuntos exactos y loopback excluido. No implica compatibilidad del parser Windows.              |
| `npm run quality-check`                                    | Exit 0: lint, formato y typecheck; se conservan seis warnings previos y aviso de módulo ESLint, sin errores.                                                                                         |
| Motores, modelos, prompts, interfaz, lockfile              | `git diff` respecto al parent no cambia `src/`, `resources/`, `main.js`, `preload.js`, `package.json` ni `package-lock.json`. No se compila ni distribuye instalador.                                |
| Windows 11 / WFP / conexiones desde peer                   | **No ejecutado**. Error inicial confirmado por usuario; todavía no existe informe nativo que identifique el valor rechazado.                                                                         |

## Alcance de los escenarios

La simulación reemplaza consultas NetSecurity, observación de procesos y la frontera de identidad administrativa .NET (no disponible en Linux). Ese reemplazo de identidad se hace exclusivamente en una copia temporal del script de prueba; la producción sigue exigiendo elevación para Install/Diagnose. El código de política, normalización numérica, validación de identidades, creación/activación y limpieza es el fuente real. No se simula ASR ni se ejecuta un motor para estas pruebas.

Se comprueban todos los filtros previos: paquete/programa, direcciones, protocolos, puertos, perfiles, tipo/alias de interfaz, servicio, usuarios/máquina, acción, dirección, Enabled, identidad/descripción/grupo y estado de enforcement. Casos adicionales: lista incompleta, `Any`/Any6 más amplios, máscaras/rangos equivalentes, keywords dinámicas rechazadas, CIDR mal formado, ausencia versus fallo de consultas, regla duplicada, servidor QA activo, regla ajena y legacy parcial, error antes/después de crear un objeto, caída al habilitar, reintento sin duplicar/borrar, ausencia de ActiveStore, limpieza de sondas deshabilitadas e impostor conservado.

Las doce pruebas de refresh usan archivos/directorios temporales con sentinels oficiales y QA sintéticos. Demuestran preservación de bytes/hashes, respaldo del inventario, idempotencia, rechazo de artefactos alterados, ancestros inválidos, firewall sin verificar y cambios de producto/modelo/prompt/lockfile/frontend fuera del alcance permitido. No se copian datos, claves ni modelos de una instalación oficial.

## Ejecuciones

```bash
TMPDIR=/ruta/privada/con/espacio REQUIRE_DB_TESTS=1 node --import tsx --test --test-concurrency=4 --test-reporter=tap "test/**/*.test.js"
npm run quality-check
pwsh -NoProfile -NonInteractive -File test/scripts/flosiQaFirewallPolicy.ps1
```

El script de simulación se niega a ejecutarse en Windows para evitar confundir fixtures con una prueba nativa. El procedimiento real está en [FLOSI_FIREWALL_FIX.md](FLOSI_FIREWALL_FIX.md).

La ampliación final de consultas/escenarios PowerShell se verificó con los 60 casos después de la suite JS; no modifica código JS ni inferencia. El primer intento de la nueva simulación detectó un acceso `.Count` sobre una colección vacía bajo StrictMode; se corrigió el código de instalación/diagnóstico para usar arrays explícitos. Es una incidencia de esta implementación, distinta del HRESULT reportado por el usuario. Se conserva el log fallido.

## Qué no demuestran estos resultados

- El HRESULT de Windows no permite decidir desde Linux si falla un rango, `::/0`, la combinación o una condición del proveedor. No se declara una causa concreta como probada.
- Las listas CIDR y límites del proveedor deben pasar `Diagnose` real; controles ordinarios y las cuatro entradas v2 deben aceptarse, ser numéricamente equivalentes y quedar limpias antes de instalar.
- `Check` verifica el plano de control ActiveStore, no una prueba de tráfico. Confirmar localhost/dictado y rechazo TCP desde otro dispositivo con ruta real, conservando contexto de red y, si ya existen, eventos WFP correlacionados.
- El motor original solo escucha IPv4. Una conexión IPv6 fallida por falta de listener no prueba un bloqueo IPv6. Un Test-NetConnection iniciado por PowerShell no prueba el outbound del EXE Orukeet. No se modifica el motor ni se abre una ventana permisiva para fabricar esas pruebas.
- Las reglas se exigen al arrancar y antes de crear el servidor; no hay monitorización continua de WFP ni aislamiento contra un administrador que cambie el sistema durante la sesión. No cambiar el firewall con QA ejecutándose.

## Archivos y propósito

- `scripts/flosi-qa-orukeet-firewall.ps1`: Diagnose nativo por valor/combinación; verificación, staging deshabilitado, activación y fallo cerrado.
- `scripts/lib/flosi-qa-firewall.ps1`: plan de cuatro reglas, identidad y equivalencia matemática de conjuntos IP.
- `scripts/flosi-qa-firewall-refresh.js`, launchers `.js`/`.ps1`: actualizar solo metadatos de source con hashes previos intactos, sin descargas/rebuilds/migraciones.
- `test/scripts/flosiQaFirewallPolicy.ps1`, `test/helpers/flosiQaFirewallRefresh.test.js`: escenarios sintéticos y fixtures sin información personal.
- Documentación y evidencias: corrección y guía nativa, avisos sobre instrucciones anteriores, comandos/exit codes/hashes/logs.

Se conservan los riesgos previos de Electron, Better Auth y licencias. Esta corrección no autoriza distribución comercial ni rediseño.
