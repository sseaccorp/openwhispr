const test = require("node:test");
const assert = require("node:assert/strict");
const { assertLocalDictationOutput } = require("../../src/helpers/flosiQa/cleanupGuard");
const wrap = (text) =>
  `<transcript>\n${text}\n</transcript>\n\nOutput only the cleaned transcript.`;
for (const [input, output] of [
  ["um can you send the report by friday", "Can you send the report by Friday?"],
  ["qué hora es", "¿Qué hora es?"],
  ["what is the capital of france", "What's the capital of France?"],
  ["send the report at five thirty PM", "Send the report at 5:30 PM."],
  ["send the report at 5:30am", "Send the report at 5:30 AM."],
  [
    "la reunión de Flosi con Jesús Márquez es el quince de noviembre",
    "La reunión de Flosi con Jesús Márquez es el 15 de noviembre.",
  ],
  [
    "envía el informe POSTGR ESQL a María el viernes",
    "Envía el informe PostgreSQL a María el viernes.",
  ],
  [
    "send the report at five thirty on november fifteenth",
    "Send the report at 5:30 on November 15th.",
  ],
])
  test(`QA accepts conservative cleanup: ${input}`, () =>
    assert.doesNotThrow(() => assertLocalDictationOutput(wrap(input), output)));
for (const [input, output] of [
  ["what is the capital of france", "The capital of France is Paris."],
  ["cuál es la capital de Francia", "La capital de Francia es París."],
  ["what is the capital of france", "La capital de Francia es París."],
  [
    "eh puedes enviarle el informe a Jesús Márquez el viernes",
    "Puedes enviarle el informe a Jesús Márquez el viernes.",
  ],
  [
    "hola María revisa PostgreSQL",
    "I've scheduled a meeting with the whole team tomorrow at noon.",
  ],
  ["qué hora es", ""],
  ["send the report by Friday at 530", "Send the report by Friday at 5:30 PM."],
  ["send it at 5:30 AM", "Send it at 5:30 PM."],
  ["send the report at 530", "Send the report at 5:30pm."],
])
  test(`QA rejects an unsafe completion: ${output}`, () =>
    assert.throws(() => assertLocalDictationOutput(wrap(input), output), {
      code: "CLEANUP_OUTPUT_INVALID",
    }));
test("QA guard refuses unwrapped input instead of pretending to validate it", () =>
  assert.throws(() => assertLocalDictationOutput("raw", "Raw."), {
    code: "CLEANUP_OUTPUT_INVALID",
  }));
