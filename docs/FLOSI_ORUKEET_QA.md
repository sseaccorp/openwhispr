# Orukeet opcional en Flosi QA

Estado: candidata de desarrollo sobre `a31a82182d8bda46c4aae5853098ea77185cfdba`, código OpenWhispr v1.10.4. Rama independiente `codex/flosi-orukeet-qa`; no modifica los PR #1/#2 ni sus ramas. No es un instalador ni una certificación comercial.

El usuario confirmó previamente arranque Windows 11, dictado Whisper base y comparación de 168 archivos oficiales sin diferencias. Esa evidencia corresponde a la candidata anterior; no demuestra todavía el funcionamiento de Orukeet en Windows. No se recibieron aquí los logs ni el manifiesto de esa comparación para repetirla.

## Motor que se conserva

Orukeet ya existe en v1.10.4. `parakeet.js` identifica/valida modelos; `parakeetServer.js` normaliza audio, aplica el umbral RMS de silencio y segmenta; `parakeetSegmentation.js` conserva detección de pausas por energía y segmentación; `parakeetWsServer.js` ejecuta sherpa-onnx y transporta PCM float32 por WebSocket local. No se usa `orukeetStreaming.js` ni `orukeetCloudSession.js`: esos módulos sirven el producto remoto, requieren emisión de sesión y no son el motor local.

Se conserva `orukeet-v0.1.0`, ONNX INT8, `nemo_transducer`, sherpa-onnx **1.13.8**, paquete Windows **no-tts / shared-MD / x64**, y estos argumentos originales:

```text
--tokens=<QA>/tokens.txt
--encoder=<QA>/encoder.int8.onnx
--decoder=<QA>/decoder.int8.onnx
--joiner=<QA>/joiner.int8.onnx
--model-type=nemo_transducer
--port=<18930..18953>
--num-threads=max(1,min(4,floor(os.availableParallelism()*0.75)))
--num-work-threads=3
```

No se añaden flags de decodificación, idioma, puntuación, GPU, prompts ni temperatura. El proveedor nativo predeterminado es CPU; este paquete no promete aceleración NVIDIA. La RTX 3050 Ti no demuestra que Orukeet utilice GPU. WebSocket, warm-up, concurrencia, tiempos límite, cancelación y cierre siguen en sus implementaciones originales. Cancelar una petición cierra su socket; no interrumpe por fuerza un cálculo que ya inició el servidor.

## Procedencia e integridad

El registro nuevo `scripts/flosi-qa-orukeet-artifacts.json` fija URLs HTTPS, tamaños y SHA-256. Ninguna URL de modelo usa `main`/`latest`.

| Artefacto                                   | Procedencia                                                         |     Bytes | SHA-256                                                            |
| ------------------------------------------- | ------------------------------------------------------------------- | --------: | ------------------------------------------------------------------ |
| Modelo INT8 comprimido                      | `oruk/orukeet`, revisión `55a984d46f68323301837194ce647c702f55facc` | 486807585 | `f9191f30178cc9122ce2f023bf9fefafc822028307b0efa4caff645ba3fe8d0a` |
| sherpa Windows no-tts                       | GitHub `k2-fsa/sherpa-onnx`, v1.13.8                                |  19164933 | `876e6b89b8cf84a3a1b375a397507f2cfe9c227c2a945411a11a668475fcb5d3` |
| sherpa Linux no-tts, solo diagnóstico Cloud | Mismo release                                                       |  24802494 | `d0f96c8b65c6cd0974fada22737e337de81bc8cd2abbec2e39caf358b1eec5fc` |

El hash del modelo coincide con la API LFS y el manifiesto ONNX de esa revisión. Los hashes de paquetes nativos coinciden con los digests de assets del release. Se descargaron y calcularon también de forma independiente en Cloud. Los bytes descomprimidos de cada uno de los siete archivos del modelo se contrastan con el manifiesto fijado. También se fija y autentica el propio manifiesto.

Se conserva el arreglo original de Windows 11 del downloader upstream: `scripts/lib/pe-imports.js` cambia únicamente la importación `onnxruntime.dll` por `ow-onnxrt.dll` para evitar que el cargador elija el ONNX antiguo de System32. No se recompila sherpa ni se modifica la inferencia. El SHA del EXE instalado, tras esa transformación determinista ya existente, es `0da44b557649818b381221434c3610239c475dc9d9c822c6e91f8bc74db4384e`. El registro conserva hashes de origen y destino. No se presenta ese archivo transformado como un ejecutable con firma comercial propia.

La preparación no invoca el downloader amplio upstream, no descarga otros modelos y no usa cuentas/tokens. La extracción TAR rechaza rutas absolutas, traversal, unidades Windows, enlaces, dispositivos y duplicados seleccionados; aplica límite de tamaño y crea archivos nuevos. Los errores HTTP/integridad paran la operación sin desactivar TLS ni otras defensas. Un `.part` existente se conserva para investigar. Si se interrumpe el proceso abruptamente, inspeccionar y renombrar únicamente restos QA antes de reintentar; nunca borrar carpetas oficiales.

## Rutas y recursos

`Q` es la raíz QA validada de la instalación anterior; por defecto `%LOCALAPPDATA%\FlosiQA`. `R` es su checkout exclusivo. No cambiar `Q` en esta actualización si se quieren conservar las preferencias existentes.

| Recurso                                              | Ubicación/estrategia                                                                  |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Pesos, tokens, licencia y NOTICE                     | `Q/cache/parakeet-models/orukeet-v0.1.0/`                                             |
| Manifiesto del modelo                                | Misma carpeta, `download-manifest.json`                                               |
| Descargas verificadas                                | `Q/cache/downloads/<SHA>-<tipo>.tar.bz2`                                              |
| Staging y cwd nativo                                 | `Q/temp/`; solo se elimina el staging creado por la operación                         |
| Ejecutable y dos DLL                                 | `R/resources/bin/`, ruta privada del checkout; sin búsqueda en la instalación oficial |
| Capacidades/procedencia instaladas                   | `Q/orukeet.json`                                                                      |
| Inventario de integridad, incluido renderer y modelo | `Q/artifacts.json`; se conserva copia anterior en `Q/logs/`                           |
| PID del proceso propio                               | `Q/profile/sidecar-pids/parakeet.pid`                                                 |
| WebSocket                                            | Puerto QA libre `18930..18953`; cliente IPv4 localhost                                |
| SQLite, audio, preferencias, credenciales y logs     | Conservan exactamente las rutas QA de la fase anterior                                |

`AddOrukeet` verifica hashes existentes antes de añadir archivos, exige checkout limpio del fork y ancestro validado, preserva dependencias, reconstruye solo renderer y actualiza el inventario para el nuevo commit. No migra/importa carpetas oficiales. Un archivo existente distinto causa error; no se sobrescribe para “repararlo”. Reserva conservadora **6,31 GiB libres en ambos volúmenes**, incluidos descarga, staging, copia instalada, compilación de renderer y 4 GiB de margen. Los pesos extraídos suman aproximadamente 672 MB decimales. No descarga Qwen ni CUDA.

## Bloqueo de red nativa: obligatorio

Fuente exacta de sherpa: [offline-websocket-server-impl.cc, commit 11afbd0](https://github.com/k2-fsa/sherpa-onnx/blob/11afbd009a7f8c08f4bcf2fc1b265d0df4670fbf/sherpa-onnx/csrc/offline-websocket-server-impl.cc). `Run()` llama `server_.listen(asio::ip::tcp::v4(), port)`: **IPv4 ANY / 0.0.0.0**, no solo loopback. `--help` no ofrece host/address/bind. El cliente `127.0.0.1` no restringe ese listener. No se inventa un flag ni se cambia el motor.

La candidata exige reglas Windows Firewall de bloqueo **entrante y saliente**, para la ruta exacta y hash fijado del EXE QA, todos los perfiles/interfaces/protocolos/puertos, con destinos/orígenes remotos fuera de `127.0.0.0/8` y todo IPv6. La instalación de reglas es un paso administrativo explícito y reversible; no eleva la app, cambia políticas globales ni toca reglas/programas oficiales. El nombre incorpora un hash de la ruta QA para distinguir checkouts. No se sobrescriben reglas existentes diferentes.

El verificador inspecciona ActiveStore, servicios BFE/MpsSvc, perfiles activos y filtros; si no puede confirmar la configuración requerida, bloquea `Check`/`Run` y el arranque del motor. Si la organización no permite reglas locales, **Orukeet permanece bloqueado**. No pulsar “Permitir acceso” en el diálogo del firewall. La preparación ejecuta únicamente `--help` como prueba de carga de DLL antes de habilitar el listener.

**Pendiente Windows:** comprobar la representación real de los filtros de NetSecurity, aplicación efectiva de reglas y rechazo de conexiones desde otro equipo/LAN. Se ejecutaron pruebas simuladas con PowerShell 7 en Linux, pero no Windows PowerShell/Windows Firewall real. Si esta comprobación falla, detener QA y corregir el adaptador de protección; no retirar el gate. El SO puede cambiar políticas durante la sesión: no cambiar/desactivar el firewall con QA en marcha. El gate se comprueba al arrancar y antes de crear el servidor; no es una monitorización continua de WFP.

Permanecen compartidos el SO, kernel, GPU/driver, micrófono, teclado, clipboard y el espacio de puertos. Otros procesos del mismo equipo pueden alcanzar el WebSocket loopback, que no autentica clientes. No se promete aislamiento absoluto ni protección frente al mismo usuario que altere deliberadamente archivos/reglas. Exigir OpenWhispr cerrado; no matar procesos ajenos. Observar procesos, puertos y ProcMon en las pruebas nativas.

## Licencias y bloqueos que permanecen

Pesos Orukeet: **CC-BY-SA-4.0**; se conservan `LICENSE-WEIGHTS` y `NOTICE.md` del archivo verificado, con los hashes upstream. El código del repositorio del modelo declara MIT; eso no relicencia los pesos. Sherpa: Apache-2.0; ONNX Runtime: MIT; revisar sus avisos y BOM al distribuir. El archive nativo revisado no contiene archivos LICENSE/NOTICE: antes de distribuir hay que completar avisos y obligaciones de terceros desde sus fuentes exactas. `no-tts` evita espeak-ng del paquete TTS, sin resolver licencias del resto de Flosi.

Se mantiene [FLOSI_LICENSES.md](FLOSI_LICENSES.md) y [FLOSI_SECURITY_REVIEW.md](FLOSI_SECURITY_REVIEW.md): Electron, Better Auth, FFmpeg/yt-dlp, Tinfoil, NirCmd y recursos de terceros siguen pendientes. No se actualiza Electron ni el lockfile, no se distribuyen binarios/modelos en Git y no se habilitan servicios propietarios.

## Archivos cambiados

- `scripts/flosi-qa-orukeet-artifacts.json`: versiones, procedencia, tamaños y hashes.
- `scripts/flosi-qa-orukeet.js`: preparación opcional, sin sobrescritura y con presupuesto.
- `scripts/flosi-qa-download.js`: TAR.bz2 seguro y cancelación de descargas.
- `scripts/flosi-qa-orukeet-firewall.ps1`: protección Windows limitada al proceso QA.
- `scripts/flosi-qa.js`, `scripts/flosi-qa.ps1`: acción incremental `AddOrukeet`, inventario ampliado, frontend del nuevo commit y probe de DLL.
- `src/helpers/flosiQa/orukeet.js`, `bootstrap.js`: verificación de artefactos y protección antes del arranque.
- `src/helpers/parakeetWsServer.js`: un único gate exclusivo de QA antes del spawn; argumentos y métodos de inferencia/cancelación/cierre intactos.
- `test/helpers/flosiQaOrukeet*.test.js`, fixture sintético TAR: pruebas de preparación, límites, ejecución y ciclo de vida.
- Documentación de esta fase y enlaces desde quickstart/arquitectura/pendientes anteriores.
