# Flosi QA — pendientes y criterios antes del rediseño

Esta fase introduce independencia a nivel de aplicación en el mismo usuario Windows. No convierte el fork en una aplicación comercial distribuible. Las auditorías de seguridad/licencias de `323923f9` siguen vigentes; no se actualizó Electron, no se cambiaron prompts ni se implementaron cuentas/suscripciones.

## P0: primera aceptación Windows

- Ejecutar [quickstart](FLOSI_WINDOWS_QUICKSTART.md) en Windows 11 x64, Node 24.19.0/npm 11.17.0 y RTX 3050 Ti 4 GB, con unos 24 GB libres. Registrar SHA del checkout, lockfile, artefactos y resultado de preflight. Linux no prueba ACL/CIM/keyring/DPAPI reales ni binarios PE.
- Completar la primera sesión con inventarios antes/después y ProcMon del árbol de procesos. **Cero escrituras a perfil, claves o modelos oficiales**; revisar también registro, ubicaciones temporales y procesos nativos. Si se detecta escritura, bloquear el flujo afectado hasta corregirla; no rebajar la guarda para que funcione.
- Probar cierre limpio y liberación de todos los hooks, hotkeys y sidecars. No se acepta ejecución simultánea; el sondeo de procesos es mitigación, no garantía sin carreras.
- Corpus idéntico ES/EN y modelo/backend/configuración idénticos frente a oficial v1.10.4: precisión, nombres, puntuación, latencia, CPU/RAM/VRAM, pegado y cancelación. Dictado con cleanup desactivado se compara así en ambos; cleanup/translation/asistente locales se comparan aparte con LLM idéntico.
- Medir sesiones largas y recuperación. Registrar funciones ausentes por preparación mínima como **no ejecutadas**, no como aprobadas ni eliminadas.

## P0: ampliar componentes sin perder aislamiento

- Preparación mínima y opciones CUDA/LLM deliberadas: no descargar el catálogo completo. Para Parakeet/Orukeet, diarización, MiniLM/Qdrant, reuniones/AEC y URL/yt-dlp, añadir planes de artefactos fijados y presupuestos individuales. Mantener releases/modelos/argumentos originales y sus licencias; volver a probar rutas y cierre.
- Verificar bind real de sherpa WebSocket y superficie de red de cada sidecar antes de habilitarlo en QA: el código original configura puerto pero no demuestra por sí solo un bind exclusivamente loopback. No inferir seguridad de la URL del cliente. No añadir flags que el binario no soporte; si no puede separarse de forma segura, mantener ese flujo bloqueado.
- Auditar red nativa y potenciales caches/archivos del driver o librerías fuera de las guardas Node. El mismo usuario mantiene acceso a ambas aplicaciones; estas guardas no son un sandbox de seguridad contra código nativo comprometido o un administrador.
- La extracción con hashes y la validación de manifests deben conservar fallos cerrados. Si los assets cambian en upstream, revisar la diferencia y sus fuentes; no recalcular automáticamente hashes para aceptar archivos nuevos.

## P0 antes de distribuir o aceptar producción

- **Controles renderer heredados:** el control panel conserva `sandbox:false`/`webSecurity:false`; no se debilitaron ni se corrigen silenciosamente en QA. Revisarlos en una tarea dedicada y verificar los proveedores/IPC al endurecerlos.
- **Electron 41.10.7:** alta TLS pendiente. Migración a runtime corregido en rama/tarea separada, con ABI, permisos, hotkeys/pegado, GPU y regresión Windows. El bloqueo de red QA reduce exposición de este modo, no corrige el runtime.
- **Better Auth:** advisories de servidor con metadata crítica; no se identificó ruta de servidor local en el cliente. No habilitar cuentas ni certificar backend ajeno. Cambio de cliente/servidor y contratos reales en trabajo separado.
- **Licencias:** aclaración Tinfoil AGPL/Apache; cumplimiento GPL de FFmpeg/yt-dlp; condiciones NirCmd; derechos Nucleo/Yowza/assets; licencias por checkpoint, CUDA/MSVC y fuentes correspondientes/NOTICE. La preparación omite componentes innecesarios, pero no elimina esas obligaciones del producto. Ver [matriz conservada](FLOSI_LICENSES.md).
- Identidad comercial, protocolo, editor/certificados, empaquetado/updater/CI/dominos OAuth propios. No invocar workflows de publicación originales ni distribuir bajo su identidad o firma.

## Decisión para interfaz Flosi

Puede diseñarse el contrato de UI sobre preload/stores/managers existentes. **No iniciar todavía el rediseño como baseline funcional aceptada** hasta adjuntar evidencia Windows de independencia y del dictado local completo, resolver regresiones críticas y acordar qué funciones locales/remotas forman parte del primer producto.

La nueva UI deberá mostrar capacidades disponibles y errores reales; no ocultar pérdida de calidad ni representar servicios propietarios como nuestros. Conservar la referencia visual/funcional hasta completar la comparación. Las decisiones comerciales/cuentas siguen fuera de esta rama.

## Reversión y trazabilidad

Conservar PR #1 y `codex/flosi-baseline` en `323923f9`. Esta rama nace de ese commit exacto; no se modifica main ni upstream. El launcher usa un checkout exclusivo y conserva la carpeta QA. Volver al commit base en un checkout aparte no migra, borra ni importa datos oficiales o QA. No ejecutar `cleanup.js`, uninstall ni reset de la app para revertir este trabajo.

Los resultados de comandos y fallos corregidos de implementación se registran en [FLOSI_ISOLATION_TESTS.md](FLOSI_ISOLATION_TESTS.md); las pruebas Windows deben añadir fecha, hardware, SHA y evidencia propia sin sustituir los resultados cloud.
