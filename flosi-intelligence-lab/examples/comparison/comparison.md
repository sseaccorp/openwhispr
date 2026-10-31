# Comparación de prompts

**SIMULACIÓN FABRICADA: estas diferencias son errores plantados, no resultados de GPT-OSS.**

Base: v1 (7c7c6f666d8bb993a36eac10f09e6d0d09d09003b18718743aed19486de89d28). Candidato: v2 (3dd0c55ac34140c86236c3fa94984f76be9351787911d2d8d15a2fdcf74fc635).
Esfuerzo: low → low. Modelo: openai/gpt-oss-120b → openai/gpt-oss-120b.
Cambiar esfuerzo o parámetros junto al prompt impide atribuir las diferencias exclusivamente al prompt. Revisar ambos manifest.json, incluidas tarifas y parámetros.

| Medida | Base | Candidato |
| --- | --- | --- |
| recorded | 30 | 30 |
| errors | 0 | 0 |
| automaticFlags | 8 | 2 |
| humanPass | 0 | 0 |
| humanFail | 0 | 0 |
| humanPending | 30 | 30 |
| p50LatencyMs | N/A | N/A |
| p95LatencyMs | N/A | N/A |
| knownEstimatedCostUsd | N/A | N/A |
| unknownCostRows | N/A | N/A |

| Caso | Dimensión | Tipo | Antes | Después | Regresión candidata |
| --- | --- | --- | --- | --- | --- |
| dev-es-01 | self_correction | lexical_signal | flag | pass | no |
| dev-es-02 | self_correction | lexical_signal | flag | pass | no |
| dev-es-03 | self_correction | lexical_signal | flag | pass | no |
| dev-es-03 | names | lexical_signal | flag | pass | no |
| dev-es-04 | numbers | lexical_signal | flag | pass | no |
| dev-es-06 | fillers | lexical_signal | flag | pass | no |
| dev-es-08 | negations | lexical_signal | pass | flag | sí |
| dev-en-01 | self_correction | lexical_signal | flag | pass | no |
| dev-en-02 | self_correction | lexical_signal | flag | pass | no |
| dev-en-06 | fillers | lexical_signal | flag | pass | no |
| dev-en-09 | numbers | lexical_signal | pass | flag | sí |

Una regresión candidata de señal léxica no es un juicio semántico. Las referencias textuales no son un ranking. El corpus es pequeño, sintético y no estima la calidad en usuarios reales.
