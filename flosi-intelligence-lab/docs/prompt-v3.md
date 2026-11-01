# Prompt v3: intención contextual y fidelidad

`prompts/v3.json`, versión `3.0.0`, deriva de v2. Es una hipótesis de mejora, no un resultado medido. Su SHA-256 es `05296a338d41f67a2f648b71180c03e952df2a685c37b55cb7ce3b7989793fc1` y el texto de sistema tiene 303 palabras. No contiene ejemplos del corpus, listas de palabras gatillo ni respuestas de desarrollo copiadas. V1 y v2 permanecen intactos; tampoco cambian el corpus, referencias, evaluador, modelo, parámetros predeterminados o barreras de gasto.

El diagnóstico parte de los fallos de la evaluación real de v2 comunicados por el usuario: 30 casos de desarrollo en Groq con esfuerzo low, siete casos con alertas y cuatro fallos importantes de significado. No se recibieron ni inspeccionaron aquí los artefactos de esa ejecución; no se inventan salidas, puntuaciones o mediciones nuevas. Para el diseño se revisaron v1, v2 y exclusivamente los 30 casos de desarrollo.

## Cambio de criterio

V1 pide aplicar autocorrecciones en general. V2 ya contempla reemplazos de cláusulas, citas e incertidumbre, pero su instrucción de acotar estrechamente el cambio deja implícita la relación entre proposiciones. V3 distingue cinco funciones por contexto, sin decidir por una palabra concreta ni por la última mención:

- **Retractación:** retirar un compromiso sin inventar otro; conservar la cancelación, no la instrucción cancelada.
- **Reemplazo:** conservar la versión final y retirar la acción o proposición sustituida completa, con sus marcadores de reparación; arrastrar solo contexto compatible, conservando condiciones y alcance.
- **Comparación o contraste:** mantener la afirmación y la alternativa rechazada con su negación. La alternativa negativa no se convierte en el valor elegido.
- **Incertidumbre:** conservar alternativas abiertas, matices y ambigüedad; no decidir por el hablante.
- **Cita literal:** conservar sus palabras, incluidas reparaciones aparentes, aunque el ASR no haya escrito comillas. La frontera de confianza del dictado se distingue de una cita literal dentro del dictado.

La fidelidad tiene prioridad sobre la fluidez. Los textos naturales que no necesitan reparación conservan su formulación; cantidades, nombres, fechas, negaciones y relaciones lógicas solo cambian cuando el hablante los corrige explícitamente.

## Relación con los errores observados en desarrollo

| Casos | Intención de la modificación |
| --- | --- |
| dev-es-02, dev-en-02 | El reemplazo puede retirar una decisión completa, evitando conservar el plan anterior junto al nuevo. Las condiciones de la decisión final se mantienen. |
| dev-es-12 y control dev-en-12 | El contraste conserva tanto la cantidad afirmada como la alternativa negada; no se interpreta como selección de la última cantidad. |
| dev-en-14 y control dev-es-14 | El carácter literal del habla citada protege sus palabras aun sin delimitadores escritos; no se resuelve la reparación interna. |
| dev-es-09 y controles técnicos | Los identificadores, códigos, rutas y comandos retenidos se copian carácter por carácter, con mayúsculas y separadores originales; se prohíbe su normalización tipográfica. |
| dev-es-07 y control dev-en-07 | La eliminación de relleno introductorio depende de su función gramatical y semántica; otra aparición de la misma palabra con significado se conserva. |
| dev-es-10 y prosa en ambos idiomas | La puntuación incluye un signo final apropiado, sin modificar el contenido técnico ni las palabras de una cita. |

La tabla describe lo que se pide al modelo. No demuestra que v3 lo cumpla. La preservación exacta de caracteres tampoco queda garantizada por una instrucción: deberá comprobarse en respuestas auténticas, además de revisar su significado. No se añade un posprocesador o una segunda llamada.

## Riesgos y límites abiertos

Retirar cláusulas completas puede borrar una acción adicional válida o su contexto si el modelo confunde adición con sustitución. Proteger citas sin comillas puede conservar reparaciones reales o atribuir una cita donde no la hay. Una política conservadora puede dejar muletillas, mientras que eliminarlas por función todavía puede perder tono o énfasis. Sin prosodia ni audio hay ambigüedades que el texto no permite resolver; el prompt no recupera información perdida por ASR.

La puntuación final puede entrar en tensión con fragmentos técnicos o citas al final de una frase. Las negaciones, condiciones y cantidades siguen requiriendo revisión humana de alcance. El evaluador actual usa checks léxicos parciales: un resultado verde no garantiza equivalencia semántica ni integridad exhaustiva de todos los identificadores. No se altera ese motor en esta entrega.

V3 es más largo que v2; su coste de entrada, latencia, uso de razonamiento y posible truncación bajo el límite existente deberán medirse. No se cambian esfuerzo, límite de salida ni parámetros para compensarlo. No se afirma ausencia de regresiones, superioridad sobre v2 o calidad comercial.

## Verificación local y alcance del reservado

Se comprobó con las funciones existentes `loadPrompt('v3')`, `loadCorpus('dev')` y `requestBody`:

- JSON, ID, versión y hash válidos, y carga correcta mediante el evaluador sin modificar código.
- Construcción local de 30 payloads con el prompt v3 y exclusivamente el input de cada caso de desarrollo; sin referencias, rúbricas o checks en los mensajes.
- Modelo `openai/gpt-oss-120b`, esfuerzo low y dos mensajes por solicitud preparada; sin herramientas ni búsqueda. Los payloads no se enviaron.
- Ningún input ni referencia completos de desarrollo aparece copiado dentro del prompt.

Se precargó `test/no-network.mjs`, que bloquea fetch, y se usaron los transportes falsos ya existentes. La ejecución final seleccionó 18 pruebas locales, todas aprobadas, excluyendo las tres que acceden al reservado. Un bloqueo adicional de lectura del archivo reservado confirmó cero intentos de acceso en esa ejecución. Se cubren simulación, errores y tokens con HTTP falso, costes, barreras de gasto, redacción, revisión humana, integridad y comparación de regresiones fabricadas. Estas pruebas validan infraestructura, no comprensión lingüística de v3.

Incidencia de alcance: el primer filtro no excluyó tres comprobaciones existentes y se ejecutó la suite completa de 21 pruebas, que lee automáticamente el reservado. V3 ya estaba escrito y fijado con el hash anterior; no se mostraron contenidos del reservado ni se utilizaron para diseñar o ajustar el prompt. Un intento posterior con bloqueo impidió esas lecturas; la ejecución final corregida las excluyó. El reservado no se evaluó con v3 y el prompt no cambió tras estas pruebas. No se presenta esta separación de procedimiento como un estudio ciego.

Comando de selección final, desde el laboratorio, con Node.js 24.19.0 en Linux:

```powershell
node --import ./test/no-network.mjs --test --experimental-test-isolation=none --test-skip-pattern="50 synthetic cases|prompts contain no reserved case|CLI validates offline" test/lab.test.mjs
```

El bloqueo adicional fue una herramienta temporal de verificación fuera del paquete; no modifica el motor ni sus tests. No se ejecutó `validate` durante el diseño porque carga ambos splits. No se verificó Windows 11 en este entorno.

No se creó `fixtures/v3.json`: inventar salidas no comprobaría el prompt. Por ello, `run --mode simulate --prompt v3` no tiene fixture y se rechaza de forma segura antes de hacer solicitudes; la comprobación de compatibilidad se hizo cargando v3 y construyendo sus payloads en memoria. El runner existente admite v3 para una futura evaluación real explícitamente autorizada, sin cambios de código.

**Cero solicitudes auténticas a Groq en esta actualización; ningún crédito consumido por ella.** La siguiente evidencia necesaria es una comparación auténtica y controlada v2/v3 sobre los mismos 30 casos de desarrollo, low, modelo y parámetros iguales, con revisión humana de los fallos comunicados y de los casos antes correctos. Conservar errores, usage y latencias, sin aceptar una mejora de coincidencia textual como prueba de fidelidad. Su ejecución requiere aprobación explícita de gasto posterior; el reservado permanece fuera del ajuste.
