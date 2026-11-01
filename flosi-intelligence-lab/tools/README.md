# Recuperar la ejecución v3 detenida por 429

Herramienta independiente, sin dependencias nuevas. Solo añade archivos dentro de `tools/`; no modifica `src/`, prompts, corpus, fixtures, tests existentes ni el motor de evaluación. Está especializada en los 30 casos de desarrollo, prompt v3 y esfuerzo low. No lee el reservado.

La ejecución descrita por el usuario está en `runs/real-v3-full30-win1`: 17 respuestas válidas y una fila de error HTTP 429 en `dev-en-03`, de 30 casos planificados. La referencia es `runs/real-v2-full30-win1`, completada con v2. Estos archivos reales están en el equipo Windows del usuario y no se inspeccionaron en esta entrega. Las pruebas siguientes usan exclusivamente artefactos y HTTP falsos. **No se hizo ninguna solicitud auténtica a Groq ni se completó aquí el benchmark real.**

## Preflight sin red en Windows 11 / PowerShell

Requisito: Node.js 22 o posterior. No instalar dependencias ni ejecutar la aplicación original. Desde PowerShell:

```powershell
Set-Location 'C:\Users\sebas\source\flosi-intelligence-lab-20261031\flosi-intelligence-lab'
node tools/recover.mjs check --source runs/real-v3-full30-win1 --baseline runs/real-v2-full30-win1 --out runs/real-v3-full30-win1-recovered1
```

`check` no necesita clave, no espera ni hace peticiones, y no crea resultados. Para esta ejecución debe mostrar `reused: 17`, `newRequests: 13` y la lista desde `dev-en-03` hasta `dev-en-15`. Se rechaza un directorio de salida existente o solapado con cualquier entrada. Si el comando falla, no ejecutar la recuperación hasta resolver la validación. No editar hashes ni resultados para forzarla.

Antes de continuar se comprueban:

- Formato del manifiesto, estado, identidad de ejecución y hash SHA-256 exacto de `rows.jsonl`; se rechazan archivos truncados o con fin de línea alterado.
- Hash actual del evaluador, corpus de desarrollo y prompt v3; texto de sistema, versión y hash deben coincidir con `loadPrompt('v3')`. El corpus reservado no se abre: su digest ya forma parte del manifiesto versionado del corpus, que se valida como metadato.
- Los 30 IDs y su orden, input, referencias, idioma, tags, ambigüedad, rúbrica, outputHash y checks guardados. Se recalculan los checks con el evaluador existente, sin cambiar su lógica ni convertir una coincidencia léxica en aprobación semántica. Las revisiones humanas existentes también se validan y conservan.
- Un prefijo continuo de respuestas válidas y un único error final 429. En la fuente original se exigen exactamente 18 filas y el fallo en `dev-en-03`. No se reutilizan respuestas incompletas, con tool calls, de otro modelo o con usage incoherente. Se rechazan IDs de caso o respuesta duplicados.
- JSON de respuesta original, contenido, modelo devuelto, finish_reason, tokens y duración. Los costes declarados deben concordar con usage y las tarifas guardadas, o permanecer explícitamente desconocidos. Una tarifa guardada no demuestra su vigencia comercial.
- Modelo `openai/gpt-oss-120b`, low, temperatura 0, seed 42, una petición a la vez, cero reintentos, timeout de 30 s y el límite de salida original. Ese límite debe coincidir con el de v2; no se modifica silenciosamente para terminar la prueba.
- La referencia v2 completa y sus 30 respuestas, hashes y parámetros. Ambas deben tener el mismo `evaluatorHash` actual, corpus, orden y configuración salvo el prompt. No se copia un hash incompatible para eludir el comparador.

Son verificaciones de consistencia local, no una firma de autenticidad de Groq. Los archivos históricos no están firmados: editar contenido y todos sus hashes puede falsificar un registro. Conservar los originales y sus copias de seguridad. La herramienta rechaza secretos reconocibles en artefactos importados en lugar de alterarlos al copiarlos.

## Comando exacto de recuperación, para ejecutar posteriormente

**Requiere aprobación explícita del gasto por el operador. Esta entrega no autoriza ni ejecuta esas solicitudes.** Abrir PowerShell local sin grabación/transcripción. La clave se introduce de forma oculta y solo se utiliza desde el entorno del proceso:

```powershell
$labSecret = Read-Host 'Groq API key (entrada oculta)' -AsSecureString
$labCredential = [System.Management.Automation.PSCredential]::new('groq', $labSecret)
$env:GROQ_API_KEY = $labCredential.GetNetworkCredential().Password
Remove-Variable labSecret, labCredential
$env:FLOSI_LAB_INPUT_USD_PER_MILLION = Read-Host 'Tarifa vigente de entrada USD por millon (punto decimal)'
$env:FLOSI_LAB_OUTPUT_USD_PER_MILLION = Read-Host 'Tarifa vigente de salida USD por millon (punto decimal)'

node tools/recover.mjs recover --source runs/real-v3-full30-win1 --baseline runs/real-v2-full30-win1 --out runs/real-v3-full30-win1-recovered1 --allow-paid-api --prices-verified --max-new-requests 13 --max-cost-usd 0.10 --interval-seconds 15
```

`--prices-verified` declara que el operador verificó las tarifas vigentes en `https://groq.com/pricing/`; la herramienta no consulta ese sitio ni hace llamadas para descubrir tarifas o modelos. Se registra la fecha y la fuente de la declaración. El flag de API tampoco reemplaza la autorización explícita de gasto.

El presupuesto USD 0,10 se aplica **solo a las solicitudes nuevas**. Antes de crear la salida se calcula para los 13 casos una reserva conservadora con bytes UTF-8 de entrada + margen de framing y el máximo de salida original, usando las tarifas configuradas. Si excede USD 0,10, se rechaza todo antes de llamar: no aumentar el presupuesto automáticamente. También se comprueba antes de cada petición. No es un límite de facturación garantizado por el proveedor; tarifas incorrectas o llamadas sin usage pueden impedir conocer el total.

Hay una espera de 15 segundos antes de cada petición, incluida la primera; después, llamadas estrictamente secuenciales. Se admite `--interval-seconds` entre 1 y 300, con 15 por defecto. El tiempo mínimo de espera para 13 solicitudes es 195 segundos, más sus latencias. Este ritmo puede reducir presión sobre cuotas por minuto, **sin garantizar que evite otro 429**. No cambia esfuerzo, prompt, seed, temperatura, límite de salida o contenido del dictado. No hay herramientas, búsqueda, segundo LLM ni peticiones auxiliares.

## Resultado nuevo y trazabilidad

Nunca se sobrescribe la fuente o la referencia v2. Se rechazan salidas que sean iguales, padres o descendientes de las entradas. Se vuelven a comprobar los hashes de las entradas, código y corpus tras cada espera, antes de la siguiente solicitud.

El resultado nuevo conserva los primeros 17 outputs, JSON de Groq, usage, latencias, costes, checks y revisiones. Se cambia el runId contenedor para que `loadRun` y el comparador existentes acepten el conjunto combinado; cada fila incluye `provenance` con runId, número y hash de su fila de origen y las tarifas de ese origen. Las filas nuevas identifican su propia sesión. No se corrigen las respuestas para que pasen checks. Se copian sin alterar los bytes del manifiesto y filas fuente a `source/` dentro de la salida.

- `rows.jsonl`: como máximo una fila canónica por caso, en orden. La antigua fila fallida se sustituye solo si llega una respuesta nueva válida; su intento no se borra de la contabilidad.
- `manifest.json`: `apiRequests` cuenta exclusivamente solicitudes nuevas; `recovery` registra procedencia, hashes de fuente/v2, respuestas reutilizadas, ritmo, verificación de precios y contabilidad. Se preserva el `evaluatorHash` real y se añade un `toolHash` independiente; no se altera el código para hacerlos coincidir.
- `attempts.jsonl`: registro de todos los intentos históricos y nuevos, incluidos los 429; identifica ejecución y número de intento, caso, usage, hash de respuesta, tarifa, coste conocido o null y error seguro.
- `accounting.json`: solicitudes y costes históricos/nuevos separados, suma conocida, número de intentos con coste desconocido y coste total null si falta cualquier dato. Una llamada 429 anterior sin usage sigue desconocida; nunca se convierte en cero ni se reconstruye a partir de la respuesta posterior del mismo caso.
- `journal.jsonl`: registro de intención de envío y recepción persistida. Si se interrumpe el proceso con una petición en vuelo, la salida queda `running` y no se reenvía automáticamente una solicitud de cobro incierto.
- `summary.csv`, `report.md`, `review-template.json`: formatos existentes, con una nota adicional de gasto y procedencia. Las decisiones humanas pendientes siguen pendientes.

Con 13 respuestas nuevas válidas, las filas serán 30 y el total histórico será **31 intentos: 18 anteriores + 13 nuevos**. El manifiesto tendrá `apiRequests: 13`; el intento 429 anterior se conserva en el ledger. Si su coste continúa desconocido, el coste total seguirá desconocido aunque las 30 respuestas válidas tengan costes estimados.

Los campos de costes del comparador existente solo suman filas canónicas: no representan todos los intentos cobrables. La comparación que genera esta herramienta añade una advertencia y remite a `accounting.json`. No comparar el coste de 13 llamadas nuevas con el de las 30 de v2 como si fueran benchmarks completos equivalentes. Las latencias combinan observaciones de sesiones distintas y excluyen el tiempo de espera del cliente.

## Otro 429 o una parada nueva

Un 429 se registra como código HTTP 429 y solo con metadatos de cuota permitidos: límites/restantes numéricos, duraciones de reset y Retry-After numérico o fecha HTTP válida. No se guardan Authorization, cookies, cabeceras arbitrarias, cuerpos de error ni mensajes de excepciones. Retry-After se registra como diagnóstico; no provoca un reintento. La ejecución se detiene inmediatamente y devuelve código de salida 2. Un error de validación/IO devuelve 1.

Para una segunda recuperación **manual y nuevamente autorizada** tras otro 429, usar como `--source` la carpeta derivada más reciente y un `--out` nuevo. La herramienta verifica recursivamente sus fuentes y el ledger; reutiliza todas las respuestas válidas acumuladas y calcula el sufijo restante. Conservar todas las carpetas originales y derivadas: sus referencias por hash forman la cadena. No volver a usar la fuente inicial si ya hubo progreso en una recuperación posterior. No ejecutar dos procesos de recuperación de la misma fuente en paralelo; no existe una exclusión global entre directorios de salida diferentes.

También se detiene ante timeout, fallo de red, respuesta vacía/truncada, modelo o respuesta inesperados, usage ausente, respuesta duplicada o presupuesto agotado. No se recuperan automáticamente paradas de tipo incierto o por IO, ni salidas `running`: revisar manualmente el proveedor antes de decidir si es seguro volver a solicitar ese caso. No convertir una carpeta incompleta en `complete` editando el manifiesto. Una futura modificación de esta herramienta cambia su toolHash; para recuperar su salida con esta versión, conservar el mismo código y la cadena íntegra.

## Validar las 30 respuestas y comparar

Solo si la recuperación termina con `state: complete`, se vuelve a validar la salida real guardada y toda su trazabilidad. Entonces se llama al comparador existente, **sin solicitudes de API**, y se generan `comparison/comparison.csv` y `comparison/comparison.md` dentro de la nueva carpeta. Si vuelve a detenerse, no se genera una comparación de 30 casos.

Comprobación posterior sin red:

```powershell
node tools/recover.mjs verify --source runs/real-v3-full30-win1-recovered1 --baseline runs/real-v2-full30-win1
Get-Content runs/real-v3-full30-win1-recovered1/comparison/comparison.md
Remove-Item Env:GROQ_API_KEY, Env:FLOSI_LAB_INPUT_USD_PER_MILLION, Env:FLOSI_LAB_OUTPUT_USD_PER_MILLION
```

También se puede usar directamente `node src/cli.mjs compare` sobre v2 y el resultado completo: las pruebas lo ejercitan sin cambiar el evaluador. Sus informes léxicos siguen necesitando revisión humana para juzgar significado. No se afirma que v3 mejore ni que el benchmark haya terminado antes de ejecutar y validar las solicitudes auténticas pendientes.

## Pruebas locales sin red ni reservado

Desde el laboratorio:

```powershell
node --import ./tools/test/offline-guard.mjs --test --experimental-test-isolation=none tools/test/recover.test.mjs
node --import ./tools/test/offline-guard.mjs --test --experimental-test-isolation=none --test-skip-pattern="50 synthetic cases|prompts contain no reserved case|CLI validates offline" test/lab.test.mjs
```

No ejecutar `npm test` o `validate` para esta entrega: la suite general contiene comprobaciones que abren el reservado. El guard bloquea fetch externo y cualquier lectura de su archivo; informa contadores al terminar. Los tests nuevos construyen fuentes sintéticas con la forma 17 válidas + 429 y una referencia falsa de 30 filas, siempre con transportes HTTP locales y sin esperas reales. Sus etiquetas `mode: real` prueban la compatibilidad del formato, no acreditan solicitudes auténticas.

Cobertura: sufijo exacto de 13 solicitudes, preservación de originales, comparación v2/v3 con evaluatorHash intacto, segunda parada 429 y reanudación manual del nuevo sufijo, headers seguros, costes previos desconocidos y tarifas mixtas, hashes inválidos, prompt/parámetros alterados, filas/respuestas duplicadas, cuotas de gasto, carpeta existente/solapada, secretos, cambios de entradas durante la espera, timeout, usage ausente y trazabilidad adulterada. Resultado local: 17 pruebas nuevas y 18 existentes seleccionadas aprobadas, con cero intentos de fetch externo o lectura del reservado en ambas ejecuciones. Verificación ejecutada en Linux con Node.js 24.19.0; Windows 11/PowerShell queda pendiente de ejecución por el usuario.

Errores frecuentes: `ROWS_HASH`/`OUTPUT_HASH` indican alteración o truncación; `CONTEXT_HASH`/`PROMPT_MISMATCH` código o corpus distintos; `BASELINE_PARAMETERS` configuración no comparable; `INSUFFICIENT_BUDGET` rechaza el plan antes de llamar; `OUTPUT_EXISTS` exige un nombre nuevo; `INPUT_CHANGED` detiene por cambios concurrentes. No copiar claves o transcripciones privadas en informes de diagnóstico.
