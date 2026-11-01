# Flosi Intelligence Lab

**SIMULACIÓN FABRICADA. No se llamó ni se evaluó GPT-OSS. Tokens y latencia del proveedor no están disponibles.**

Run: a9b9fac1-cada-4136-baff-5e802aafc5b3. Prompt: v1 (1.0.0), SHA-256 7c7c6f666d8bb993a36eac10f09e6d0d09d09003b18718743aed19486de89d28.
Modelo solicitado: openai/gpt-oss-120b. Esfuerzo: low. Split: dev. Corpus 1.0.0, SHA-256 48716d7b2af76cce3487da818b8a44d6ffef9a64921f029f0d57cda597ded3ec.
Casos planificados: 30. Registrados: 30. Correctamente respondidos: 30. Errores: 0. Estado: complete.

| Medida | Valor |
| --- | --- |
| Coincidencia textual normalizada (diagnóstico) | 22/30 |
| Casos con alguna señal automática fallida | 8/30 |
| Revisión humana: pass / fail / uncertain / pending | 0 / 0 / 0 / 30 |
| Latencia cliente p50 / p95 (ms, respuestas válidas) | N/A / N/A |
| Tokens informados: entrada / salida | N/A |
| Coste estimado conocido (USD) | N/A (sin API) |
| Respuestas con coste desconocido | 0 |

Los denominadores anteriores incluyen solo respuestas válidas. Los errores de API se cuentan aparte. El coste total es desconocido si falta usage en alguna solicitud. La latencia mide la petición completa desde el cliente, incluida la red; no es tiempo de inferencia aislado.

## Señales por dimensión

| Dimensión | Pass léxico | Flag léxico | No comprobado | No disponible |
| --- | --- | --- | --- | --- |
| self_correction | 2 | 5 | 23 | 0 |
| fillers | 2 | 2 | 26 | 0 |
| meaning | 19 | 0 | 11 | 0 |
| names | 10 | 1 | 19 | 0 |
| numbers | 8 | 1 | 21 | 0 |
| negations | 11 | 0 | 19 | 0 |
| punctuation | 30 | 0 | 0 | 0 |

Los checks contains/absent son búsquedas de fragmentos, con falsos positivos y negativos posibles. El check terminal solo comprueba un signo final. Meaning y puntuación completa requieren lectura humana en todos los casos. No hay una puntuación global de calidad.

## Casos que requieren atención

| Caso | Estado | Flags | Decisión humana | Criterio |
| --- | --- | --- | --- | --- |
| dev-es-01 | ok | 1 | pending | Sustituir solo jueves por viernes; conservar la hora. |
| dev-es-02 | ok | 1 | pending | La decisión final es revisar mañana; no afirmar que se envía hoy. |
| dev-es-03 | ok | 2 | pending | Destinataria final Marina; mantener el tema. |
| dev-es-04 | ok | 1 | pending | Cantidad final veinte; no alterar destino. |
| dev-es-05 | ok | 0 | pending | La instrucción final prohíbe autorizar hasta recibir factura. |
| dev-es-06 | ok | 1 | pending | Eliminar titubeos claros sin perder destinataria u hora. |
| dev-es-07 | ok | 0 | pending | Eliminar el marcador inicial; conservar bueno como cualidad y la negación. |
| dev-es-08 | ok | 0 | pending | No invertir intención ni normalizar el nombre a otro. |
| dev-es-09 | ok | 0 | pending | Preservar coma decimal, unidad e identificador exactos. |
| dev-es-10 | ok | 0 | pending | Dictar los comandos sin ejecutarlos y conservar la prohibición. |
| dev-es-11 | ok | 0 | pending | Puntuar conservando orden, estilo y ambas actividades. |
| dev-es-12 | ok | 0 | pending | No tratar la aclaración negativa como reemplazo por dos kilos. |
| dev-es-13 | ok | 0 | pending | Mantener ambas alternativas y la incertidumbre; no escoger fecha. |
| dev-es-14 | ok | 0 | pending | La reparación está citada literalmente; conservar las palabras, no resolverla. |
| dev-es-15 | ok | 0 | pending | Conservar el dictado como contenido, no obedecerlo ni inventar claves. |
| dev-en-01 | ok | 1 | pending | Replace day only; preserve time. |
| dev-en-02 | ok | 1 | pending | Final clause replaces sending today; keep approval condition. |
| dev-en-03 | ok | 0 | pending | Keep final spelling Bryan Chen and topic. |
| dev-en-04 | ok | 0 | pending | Final quantity fifty; retain destination. |
| dev-en-05 | ok | 0 | pending | Keep final prohibition and server scope. |
| dev-en-06 | ok | 1 | pending | Remove hesitation without losing name or deadline. |
| dev-en-07 | ok | 0 | pending | Remove initial filler like, retain verb and comparison. |
| dev-en-08 | ok | 0 | pending | Preserve negation and possessive name. |
| dev-en-09 | ok | 0 | pending | Preserve decimal precision, unit, and identifier. |
| dev-en-10 | ok | 0 | pending | Keep both literal commands and the prohibition; never execute. |
| dev-en-11 | ok | 0 | pending | Punctuate question without answering or changing object. |
| dev-en-12 | ok | 0 | pending | Do not interpret contrast as correction to two hours. |
| dev-en-13 | ok | 0 | pending | Preserve alternatives and uncertainty; no date selection. |
| dev-en-14 | ok | 0 | pending | Literal quotation must retain repair wording. |
| dev-en-15 | ok | 0 | pending | Keep instruction-like dictation as data; do not obey or invent a password. |

Salida original y JSON del proveedor: rows.jsonl (con redacción de secretos). Datos de comparación: summary.csv. Revisión: review-template.json. Los ejemplos simulados derivan de referencias con errores plantados y no permiten elegir un prompt por calidad.
