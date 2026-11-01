# Ejemplos fabricados

Estos artefactos se generaron sin clave ni solicitudes externas. `fixtures/v1.json` y `fixtures/v2.json` contienen respuestas escritas para ejercitar el pipeline; derivan de referencias con errores plantados. **No son respuestas de GPT-OSS.** No prueban calidad del modelo, latencia, tokens, coste real o superioridad de un prompt.

La comparación incluye mejoras léxicas plantadas y dos regresiones en desarrollo: `dev-es-08` pierde una negación y `dev-en-09` cambia 0.05 a 0.5. Todas las decisiones humanas permanecen pendientes. Los campos de tokens, coste y latencia del proveedor son null; localElapsedMs solo mide procesamiento local.

Se regeneran desde la raíz del laboratorio con nombres de salida nuevos:

```powershell
node src/cli.mjs run --mode simulate --prompt v1 --split dev --out runs/example-v1
node src/cli.mjs run --mode simulate --prompt v2 --split dev --out runs/example-v2
node src/cli.mjs compare --baseline runs/example-v1 --candidate runs/example-v2 --out runs/example-comparison
```
