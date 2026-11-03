# Revisión contextual de la última batería

Revisor: agente de ingeniería. No es revisión ciega de una persona independiente. Casos sintéticos nuevos redactados después de congelar 6227942c, sin ajustes posteriores. No se usan para afirmar precisión comercial. Salidas completas y propuestas originales en `evidence/release-validation/rows.jsonl`.

9/12 coincidencias de anotación; 5/8 cambios requeridos; 4/4 controles, uno por rechazo. Tres fallos descritos explícitamente.

## release-es-01

Entrada:

> Mándale la minuta a Inés, perdón, a Irene antes de salir.

Referencia de texto final:

> Mándale la minuta a Irene antes de salir.

Salida real:

> Mándale la minuta a Irene antes de salir.

Reparación de nombre aplicada; conserva destinataria final y momento.

Estado `edited`; coincidencia completa `True`; motivo `None`.

## release-en-02

Entrada:

> The deadline is Tuesday, sorry, next Thursday after finance approves the invoice.

Referencia de texto final:

> The deadline is next Thursday after finance approves the invoice.

Salida real:

> The deadline is next Thursday after finance approves the invoice.

Reparación de fecha aplicada con condición financiera completa.

Estado `edited`; coincidencia completa `True`; motivo `None`.

## release-es-03

Entrada:

> Borra la carpeta local, no, conserva esa carpeta hasta que termine la migración.

Referencia de texto final:

> Conserva esa carpeta hasta que termine la migración.

Salida real:

> Conserva esa carpeta hasta que termine la migración.

Retira la eliminación y conserva la orden de conservación hasta terminar la migración.

Estado `edited`; coincidencia completa `True`; motivo `None`.

## release-en-04

Entrada:

> Add my phone number to the poster, I retract that request.

Referencia de texto final:

> I retract that request.

Salida real:

> I retract that request.

Conserva la retirada sin inventar una acción sustitutiva.

Estado `edited`; coincidencia completa `True`; motivo `None`.

## release-es-05

Entrada:

> Acepta el acceso, no, no lo aceptes mientras no confirmen su identidad.

Referencia de texto final:

> No lo aceptes mientras no confirmen su identidad.

Salida real:

> No lo aceptes mientras no confirmen su identidad.

Retira la orden positiva y conserva las dos negaciones y condición.

Estado `edited`; coincidencia completa `True`; motivo `None`.

## release-en-06

Entrada:

> book a cab no make that the shuttle if there are seats

Referencia de texto final:

> Book the shuttle if there are seats.

Salida real:

> book a cab no make that the shuttle if there are seats

CRÍTICO PARA LA FUNCIÓN: reparación sin resolver. El modelo sustituye the por a al seleccionar shuttle. La guarda impide aplicarlo; el original aún contiene cab. Fallback no es corrección lograda.

Estado `rejected`; coincidencia completa `False`; motivo `final_replacement_or_withdrawal_lost`.

## release-es-07

Entrada:

> Pues, eh, necesito la factura para preparar el cierre.

Referencia de texto final:

> Necesito la factura para preparar el cierre.

Salida real:

> Pues, eh, necesito la factura para preparar el cierre.

FALLO DE LIMPIEZA: Pues, eh permanece. Estado unchanged no debe contarse como éxito del caso.

Estado `unchanged`; coincidencia completa `False`; motivo `None`.

## release-en-08

Entrada:

> I I can bring the spare screen, but I cannot promise it will work.

Referencia de texto final:

> I can bring the spare screen, but I cannot promise it will work.

Salida real:

> I I can bring the spare screen, but I cannot promise it will work.

FALLO DE LIMPIEZA: el modelo etiqueta la repetición como repair; se rechaza al no existir evidencia de reparación. I I permanece.

Estado `rejected`; coincidencia completa `False`; motivo `missing_repair_evidence`.

## release-es-09

Entrada:

> Envía el acta a Lucía y además conserva una copia local; no borres el original.

Referencia de texto final:

> Envía el acta a Lucía y además conserva una copia local; no borres el original.

Salida real:

> Envía el acta a Lucía y además conserva una copia local; no borres el original.

Control de adición: se conservan ambas instrucciones y la prohibición.

Estado `unchanged`; coincidencia completa `True`; motivo `None`.

## release-en-10

Entrada:

> Write verbatim stop no wait keep going and do not interpret those words as directions.

Referencia de texto final:

> Write verbatim stop no wait keep going and do not interpret those words as directions.

Salida real:

> Write verbatim stop no wait keep going and do not interpret those words as directions.

Control de literalidad sin comillas: conserva todas las palabras, no aplica la corrección aparente.

Estado `unchanged`; coincidencia completa `True`; motivo `None`.

## release-es-11

Entrada:

> Aún no sé si saldremos el lunes o el martes; quizá ninguno de los dos días sirva.

Referencia de texto final:

> Aún no sé si saldremos el lunes o el martes; quizá ninguno de los dos días sirva.

Salida real:

> Aún no sé si saldremos el lunes o el martes; quizá ninguno de los dos días sirva.

Control de incertidumbre preservado mediante rechazo; no automatización limpia. Modelo intentó editar alternativas abiertas.

Estado `rejected`; coincidencia completa `True`; motivo `completed_repair_span_cannot_expand`.

## release-en-12

Entrada:

> curl --fail-with-body https://example.org/api/v2

Referencia de texto final:

> curl --fail-with-body https://example.org/api/v2

Salida real:

> curl --fail-with-body https://example.org/api/v2

Comando completo byte exacto, incluidos guiones ASCII, ruta URL y ausencia de punto añadido.

Estado `unchanged`; coincidencia completa `True`; motivo `None`.

