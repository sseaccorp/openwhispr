# V4: entrega P0 verificable, pendiente de inferencia auténtica

V4 es un candidato conservador, **no una corrección semántica demostrada**. No se hicieron solicitudes reales a Groq. EN-14, EN-03, ES-07 y la introducción de espacios Unicode siguen pendientes de comprobar con respuestas auténticas de `openai/gpt-oss-120b`, esfuerzo `low`. Las cifras comunicadas por el usuario (30 casos, siete alertas v2 y dos v3) no son una medición nueva ni precisión comercial.

Prompt: `../../prompts/v4.json`, versión `4.0.0`, SHA-256 de bytes UTF-8/LF:

```text
eea5087aac218db999328c0dd33f8ed25364c7bc7da645367a6aed7fdef60c8e
```

326 palabras de sistema frente a 303 en v3; esto no es un recuento de tokens del proveedor. No se cambian modelo, esfuerzo, temperatura 0, seed 42, salida máxima de 512 tokens, timeout de 30 segundos ni concurrencia 1. No se añade posprocesamiento, un segundo modelo, búsqueda ni una integración en Flosi QA.

## Evidencia disponible y diagnóstico

Se inspeccionaron el código publicado, los prompts y exclusivamente `corpus/dev.json`. No existen aquí las carpetas Windows `runs/real-v3-complete30-recovered-win2` y `runs/real-v2-full30-win1`; no se leyeron sus manifiestos, respuestas ni puntuaciones. Las salidas concretas de EN-14/EN-03 y el problema de ES-09 proceden del relato del usuario. Sin respuestas completas, trazas ni audio no se puede demostrar la causa interna de las decisiones del modelo.

V3 ya pide conservar citas sin comillas y retirar marcadores. La hipótesis es que esas instrucciones quedan demasiado implícitas ante la prioridad de resolver reparaciones completas y la instrucción general de conservar tono. Añadir sinónimos de la misma regla no acreditaría una mejora. V4 hace explícita la precedencia entre regiones de habla literal y la limpieza, y delimita mejor las operaciones permitidas.

Sí se comprobaron defectos locales del evaluador: `src/evaluate.mjs` busca fragmentos normalizados; `normalize` pasa a minúsculas y colapsa `\s`, incluyendo NBSP y espacio estrecho. EN-03 no tiene un check que prohíba el marcador residual. Sus checks pueden dar verde con «Sorry, email…»; el check de cantidad puede dar verde con `0,5\u202fmg`. Una secuencia parcial tampoco comprueba todas las palabras ni el orden de una cita. No se modifica ese evaluador ni su hash: se añade una auditoría suplementaria versionada.

## Decisiones de diseño y regresiones posibles

| Cambio frente a v3 | Justificación técnica | Riesgo y control preparado |
| --- | --- | --- |
| Proteger primero palabras y orden del habla presentada como literal, con o sin comillas; no resolver reparaciones dentro de ella. | La cita es contenido, aunque contenga vocabulario de autocorrección. | Proteger demasiado puede dejar reparaciones reales. Casos emparejados de cita literal, atribución indirecta, reparación exterior y límites ambiguos. |
| Aclarar que la mera atribución no prueba literalidad, ni autoriza inventar fronteras. | Evitar convertir cualquier «dijo» en una cita protegida o incluir narración exterior. | El texto ASR sin prosodia puede no bastar. Preservar ambigüedad y revisar manualmente; no inferir intención por una palabra aislada. |
| Retirar marcadores asociados donde aparezcan, sin moverlos al inicio; conservar disculpas reales. | La grafía final del nombre y el marcador tienen funciones distintas. | Eliminar una disculpa real. Contraejemplos con disculpa real y marcador reparador en la misma entrada, en ambos idiomas. |
| Mantener reemplazo completo, retractación, contraste, condiciones, negación e incertidumbre; separar repetición accidental de énfasis. | Retener las mejoras observadas de v3 sin simplificar todo a «gana lo último». | Borrar una acción adicional válida, una alternativa o una negación. Permanecen los 30 controles originales y nuevos contrastes/retractaciones. No se consideran superados por pruebas simuladas. |
| Copiar también números, decimales y espacios de cantidades carácter por carácter, sin signos o espacios tipográficos sustitutos. | Un espacio no separable puede romper un parser; un signo o un guion visualmente similar puede cambiar un valor o identificador. | Preservar una rareza del ASR. Solo una corrección explícita autoriza sustituirla; hay controles de cantidades corregidas. La comparación técnica evita normalizar bytes. |
| Puntuar prosa fuera de regiones protegidas; preservar puntuación existente de citas explícitas y no añadir un punto a comandos/rutas aislados. | Un punto puede pasar a formar parte de un argumento o una ruta. | Menos fluidez o puntuación imperfecta del ASR retenida. En citas sin puntuación, la auditoría de palabras tolera variaciones de signos; no etiqueta toda diferencia tipográfica como pérdida semántica. |

No hay listas globales de palabras a eliminar, ejemplos del benchmark ni respuestas esperadas copiadas al prompt. La normalización de producción no se cambia: la fidelidad sigue siendo una instrucción al modelo, no una garantía impuesta por código.

## Datos y separación del experimento

- `dev.json`: 32 casos sintéticos nuevos (16 es / 16 en). Son **desarrollo**, utilizados para el diseño y la validación de las utilidades; nunca una evaluación ciega.
- `historical-checks.json`: reglas adicionales vinculadas al hash del input de nueve casos originales. No cambia sus referencias, rúbricas ni checks. Se ejecutan también todos los checks históricos sobre los 30 casos.
- `freeze.json`: hashes del prompt, datos de desarrollo, auditoría, runner, CLI, guard, dependencia de recuperación y evaluador histórico; parámetros y commit base. `verify` rechaza cualquier discrepancia. Las rutas de Windows mantienen LF mediante el `.gitattributes` existente.
- El **holdout original no se abrió, evaluó ni utilizó**. Su digest aparece como metadato del manifiesto histórico, sin leer su archivo. Tampoco se ejecutan `npm test` ni `src/cli.mjs validate`, que abren ese split.
- No se crean aquí datos de aceptación postcongelación. Deben autorarse y custodiarse por separado, después de congelar este candidato, sin usarse para ajustar v4. No hay una ruta que cargue holdout en estas utilidades. Si un resultado futuro obliga a ajustar el prompt, crear otra versión y otro conjunto independiente para validar la nueva versión.

La nota histórica de v3 documenta acceso accidental al reservado en una entrega anterior. Esta entrega no reutiliza su contenido ni presenta el conjunto público como una muestra comercial ciega.

## Auditoría: A, B, C y D separados

`audit.mjs` produce alertas, nunca aprobación automática:

- **A, fidelidad:** checks históricos de intención/negación/reparación y secuencias de palabras anotadas. Conserva el orden e ignora puntuación para citas sin delimitación explícita. Puede omitir cambios de alcance, adiciones o fronteras equivocadas: siempre requiere lectura humana.
- **B, limpieza:** marcadores y conteos específicos del caso, puntuación histórica y controles de énfasis. No se aplican como filtros sobre la salida y no son listas de eliminación globales.
- **C, integridad:** spans anotados exactos sin normalización de Unicode, espacios o mayúsculas; rechaza signos añadidos, sufijos y coincidencias parciales. Detecta diferencias en caracteres Unicode especiales sin reescribirlos. Los spans son anotaciones limitadas: no aseguran exhaustividad en texto arbitrario.
- **D, rendimiento:** usage de entrada/salida (incluidos tokens de razonamiento si están en completion), latencia de la petición desde el cliente, errores y coste estimado con tarifas declaradas. En simulación son `null`. P50/P95 en ejecuciones completas no representan tráfico comercial. El tiempo de espera entre solicitudes no es latencia de API.

`compare` muestra alertas nuevas por grupo y por caso; no suma A/B/C en una puntuación. La prueba de integración introduce deliberadamente una regresión de negación mientras mejora limpieza y espacios: debe seguir visible. El texto de referencia es una opción aceptable, no la definición completa de corrección.

`review-template.json` vincula cada revisión al outputHash y conserva el criterio del caso. Es una plantilla: esta herramienta no adjudica ni importa una aprobación humana. Revisar las salidas completas, incluso aquellas sin alertas, preferiblemente con identidad del prompt oculta y adjudicación de discrepancias. Nunca editar las respuestas para aprobarlas.

## Herramienta aislada y seguridad de ejecución

`verify`, `prepare` y `compare` son locales. `prepare` construye los mensajes sin transportarlos; referencias, checks y rúbricas no aparecen en el cuerpo enviado. `run` es exclusivamente una evaluación futura con opt-in explícito de API, tarifas verificadas, límite, número máximo exacto de solicitudes, presupuesto positivo y clave ya disponible en el proceso local. No se solicitan ni guardan claves en esta entrega.

Cada caso produce una sola solicitud por versión evaluada, sin reintentos. La comparación v3/v4 es un experimento separado, no un doble procesamiento en el producto. Hay al menos 15 segundos antes de cada solicitud, incluida la primera. Un 429, timeout, usage inválido, truncación, modelo/rol inesperado, respuesta duplicada o presupuesto insuficiente detiene el lote. Las cuotas y Retry-After se guardan con el allowlist existente; no se leen cuerpos de error ni se registran excepciones que puedan contener secretos. Queda el JSON original de respuestas HTTP válidas, redactado por seguridad.

Las salidas solo pueden crearse en carpetas nuevas de `runs/`, sin traversal ni symlinks. No se sobrescribe ningún resultado. Se verifican archivos congelados después de cada espera, antes de enviar. `journal.jsonl` registra intención y persistencia: una interrupción deja `running` y no se reenvía automáticamente una petición de coste incierto. La herramienta de recuperación histórica no se modifica ni se aplica a este formato nuevo.

La reserva de coste utiliza el bound conservador existente de bytes UTF-8 + margen y máximo de salida, con tarifas del operador. No garantiza facturación. Una llamada sin usage conserva coste desconocido y para el lote. Los hashes verifican consistencia, no una firma de autenticidad del proveedor. No existe exclusión global entre procesos distintos: ejecutar un solo lote a la vez. Una ejecución detenida se inspecciona; no se lanza otra ni se edita a `complete` automáticamente.

## Pruebas locales y alcance

En Linux, Node.js 24.19.0: **51 pruebas aprobadas** (16 nuevas, 18 históricas seleccionadas, 17 de recuperación). Los tres procesos principales informaron `networkAttempts:0, reservedAttempts:0`. Se construyeron 124 payloads: 30 históricos + 32 nuevos, para cada uno de v3 y v4. No se enviaron.

Se verificaron por separado seis probes del guard (fetch, HTTP, HTTPS, net, TLS y una ruta **sintética inexistente** con nombre de reservado): todos se bloquearon antes de IO, con código 1 esperado. Los cinco probes de red suman cinco intentos deliberadamente interceptados; no son cinco solicitudes salientes. El probe del reservado no apunta al archivo original. No se afirma cero intentos de probe: se afirma **cero solicitudes auténticas de inferencia y cero lecturas del holdout original**.

Se probaron formato/carga/hash, referencias solo en metadatos, salidas fabricadas de los fallos reportados, contraejemplos de puntuación, protección de caracteres, presupuestos, autorización, pausas inyectadas, 429, timeout, truncación, usage, respuestas duplicadas, cambios de archivos, integridad de filas y costes, symlinks y comparación incompatible. El runner futuro se ejercitó únicamente con HTTP falso, marcado `provenance: simulated`; sus métricas de API son `null`.

Durante la implementación se corrigieron dos fallos del harness: exigir que una frase reparada ya fuera contigua en el input rechazaba referencias válidas; ahora solo los spans exactos exigen copia contigua y las secuencias semánticas se comprueban con sus palabras de origen. Los subprocesos Node anidados no devolvían los contadores del guard en este sandbox; los probes se ejecutan en procesos principales separados y su salida/código se validan explícitamente. Las pruebas finales no dejan fallos conocidos dentro del alcance local.

Los logs finales y la comprobación de preservación se describen en `VERIFICATION.md`. Comandos Windows completos: [WINDOWS.md](WINDOWS.md). No se ejecutaron Windows/PowerShell en este entorno.

## Criterios pendientes antes de aceptar comercialmente

1. Ejecutar comparación auténtica y controlada v3/v4: mismos inputs, orden, modelo, low y parámetros, sin errores ni respuestas truncadas. Revisar los 30 históricos y los 32 nuevos por separado. No atribuir una diferencia de sesiones únicamente al prompt sin considerar no determinismo o revisión del proveedor.
2. Confirmar EN-14/ES-14 palabra por palabra sin falsos límites; retirar «sorry» en EN-03 y el «bueno» introductorio en ES-07 sin perder usos semánticos. ES-09 debe conservar `0,5 mg` y `AB-019` con caracteres exactos.
3. No aceptar ninguna regresión de significado en ES-02/EN-02, ES-12, ES-05/EN-05, ES-03/EN-04, ES-09, EN-08 y EN-13. Una mejora de B no compensa pérdida en A/C; `uncertain` requiere adjudicación.
4. Después de congelar, evaluar datos nuevos independientes en ambos idiomas, incluyendo dictados largos, ruido de ASR, múltiples hablantes, citas incompletas, terminología y contexto reales anonimizados. Los casos sintéticos de desarrollo no certifican precisión.
5. Predefinir límites de error crítico, latencia p95, errores de proveedor y coste con el responsable del producto antes de observar la muestra de aceptación; medirlos con respuestas auténticas. Como referencia estadística, cero errores en 30 casos independientes todavía deja un límite unilateral aproximado de 9,5% al 95%; estos 30 de desarrollo ni siquiera son una muestra independiente.

No se fijan resultados, SLO ni tasas comerciales inventadas. La entrega deja el candidato congelado y la verificación preparada; la aceptación del comportamiento del modelo sigue pendiente.
