# Audio humano: evidencia completa por archivo

Revisión del agente de ingeniería a partir de referencias externas; no aprobación humana independiente. Doce WAV distintos procesados realmente. Nueve son lectura, tres conversación espontánea. Los ejemplos se muestran con fallos. La selección de registros más recientes mezcla revisiones: solo los cuatro de `audio-release` se ejecutaron con la versión final congelada.

Referencias a lo hablado, no referencias de texto limpio. Se mantienen las disfluencias y palabras numéricas anotadas. Las referencias no se enviaron al ASR ni al LLM. Fuentes/licencias/hashes y recortes continuos en los manifest de `data/human*`.

No se ejecutó micrófono físico Windows. La existencia de un WAV humano no valida ese hardware.

## fleurs-es_419-1001146817223348054

Fuente: https://huggingface.co/datasets/google/fleurs/resolve/main/data/es_419/audio/test.tar.gz — CC-BY-4.0 — human_read_speech.

SHA-256: `861ceedc4d50fbe52fc89b6d0c0fa740b9cd6fa668388e754064847386af0faf`. Ejecución: `evidence/audio-via-launcher/rows.jsonl`.

Referencia humana externa:

> Se recomienda enfáticamente a los viajeros que se informen sobre cualquier riesgo de clima extremo en el área que visitan, dado que ello puede afectar sus planes de viaje.

ASR real:

> Se recomienda enfáticamente a los viajeros que se informen sobre cualquier riesgo del clima extremo en el área que visitan, dado que ello puede afectar sus planes de viaje.

Resultado real del corrector:

> Se recomienda enfáticamente a los viajeros que se informen sobre cualquier riesgo del clima extremo en el área que visitan, dado que ello puede afectar sus planes de viaje.

Debe conservar/corregir: Conservar toda la recomendación y su condición causal.

ASR: «del clima» por «de clima». El corrector conserva todo el ASR; no se le atribuye reparación de esa diferencia.

Estado: `unchanged`; motivo: `None`. Duración 12.840 s. ASR 7.769 s; corrección 2.880 s; total pipeline 10.650 s; RTF 0.605. Tokens medidos 625.

WER ASR léxico: 1/29 (0.0345); incluye formato de números y disfluencias. No es una puntuación semántica de la corrección.

## fleurs-es_419-1008205615316519958

Fuente: https://huggingface.co/datasets/google/fleurs/resolve/main/data/es_419/audio/test.tar.gz — CC-BY-4.0 — human_read_speech.

SHA-256: `0576e73da35ef17b6ce6396d31b32830b7ab19cea98f9f5db68de3756dc3d4fc`. Ejecución: `evidence/audio-via-launcher/rows.jsonl`.

Referencia humana externa:

> Fue tanta la cantidad de gente que se concentró, que no todos pudieron acceder al funeral en la Plaza de San Pedro.

ASR real:

> Fue tanta la cantidad de gente que se concentró que no todos pudieron acceder al funeral en la plaza de San Pedro.

Resultado real del corrector:

> Fue tanta la cantidad de gente que se concentró que no todos pudieron acceder al funeral en la plaza de San Pedro.

Debe conservar/corregir: Conservar que no todos pudieron acceder.

Sin diferencias léxicas de ASR frente a referencia; cambian puntuación/caso. La negación se conserva.

Estado: `unchanged`; motivo: `None`. Duración 9.720 s. ASR 6.626 s; corrección 2.355 s; total pipeline 8.982 s; RTF 0.682. Tokens medidos 610.

WER ASR léxico: 0/22 (0.0000); incluye formato de números y disfluencias. No es una puntuación semántica de la corrección.

## fleurs-es_419-10084850086754329587

Fuente: https://huggingface.co/datasets/google/fleurs/resolve/main/data/es_419/audio/test.tar.gz — CC-BY-4.0 — human_read_speech.

SHA-256: `275d5d9dcbfb7099b9aac08ea81fc7383b94e085a683d127ce4d8ff742cb3961`. Ejecución: `evidence/audio-via-launcher/rows.jsonl`.

Referencia humana externa:

> Esto parece tener sentido, ya que en la Tierra no se percibe su movimiento, ¿cierto?

ASR real:

> Esto parece tener sentido, ya que en la Tierra no se percibe su movimiento, ¿cierto?

Resultado real del corrector:

> Esto parece tener sentido, ya que en la Tierra no se percibe su movimiento, ¿cierto?

Debe conservar/corregir: Conservar la explicación y la pregunta, incluida la negación.

Sin diferencias léxicas; corrector conserva el ASR.

Estado: `unchanged`; motivo: `None`. Duración 8.580 s. ASR 6.219 s; corrección 2.811 s; total pipeline 9.030 s; RTF 0.725. Tokens medidos 605.

WER ASR léxico: 0/15 (0.0000); incluye formato de números y disfluencias. No es una puntuación semántica de la corrección.

## fleurs-en_us-1003119935936341070

Fuente: https://huggingface.co/datasets/google/fleurs/resolve/main/data/en_us/audio/test.tar.gz — CC-BY-4.0 — human_read_speech.

SHA-256: `33aca50159ec2e3cbcc894eb26faa916d6badb1b49fb75994973561540a7f012`. Ejecución: `evidence/audio-via-launcher/rows.jsonl`.

Referencia humana externa:

> However, due to the slow communication channels, styles in the west could lag behind by 25 to 30 year.

ASR real:

> However, due to the slow communication channels, styles in the West could lag behind by 25 to 30 years.

Resultado real del corrector:

> However, due to the slow communication channels, styles in the West could lag behind by 25 to 30 years.

Debe conservar/corregir: Conservar la comunicación lenta, Occidente y el retraso de 25 a 30 años.

ASR: «years» por referencia «year»; no se presenta como reproducción literal perfecta. Corrector sin cambios.

Estado: `unchanged`; motivo: `None`. Duración 10.560 s. ASR 6.276 s; corrección 2.376 s; total pipeline 8.653 s; RTF 0.594. Tokens medidos 608.

WER ASR léxico: 1/19 (0.0526); incluye formato de números y disfluencias. No es una puntuación semántica de la corrección.

## fleurs-en_us-10323357556845456822

Fuente: https://huggingface.co/datasets/google/fleurs/resolve/main/data/en_us/audio/test.tar.gz — CC-BY-4.0 — human_read_speech.

SHA-256: `6b3081a29a5bb6fc6434e8525690edc26b23844841e119c916183f4ba1863372`. Ejecución: `evidence/audio-via-launcher/rows.jsonl`.

Referencia humana externa:

> The Northern Marianas emergency management office said that there were no damages reported in the nation.

ASR real:

> The Northern Marianas Emergency Management Office said that there were no damages reported in the nation.

Resultado real del corrector:

> The Northern Marianas Emergency Management Office said that there were no damages reported in the nation.

Debe conservar/corregir: Conservar entidad Marianas y que no se reportaron daños.

Medium conserva nombre y negación; cambio de mayúsculas respecto de referencia. Small había escrito Mariana.

Estado: `unchanged`; motivo: `None`. Duración 10.800 s. ASR 5.876 s; corrección 2.086 s; total pipeline 7.962 s; RTF 0.544. Tokens medidos 600.

WER ASR léxico: 0/16 (0.0000); incluye formato de números y disfluencias. No es una puntuación semántica de la corrección.

## fleurs-en_us-1036771894648013441

Fuente: https://huggingface.co/datasets/google/fleurs/resolve/main/data/en_us/audio/test.tar.gz — CC-BY-4.0 — human_read_speech.

SHA-256: `9514bffb9e0bd3397f2cf90041eff51b87e68293335f7ff904515a19f8d416e3`. Ejecución: `evidence/audio-via-launcher/rows.jsonl`.

Referencia humana externa:

> As light pollution in their heyday was not the kind of problem it is today, they are usually located in cities or at campuses, easier to reach than those built in modern times.

ASR real:

> As light pollution in their heyday was not the kind of problem it is today, they are usually located in cities or at campuses easier to reach than those built in modern times.

Resultado real del corrector:

> As light pollution in their heyday was not the kind of problem it is today, they are usually located in cities or at campuses easier to reach than those built in modern times.

Debe conservar/corregir: Conservar la comparación histórica y las ubicaciones/accesibilidad.

Sin diferencias léxicas; distinta puntuación. No se elimina la negación ni la explicación.

Estado: `unchanged`; motivo: `None`. Duración 9.900 s. ASR 7.265 s; corrección 2.937 s; total pipeline 10.203 s; RTF 0.734. Tokens medidos 618.

WER ASR léxico: 0/33 (0.0000); incluye formato de números y disfluencias. No es una puntuación semántica de la corrección.

## ami-ES2012a-D-785.35-791.77

Fuente: https://groups.inf.ed.ac.uk/ami/AMICorpusMirror/amicorpus/ES2012a/audio/ES2012a.Headset-3.wav — CC-BY-4.0 — human_spontaneous_meeting.

SHA-256: `1b1bcb3731a6f91522c979d05ec51d11bda635fa578a84f36c2d5c3120358324`. Ejecución: `evidence/audio-release/rows.jsonl`.

Referencia humana externa:

> especially if we try to sell , what two million of them . Oh sorry , four million of 'em ,

ASR real:

> Especially if we try to sell 2 million of them, oh sorry, 4 million of them.

Resultado real del corrector:

> Especially if we try to sell 4 million of them.

Debe conservar/corregir: Retirar la cantidad de dos millones, conservar cuatro millones y «especially if we try to sell».

Reparación e «if» conservados en el resultado actual. Referencia con palabras numéricas y disfluencias; WER no mide la intención limpia. Es reparación humana equivalente, no el caso manual perdido.

Estado: `edited`; motivo: `None`. Duración 6.420 s. ASR 5.939 s; corrección 6.538 s; total pipeline 12.478 s; RTF 0.925. Tokens medidos 647.

WER ASR léxico: 4/17 (0.2353); incluye formato de números y disfluencias. No es una puntuación semántica de la corrección.

## ami-ES2004a-D-968.95-972.10

Fuente: https://groups.inf.ed.ac.uk/ami/AMICorpusMirror/amicorpus/ES2004a/audio/ES2004a.Headset-3.wav — CC-BY-4.0 — human_spontaneous_meeting.

SHA-256: `b0e93f7870286e4e6d696480272f423284c4e8bb86a966639590c02db2c29349`. Ejecución: `evidence/audio-via-launcher/rows.jsonl`.

Referencia humana externa:

> . Sorry I'm treading on your territory guys

ASR real:

> Sorry, I'm trading on your territory, guys.

Resultado real del corrector:

> Sorry, I'm trading on your territory, guys.

Debe conservar/corregir: Conservar la disculpa genuina y «treading on your territory».

FALLO ASR: «trading» por «treading» (small: «chatting»). Propuesta de eliminar disculpa rechazada. Conservar el ASR no arregla la palabra incorrecta.

Estado: `rejected`; motivo: `missing_repair_evidence`. Duración 3.150 s. ASR 5.283 s; corrección 3.923 s; total pipeline 9.206 s; RTF 1.677. Tokens medidos 616.

WER ASR léxico: 1/7 (0.1429); incluye formato de números y disfluencias. No es una puntuación semántica de la corrección.

## ami-IS1000c-C-1165.13-1177.28

Fuente: https://groups.inf.ed.ac.uk/ami/AMICorpusMirror/amicorpus/IS1000c/audio/IS1000c.Headset-2.wav — CC-BY-4.0 — human_spontaneous_meeting.

SHA-256: `bdf01414c5552a7e12c87b30430e11d791f5335430f07976a549a229b11a9437`. Ejecución: `evidence/audio-release/rows.jsonl`.

Referencia humana externa:

> not going to be the standard remote , which is having uh which need just uh six six volt uh th sorry three volts um of D_C_ . It may need more actually

ASR real:

> It's not going to be the standard remote, which is having, which need just 6 volt, sorry, 3 volts DC. It may need more actually.

Resultado real del corrector:

> It's not going to be the standard remote, which is having, which need just 6 volt, sorry, 3 volts DC. It may need more actually.

Debe conservar/corregir: Sustituir seis voltios por tres voltios DC, conservar descripción, negación e incertidumbre posterior sobre necesitar más.

FALLO de corrección pendiente. La versión anterior aceptó borrar tres voltios; la versión entregada vuelve a proponer esa pérdida y ahora la rechaza. Mantiene ASR con decisión descartada. No cuenta como éxito.

Estado: `rejected`; motivo: `completed_repair_span_cannot_expand`. Duración 12.150 s. ASR 11.681 s; corrección 5.494 s; total pipeline 17.176 s; RTF 0.961. Tokens medidos 644.

WER ASR léxico: 12/32 (0.3750); incluye formato de números y disfluencias. No es una puntuación semántica de la corrección.

## held-fleurs-es-1013662909103347734

Fuente: https://huggingface.co/datasets/google/fleurs/resolve/70bb2e84b976b7e960aa89f1c648e09c59f894dd/data/es_419/audio/test.tar.gz — CC-BY-4.0 — human_read_speech.

SHA-256: `27c060cfd8abfffe6f31dc41b3e1fb8ab0adef25ac8347a038c6ef1e536077f8`. Ejecución: `evidence/human-postfreeze/rows.jsonl`.

Referencia humana externa:

> Hoy en día, las personas escriben mensajes en las pantallas de sus computadoras. No tienen la necesidad de, siquiera, aproximarse a un sacapuntas.

ASR real:

> Hoy en día las personas escriben mensajes en las pantallas de sus computadoras, no tienen la necesidad de siquiera aproximarse a un sacapuntas.

Resultado real del corrector:

> Hoy en día las personas escriben mensajes en las pantallas de sus computadoras, no tienen la necesidad de siquiera aproximarse a un sacapuntas.

Debe conservar/corregir: Conservar ambos enunciados y que no hace falta aproximarse a un sacapuntas.

Sin diferencias léxicas; ASR une las oraciones con coma. Corrector no mejora esa puntuación; negación conservada.

Estado: `unchanged`; motivo: `None`. Duración 9.780 s. ASR 7.098 s; corrección 2.817 s; total pipeline 9.916 s; RTF 0.726. Tokens medidos 617.

WER ASR léxico: 0/23 (0.0000); incluye formato de números y disfluencias. No es una puntuación semántica de la corrección.

## qualification-fleurs-es_419-10234623649795772963

Fuente: https://huggingface.co/datasets/google/fleurs/resolve/70bb2e84b976b7e960aa89f1c648e09c59f894dd/data/es_419/audio/test.tar.gz — CC-BY-4.0 — human_read_speech.

SHA-256: `5baf2184c18a597a73752f2524f03bed8ccad911c91d13a94e95ed01474ac862`. Ejecución: `evidence/audio-release/rows.jsonl`.

Referencia humana externa:

> No se ha emitido ni se emitirá ninguna alerta de tsunami ya que, según la agencia geofísica de Yakarta, el terremoto no alcanzó la magnitud de 6,5 exigida a tal fin.

ASR real:

> No se ha emitido ni se emitirá ninguna alerta de tsunami, ya que según la agencia geofísica de Jakarta, el terremoto no alcanzó la magnitud de 6,5 exigida a tal fin.

Resultado real del corrector:

> No se ha emitido ni se emitirá ninguna alerta de tsunami, ya que según la agencia geofísica de Jakarta, el terremoto no alcanzó la magnitud de 6,5 exigida a tal fin.

Debe conservar/corregir: Conservar que no hubo ni habrá alerta, la justificación y el umbral de 6,5.

ASR: Jakarta por Yakarta. Negaciones y cifra conservadas; corrector sin cambios. Control nuevo adquirido después de freeze-release; no reparación espontánea.

Estado: `unchanged`; motivo: `None`. Duración 13.260 s. ASR 8.745 s; corrección 3.237 s; total pipeline 11.983 s; RTF 0.660. Tokens medidos 632.

WER ASR léxico: 1/32 (0.0312); incluye formato de números y disfluencias. No es una puntuación semántica de la corrección.

## qualification-fleurs-en_us-1043394666292127188

Fuente: https://huggingface.co/datasets/google/fleurs/resolve/70bb2e84b976b7e960aa89f1c648e09c59f894dd/data/en_us/audio/test.tar.gz — CC-BY-4.0 — human_read_speech.

SHA-256: `8c5d2b4634bab071370c4d03aca8134cdc25dc256f7409fe872dc82803d3b4c7`. Ejecución: `evidence/audio-release/rows.jsonl`.

Referencia humana externa:

> These theories look at what it is about certain people that make them want the things that they do and what things in their environment will make them do or not do certain things.

ASR real:

> These things look at what it is about certain people that make them want the things that they do and what things in their environment will make them do or not do certain things.

Resultado real del corrector:

> These things look at what it is about certain people that make them want the things that they do and what things in their environment will make them do or not do certain things.

Debe conservar/corregir: Conservar que se habla de teorías y la explicación completa sobre personas y entorno.

FALLO ASR: «things» por «theories», que cambia el sustantivo. Corrector conserva ese error. Control nuevo con negación conservada, sin fidelidad completa de extremo a extremo.

Estado: `unchanged`; motivo: `None`. Duración 15.560 s. ASR 7.129 s; corrección 2.700 s; total pipeline 9.829 s; RTF 0.458. Tokens medidos 617.

WER ASR léxico: 1/34 (0.0294); incluye formato de números y disfluencias. No es una puntuación semántica de la corrección.

