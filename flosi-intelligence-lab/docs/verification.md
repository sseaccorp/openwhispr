# Verificación de esta entrega

Validado en Linux con Node.js v24.19.0. No se ha ejecutado Windows 11 ni PowerShell aquí; el código usa módulos nativos portables y el README contiene los comandos para esa validación local. No se instaló ninguna dependencia.

Comandos ejecutados desde el laboratorio:

```text
npm test
node --import ./test/no-network.mjs test/lab.test.mjs
node src/cli.mjs validate
node --import ./test/no-network.mjs src/cli.mjs run --mode simulate --prompt v1 --split dev --out examples/sim-v1
node --import ./test/no-network.mjs src/cli.mjs run --mode simulate --prompt v2 --split dev --out examples/sim-v2
node src/cli.mjs compare --baseline examples/sim-v1 --candidate examples/sim-v2 --out examples/comparison
```

Resultado: 21 pruebas locales aprobadas; 50 casos sintéticos validados (30 desarrollo / 20 reservados, 25 por idioma). Dos ejecuciones simuladas de 30 casos cada una, con apiRequests=0. La comparación detectó las regresiones plantadas de negación en dev-es-08 y decimal en dev-en-09. Todas las decisiones humanas siguen pendientes; no se presentan como calidad medida del modelo.

Las pruebas de respuestas HTTP usan exclusivamente transportes falsos en memoria: éxitos, 401/429/500, timeout, fallo de red, JSON inválido, truncación, respuesta vacía, tool calls inesperados y usage ausente. Se verificaron barreras de gasto, redacción de secretos, costes con tokens de razonamiento incluidos, integridad de resultados y vinculación de revisiones a sus respuestas.

Base de trabajo: `fc786f41c91de8177ce7d9333d2834d973cc3c19` de `sseaccorp/openwhispr`. Se creó `codex/flosi-intelligence-lab` en un worktree separado. Se comprobó que el checkout original seguía limpio y que el diff de entrega contenía únicamente archivos nuevos bajo `flosi-intelligence-lab/`. No se modificaron archivos existentes, modelos, configuraciones ni instaladores. No se hizo merge ni se ejecutaron tests o instalaciones de la aplicación original. No se verificó una instalación de Flosi en un equipo Windows que no está disponible en este entorno.

**No se hicieron solicitudes auténticas a Groq ni se probó GPT-OSS.** Para hacerlo faltan aprobación explícita del gasto, clave local, tarifas verificadas, acceso HTTPS/disponibilidad del modelo y la ejecución manual controlada indicada en README.md. También queda pendiente validar en un equipo Windows 11 real. No hay evidencia en esta entrega para prometer calidad comercial o superioridad sobre otro producto.
