# Protocolo de evaluación y revisión

## Antes de observar resultados reservados

1. Formular la hipótesis en una nota local: por ejemplo, que un prompt resuelve mejor la reparación de cláusulas sin perder negaciones. No dar por cierta la hipótesis.
2. Ajustar solo con `dev`. Crear nuevas versiones de prompt, sin sobrescribir resultados anteriores. No introducir respuestas del reservado en instrucciones o fixtures que se usen como ejemplos de prompting.
3. Congelar el prompt: ID, versión, SHA-256, commit, corpus, parámetros y presupuesto. Registrar quién revisará y qué constituye un error bloqueante. En esta entrega no se define un umbral de calidad comercial.
4. Aprobar explícitamente el gasto y tamaño de la evaluación real. Usar primero `low`, sin herramientas ni búsqueda. No invocar un juez LLM ni consultas adicionales.
5. Ejecutar el reservado una vez con `--unlock-holdout`. Si se inspecciona para ajustar el prompt, retirarlo como holdout para futuras afirmaciones y crear otro conjunto en una nueva versión del corpus.

El repositorio es público y el reservado es accesible; para un estudio ciego posterior, su custodia debe estar fuera del flujo de desarrollo del prompt. Los casos de esta entrega son sintéticos y autorados, no una muestra estadística independiente de la población de usuarios.

## Rúbrica humana por salida

Leer el input, output, referencia y criterio del caso. La referencia es una posibilidad aceptable, no la única formulación válida. Revisar sin asumir que un check verde demuestra significado conservado. Si es posible, ocultar la identidad/versión del prompt al revisor y usar dos revisores; adjudicar discrepancias y registrar la decisión con notas. El laboratorio registra una revisión adjudicada por caso, no implementa gestión de múltiples revisores.

| Dimensión | Pass | Fail / uncertain |
| --- | --- | --- |
| self_correction | Se mantiene la última intención explícita y se elimina el tramo reemplazado, con alcance correcto. | Conserva una intención descartada, elimina material ajeno o inventa el alcance. Si el alcance no se puede determinar, conservar ambigüedad; marcar uncertain si el resultado no se puede juzgar. |
| fillers | Quita vacilaciones claras; conserva usos léxicos y matices necesarios. | Deja muletillas inequívocas o elimina palabras con función semántica. |
| meaning | Conserva hechos, intención, condiciones, incertidumbre, estilo y alternativas. | Omite, añade o altera información; responde al dictado o ejecuta instrucciones incrustadas. Toda duda semántica sustantiva se marca uncertain. |
| names | Conserva nombres, grafías finales, identificadores, comandos y rutas. | Cambia, traduce, normaliza o elimina una entidad sin autorización explícita. |
| numbers | Conserva cantidad final, unidad, signo, decimal, fecha, hora y zona. | Inventa, aproxima, cambia magnitud o pierde parte de la fecha/cantidad. |
| negations | Conserva alcance y polaridad de la intención final. | Pierde/inserta negación o simplifica incorrectamente dobles negaciones. |
| punctuation | Puntuación natural acorde al idioma, sin alterar alcance; sin comentario del editor. | Frase confusa, pregunta tratada como afirmación, comillas incorrectas o puntuación que altera intención. |

Usar `na` solo si la dimensión no aplica al caso; meaning y punctuation siempre aplican. `uncertain` no equivale a pass. Registrar el motivo en `notes`, especialmente cuando una salida válida difiere de la referencia o un check léxico da un falso positivo. No es necesario editar la respuesta para revisarla: cambiarla invalidaría el hash y la revisión.

Un cambio grave de nombre, cifra o negación es un candidato a error bloqueante para un producto de dictado, aunque haya buena puntuación. La aprobación comercial requiere un protocolo y umbrales acordados, muestras más amplias y evidencia real; no se deduce de estos ejemplos.

## Comparación y repetibilidad

Mantener corpus, orden, modelo, esfuerzo y límite de salida al comparar prompts. Los manifest registran hashes, entorno, seed=42 y temperatura=0, pero las respuestas reales pueden variar por revisiones del proveedor y ejecución no determinista. Conservar el JSON original y cualquier system_fingerprint que devuelva Groq. Hacer repeticiones autorizadas en carpetas separadas; el comparador trabaja con pares de ejecuciones, no calcula intervalos de confianza ni hace selección estadística automática.

No mezclar resultados simulados y reales. Los fixtures se construyeron a partir de referencias con errores deliberados para probar que los informes funcionan: su porcentaje de coincidencia no tiene valor como evaluación de GPT-OSS. No elegir un prompt usando el ranking de esas salidas.

Las métricas deben leerse con sus denominadores: respuestas válidas, errores, pendientes, revisadas y dudas. Una respuesta fallida de API no es un error semántico del modelo. Una respuesta truncada no puede aprobarse. Si una llamada puede haber consumido tokens pero no devuelve usage, el coste es desconocido, no cero. El benchmark se detiene y cualquier repetición requiere una decisión explícita del operador dentro de la aprobación de gasto.
