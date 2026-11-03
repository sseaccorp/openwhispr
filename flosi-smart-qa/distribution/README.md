# Flosi Smart QA P0 — descarga y ejecución

**P0 abierto. Herramienta experimental, no producción.**

[Descargar Flosi-Smart-QA-P0.zip](https://github.com/sseaccorp/openwhispr/blob/codex/flosi-smart-qa-p0/flosi-smart-qa/distribution/Flosi-Smart-QA-P0.zip?raw=true)

ZIP: 8.088.734 bytes. SHA-256:

```text
f1d9618c9ad012740fb90bb44cc662e74c71143c91a067c0b13108b9c9b8ff13
```

Fuente incluida: `eba412025d4327f0f0c043f1dd494db72983adb0`.
Código candidato congelado: `6227942c9d498b032c627fe93aa0cbf2db5d981b`.
El commit de distribución solo añade ZIP, identidad, checksum y comprobación.

El ZIP se extrajo en una carpeta nueva, verificó sus 29 archivos congelados y
pasó los 59 tests de la herramienta usando el entorno Linux ya preparado.
No constituye instalación nueva Windows ni validación de micrófono físico.
No incluye modelos, caches, credenciales, runtime ni perfiles Flosi QA.

Sigue [WINDOWS.md](../WINDOWS.md) para el bloque exacto de PowerShell con selector
de ZIP y carpeta GUID nueva. Python 3.12 x64; Chrome/Edge; recomendados 16 GB RAM
y al menos 6 GB libres. Primer inicio: descarga de unos 4 GB con hashes fijos.
No requiere Git, Node ni clave API.

Incluye motor, interfaz, tests, reportes, WAV humanos licenciados y todas las
respuestas/evidencia guardadas, también las fallidas. Antes/después visibles;
ninguna inserción automática en otras aplicaciones.

- [Informe técnico y criterios pendientes](../REPORT.md)
- [Audio: referencia → ASR → salida → errores y tiempos](../AUDIO.md)
- [Última revisión textual completa](../TEXT-REVIEW.md)
- [Métricas verificables](../evidence/metrics.json)
- [Checksums](SHA256SUMS.txt)

La última batería obtiene 9/12 coincidencias, 5/8 en cambios requeridos. Conserva
los cuatro controles, uno mediante rechazo. Audio espontáneo de 2→4 millones
funciona conservando if; voltaje, algunos ASR y reparaciones difíciles siguen
fallando. Los tests verdes no aprueban la calidad del dictado.
