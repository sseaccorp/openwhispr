# Flosi Intelligence Lab

Laboratorio independiente para evaluar `openai/gpt-oss-120b` en Groq como editor de dictados en español e inglés. No importa código de Flosi QA ni OpenWhispr, no instala modelos y no cambia sus perfiles, configuración, instaladores ni mecanismos de dictado/pegado. No contiene backend ni integración de producción.

**Esta entrega no incluye solicitudes auténticas a Groq. Los ejemplos son simulados y no permiten afirmar calidad de GPT-OSS ni competitividad frente a Wispr Flow.**

## Inicio en Windows 11 / PowerShell

Requisito: Node.js 22 o posterior con npm. No se necesita Python, SDK, API key, cuenta, servicio local ni instalación de dependencias. Desde la raíz del checkout de esta rama:

```powershell
Set-Location .\flosi-intelligence-lab
node --version
npm.cmd test
node src/cli.mjs validate
node src/cli.mjs run --mode simulate --prompt v1 --split dev --out runs/sim-v1
node src/cli.mjs run --mode simulate --prompt v2 --split dev --out runs/sim-v2
node src/cli.mjs compare --baseline runs/sim-v1 --candidate runs/sim-v2 --out runs/sim-comparison
Get-Content runs/sim-comparison/comparison.md
```

`npm.cmd` evita que la política de ejecución de PowerShell bloquee `npm.ps1`; no es necesario cambiar esa política. No ejecutar `npm install` en la raíz de OpenWhispr para usar este laboratorio. Este paquete no tiene dependencias ni scripts de instalación. `npm.cmd run simulate` también funciona: usa `v2`, `dev`, `low` y un directorio nuevo con fecha. Los nombres de salida explícitos deben ser nuevos; nunca se sobrescriben resultados. Para repetir, elegir otro nombre. Todos los paths de artefactos son relativos al laboratorio, aunque la terminal esté en otra carpeta.

Las pruebas precargan un bloqueo de `fetch` y usan transportes falsos para probar la API. Nunca llaman a Groq. Los tiempos de esas pruebas no representan latencia del proveedor. En algunos entornos el runner muestra una sola entrada por archivo; el detalle se ve con:

```powershell
node --import ./test/no-network.mjs test/lab.test.mjs
```

## Corpus y separación de evaluación

Hay exactamente 50 casos escritos para esta entrega: 25 españoles y 25 ingleses. `corpus/dev.json` contiene 30 casos (15 por idioma), y `corpus/holdout.json` contiene 20 (10 por idioma). Cada caso tiene input sintético, una o más referencias admitidas, tags, comprobaciones verificables, criterio de revisión y una marca de ambigüedad. Incluye reparaciones de frases enteras, entidades, fechas, cantidades, negaciones, muletillas, usos semánticos de palabras como «este»/«well», habla natural, comandos, dictados parecidos a instrucciones al asistente y citas literales.

El modo habitual solo lee `dev`. Para acceder al reservado hay que pasar `--split holdout --unlock-holdout`. Los hashes del corpus detectan cambios involuntarios. El validador y las pruebas leen el reservado para verificar su estructura y coherencia, no para elegir prompts. Los prompts no incluyen referencias ni ejemplos del reservado. El request solo contiene el prompt de sistema y el input del caso; nunca las expectativas o los checks.

El reservado está versionado en Git y no está oculto criptográficamente. Es una separación de procedimiento, no una garantía de cegamiento. Antes de medirlo, congelar y registrar el hash del prompt, los parámetros y la hipótesis. Después de observar sus resultados, no seguir ajustando contra esos mismos 20 casos ni llamarlos evaluación ciega: crear un nuevo conjunto reservado en una versión futura. Véase [protocolo](docs/evaluation-protocol.md).

## Qué mide el evaluador

Se registran por separado las señales de autocorrecciones, muletillas, significado, nombres, cifras/fechas/unidades, negaciones y puntuación. `contains` acepta al menos una variante declarada, `absent` exige que no aparezca ningún fragmento prohibido; ambas normalizan Unicode, mayúsculas y espacios. Son comprobaciones léxicas parciales, con falsos positivos/negativos. No implementan un corrector ni modifican la respuesta. `terminal` comprueba solo un signo final, no la calidad completa de puntuación.

La coincidencia con una referencia es diagnóstica. **Incluso una coincidencia exacta deja pendiente la revisión humana.** Toda salida requiere lectura para certificar significado; las ambigüedades requieren especial atención y pueden terminar como `uncertain`. No se usa otro LLM como juez. No hay puntuación global ni umbral comercial inventado.

Los informes contienen denominadores, errores separados, señales por dimensión y decisiones humanas. Una comparación detecta cambios `pass → flag` por dimensión y `pass → fail/uncertain` humanos. Son regresiones candidatas hasta revisar el contenido. Rechaza comparar diferentes corpus, evaluadores, modos, casos u órdenes, y ejecuciones incompletas. Comparar distintos esfuerzos es posible, pero el informe advierte que no se puede atribuir el cambio solo al prompt.

## Artefactos y revisión humana

Cada ejecución genera:

- `manifest.json`: prompt completo, versión y hash; hash de evaluador/corpus/fixture; modelo, esfuerzo, seed, temperatura, límite de salida, tarifas, presupuesto, entorno, fechas, casos y estado.
- `rows.jsonl`: input sintético, respuesta original y JSON del proveedor cuando HTTP fue exitoso, tokens, latencia, error estructurado, coste estimado, checks y revisión. Se redactan secretos antes de escribir. Los cuerpos arbitrarios de errores HTTP no se guardan para evitar que reflejen credenciales.
- `summary.csv` y `report.md`: resultados por caso y resumen. El CSV usa UTF-8, comillas/CRLF y neutraliza fórmulas de hoja de cálculo; si Excel no reconoce la codificación, importar como UTF-8. Las respuestas exactas están en JSONL.
- `review-template.json`: plantilla vinculada al ID de ejecución y hash de cada respuesta.

Copiar y editar la plantilla localmente. En cada revisión enviada, rellenar `reviewer`, `notes` y todas las dimensiones con `pass`, `fail`, `uncertain` o `na`. Meaning y puntuación no aceptan `na`. Eliminar de la copia los casos que aún no se han revisado; permanecerán `pending`. No dejar valores `pending` en una revisión enviada. No es posible aprobar respuestas truncadas o con errores de API.

```powershell
Copy-Item runs/sim-v2/review-template.json runs/reviews-v2.json
notepad runs/reviews-v2.json
node src/cli.mjs review --run runs/sim-v2 --reviews runs/reviews-v2.json --out runs/sim-v2-reviewed
```

La revisión crea un directorio nuevo y conserva las salidas originales. Para comparar revisiones, usar esos directorios como base y candidato. Una revisión con cualquier `fail` falla; con algún `uncertain` y sin fallos queda incierta. Revisiones pendientes no cuentan como aprobadas. Ver la [rúbrica](docs/evaluation-protocol.md).

## Primera ejecución real controlada: requiere aprobación explícita previa

**Estos comandos están preparados, pero no se ejecutaron en esta entrega.** Hace falta una API key válida de Groq, permiso de salida HTTPS hacia `api.groq.com`, disponibilidad del modelo y tarifas vigentes verificadas por el operador. El código no consulta tarifas ni descubre modelos mediante llamadas de red. Modelo fijo: `openai/gpt-oss-120b`; endpoint fijo HTTPS, redirecciones rechazadas. No se envían herramientas, búsqueda, audio ni archivos locales de Flosi.

Tras aprobar explícitamente el gasto, abrir una sesión local de PowerShell sin grabación/transcripción. Introducir la clave mediante entrada oculta, sin escribirla literalmente en comandos, archivos `.env`, historial, informes o capturas:

```powershell
$labSecret = Read-Host "Groq API key (entrada oculta)" -AsSecureString
$labCredential = [System.Management.Automation.PSCredential]::new("groq", $labSecret)
$env:GROQ_API_KEY = $labCredential.GetNetworkCredential().Password
Remove-Variable labSecret, labCredential
$env:FLOSI_LAB_INPUT_USD_PER_MILLION = Read-Host "Tarifa vigente de entrada USD por millon (punto decimal)"
$env:FLOSI_LAB_OUTPUT_USD_PER_MILLION = Read-Host "Tarifa vigente de salida USD por millon (punto decimal)"

# Una sola solicitud, primer caso español de dev, esfuerzo low, máximo 512 tokens.
node src/cli.mjs run --mode real --allow-paid-api --prompt v2 --split dev --effort low --limit 1 --max-tokens 512 --max-cost-usd 0.01 --out runs/real-smoke-v2-low
```

La ejecución se rechaza antes de la primera solicitud si la reserva conservadora excede USD 0,01; no aumentar ese límite automáticamente. `--limit N` selecciona los primeros N casos en orden estable; en `dev` aparecen primero los 15 españoles, luego los 15 ingleses. Un smoke test de un caso no evalúa calidad. Después de revisar ese resultado y **solo con aprobación que cubra las solicitudes adicionales**, ejecutar comparaciones sobre el conjunto de desarrollo:

```powershell
# Hasta 30 solicitudes secuenciales por comando; revisar las tarifas y el presupuesto antes.
node src/cli.mjs run --mode real --allow-paid-api --prompt v1 --split dev --effort low --limit 30 --max-tokens 512 --max-cost-usd 0.10 --out runs/real-dev-v1-low
node src/cli.mjs run --mode real --allow-paid-api --prompt v2 --split dev --effort low --limit 30 --max-tokens 512 --max-cost-usd 0.10 --out runs/real-dev-v2-low
node src/cli.mjs compare --baseline runs/real-dev-v1-low --candidate runs/real-dev-v2-low --out runs/real-dev-comparison
```

Para probar explícitamente `medium` después, conservar el prompt y los demás parámetros, usar `--effort medium` y un directorio nuevo. No hay cambio automático de esfuerzo. Si 512 tokens no bastan para razonamiento + texto, una respuesta `length` se marca truncada y detiene la ejecución; revisar y aprobar una nueva ejecución con mayor `--max-tokens` antes de repetir. El rango admitido es 64–4096, sin reintento automático.

```powershell
node src/cli.mjs run --mode real --allow-paid-api --prompt v2 --split dev --effort medium --limit 1 --max-tokens 512 --max-cost-usd 0.01 --out runs/real-smoke-v2-medium

# Solo después de congelar el prompt y aprobar estas 20 solicitudes reservadas:
node src/cli.mjs run --mode real --allow-paid-api --prompt v2 --split holdout --unlock-holdout --effort low --limit 20 --max-tokens 512 --max-cost-usd 0.10 --out runs/real-holdout-v2-low

# Al terminar, retirar las variables de esta sesión; no imprimirlas.
Remove-Item Env:GROQ_API_KEY, Env:FLOSI_LAB_INPUT_USD_PER_MILLION, Env:FLOSI_LAB_OUTPUT_USD_PER_MILLION
```

Cada comando real exige `--mode real`, `--allow-paid-api`, `--limit`, `--max-cost-usd`, clave y ambas tarifas. El flag es una barrera técnica, no reemplaza la aprobación explícita del usuario. Ninguna ejecución real está autorizada por la mera instalación o el PR.

## Latencia, tokens y coste

Una solicitud cada vez, timeout de 30 segundos, cero reintentos. Se detiene en el primer error HTTP/red/timeout, respuesta vacía/truncada/inesperada, falta de usage o presupuesto insuficiente. Se guarda lo ya recibido. Una ejecución interrumpida externamente puede quedar `running`: no se considera completa ni se reanuda automáticamente, para evitar cobros duplicados.

Coste estimado = `(prompt_tokens × tarifa_entrada + completion_tokens × tarifa_salida) / 1_000_000`. Los tokens de razonamiento incluidos en completion_tokens no se suman otra vez. Las tarifas son variables locales y se guardan como parámetros no secretos de la ejecución. La latencia mide cliente → red → respuesta completa; se reportan p50/p95 de respuestas válidas, sin prometer significación estadística con muestras pequeñas.

Antes de empezar se reserva para todo el plan una cota conservadora de entrada basada en bytes UTF-8 + 1024 de margen por solicitud, y el máximo de tokens de salida. Se comprueba de nuevo antes de cada llamada. **No es un límite de facturación garantizado por Groq**: las tarifas configuradas pueden estar desactualizadas y un timeout/error puede haberse cobrado. Si falta usage, el coste queda desconocido y se detiene; nunca se informa como cero. Conviene configurar también los límites que ofrezca la cuenta del proveedor. No se ha comprobado aquí la aceptación actual de parámetros (`seed`, `max_completion_tokens`, etc.) mediante solicitudes auténticas; cualquier rechazo se registra sin reintentar o cambiar el modelo.

## Privacidad y límites

El runner solo admite los corpus sintéticos incluidos y verificados por hash; no tiene opción de cargar transcripciones privadas. Nunca lee perfiles, credenciales, modelos o archivos de otros proyectos. Las credenciales se toman exclusivamente del entorno del proceso: `.env.example` es documentación vacía y no se carga automáticamente. `runs/`, `.env*` y logs están ignorados por Git; revisar siempre lo que se sube. No poner claves en prompts o fixtures. Las respuestas se conservan con redacción de claves conocidas y patrones de credenciales; eso no sustituye la revisión antes de compartir artefactos.

Este benchmark evalúa edición de texto, no ASR ni audio ni Whisper. No mide acentos, ruido, idiomas mezclados, latencia de dictado/pegado, privacidad operativa o coste de una aplicación completa. Un conjunto sintético de 50 casos no representa usuarios reales. Las referencias pueden tener sesgos; no cubren todas las reformulaciones válidas. Seed y temperatura cero no garantizan determinismo del proveedor. Harán falta repeticiones autorizadas con carpetas nuevas y revisores independientes antes de tomar decisiones de producto. No se entrenan modelos, no se añade un corrector de reglas y no se sustituye el sistema original.

## Ejemplos y diagnóstico

`examples/sim-v1`, `examples/sim-v2` y `examples/comparison` son artefactos generados en modo simulado. Tienen errores plantados, entre ellos una negación española eliminada y un decimal inglés cambiado en `v2`. Sirven para comprobar el laboratorio, no para declarar que v2 sea mejor.

Si el comando termina con error: comprobar nombre de opción con `--help`, directorio de salida nuevo, paths dentro del laboratorio, hash del corpus y configuración local. En modo real revisar `manifest.json` y el `error.type` de `rows.jsonl`: HTTP 401/403 requiere revisar acceso, 429 cuotas/límites, 5xx proveedor; no hay reintentos. No copiar claves ni cuerpos de error privados en issues. Nunca hacer merge de esta rama como parte del laboratorio.
