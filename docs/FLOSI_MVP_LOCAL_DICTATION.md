# Flosi QA MVP: Whisper base → Qwen3.5 2B → pegado

Candidata de desarrollo, basada exactamente en `a31a82182d8bda46c4aae5853098ea77185cfdba`, rama `codex/flosi-mvp-local-dictation-20261030`. Código de producto OpenWhispr v1.10.4. No incorpora los PR #3/#4 ni requiere sherpa, Orukeet o reglas de firewall nuevas. La base Whisper → Bloc de notas fue validada en Windows por el usuario; **esta ampliación con Qwen requiere su propia aprobación nativa**.

## Implementación y contratos

El recorrido conserva `audioManager.processWithLocalWhisper` → IPC `transcribe-local-whisper` → `WhisperManager`/`WhisperServerManager` → `audioManager.processTranscriptionCore` → `ReasoningService` → `inferenceProviders/local` → IPC `process-local-reasoning` → `localReasoningBridge` → `modelManagerBridge` → `LlamaServerManager`. El gestor descubre el GGUF por el ID original del catálogo. La entrega final sigue en `useAudioRecording`/`safePaste` y el helper original `windows-fast-paste.exe`; captura de micrófono, foco, hotkeys, persistencia y portapapeles conservan sus implementaciones.

No se modifican los motores, binarios, registro de modelos, prompts en español/inglés, temperatura de cleanup (0), contexto, muestreo ni normalización de Whisper. El envoltorio `<transcript>` y los prompts proceden de la implementación original. `cleanupDisableThinking=true` utiliza el soporte existente `enable_thinking=false` y la eliminación original de bloques `<think>`. CPU inicialmente; no se instala Vulkan para llama ni se promete uso de la RTX 3050 Ti.

Cambios pequeños de aceptación de respuestas, exclusivos de QA:

- Rechazar respuestas vacías o compuestas solo por razonamiento en lugar de reutilizar `reasoning_content` como texto visible. Mantener el error tipado `CLEANUP_OUTPUT_INVALID` a través del gestor.
- Validación conservadora de cleanup en `flosiQa/cleanupGuard.js`: una pregunta reconocida debe seguir siendo pregunta y una salida con escaso respaldo léxico se rechaza. También se rechaza añadir AM/PM a una hora sin ese calificativo en el dictado. Surgió de una inferencia **real** que contestó «La capital de Francia es París.» al dictado de una pregunta, después de cancelar una petición. No se ha demostrado que la cancelación sea su causa.
- Ante error, truncamiento, rechazo o servidor no disponible, se usa el fallback original: conservar la transcripción bruta, registrar el fallo de cleanup y entregar una sola finalización al flujo de pegado existente. No se reintenta Qwen ni se pega desde el nuevo código. La cancelación conserva el manejo de generaciones y propietario de petición original.

La validación léxica **no demuestra fidelidad semántica**, puede rechazar correcciones válidas y no verifica que todos los nombres, fechas o números sean correctos. Los dígitos no cuentan en la comparación léxica para permitir conversiones de números hablados. La puntuación interrogativa también puede ser ambigua. El texto bruto permanece recuperable y los falsos rechazos deben medirse. No afirmar «sin alucinaciones» ni calidad aprobada a partir de estos controles.

## Artefacto exacto investigado antes de descargar

| Campo                                            | Evidencia fijada                                                                                                                                        |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ID del catálogo original                         | `qwen3.5-2b-q4_k_m`                                                                                                                                     |
| Repositorio                                      | `bartowski/Qwen_Qwen3.5-2B-GGUF`                                                                                                                        |
| Archivo                                          | `Qwen_Qwen3.5-2B-Q4_K_M.gguf`                                                                                                                           |
| Revisión HF                                      | `7d26695454df6de5fbcce2e58681e62dae06ce43`                                                                                                              |
| SHA-256                                          | `57a1085840f497d764a7fc5d346922dbde961efb54cc792ea81d694fd846a1d8`                                                                                      |
| Tamaño exacto                                    | 1.396.198.496 bytes; ~1,30 GiB                                                                                                                          |
| GGUF real                                        | arquitectura `qwen35`, 25 bloques, dimensión 2048, contexto entrenado 262144, estado recurrente; el gestor conserva su presupuesto de contexto original |
| Runtime original                                 | llama.cpp `b9763`, commit `dec5ca5577d6042b4e870fadf4087c5b9b8d3a70`                                                                                    |
| ZIP Windows CPU                                  | 17.287.711 bytes, SHA-256 `05144ee4d885a778ebaef619f79ca0b8a4edb7f017eaf70086a8781ff003815f`                                                            |
| Licencia declarada por cuantizador y modelo base | Apache-2.0                                                                                                                                              |

El catálogo v1.10.4 declara 1.329.766.560 bytes y «1.3GB», distintos del archivo fijado actual. **No se cambió el catálogo ni se eligió otro modelo**: preparación y preflight usan el tamaño/hash reales; la cifra visible anterior es orientativa. La tarjeta de esta revisión describe cuantización con b9222 y capas MTP añadidas; no se habilita MTP, ni se añade drafter o proyector visual. La carga e inferencia de texto con b9763 se comprobaron realmente en Linux CPU. Windows sigue pendiente.

Fuentes inmutables:

- [Puntero LFS con tamaño y SHA](https://huggingface.co/bartowski/Qwen_Qwen3.5-2B-GGUF/raw/7d26695454df6de5fbcce2e58681e62dae06ce43/Qwen_Qwen3.5-2B-Q4_K_M.gguf).
- [Tarjeta del cuantizador](https://huggingface.co/bartowski/Qwen_Qwen3.5-2B-GGUF/blob/7d26695454df6de5fbcce2e58681e62dae06ce43/README.md).
- [Modelo base, revisión 15852e8](https://huggingface.co/Qwen/Qwen3.5-2B/tree/15852e8c16360a2fea060d615a32b45270f8a8fc).
- [Licencia Apache-2.0 del modelo base](https://huggingface.co/Qwen/Qwen3.5-2B/blob/15852e8c16360a2fea060d615a32b45270f8a8fc/LICENSE), 11.544 bytes, SHA-256 `bbedc3fda3305820b977265f01b8619d87570a6739de3a5582c3464840f1e57a`.
- [Soporte qwen35 de llama.cpp fijado](https://github.com/ggml-org/llama.cpp/blob/dec5ca5577d6042b4e870fadf4087c5b9b8d3a70/src/models/qwen35.cpp).

Apache-2.0 permite uso comercial sujeto a conservar licencia, atribuciones/NOTICE aplicables y avisos de modificaciones al redistribuir. La cuantización no convierte todas las dependencias en Apache/MIT. Se conservan pendientes las restricciones documentadas de Electron, Better Auth, FFmpeg/yt-dlp, Tinfoil, NirCmd, recursos y otros modelos en `FLOSI_SECURITY_REVIEW.md` y `FLOSI_LICENSES.md`. Esta rama no prepara distribución comercial.

## Perfil nuevo y preparación opcional

| Recurso                         | MVP                                                                                |
| ------------------------------- | ---------------------------------------------------------------------------------- |
| Checkout recomendado            | `%USERPROFILE%\source\flosi-mvp-local-20261030` (nuevo)                            |
| Raíz Q predeterminada           | `%LOCALAPPDATA%\FlosiQA-MVP-Local` (nueva)                                         |
| AppUserModelID                  | `com.sseaccorp.flosi.qa.mvp.local`                                                 |
| Credential Manager              | servicio `Flosi-QA-MVP-Local`, cuenta `qa-mvp-local-master-key-v1`; sin claves API |
| Marcador                        | schema 2, propósito `local-dictation-mvp-v1`; marcadores QA anteriores rechazados  |
| Perfil / SQLite / historial     | `Q\profile`, rutas originales bajo ese perfil                                      |
| Chromium / modelos / temporales | `Q\chromium`, `Q\cache\models`, `Q\temp`                                           |
| Whisper base                    | `Q\cache\whisper-models\ggml-base.bin`                                             |
| CPU llama.cpp                   | solo el checkout nuevo: `R\resources\bin`                                          |
| Inventarios                     | `Q\artifacts.json`, `Q\local-dictation.json`                                       |
| Logs / PIDs                     | `Q\logs`, `Q\profile\sidecar-pids`                                                 |
| Whisper / llama HTTP            | `127.0.0.1:18900–18921` / `127.0.0.1:18960–18979`                                  |

La raíz QA anterior predeterminada también queda protegida; una raíz nueva dentro de otra raíz QA marcada se rechaza. No se migran modelos, credenciales o ajustes. El AppUserModelID y servicio de clave anteriores permanecen intactos. Las guardas originales de filesystem, red Node/Chromium, IPC, procesos, ACL, descargas y actualizaciones siguen activas. No se cambia HOME, USERPROFILE, APPDATA o LOCALAPPDATA globalmente.

`Prepare` sin opciones instala solo el mínimo anterior con Whisper base. `AddQwen` verifica el manifiesto existente, calcula espacio en ambos volúmenes y añade únicamente el ZIP CPU fijado y este GGUF. No ejecuta npm ni recompila frontend. En Windows prueba primero el ejecutable CPU con `--version` (sin servidor/modelo) y exige build 9763/commit dec5ca557 antes de descargar el GGUF. Un fallo de DLL/CPU o versión bloquea esa descarga. Es repetible: un archivo correcto se reutiliza; uno distinto o incompleto se conserva y bloquea la operación. El inventario se actualiza antes de habilitar cleanup y el recibo solo se crea tras validaciones. Una interrupción no habilita Qwen parcialmente. `Prepare -LocalAI` permite preparar ambos en una operación nueva.

Presupuesto incremental conservador: descarga pendiente (~1,40 GB +17,3 MB), 256 MiB de extracción y 4 GiB de reserva; aproximadamente 6 GiB libres por volumen antes de añadir Qwen. Preparación nueva completa exige 12 GiB, o 16 GiB con `-LocalAI`, antes de iniciar. No se descargan todos los modelos. Los 24 GB indicados son suficientes para el presupuesto inicial si siguen realmente disponibles; el preflight vuelve a medirlos.

Tras el primer `AddQwen` correcto, el siguiente arranque configura una sola vez el cleanup original local con este ID y thinking desactivado. No se habilita el agente, traducción, cuentas ni cloud. Las elecciones posteriores del usuario en el perfil MVP se conservan. La interfaz de modelos, el indicador de procesamiento y los avisos de fallo siguen siendo los originales.

## Límites compartidos y criterios pendientes

Cerrar OpenWhispr oficial y el QA anterior normalmente antes de usar MVP. Se comparten usuario/SID, escritorio, audio, clipboard, hooks, CPU/GPU, loopback y permisos de Electron. No hay aislamiento absoluto ni convivencia simultánea validada. Los servicios HTTP locales no autentican a otros procesos del usuario; se verificará escucha loopback y cierre por PID en Windows. No se cambia Windows Firewall.

El caché de Electron se fija también mediante `electron_config_cache`, nombre realmente consumido por su instalador. npm/Electron/descargas se dirigen a Q cuando sus herramientas lo soportan. **Límite de compilación existente:** `@electron/rebuild` puede usar `%USERPROFILE%\.electron-gyp` y `.electron-rebuild-cache` si recurre a compilación nativa; su implementación fija `os.homedir()`. No se parchea la dependencia ni se redirige HOME para ocultarlo. Es caché de herramientas compartida, no el perfil/modelos de OpenWhispr; observarlo si no hay prebuild. Tampoco se aíslan caches/diagnósticos propios de Windows o del driver.

Para aceptar esta MVP: verificar micrófono real ES/EN, cleanup local con raw/corrected en historial, un pegado por dictado, preguntas sin respuestas, nombres y números, cancelación/error y siguiente dictado, loopback/egress por PID, perfil oficial/anterior intactos y estabilidad de al menos 30 minutos. La evidencia Linux no cumple esas puertas nativas. Los defectos de calidad observados y las latencias se describen en `FLOSI_MVP_TESTS.md`.
