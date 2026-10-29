# Flosi — baseline reproducible y resultados

> Registro histórico de `30037542` (fase inicial). La rama ya fue publicada en GitHub en la fase siguiente. Estado actual, cambios de dependencias y riesgos: [FLOSI_SECURITY_REVIEW.md](FLOSI_SECURITY_REVIEW.md); restricciones actualizadas: [FLOSI_LICENSES.md](FLOSI_LICENSES.md). Los resultados de este documento conservan las versiones y condiciones de la auditoría original.

Auditoría: **28 de octubre de 2026, America/New_York**. Los logs usan UTC, ya 29 de octubre. Se ha investigado y probado código; no se declara paridad completa ni preparación para distribuir un producto comercial.

## Identidad exacta y preservación del trabajo

| Dato                        | Valor observado                                                                                                                                                             |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Repositorio local inicial   | `/workspace/openwhispr`                                                                                                                                                     |
| Único remoto inicial        | `origin = https://github.com/sseaccorp/openwhispr.git` tanto fetch como push                                                                                                |
| Rama/commit iniciales       | `work`, `fc786f41c91de8177ce7d9333d2834d973cc3c19`; `origin/main` en ese mismo commit                                                                                       |
| Versión inicial             | `package.json`: **1.11.0**; no era la versión instalada de referencia                                                                                                       |
| Árbol inicial               | Limpio según `git status --short`; repositorio no shallow; sin etiqueta local v1.10.4                                                                                       |
| Confirmación del fork       | Metadatos del conector GitHub: `sseaccorp/openwhispr`, acceso de lectura/escritura; no se escribió a GitHub                                                                 |
| Etiqueta solicitada         | La API del fork devolvió **404** para `refs/tags/v1.10.4`; la API de `OpenWhispr/openwhispr` confirmó etiqueta lightweight a `ba6d61820b4c56d7b08012c61c2ae6b43f3152f3`     |
| Compatibilidad del baseline | Ese commit ya estaba en el historial local y es ancestro del HEAD inicial, confirmado con `git cat-file` y `git merge-base --is-ancestor`; hay **37 commits** de diferencia |
| Rama creada                 | `codex/flosi-baseline`, desde el SHA exacto de v1.10.4                                                                                                                      |
| Worktree de auditoría       | `/workspace/work/flosi-baseline`; el checkout inicial se conserva en su rama y commit                                                                                       |
| Versión analizada           | **1.10.4**, commit **`ba6d61820b4c56d7b08012c61c2ae6b43f3152f3`**                                                                                                           |
| Estado de publicación       | Rama y documentos locales; sin push, PR, merge, despliegue, release ni instalador publicado                                                                                 |

Se creó un worktree porque el usuario pidió rama aislada y preservar trabajo anterior; no se sobrescribió el checkout preparado ni se modificó ningún proyecto Flosi previo. No se añadió un remoto upstream de escritura ni se recreó una etiqueta con un SHA supuesto.

## Entorno y red: observación, no suposición

Linux x64 cloud, sin `/dev/snd`, `/dev/nvidia0`, `nvidia-smi`, DISPLAY ni Wayland configurados; Node **24.19.0**, npm **11.9.0**; `.nvmrc` exige 24 y `.npmrc` aplica `engine-strict=true`. Lockfile v3 con **988 entradas**, SHA-256:

```text
60396a350b1e3dc263bd9ec305787aca270b25e4799cb3b817580bc166e66816
```

Versiones resueltas: Electron **41.10.7** (Node embebido 24.18.0, ABI **145**); better-sqlite3 **12.9.0**; ONNX Runtime Node **1.27.0**; FFmpeg wrapper **5.3.0**; electron-builder **26.15.3**. La prueba SQLite de Node usó ABI **137** y SQLite **3.53.0**. Los `node_modules` preparados para 1.11.0 no se usaron para declarar aprobada la 1.10.4.

La guía cloud y `/etc/codex/network-policy.json` se leyeron antes del trabajo de red. Estado runtime: `running`, `connected`, observaciones actuales; política unrestricted/enforced, sin VPN, sin secretos ni identidades outbound configurados. Esto no prueba por sí solo acceso a cada host.

Los primeros `curl` y `git ls-remote` bajo el sandbox por defecto fallaron al conectar al proxy heredado, sin respuesta HTTP (`curl 7`, HTTP `000`; npm registró EPERM y error de cierre). Al habilitar **el permiso de red soportado de la herramienta**, conservando proxy/CA/TLS, los siguientes HEAD con redirecciones devolvieron **200**:

| Recurso probado                                                                                                | Resultado actual                                       |
| -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `registry.npmjs.org/electron`                                                                                  | 200                                                    |
| `github.com/sseaccorp/openwhispr` y API de etiqueta v1.10.4 upstream                                           | 200                                                    |
| Headers de Electron: `www.electronjs.org/headers/index.json` y artefacto 41.10.7 en `artifacts.electronjs.org` | 200                                                    |
| Electron 41.10.7 Linux x64, release de GitHub                                                                  | 200 y descarga/ejecución Node-mode posterior correctas |
| Whisper tiny, Hugging Face                                                                                     | 200 y descarga posterior correcta                      |
| Manifiesto Orukeet al revision fijado, Hugging Face                                                            | 200                                                    |
| Tokenizer MiniLM, Hugging Face                                                                                 | 200 y descarga del modelo posterior correcta           |

**No se reprodujeron 403 persistentes en esta sesión con el permiso adecuado.** La nota de preparación del entorno relataba 403 anteriores en Electron/GitHub/HF; es antecedente, no un resultado actual. El 404 del tag en el fork es ausencia de ref, no un bloqueo HTTP 403. El conector GitHub tenía conectividad aun cuando el shell inicial no la tenía. No se cambió la política publicada, se retiró el proxy ni se desactivó ninguna verificación. Un HEAD 200 no certifica todos los modelos, APIs autenticados o dominios de redirección posibles.

## Instrucciones, módulos y efectos secundarios examinados

No se encontró `AGENTS.md` en los padres aplicables ni en el checkout. Se leyeron README, `CLAUDE.md` (arquitectura/guías), `.github/CONTRIBUTING.md`, `LOCAL_WHISPER_SETUP.md`, `SECURITY.md`, documentación de red/integraciones, README móvil, manifests/lockfile, Vite/TS/ESLint, `main.js`, `preload.js`, configuración de ventanas, empaquetado y workflows relevantes. Las referencias que mencionan Electron 41 frente a otras versiones del README no sustituyen al lockfile.

| Límite                                    | Responsabilidad y dependencias                                                                                               |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Renderer `src/components`, hooks y stores | React 19/TypeScript/Vite/Tailwind; captura y orquestación en `helpers/audioManager.js`, UI y estado de grabación/reuniones   |
| Preload/main                              | Puente `window.electronAPI`, handlers IPC, permisos, ventanas, portapapeles, autenticación y persistencia                    |
| Motores                                   | Managers Whisper/Parakeet/llama, servidores loopback, FFmpeg; utility process ONNX para embeddings/huellas                   |
| Nativo                                    | Helpers C Windows/Linux y Swift/macOS; teclado, pegado, audio de sistema, mic monitor, calendario y media                    |
| Datos                                     | SQLite/WAL, audio/spool/retención, Qdrant y FTS5; secretos en keyring/safeStorage                                            |
| Cloud                                     | Clientes de inferencia, auth, sync, equipos, compartir y conectores; backend alojado no incluido                             |
| Móvil                                     | Proyecto Expo independiente con lockfile/CI/módulos nativos propios; no se instaló ni ejecutó como parte de la suite desktop |

Efectos secundarios importantes:

- `npm ci` ejecuta instaladores de Electron/FFmpeg/ONNX y `postinstall: electron-builder install-app-deps`, que puede reconstruir SQLite para Electron. `npm rebuild better-sqlite3` posterior prepara Node para tests; no intercambiar ABIs mientras procesos estén usando el módulo.
- `prestart`, `predev:main`, `prebuild*`, `prepack` y `predist` compilan helpers y descargan sidecars/modelos. `build:renderer` solo compila frontend. `build`, `pack` o `dist` no son equivalentes al build de Vite.
- Whisper está fijado a **0.0.10**, sherpa a **1.13.8**, llama.cpp a **b9763**; Qdrant busca latest si no hay override (descargó **v1.20.0**); AEC y otros helpers resuelven releases por prefijo; varios modelos usan `main`. Por ello commit+lockfile no producen todavía un paquete binariamente reproducible. Hay que guardar hashes/manifiestos y fijar entradas en una fase posterior, sin cambiar motores aquí.
- Las descargas y cachés pueden escribir en home. Se usaron rutas de caché escribibles en `/workspace` y `--for-build` / `--output-dir` soportados para embeddings/diarización. No se modificó `$HOME` ni se escribió un archivo de credenciales.
- `clean`, `cleanup.js`, `scripts/complete-uninstall.sh`, reset/borrado de modelos y workflows de release pueden borrar datos o publicar; no se ejecutaron. Los workflows conservan identidades y destinos upstream, no deben activarse para Flosi sin adaptación futura.

## Resultados de comprobaciones

| Comprobación                                                        | Resultado y alcance                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Instalación raíz siguiendo lockfile                                 | **Aprobada** con `NODE_USE_ENV_PROXY=1 XDG_CACHE_HOME=/workspace/.cache npm_config_devdir=/workspace/work/flosi-audit/node-gyp npm ci --cache /workspace/.cache/npm --no-audit --no-fund --fetch-retries=0 --fetch-timeout=30000`, permiso de red y TLS normal; 915 paquetes instalados y postinstall completado              |
| `npm run quality-check`                                             | **Aprobada**, 49.80 s: ESLint raíz/src, Prettier src y typecheck. 0 errores; 4 warnings de variables en un test y 2 de react-refresh en iconos, más aviso de módulo ESM sin `type`. No se alteró código para ocultarlos                                                                                                       |
| `npm run typecheck` explícito                                       | **Aprobada**, 25.34 s; incluida también en quality-check                                                                                                                                                                                                                                                                      |
| `npm run build:renderer`                                            | **Aprobada**, 4.27 s; aviso de import estático/dinámico de workspaceStore y chunks >500 kB. No es empaquetado Electron ni prueba funcional completa                                                                                                                                                                           |
| `node scripts/check-i18n.js`                                        | **Aprobada**, claves/placeholders consistentes                                                                                                                                                                                                                                                                                |
| `node --test .github/scripts/ci-scope.test.cjs`                     | **Aprobada**, 1 test, 0 fallos, 0 omitidos                                                                                                                                                                                                                                                                                    |
| SQLite para Node                                                    | **Aprobada**, rebuild y DB en memoria con consulta real; ABI 137                                                                                                                                                                                                                                                              |
| Suite desktop completa                                              | **Aprobada con omisiones explícitas**: 8746 tests; 8713 aprobados, 0 fallidos, 0 cancelados, 32 omitidos, 1 TODO; 1163.99 s. Resultado completo y omisiones en `flosi-evidence/TEST_SUMMARY.json`; las pruebas de hardware/Windows se mantienen no ejecutadas                                                                 |
| `npm audit --audit-level=high --json`                               | **Falló el gate** (exit 1): 8 paquetes afectados, **1 crítico, 4 altos, 1 moderado, 2 bajos**. Véase apartado de seguridad. No se ejecutó audit fix                                                                                                                                                                           |
| `npm run compile:native` en Linux                                   | **Aprobada en el reintento con permiso de red soportado**, 11.70 s: helpers Linux, incluido fast-paste con uinput/GIO/AT-SPI. El intento inicial sin ese permiso se bloqueó en el sondeo gcc/cc y fue interrumpido tras 660 s (exit -15). No se cambió código; las ramas Windows/macOS omitidas en Linux siguen sin verificar |
| Helpers Linux por separado                                          | **Aprobados** `compile:linux-system-audio` y `compile:text-monitor` con sysroot preparado y timeout 45 s, en 1.61/0.48 s. No valida los helpers Windows/macOS que el script Linux omite                                                                                                                                       |
| Pruebas nativas Linux en Xvfb                                       | **Aprobadas 2 de 3**, 0 fallos; 1 omitida por `/dev/uinput` no escribible. Reintento focalizado con Xvfb del sysroot en PATH: regiones de entrada y espera de modificadores. Son eventos sintéticos en display privado, no escritorio Windows ni teclado físico                                                               |
| Probe de audio de sistema                                           | Binario ejecuta (exit 0), pero retorna **`ok:false`, `pipewire_unavailable`, `supportsNativeCapture:true`**. Captura real no ejecutada; código 0 no se interpreta como disponibilidad de audio                                                                                                                                |
| Descargas originales                                                | **Aprobadas** Whisper, sherpa-onnx, llama-server, Qdrant, AEC, VAD, MiniLM y diarización. Los pesos de Orukeet/Parakeet/Cohere/GGUF no se descargaron para inferencia                                                                                                                                                         |
| Runtime nativo Linux                                                | `--help` Whisper/sherpa y `--version` llama funcionaron; ONNX Runtime Node carga backend CPU. Que liste WebGPU no demuestra un GPU disponible o inferencia GPU                                                                                                                                                                |
| Electron Node-mode                                                  | **Aprobado** ejecutable 41.10.7; verifica runtime/ABI, no renderers ni IPC                                                                                                                                                                                                                                                    |
| Whisper CPU sobre silencio sintético                                | **Aprobado smoke del binario/API**: health 200, 2 s mono 16 kHz, tiny, respuesta `[BLANK_AUDIO]`, inferencia 1.027 s en esa ejecución. Usa CLI/API directa y no todos los campos del pipeline del producto; no mide WER, dictado humano o paridad                                                                             |
| Arranque escritorio Electron                                        | **Falló por entorno** antes de validar aplicación: primero `sandbox_host_linux.cc: shutdown: Operation not permitted`; con permiso de red se alcanza el error definitivo `The SUID sandbox helper binary was found, but is not configured correctly` (exit -5). No se cambió propietario/modo SUID ni se usó `--no-sandbox`   |
| Tests E2E Windows, micrófono, GPU, atajos/pegado reales, NSIS/firma | **No ejecutados**: entorno Linux sin escritorio Windows/hardware pertinente. Procedimiento en [FLOSI_WINDOWS_QA.md](FLOSI_WINDOWS_QA.md)                                                                                                                                                                                      |
| Cuentas/cloud/sync reales, móvil y macOS                            | **No ejecutados**: sin backend/credenciales propios ni dispositivos/toolchains nativos. Existen pruebas simuladas y auditoría estática; no sustituyen esas comprobaciones                                                                                                                                                     |

## Seguridad y licencias: estado para una candidata comercial

La auditoría npm es de advisories públicos vigentes para esta baseline; no es un pentest. Paquetes: `better-auth` crítico; `electron`, `happy-dom`, `undici` y `zod` altos; `fast-uri` moderado; adaptadores Better Auth Drizzle/Kysely bajos. El log contiene enlaces GHSA y rutas transitivas. Separar herramienta de desarrollo y paquete distribuido al evaluar exposición. El aviso crítico de Better Auth no demuestra por sí solo que este cliente implemente el servidor vulnerable; **sí exige triage** antes de usarlo como base de producción. Mantener esta referencia congelada y preparar correcciones en otra rama, sin migrar auth ni alterar motores para hacer verde el gate.

El código principal es MIT y debe conservar su atribución. La distribución completa incluye obligaciones diferentes: **AGPL** (`tinfoil`, `@tinfoilsh/verifier`), **GPL** (`ffmpeg-static`), MPL y licencias de modelos/recursos. Yowza no se entrega en source; Nucleo y marcas necesitan revisión de derechos. Orukeet local es CC-BY-SA-4.0; no confundir sus pesos con el servicio Orukeet cloud. Ver el análisis por función en [FLOSI_PARITY_MATRIX.md](FLOSI_PARITY_MATRIX.md).

Se identificaron como deuda heredada `sandbox:false`/`webSecurity:false` del control panel, CSP limitada a imágenes, persistencia no cifrada de transcripciones/audio, namespaces de cache/keyring compartidos y feed de actualización upstream. No se modificaron. El dictado ASR local no implica privacidad local si cleanup, visión, asistente, traducción o sync usan cloud.

Las 32 omisiones de la suite principal corresponden a pruebas de macOS, PowerShell/Windows, Xvfb no incluido inicialmente en PATH y `/dev/uinput` no escribible; sus nombres están en el resumen JSON. Las dos omitidas por Xvfb se ejecutaron después y aprobaron; las demás siguen no ejecutadas en este host. No hubo omisiones de SQLite por binding no disponible. El TODO es `test/helpers/syncScenarios.test.js:667`, escenario S5 de paginación delta cuando una página completa comparte `updated_at` con el cursor: es una declaración sin cuerpo. Su comentario advierte posible abandono del resto del pull, pero la implementación actual de `pullNotes` ya usa cursor `(timestamp, id)` (`SyncService.ts:1992`, `:2221`): podría ser un TODO histórico. **No es un caso probado ni un fallo reproducido en esta auditoría**. Debe cubrirse y verificarse antes de una sincronización Flosi propia; no se modificó ese sistema.

## Registro de comandos y errores

Las operaciones iniciales de inspección fueron de lectura: `pwd`, `ls`, `rg --files`, `rg -n`, `sed`, `cat`, `node --version`, `npm --version`, lectura de configuración de red, documentación/manifests y búsquedas de referencias/tests. Se evitó leer valores de credenciales o volcar el entorno. `rg --files -g AGENTS.md` sin resultados devolvió 1; una inspección encadenada se detuvo por ese resultado y se repitió. Las lecturas de rutas inicialmente supuestas e inexistentes (`authClient.ts`, `app.config.ts`, etc.) se corrigieron mediante inventario; no son fallos del producto.

Operaciones Git relevantes:

```text
git status --short                         → limpio inicialmente
git remote -v / branch -avv / rev-parse HEAD → identidad de la tabla inicial
git tag -l '*1.10.4*'                      → sin tag local
git rev-parse --is-shallow-repository      → false
git ls-remote --tags origin v1.10.4 1.10.4  → falló conexión al proxy en sandbox inicial
git cat-file -t ba6d618...                 → commit disponible
git merge-base --is-ancestor ba6d618... HEAD → 0
git show ba6d618...:package.json           → 1.10.4
git worktree add -b codex/flosi-baseline /workspace/work/flosi-baseline ba6d61820b4c56d7b08012c61c2ae6b43f3152f3 → 0
```

Intentos de instalación anteriores al aprobado: offline sin cache indicado → ENOTCACHED (`zwitch`) y home no escribible; `npm ci` con cache escribible pero sin permiso de red → EPERM/`Exit handler never called`; intento CI `--ignore-scripts` con `NODE_USE_ENV_PROXY=1` pero sin permiso de red → mismo fallo; offline con cache correcto → ENOTCACHED (`zod@4.3.6`); `npm ci` con permiso de red y `ELECTRON_CACHE` → Electron intentó crear `/home/agent/.cache/electron` y falló ENOENT. **XDG_CACHE_HOME** resolvió la caché sin modificar el producto. Se conservan los logs de cada intento, no se interpreta ninguno como instalación aprobada.

Se intentó preservar el binding Electron con un `cp` relativo ejecutado desde otro cwd; falló `cannot stat` y no copió ni sobrescribió archivos. El rebuild de SQLite para Node y su consulta real posterior sí se verificaron. Para volver a Electron se requiere su rebuild, no reutilizar ese binding de Node.

El primer `npm test -- --test-concurrency=4` avanzó parcialmente pero la opción quedó después del patrón de archivos y no produjo el paralelismo buscado. Se interrumpió y se registró como **incompleto**, sin atribuirle un total final de aprobados. La ejecución de referencia usa opciones antes del glob: `REQUIRE_DB_TESTS=1 node --import tsx --test --test-concurrency=4 "test/**/*.test.js"`. No se cambiaron tests ni se desactivó el requisito de DB.

El registro detallado de ejecución está en `docs/flosi-evidence/COMMANDS.md`; stdout/stderr de verificación se conserva en `docs/flosi-evidence/VERIFICATION_LOGS.zip`. La tabla anterior expresa el alcance semántico: una descarga exitosa o un probe con exit 0 no certifican hardware.

## Cambios realizados y criterio de salida

Cambios de proyecto: documentación de baseline, matriz, QA Windows y roadmap, más evidencia de comandos/artefactos. Dependencias y binarios generados permanecen en directorios ignorados del worktree; scripts de análisis/smoke y logs crudos en `/workspace/work/flosi-audit`. **Sin cambios de código funcional, motores, prompts, parámetros, modelos seleccionados por defecto, lockfile, marca, auth, monetización o seguridad.**

La instalación de dependencias y el frontend se pueden reproducir bajo las condiciones registradas. Faltan la validación del desktop cloud y de los nativos Windows, las validaciones Windows y el gate comercial de seguridad/licencias. La propuesta incremental de [FLOSI_ROADMAP.md](FLOSI_ROADMAP.md) conserva la base existente y pospone el rediseño visual hasta una aceptación verificable.

La exportación a la ruta de outputs de la interfaz no está disponible en este host: `/codex` no existe y su directorio padre es de solo lectura en sandbox; fuera del sandbox el usuario del proceso no tiene permiso para crearlo. Los informes y la evidencia completa permanecen dentro del repositorio, sin cambiar permisos del sistema.
