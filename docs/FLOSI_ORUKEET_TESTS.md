# Verificación Orukeet y regresión

> **Incidencia Windows confirmada y corrección independiente (30 de octubre de 2026):** la instalación original de firewall falló con `0x80070057`. No usar sus simulaciones como validación nativa. Ver [FLOSI_FIREWALL_FIX.md](FLOSI_FIREWALL_FIX.md): diagnóstico por valor/combinación, política v2 y actualización `RefreshFirewall` sin reinstalar ni borrar datos.

Candidata sobre `a31a82182d8bda46c4aae5853098ea77185cfdba`, OpenWhispr v1.10.4, rama `codex/flosi-orukeet-qa`. Linux x64 Cloud, Node **24.19.0**, npm **11.9.0**, dos CPU disponibles/cgroup 2 cores, memoria máxima 8 GiB. No Windows 11, NVIDIA ni npm 11.17.0 del equipo objetivo. Fecha 29 de octubre de 2026; registros técnicos UTC.

## Resultados finales

| Comprobación                                            | Resultado y alcance                                                                                                                                                                                                                                                         |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm ci` por lockfile                                   | Exit 0, 915 paquetes; postinstall reconstruye SQLite para Electron 41.10.7. Advertencias de deprecación conservadas.                                                                                                                                                        |
| `npm rebuild better-sqlite3`                            | Exit 0; ABI de Node para pruebas de SQLite real, después del rebuild Electron del postinstall. No intercambiar ABI durante una ejecución.                                                                                                                                   |
| Suite completa con `REQUIRE_DB_TESTS=1`, cuatro workers | **8842 tests: 8808 pass, 0 fail, 33 skipped, 1 TODO**, ocho suites; 1357,60 s. SQLite requerido, no omitido.                                                                                                                                                                |
| Comparación con parent validado                         | Parent: 8786 pass, 32 skip, 1 TODO. Ahora **+22 pass**, +1 skip del nuevo diagnóstico nativo opt-in. Respecto a los 8713 de la fase 2: +73 de aislamiento previo y +22 de esta fase. No se editan tests previos.                                                            |
| Selección enfocada final                                | **110 pass, 0 fail**: 73 aislamiento previo, 22 nuevos, seis contratos de arranque Parakeet y nueve PE/imports. Ya incluidos en la suite completa; no sumarlos de nuevo.                                                                                                    |
| Preparación con artefactos reales                       | Exit 0: modelo de 486807585 bytes, paquete Windows de 19164933 bytes, manifiesto fijado; extracción real, hashes de siete archivos/modelo y tres archivos nativos, transformación PE original y recibo privado. Windows EXE no se ejecutó en Linux.                         |
| Descargador HTTPS real del proyecto                     | Exit 0 para paquete Windows y manifiesto HF, redirects permitidos y SHA/size; los tres archives modelo/Windows/Linux se descargaron además por HTTPS y hashearon independientemente. Sin 403 en estas fuentes durante la fase.                                              |
| Inferencia nativa real Linux                            | **1 test opt-in pass, 0 fail**, con binario sherpa original y pesos auténticos; transcripción, manager WAV original, filtro RMS, cancelación, recuperación, parada durante petición, PID y puerto liberados. No simulación ASR.                                             |
| Política firewall en PowerShell 7.5.4 Linux             | **24 escenarios simulados aprobados**, cero inesperados. Prueba el script y sus decisiones, no WFP ni NetSecurity real de Windows.                                                                                                                                          |
| `npm run typecheck`                                     | Exit 0.                                                                                                                                                                                                                                                                     |
| `npm run quality-check`                                 | Exit 0: ESLint, formato de `src` y typecheck. Seis advertencias previas de lint (cuatro variables no usadas en tests y dos fast-refresh de iconos), sin errores. Aviso existente sobre tipo de módulo ESLint.                                                               |
| `npm run build:renderer`                                | Exit 0; avisos previos de imports dinámicos ineficaces/chunks grandes. No instalador ni build comercial.                                                                                                                                                                    |
| ESLint de cambios                                       | Exit 0; la invocación raíz indica tres helpers de `src` ignorados por esa config; la config de `src` también excluye helpers. Por eso se ejecutó además ESLint explícito con `--no-ignore` sobre los tres helpers modificados: exit 0. No se alteran reglas para ocultarlo. |

`package.json` y `package-lock.json` son idénticos al parent, también los gestores Whisper/llama, Parakeet manager/segmentación, catálogo de modelos y prompts. En `parakeetWsServer.js` solo se añade un gate QA antes de reservar puerto/spawn; los contratos originales de argumentos siguen pasando. La nueva restricción de QA impide arrancar otros servidores Parakeet no preparados y el servidor Orukeet sin protección verificada; no altera el flujo normal fuera de QA.

Después de completar la suite se añadió un ajuste limitado de diagnóstico: conservar stderr de la comprobación de firewall y guardar el probe `--help` en el log privado. Se repitieron las 110 pruebas enfocadas y ESLint de sus archivos con exit 0; no se repitió toda la suite por ese ajuste sin cambios de inferencia.

## Qué verifican las pruebas nuevas

- TAR.bz2 real sintético: traversal, rutas absolutas, unidades Windows, backslashes, enlaces simbólicos/duros, dispositivos, duplicados, límites de extracción y preservación de staging existente.
- Preparación opcional idempotente: destino privado, conservación de historial QA y del fixture oficial, hashes de origen/instalados, rechazo de archivos existentes diferentes y recibos incompletos/alterados, licencia y NOTICE presentes en el plan.
- Cancelación antes/durante operaciones controladas: no instalación aceptada ni modificación del fixture oficial, staging propio retirado; el downloader acepta AbortSignal y cancela la petición HTTPS/pipeline. Una terminación abrupta conserva `.part`/restos privados para diagnóstico.
- Rechazo de links hacia datos compartidos, selección de modelos/runtime no preparados, hashes de recibo manipulados, carga nativa con DLL ausente/timeout/contrato erróneo y falta de protección.
- Gate QA en el servidor original: si no hay protección no llega a reservar puerto, crear proceso ni escribir PID.
- PowerShell simulado: filtros escalares/arrays válidos y ruta Windows sin sensibilidad a mayúsculas; rechazo de perfiles/servicios apagados, GPO que impide reglas locales, reglas ausentes/ambiguas, programa/paquete equivocado, direcciones/puertos/protocolos/interfaces/servicios/usuarios parciales, reglas allow/deshabilitadas/error/no efectivas y dirección incorrecta. Las consultas del SO son fixtures; nunca se aplican reglas reales desde esta prueba Linux.

Los fixtures contienen texto sintético, no historiales, claves ni audios personales. Las pruebas existentes conservan verificación de transcripción, texto, traducción, modelos locales, persistencia, errores y cancelación; muchas simulan servicios/Electron y no demuestran ejecución completa del producto.

## Diagnóstico nativo: evidencia y límites

Se generó una frase sintética inglesa con Flite CMU_US_SLT y se normalizó a PCM16 mono 16 kHz mediante FFmpeg. WAV de 5,39 s y hash en `flosi-orukeet-evidence/audio-diagnostic.json`; no se publica el audio ni un modelo. Resultado real:

> This is a local speech recognition test. The meeting starts tomorrow at nine in the morning.

Se ejecuta el código original `ParakeetWsServer` con child_process/WebSocket reales y el `ParakeetServerManager` con WAV/RMS/segmentación originales. El harness adapta descubrimiento de binario, rutas Electron y logging a un directorio Cloud privado. No activa el arranque Electron QA Windows ni sustituye reconocimiento, audio o pesos. Comprueba hashes antes de ejecutar y usa puertos QA.

La ejecución final midió arranque/warm-up 10149,69 ms y una inferencia caliente de 3023 ms. Una ejecución previa del mismo modelo dio 5821,95 ms / 1134 ms. **No son un benchmark de rendimiento**: compartían CPU con la suite y otras verificaciones; no hay resultado equivalente de la oficial ni de Windows. No se deduce precisión general, paridad ES/EN, p95 ni aprovechamiento de GPU de una sola frase.

Se observa `0.0.0.0:18930`, consistente con el código upstream. Cancelar una petición rechaza al cliente, la siguiente transcribe de nuevo, al parar durante una petición esta falla y no queda PID/listener. El proceso Node de test tarda unos 63 s aunque las aserciones duren ~19,5 s: el timeout original de arranque de 60 s no se cancela tras ganar la carrera de readiness. No se modifica ese código para acelerar o maquillar la prueba. No confundir ese temporizador del runner con un servidor nativo huérfano.

El intento de namespace de red con bubblewrap fue bloqueado por `NETLINK_ROUTE: Operation not permitted`; no se cambió la seguridad del entorno. El diagnóstico se ejecutó en Cloud, no en un desktop Windows, y no se usa como evidencia de firewall Windows.

## Comandos de pruebas reproducibles

En Cloud, usar un directorio temporal del volumen con espacio suficiente. El sandbox de herramientas necesita permitir sockets/IPC/child processes para las pruebas: la primera ejecución restringida devolvió EPERM. Eso se resolvió con el permiso de ejecución de la herramienta, sin modificar código/tests o protecciones del producto.

```bash
npm ci --no-audit --no-fund
npm rebuild better-sqlite3
TMPDIR=/ruta/privada/con/espacio REQUIRE_DB_TESTS=1 node --import tsx --test --test-concurrency=4 --test-reporter=tap "test/**/*.test.js"
npm run quality-check
npm run build:renderer
```

No ejecutar esos rebuilds mientras Electron esté abierto. En Windows el launcher conserva/revisa SQLite para ABI 145; no usar un `.node` compilado para Node dentro de Electron. Para ejecutar suite Node y volver a la app, reconstruir después con `electron-builder install-app-deps` dentro de ese checkout privado; esta fase no obliga a reinstalar las dependencias del usuario para habilitar Orukeet.

Diagnóstico nativo opt-in Linux, después de preparar un laboratorio con el layout del harness y artefactos autenticados:

```bash
LD_LIBRARY_PATH="$LAB/linux" FLOSI_ORUKEET_NATIVE_ROOT="$LAB" node --test --test-reporter=tap test/helpers/flosiQaOrukeetNative.test.js
```

Layout: `LAB/data/cache/parakeet-models/orukeet-v0.1.0`, `LAB/data/profile`, `LAB/data/temp`, `LAB/linux/{sherpa-onnx-offline-websocket-server,libonnxruntime.so}`, `LAB/english-16k.wav`. El paquete Linux debe coincidir con el SHA de la arquitectura y los hashes descomprimidos fijados por el test. Usar la frase sintética indicada para su aserción, nunca datos personales. El script de preparación exacto usado en Cloud se conserva en el ZIP de evidencias con sus rutas de laboratorio explícitas. Este harness no es un launcher alternativo de QA Windows.

Política simulada, solo en Linux con PowerShell instalado:

```bash
pwsh -NoProfile -NonInteractive -File test/scripts/flosiQaFirewallPolicy.ps1
```

Para la herramienta temporal se verificó el asset oficial Microsoft PowerShell 7.5.4 Linux x64, 75396784 bytes, SHA `1fd7983fe56ca9e6233f126925edb24bf6b6b33e356b69996d925c4db94e2fef`. No se añadió a dependencias ni al producto. En Cloud se dirigieron XDG_DATA_HOME/CONFIG_HOME/CACHE_HOME a rutas propias sin cambiar HOME. No se afirma equivalencia del runtime PowerShell 7 Linux con Windows PowerShell 5.1 y NetSecurity.

## Incidencias registradas y corregidas

1. Primer extractor usaba `Parser.destroy`, inexistente en el tar instalado: cambiado a `abort`. El caso real alertó además sobre listeners retenidos; se retira el listener al cerrar cada archivo, sin elevar el límite ni ocultar el aviso.
2. Temporales `/tmp` con 4,56 GiB eran insuficientes incluso para el presupuesto conservador de los fixtures. Se usó TMPDIR en `/workspace`; no se rebajó el presupuesto. EPERM de sockets/spawn del sandbox produjo fallos de entorno en tests anteriores; la ejecución con capacidad de red/IPC autorizada pasa íntegra.
3. Un intento llamó al harness de preparación antes de crear su archivo; otro inició la prueba nativa antes de que acabara la extracción Linux y obtuvo ENOENT. Se corrigió el orden y las ejecuciones finales pasan. No se atribuyen esos intentos a fallos de reconocimiento ni se borran sus registros.
4. PowerShell portable intentó inicializar su carpeta default fuera del workspace (solo lectura); se redirigieron XDG_* a espacio propio. El primer fixture de políticas tenía alcance de variable incorrecto; se corrigió únicamente el harness. Los 24 casos finales ejecutan el script real con consultas de SO simuladas.
5. Se mantienen advertencias previas de dependencias/lint/bundle, el TODO y las omisiones existentes. No se modificaron tests anteriores ni motores para producir aprobación.

## No ejecutado / pendiente en Windows

- `AddOrukeet`, carga del EXE/DLL MSVC/ONNX en el equipo real, UI local seleccionada y persistencia de esa selección.
- Windows PowerShell/NetSecurity real: lectura ActiveStore sin elevar la app, instalación administrativa explícita de dos reglas privadas, aplicación por perfil y prueba negativa desde peer LAN. Si no se puede verificar, el gate impide iniciar; no elevar la app ni saltarse la protección.
- Micrófono/audio real, español/inglés, GPU/CPU efectivos en el equipo, hotkeys/pegado en ChatGPT web/navegador/apps y estabilidad prolongada.
- ProcMon/Process Explorer de accesos nativos, cero cambios oficiales antes/después y ausencia de procesos/puertos huérfanos en Windows. La evidencia previa de 168 archivos sin cambios se conserva como reporte del usuario, sin inventar nuevos inventarios.
- Comparación A/B real con v1.11.0, ruta local vs cloud de la oficial y Qwen3.5 2B exacto. El Qwen2.5 de la preparación previa no es equivalente.

Los permisos y protecciones de la aplicación no se debilitan. La política local reduce exposición de esta candidata; no cierra los riesgos heredados de Electron, Better Auth ni licencias. Seguir [Windows](FLOSI_ORUKEET_WINDOWS.md), [arquitectura](FLOSI_ORUKEET_QA.md) y [comparación](FLOSI_VERSION_COMPARISON.md).

## Evidencias

`docs/flosi-orukeet-evidence/` contiene comandos con exit codes/duración, resultados y hashes, logs enfocados/nativos/política, manifiesto modelo y comparación de fuentes exactas. El ZIP conserva la suite completa, intentos fallidos y script Cloud; no contiene audios personales, modelos, ejecutables de la candidata ni credenciales. Las pruebas Windows deben adjuntar sus propios logs/fecha/SHA, sin sustituir los resultados Cloud.
