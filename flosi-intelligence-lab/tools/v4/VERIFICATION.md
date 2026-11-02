# Verificación local de la entrega v4

Fecha: 2 de noviembre de 2026. Linux, Node.js 24.19.0, Python 3.12.14 para registrar evidencia de archivos. Ninguna inferencia real. Windows/PowerShell pendiente. Rama aislada `codex/flosi-intelligence-v4-p0`, basada en `1ad9adbcb7068e3eb606bfd2075599fdeaf1ebb8` (PR #6 verificado mediante GitHub y Git).

## Pruebas finales reproducibles

Desde `flosi-intelligence-lab/`, sin instalar dependencias:

```powershell
node --import ./tools/v4/offline-guard.mjs --test --experimental-test-isolation=none tools/v4/test/v4.test.mjs
node --import ./tools/v4/offline-guard.mjs --test --experimental-test-isolation=none --test-skip-pattern='50 synthetic cases|prompts contain no reserved case|CLI validates offline' test/lab.test.mjs
node --import ./tools/v4/offline-guard.mjs --test --experimental-test-isolation=none tools/test/recover.test.mjs
node --import ./tools/v4/offline-guard.mjs tools/v4/cli.mjs verify
```

| Evidencia | Resultado | Demuestra | No demuestra |
| --- | --- | --- | --- |
| [evidence/v4-tests.txt](evidence/v4-tests.txt) | 16/16, 0 fallos | Carga/congelación, 124 payloads, 32 casos nuevos, alertas suplementarias y comparación; guardas de ejecución y transporte simulado | Comprensión o superioridad del modelo |
| [evidence/historical-tests.txt](evidence/historical-tests.txt) | 18/18 seleccionadas, 0 fallos | Compatibilidad del laboratorio histórico sin cambiar sus tests; HTTP falso y revisión pendiente | Resultado real de v3/v4; cobertura de los tests que abren el reservado |
| [evidence/recovery-tests.txt](evidence/recovery-tests.txt) | 17/17, 0 fallos | Herramientas de recuperación publicadas siguen funcionando en sus pruebas falsas | Integridad de artefactos Windows no accesibles ni recuperación auténtica |
| [evidence/guard-fetch.txt](evidence/guard-fetch.txt), guard-http/https/net/tls | 5 probes bloqueados antes de IO, salida 1 esperada | Bloqueo de transportes estándar Node | Sandbox contra código nativo arbitrario |
| [evidence/guard-reserved.txt](evidence/guard-reserved.txt) | Ruta sintética bloqueada, salida 1 esperada | Intercepción de lectura del nombre reservado sin abrir el original | Una lectura/evaluación del holdout, que está prohibida y no se hizo |
| `verify` | SHA v4 correcto; 30 históricos + 32 nuevos; API requests 0 | Archivos y parámetros coinciden con freeze.json | Autenticidad criptográfica de futuras respuestas del proveedor |

Los tres logs de suites terminan con `networkAttempts:0,reservedAttempts:0`. Los probes separados informan uno cada uno, deliberadamente; ninguno sale a red. Se comprobaron sintaxis de los siete módulos nuevos con `node --check` y dos planes offline de 6 y 32 inputs. No se enviaron los planes. La suite nueva construye también los 124 cuerpos v3/v4 de ambos corpus en memoria.

Para repetir los probes, ejecutar cada nombre en un proceso separado y exigir código 1 y exactamente el contador esperado; el loop PowerShell completo está en [WINDOWS.md](WINDOWS.md). `guard-probe.mjs` importa el guard por sí mismo, incluso si se omite accidentalmente `--import`.

## Preservación del trabajo previo

[evidence/preservation.json](evidence/preservation.json) registra commit y estado limpio antes/después del checkout original `/workspace/openwhispr`, que permaneció en `fc786f41c91de8177ce7d9333d2834d973cc3c19`. Se creó una copia Git independiente dentro de `work/`; solo en esa copia se obtuvo la rama del PR #6 y se creó la nueva rama. No se cambiaron refs ni archivos de trabajo del checkout original, ni se hizo stage sobre él.

Antes de stage se obtuvo diff vacío respecto al commit base para **todos los archivos ya existentes**, excluyendo explícitamente el contenido del holdout. Se compararon bytes y SHA-256 de v1/v2/v3, desarrollo histórico, manifiesto y adaptador de recuperación contra ese commit. El SHA del evaluador histórico continúa siendo `1d5180bc080f587e6dafddd1121154c734d8c0111958c98279dd3d18844330b5`. El objeto del holdout se registra solamente desde el índice Git, sin abrir su archivo. La entrega añade exclusivamente `prompts/v4.json` y `tools/v4/**`; no modifica archivos previos.

No se leyó ni escribió la instalación QA, modelos locales, perfiles, instaladores o configuraciones de producción. No se ejecutó la aplicación ni sus scripts de instalación. El entorno Windows y sus resultados recuperados no están montados: no se puede atestar su contenido, ni se inventa evidencia sobre ellos. La evidencia local de preservación se limita al checkout accesible, los hashes, el alcance de los cambios y las acciones ejecutadas.

La actividad de red de esta entrega se limita a Git/GitHub para obtener/publicar código y consultar metadatos del PR. **Cero solicitudes reales a Groq; cero claves solicitadas o almacenadas; cero inferencias de otros proveedores.**

## Límites y fallos resueltos

Se corrigió el validador inicial de referencias reparadas para no exigir una secuencia contigua antes de retirar palabras; la copia exacta sigue siendo obligatoria para los spans técnicos. Se reemplazó la ejecución anidada de probes, cuyo subproceso no devolvía contadores en este sandbox, por procesos separados con comprobación explícita. Los logs finales anteriores son de ejecuciones completas posteriores a las correcciones; no se omitieron pruebas de funcionalidad para ocultar un fallo.

La comparación nueva rechaza ejecuciones parciales, mezclas real/simulado, parámetros o corpus distintos, filas y costes alterados, hashes incompatibles y métricas de API falsamente asignadas a simulaciones. Aun así los checks son parciales y los artefactos locales no son una firma del proveedor. Los templates de revisión quedan pendientes; no se otorga un pass semántico automático.

No quedan fallos técnicos conocidos en el alcance local comprobado. Sigue pendiente validar el flujo real con Groq y Windows, medir rendimiento/coste auténticos, adjudicar todos los outputs y recoger datos de aceptación independientes. Nada de esta verificación acredita haber solucionado EN-14, EN-03 o ES-07 en el modelo.
