# Evidencia de Flosi QA MVP

Fuente de implementación fijada: `f82e3fe06df2b828de2c231735fd2f0d0f33de16`, sobre `a31a82182d8bda46c4aae5853098ea77185cfdba`. Los commits posteriores de entrega solo documentan y empaquetan esta evidencia; `code-snapshot.json` permite comprobar los archivos de código y tests.

- `results.json`: conteos definitivos, pasadas anteriores y limitaciones. Los subconjuntos se solapan; no sumar todos los aprobados.
- `commands.json`: comandos de verificación, UTC, duración, exit code del hijo y SHA-256 del log. La sesión supervisora de la primera pasada informó 130 después de un intento de interrupción, aunque el hijo completó y registró exit 0; la pasada definitiva usa una sesión nueva.
- `native-linux.json`: inferencia real de los dos motores, casos ES/EN, dos WAV sintéticos, fallbacks, cancelación, memoria observada, listeners por PID/inode y cierre. No es Windows, micrófono ni clipboard.
- `preparation-real.json`: descarga/extracción real del runtime Windows y comprobación del GGUF exacto ya descargado; segunda ejecución sin descargas. `probe.executed=false` en Linux es deliberado: ningún EXE Windows se ejecutó aquí.
- `environment.json`: toolchain, límites del entorno cloud y ausencia de QA Windows.
- `skips.json`: las omisiones y el TODO exactos del TAP final.
- `model-provenance.json`: revisión, licencia declarada y puntero LFS del archivo solicitado, sin sustitutos.
- `unchanged-core.json`: comparación byte a byte y hashes de los componentes centrales conservados frente a la base.
- `VERIFICATION_LOGS.zip`: logs completos, incluidos intentos fallidos, scripts auxiliares de reproducción y dos WAV generados con libflite. No contiene modelos, ejecutables, DLL, instaladores, claves ni grabaciones del usuario.
- `SHA256SUMS.txt`: integridad de los archivos de evidencia, incluido el ZIP. Verificar además los SHA indicados dentro de `commands.json` tras extraer los logs.

Consultar `../FLOSI_MVP_TESTS.md` para interpretar los resultados y `../FLOSI_MVP_WINDOWS_QUICKSTART.md` para la prueba nativa pendiente. Un fallback seguro no significa que el modelo haya corregido bien ese caso.
