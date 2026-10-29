# Flosi QA — verificación, regresión y límites

> **Actualización Orukeet, 29 de octubre de 2026:** Los resultados anteriores corresponden a la fase de aislamiento. La ampliación Orukeet, su inferencia nativa real en Linux y las simulaciones de política Windows se registran por separado en [FLOSI_ORUKEET_TESTS.md](FLOSI_ORUKEET_TESTS.md). El usuario confirmó posteriormente arranque Windows/Whisper y cero diferencias en 168 archivos oficiales; eso no valida todavía Orukeet ni una paridad completa con v1.11.0.

Base exacta: `323923f963987a50913fbd3ba21f4fdf7b122cbc`, OpenWhispr v1.10.4. Rama independiente `codex/flosi-windows-isolation`. Entorno de ejecución: Linux x64 cloud, Node 24.19.0/npm 11.9.0; **no** Windows 11 ni npm 11.17.0 del equipo objetivo. Revisión del 29 de octubre de 2026, America/New_York; timestamps técnicos UTC.

## Qué demuestran las pruebas

- Fixtures sin datos personales que representan SQLite/WAL, modelos, preferencias y token oficial. Comparación de hashes antes/después de cada caso y eliminación únicamente de los fixtures creados por el test.
- Identidad opt-in y marca de checkout: modo QA explícito; fallos antes de arranques/lifecycles originales; comportamiento inerte del guard en un checkout sin marca.
- Rutas privadas, root protegido y canonizado, links/junctions/hardlinks —incluidos enlaces colgantes—, marca incompatible, espacio insuficiente, dotenv del proyecto y credenciales/configuración heredadas.
- `modelDirUtils` retorna la caché QA antes de migraciones; TEMP no cae en ProgramData oficial. Preferencias privadas conservan las claves permitidas y no pueden cambiar variante, HOME ni roots del producto.
- Escrituras sync/callback/promises/streams, descriptores, rename/copia/borrado fuera de raíz rechazados. Lecturas de datos oficiales/credenciales ambientales rechazadas, también mediante exports ESM. Estas son guardas Node, no un sandbox nativo.
- SQLite real: WAL/consulta/persistencia y `DatabaseManager` real sobre perfil privado con la guarda activada. Electron/getPath se simula; SQLite no.
- Clave AES sintética, keyring simulado: servicio/cuenta QA distintos, cifrado/descifrado, rechazo de fallback DPAPI oficial. No se leyó ni escribió un keyring personal del host.
- Preload en VM: configuración local/invitado inicial privada, persistencia de cambios posteriores y conservación de la API existente; no se inventa una cuenta autenticada.
- Colisiones de procesos simuladas y puerto realmente ocupado en Linux. Ningún proceso ajeno terminado. HTTP/fetch reales a un servidor local de fixture; destinos externos y puertos originales rechazados. WebRequest de Chromium simulado.
- Bloqueo de cloud/claves/updater/autostart/import/reset en IPC antes del handler original; conservar preferencias de hotkey y consultas de estado. Bloquear Tinfoil antes de cargar transporte atestado y downloader nativo yt-dlp antes de ejecutarlo.

Las regresiones existentes cubren audio, texto/cleanup, traducción, LLM, ASR, cancelación, errores, scopes y persistencia. El resultado de una unidad con mocks no se presenta como inferencia con micrófono ni exactitud acústica. No se modificaron tests anteriores para conseguir aprobados.

## Resultados de comandos

Registro final y logs se adjuntan en `flosi-isolation-evidence/`. El resultado de `npm audit` de la fase 2 sigue vigente: no se modifican dependencias/versiones ni se declara seguridad verde.

| Comprobación                                                          | Resultado / alcance                                                                                                                                                                                                                                                                                                 |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm ci` con cache y node-gyp escribibles                             | Aprobado, 915 paquetes y postinstall/rebuild Electron completos; 24,41 s                                                                                                                                                                                                                                            |
| `npm rebuild better-sqlite3` para tests Node                          | Aprobado; no confundir ABI Node 137 con Electron 145                                                                                                                                                                                                                                                                |
| Primera suite completa, concurrencia 4                                | **8.813 enumeradas: 8.780 aprobadas, 0 fallos, 32 omitidas, 1 TODO**, incluida la revisión de 67 casos QA disponible durante esa pasada                                                                                                                                                                             |
| Pruebas específicas después de las guardas de entrada/salidas nativas | **73 aprobadas, 0 fallos** en árbol definitivo, incluidos frontend y última guarda de configuración heredada                                                                                                                                                                                                        |
| Pasada adicional con concurrencia 8                                   | **No aprobada:** `noteEditorSummaryDeletion.test.js` terminó con SIGKILL; cgroup mostró `oom_kill=1`, límite 8 GiB y peak en ese límite, evidencia consistente con falta de memoria; no se dispone de una traza kernel que atribuya el PID exacto. No se modificó el test ni aumentó memoria/timeout para ocultarlo |
| Repetición final con concurrencia 4                                   | **8.819 enumeradas: 8.786 aprobadas, 0 fallos, 0 canceladas, 32 omitidas y 1 TODO**, 1.352,66 s; 73 aprobadas más que la baseline de 8.713. Se conservaron las omisiones/TODO históricos                                                                                                                            |
| `npm run quality-check`                                               | **Aprobado**, 199,80 s. Incluye ESLint, Prettier src y typecheck. Persisten 4 warnings anteriores de variables y 2 de react-refresh; sin errores. Última guarda: lint/formato y suite QA repetidos                                                                                                                  |
| `npm run build:renderer`                                              | Aprobado; no es arranque Electron/NSIS ni prueba Windows. Permanecen avisos de chunks y workspaceStore                                                                                                                                                                                                              |
| Orígenes/hashes/extracción Windows CPU                                | **6 archives descargados, hash/tamaño comprobados y extracción validada**: Whisper, key listener, fast paste, mic listener, system audio y llama.cpp opcional. Ningún EXE/DLL Windows ejecutado en Linux                                                                                                            |
| Modelos y CUDA                                                        | Metadatos/pins registrados; no se descargaron pesos grandes ni pack CUDA en cloud en esta fase. Digest CUDA coincide con el manager original. No son pruebas de inferencia                                                                                                                                          |
| PowerShell portable 7.6.0 en Linux                                    | **12 archivos/bloques** analizados (launcher, guía y snippets CIM/ACL). Prueba sintética del inventario before/after y rechazo de sobrescritura aprobada en Linux. **Sin ejecutar APIs Windows**                                                                                                                    |
| `node scripts/require-safe-entry.js`                                  | Exit 1 esperado: guard impide lifecycles de este checkout antes de efectos                                                                                                                                                                                                                                          |
| `node scripts/flosi-qa.js check` en Linux                             | Exit 1 esperado: launcher rechaza plataforma no soportada; no sustituir por `--no-sandbox`                                                                                                                                                                                                                          |
| Lock y revisión de scope                                              | SHA-256 sin cambio: `9dfb56d340c4e7490ea88a0d819dd38ad273a788ea10ab0431d913369ea97a92`; `package.json` cambia únicamente prefijos de scripts, no dependencias/versiones                                                                                                                                             |

La suite completa `full-stable` se ejecutó sobre la implementación y pruebas de `26eaf319`; las comprobaciones adicionales de configuración heredada y rutas aplicadas de Electron se comprobaron después con los 73 casos QA y lint explícito. No cambió ningún motor/contrato de inferencia entre ambas revisiones. Los guards adicionales de helpers se lintan explícitamente con `--no-ignore`, porque la configuración heredada excluye parte de helpers de su búsqueda automática.

### Fallos encontrados durante implementación

1. Un test previo de embeddings construye `process` sin `env`. La nueva condición QA usaba acceso directo; se corrigió la condición a acceso opcional, conservando el test y la lógica de inferencia.
2. Un test nuevo SQLite tenía un error de quoting en su script hijo; se corrigió usando un parámetro SQL. No se cambió la aserción ni SQLite para conseguirlo.
3. Una aserción nueva trataba un rechazo async de Tinfoil como throw sync; se corrigió a `assert.rejects`, que comprueba el contrato real, antes de cargar el SDK.
4. Se detectaron problemas por revisión antes de Windows: `.env.example` legítimo debía permitirse; flags de invitado originales requeridos para no abrir reauth; el regex de secretos no debía bloquear `save-dictation-key`; fallback de backup debía tener nombre QA propio; dotenv privado no debía poder desactivar identidad; lifecycles normales podían saltarse bootstrap. Se corrigieron en código y se añadieron aserciones correspondientes.
5. La pasada con ocho workers agotó memoria. Es un fallo de ejecución real, no una regresión de notas demostrada ni un aprobado. Se conservó el intento fallido; la repetición a concurrencia 4 pasó completa y el contador OOM no aumentó. Los intentos de localizar su PID para cancelarla no enviaron señales: terminó con exit 1. No se terminó ningún proceso ajeno.

No hubo 403 persistentes en las consultas/descargas verificadas de esta fase. Se preservaron proxy/CA/TLS. Un futuro 403 o bloqueo local debe registrarse y detener el paso dependiente, sin modificar motores ni protecciones.

## Repetir las comprobaciones cloud

En un checkout de pruebas dedicado, con Node 24 y las dependencias del lock instaladas. No ejecutar simultáneamente tests Node y la app sobre el mismo `node_modules`, porque comparten el binario SQLite de distinta ABI:

```bash
npm rebuild better-sqlite3
REQUIRE_DB_TESTS=1 node --import tsx --test --test-concurrency=4 --test-reporter=tap "test/**/*.test.js"
npm run quality-check
npm run build:renderer
```

En Windows, `Prepare` restaura SQLite para Electron antes del launcher. El npm del entorno cloud es 11.9.0; el launcher valida específicamente el 11.17.0 solicitado para Windows y ese toolchain aún no se ejecutó aquí.

## No ejecutado y gate Windows

**No ejecutados:** arranque funcional Windows, ACL/CIM reales, keyring/Credential Manager/DPAPI reales, micrófono/dispositivos, WASAPI, GPU NVIDIA/CUDA, hotkeys/hooks, clipboard/pegado y foco en otras aplicaciones, estabilidad prolongada, ProcMon/inventario sobre instalación oficial, instalador/firma/SmartScreen. Electron GUI ya estaba bloqueado por sandbox SUID en la auditoría cloud; no se ha desactivado para producir una demostración.

Completar [FLOSI_WINDOWS_QUICKSTART.md](FLOSI_WINDOWS_QUICKSTART.md): SHA exacto, preflight nativo, hashes oficiales antes/después y ProcMon, ES/EN pareado, CPU/CUDA y LLM por separado, pegado sin enviar mensajes, cancelación, reinicio y soak. Si falla la independencia, detener el flujo afectado. No declarar paridad ni aislamiento absoluto por los resultados anteriores.
