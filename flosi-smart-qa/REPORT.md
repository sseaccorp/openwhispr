# Flosi Smart QA — entrega de investigación e implementación P0

**Estado: P0 abierto. Herramienta experimental funcional; no aprobada para producción.**

Se implementó y ejecutó un motor contextual con validación de ediciones, una
aplicación local aislada y el pipeline de voz humana real. La evidencia no alcanza
los criterios de aceptación: la última batería nueva obtiene 9/12 coincidencias
completas, solo 5/8 entre los casos que requieren cambios. Conservar el original
tras un rechazo evita aplicar algunas propuestas peligrosas, pero no resuelve
una autocorrección. No se presenta ese fallback como éxito.

## 1. Identidad y alcance

- Repositorio: `sseaccorp/openwhispr`.
- Rama nueva: `codex/flosi-smart-qa-p0`.
- Base V4 verificada: `862dbe784072f4308d7cc467ec5eab6e5609189c`.
- Código candidato congelado: `6227942c9d498b032c627fe93aa0cbf2db5d981b`.
- Congelación aplicable a esta entrega: `evidence/freeze-release.json`, 29 archivos.
- El commit del paquete, su SHA-256 y el PR constan en la entrega de distribución.
  Los commits posteriores a la congelación añaden resultados y documentación.
- Todos los cambios están bajo la carpeta nueva `flosi-smart-qa/`. La aplicación
  principal y el laboratorio original no se integran ni modifican.

No conocemos la transcripción perdida de la prueba manual del usuario. Se probó
su ejemplo ilustrativo del contrato y se encontró una reparación equivalente
auténtica en AMI; ninguna se identifica como aquel caso perdido. No existe acceso
autorizado al Windows ni a los resultados locales del usuario.

## 2. Diagnóstico técnico

V2/V3/V4 expresan reglas razonables, pero una salida libre del LLM no garantiza
que la orden abandonada haya desaparecido ni que la negación final sobreviva.
V4 pide conservar ante ambigüedad y resolver revisiones claras; no hay una
contradicción lógica que por sí sola explique todos los fallos. Sí existe una
decisión difícil de alcance y literalidad que el modelo sigue tomando mal.
En las inferencias observadas aparecen decisiones conservadas, eliminaciones
incorrectas, cambios técnicos y errores al representar el tramo editado.

El evaluador histórico separa revisión humana y coincidencia completa, pero sus
señales `contains`/`absent` pueden pasar un texto incorrecto. V4 incorpora más
auditoría, sin convertirla en prueba de significado. No se alteraron sus archivos
ni resultados. La nueva evaluación exige la secuencia COMPLETA y ordenada,
caracteres técnicos y citas explícitas; donde la puntuación es material exige
salida exacta. Tampoco esa comparación equivale a un juez semántico universal.

Dos fallos críticos se descubrieron después de congelaciones anteriores:

1. En audio AMI real, el modelo eliminó «3 volts DC» y conservó solo una
   incertidumbre posterior. El compilador permitía extender un anclaje ya
   completado a otra oración. Además, un «actually» posterior podía reiniciar
   la protección. Se prohibió esa extensión y se delimitó el evento de reparación.
   La respuesta original permanece en `evidence/human-postfreeze/`.
2. Una entrada nueva sobre una válvula produjo una edición que solo eliminaba
   un «no», conservando la orden inicial y la prohibición final. Ahora se rechaza
   una reparación que solo quite marcadores sin cambiar el resto del contenido.
   La respuesta aceptada original permanece en `evidence/final-qualification/`.

Ambos arreglos impiden aplicar esas propuestas, **no demuestran que el LLM haya
aprendido a corregirlas**. El primer audio vuelve a fallar como corrección y se
marca rechazado en una inferencia nueva de la versión entregada.

ASR y corrector tienen defectos distintos. Whisper small perdía «if» antes de la
corrección de 2 a 4 millones. Cambiar timestamps no lo arregló. En ocho archivos
idénticos, medium restauró esa condición y la grafía Marianas, a mayor latencia.
Sigue transcribiendo «treading» como «trading». Un audio nuevo inglés produjo
«things» donde la referencia dice «theories». El corrector conserva esos errores
de ASR; no se cuentan como dictados correctos de extremo a extremo.

## 3. Arquitectura implementada y alternativas medidas

El flujo seleccionado es:

`Audio WAV → ASR medium local → original → un plan contextual LLM → compilación desde fuente → validación → texto/estado visible`.

El modelo propone JSON con tramos exactos `before`, `after` y tipo de edición.
El motor reconstruye desde el original, permite supresiones contextualizadas y
rechaza palabras nuevas, reordenamientos, anclajes ambiguos, solapamientos,
truncación, cambios de caracteres retenidos, citas editadas y pérdidas de la cola
final de una reparación detectada. La identidad de un texto sin ediciones se
conserva byte a byte. Los ajustes de caso inicial y espacios de cantidades usan
una representación única de la fuente. No se normaliza Unicode.

El LLM conserva responsabilidad semántica; los detectores de marcadores y códigos
son finitos. Esta arquitectura no puede reconstruir nombres deletreados ni
palabras ausentes del ASR, no ofrece toda la normalización editorial de un
producto comercial y puede rechazar reparaciones encadenadas o mal etiquetadas.
No hay garantía general de fidelidad derivada de estas reglas.

Se midieron alternativas con los mismos 32 inputs de desarrollo, temperatura 0,
seed 42 y evaluación uniforme posterior, sin modificar respuestas anteriores:

| Modelo local / método | Coincidencias completas | p50 / p95 corrección |
|---|---:|---:|
| Qwen3-4B original / V3 libre | 16/32 | 2,56 / 5,99 s |
| Qwen3-4B original / V4 libre | 15/32 | 2,72 / 7,01 s |
| Qwen3-4B original / plan explícito inicial | 20/32 | 5,27 / 8,71 s |
| Qwen3-4B Instruct-2507 / V4 libre | 21/32 | 2,41 / 6,17 s |
| Instruct-2507 / texto libre alineado a fuente | 22/32 | 2,23 / 5,56 s |
| Instruct-2507 / plan explícito | 26/32 | 4,89 / 8,59 s |
| Instruct-2507 / plan con anclaje de caso corregido | 27/32 | 5,10 / 8,80 s |

Son experimentos de desarrollo, con presupuestos distintos por contrato de salida
(texto libre 512; JSON 768). No comparan GPT-OSS 120B ni demuestran generalización
de estas cifras. Los scores originales anteriores a corregir el auditor de citas
se preservan; la tabla usa `evidence/observed-audit/`, sin nuevas inferencias.

También se probó razonamiento: un primer intento usó un campo de presupuesto
incorrecto y NO demuestra un límite de 512 tokens efectivo. Se conservan sus dos
respuestas de 49,4/77,8 s y un timeout real de 120 s. La prueba corregida de 128
tokens, con el campo admitido, completó 12 casos: 6 coincidencias según su scorer
original y p95 21,74 s. No se seleccionó. Un segundo plan con feedback sobre seis
fallos reales no recuperó los problemas de contenido: no se añadió ese coste ni
un segundo LLM, router o reintento al producto de prueba.

No había credenciales de inferencia configuradas. Se usó inferencia CPU local,
Apache 2.0, para obtener evidencia real sin servicios pagos. No se hicieron
peticiones a Groq. La comparación GPT-OSS/Groq V2/V3/V4 sigue pendiente; otra
familia local no es evidencia del comportamiento de ese proveedor. No se prueba
un modelo mayor por reputación ni se atribuye un límite universal a todos los
modelos. Los recursos disponibles son insuficientes para una comparación local
simultánea de modelos grandes con el ASR seleccionado.

## 4. Validación y resultados realmente ejecutados

Los criterios están en `ACCEPTANCE.md`, establecidos antes de los conjuntos
finales y sin relajarse tras los fallos. Se exigieron cero errores críticos,
≥95% de correcciones/limpieza, 100% de controles y caracteres técnicos,
repetición, audio humano, velocidad y micrófono Windows.

| Conjunto y revisión | Resultado | Interpretación |
|---|---:|---|
| Primer final, congelación 25cac169 | 17/24 | Falló; después se consumió para corregir retiradas |
| Segundo final, congelación aa0a8f03 | 19/24; cambios 7/12 | Falló; evidencia de revisión anterior |
| Calificación tras arreglo de alcance aa3eb9ba | 10/12 | Encontró el fallo de solo marcadores; ahora desarrollo |
| **Último final, congelación 6227942c** | **9/12; cambios 5/8** | **Falló; no se ajustó con sus resultados** |
| Estabilidad en versión entregada | 6/9 coincidencias | Cada input tiene un único output y plan en 3 repeticiones; incluye un fallo estable |
| Dos dictados largos ES/EN, desarrollo | 2/2 | 228/211 palabras; 36,14/43,76 s; no validación ciega |

En el último final pasan los cuatro controles, uno conservado mediante rechazo.
Solo ocho de las doce salidas coinciden sin solicitar revisión. Cero flags de
caracteres técnicos en esos doce casos no demuestra integridad para todos los
lenguajes o comandos. La reparación inglesa sin puntuación mantiene una decisión
descartada al rechazarse el plan; el modelo cambia «the shuttle» a «a shuttle».
Se conservan «Pues, eh» y un «I I» que el modelo etiquetó como reparación en lugar
de tartamudeo. No se llama aprobado a ninguno de esos tres resultados.

Los datos finales nuevos fueron escritos por el agente después de congelar el
código; son independientes del ajuste posterior, **no una revisión humana ciega
externa**. Los audios tienen referencias de corpus externos; su posible presencia
en preentrenamiento es desconocida. El holdout histórico no se leyó ni se empleó
como validación independiente. Los conjuntos consumidos se identifican con
archivos `*-status.json`; no se reemplazaron sus resultados.

Tests ejecutados: 59 de la herramienta y motor, más 51 históricos con guardas
offline (18 laboratorio, 17 recuperación, 16 V4): **110 pasan**. Los fallos de
proveedor de estos tests son simulaciones HTTP explícitas; no son mediciones de
calidad. Incluyen 401/403/429/5xx, timeout, red, respuesta inválida/truncada,
modelo incorrecto, ausencia de uso, no reintentos y conservación del original.
El timeout anterior y un 409 del servidor QA sí ocurrieron durante inferencias
reales. El 409 se debió a liberar el lock después de enviar la respuesta; se
arregló, con test determinista, y el lote se repitió en otra carpeta.

Se ejecutaron Chromium/Playwright con inferencia real: texto, cita/negación,
subida de WAV humano, diseño de 390 px y manejo de micrófono ausente; sin errores
JavaScript en la ejecución válida. El primer driver falló por usar eval ante la
CSP; se corrigió el driver y no se debilitó la política. Esa primera ejecución
no se presenta como smoke pasado. No se ejecutó Electron ni el build principal,
porque la aplicación principal no cambia.

## 5. Voz humana real: éxitos y fallos

Se procesaron **12 archivos humanos distintos**: nueve de lectura FLEURS y tres
de conversación espontánea AMI, CC BY 4.0, sin TTS ni ensamblado. Los WAV,
referencias, URLs, revisiones, hashes, muestras/timing de los recortes y atribución
están incluidos. Hay dos controles adquiridos que no llegaron a ejecutarse antes
de otra congelación (`human-qualification`); no se cuentan en esos doce.

`AUDIO.md` muestra por archivo referencia, ASR, final, error y tiempos. Los JSONL
contienen respuestas completas, segmentos y uso real. No se compara el texto
limpio con las muletillas habladas para inventar una métrica de intención.

| Audio y ejecución de la versión entregada | ASR | Final | ASR / corrección / total |
|---|---|---|---:|
| AMI ES2012a, reparación espontánea | «Especially if we try to sell 2 million of them, oh sorry, 4 million of them.» | «Especially if we try to sell 4 million of them.» | 5,94 / 6,54 / 12,48 s |
| AMI IS1000c, voltaje e incertidumbre | Incluye 6 volt, sorry, 3 volts DC y que puede necesitar más | Original conservado; plan rechazado; reparación pendiente | 11,68 / 5,49 / 17,18 s |
| FLEURS español nuevo, tsunami | Mantiene las negaciones; Jakarta por Yakarta | ASR sin cambios | 8,75 / 3,24 / 11,98 s |
| FLEURS inglés nuevo | «These things…» por «These theories…» | ASR sin cambios; error léxico/semántico pendiente | 7,13 / 2,70 / 9,83 s |

La disculpa AMI de otra ejecución conserva «Sorry», pero su ASR «trading» por
«treading» sigue siendo un fallo de extremo a extremo. Con medium se corrigió la
pérdida de la condición «if» observada con small; no se arreglaron todos los ASR.

## 6. Métricas, latencia, recursos y coste

`evidence/metrics.json`, `metrics.csv` y `audio-metrics.csv` se reconstruyen con
`python evidence/build_metrics.py`. Distinguen cambios requeridos, controles,
fallbacks, matches automáticos, tokens, respuesta/plan y revisión. No contienen
una precisión semántica comercial inventada.

- Último final: 12/12 respuestas de proveedor válidas; p50 4,796 s y p95 21,457 s;
  7.506 tokens (7.064 entrada, 442 salida). El tamaño muestral es pequeño.
- Repeticiones finales: 9/9 respuestas válidas; p50 6,786 s, p95 7,360 s;
  5.814 tokens. Estabilidad no implica que el fallo repetido sea correcto.
- En los cuatro audios finales, RTF de ASR 0,660 / 0,458 / 0,925 / 0,961.
  El objetivo ASR ≤0,5 y el p95 de corrección ≤1,5 s no se cumplen.
- 379 respuestas locales únicas con uso guardado, deduplicadas por responseId:
  **220.003 tokens medidos**. Faltan los tokens no devueltos del timeout y tres
  respuestas de la primera ejecución fallida del driver. El total es un mínimo
  documentado, no el consumo exhaustivo de todos los intentos.
- **0 solicitudes de inferencia externa; US$0 de cargos de inferencia externa.**
  No se activó facturación ni un servicio pago. El coste de CPU/energía/cloud no
  se midió ni se declara cero. No se da una tarifa Groq supuesta como medida real.
- Linux x64, Python 3.12.14, CPU sin GPU, tres threads de inferencia. Snapshot:
  tres CPU visibles, cuota cgroup equivalente a dos CPU y límite de memoria 8 GiB;
  disco de unos 7,9 GiB. Los límites pueden cambiar durante una tarea cloud.
  GGUF seleccionado 2,50 GB, ASR medium 1,53 GB; identidades en `assets.json`.

## 7. Protección de lo existente

`evidence/preservation-final.json` verifica los 68 blobs del laboratorio frente
a la base: todos iguales. El checkout original permanece en `work`, commit
`fc786f41c91de8177ce7d9333d2834d973cc3c19`, sin cambios. Solo se comparó el hash
Git del holdout, nunca su contenido. No se usó reset/clean destructivo ni se
sobrescribieron resultados. No se accedió al Windows original.

La variante usa su carpeta, venv, modelos, puertos 18765/18766 y sesiones UUID.
No lee perfiles Flosi, no inicia la QA original ni pega texto automáticamente.
El modelo local requiere un token efímero privado del launcher, no expuesto en
la interfaz; se comprobó 401 sin él y peticiones correctas a través del backend.
La persistencia de voz es optativa. Los WAV temporales se eliminan tras procesar.

## 8. Cómo probar en Windows y qué falta

`WINDOWS.md` contiene el flujo exacto de PowerShell: Python 3.12 x64, selector
del ZIP, carpeta nueva con GUID, instalación aislada, descarga con SHA-256,
navegador, micrófono, revisión antes/después, evidencia y parada de sus procesos.
No necesita Git, Node ni clave API. El ZIP no incluye los pesos: se descargan
aproximadamente 4 GB en el primer arranque. Recomendación: 16 GB RAM y ≥6 GB libres.

Se verificó el launcher Linux reutilizando assets previamente descargados y el
venv de esta tarea (`--skip-pip`); no se presenta como instalación Windows nueva.
**PowerShell, dependencias Windows y micrófono físico no se ejecutaron.** El
cloud no proporciona ese hardware ni conexión al equipo del usuario. Para pasar
ese gate hay que ejecutar el flujo documentado y conservar WAV, referencia, ASR,
final, tiempos y juicio de fidelidad sobre dictados propios nuevos.

La solución aún falla correcciones contextuales, limpieza, algunos ASR y velocidad.
Las guardas previenen fallos concretos, pero tampoco cubren todo el lenguaje.
No se recomienda integrar en la aplicación principal mientras esos gates fallen.
La comparación con GPT-OSS/Groq necesita una credencial ya configurada y cuota
gratuita verificable, o autorización explícita de un presupuesto antes de cualquier
prueba paga. No se pide ni se incorpora una clave al paquete.

La próxima decisión debe basarse en los mismos inputs y criterios, con datos
posteriores sin ajustar y audio espontáneo del usuario autorizado. Esta entrega
permite hacerlo y conserva los fallos como evidencia; no declara alcanzada la
definición de éxito del producto.
