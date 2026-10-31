// Conservative QA acceptance guard, not an ASR/LLM engine or a semantic proof.
// A rejected completion uses the existing raw-transcript fallback. Never retry
// the model or paste from this module. Scope: Spanish/English local dictation.
const PREFIX = "<transcript>\n";
const SUFFIX = "\n</transcript>\n\nOutput only the cleaned transcript.";
const fillers = /^(?:(?:um|uh|er|eh|bueno|pues)[\s,.:]+)+/iu;
const question =
  /^(?:¿\s*)?(?:what|what's|who|when|where|why|how|which|whose|can|could|would|should|do|does|did|is|are|will|cual(?:es)?|que|quien(?:es)?|cuando|donde|por que|como|cuant[oa]s?|puedes|podrias)\b/iu;
const common = new Set(
  (
    "a an the of to in on at for by and or with is are be was it its me my you your can could would should do does did what whats which who when where why how please um uh er " +
    "el la los las un una unos unas de del a al en por para con y o es son ser se le les lo te me mi mis tu tus que cual cuales quien quienes cuando donde como puedes podrias eh bueno pues"
  ).split(/\s+/)
);
function tokens(value) {
  return (
    value
      .normalize("NFKD")
      .replace(/\p{M}/gu, "")
      .toLowerCase()
      .match(/[\p{L}\p{N}]+/gu) || []
  ).filter((token) => !common.has(token) && !/^\d/u.test(token));
}
function reject(reason) {
  throw Object.assign(
    new Error(
      "Local cleanup could not preserve the dictation safely; the original transcript was kept."
    ),
    { code: "CLEANUP_OUTPUT_INVALID", details: { reason } }
  );
}
function assertLocalDictationOutput(wrapped, output) {
  if (!wrapped.startsWith(PREFIX) || !wrapped.endsWith(SUFFIX))
    reject("unexpected_cleanup_envelope");
  const raw = wrapped.slice(PREFIX.length, -SUFFIX.length).trim();
  if (typeof output !== "string" || !output.trim()) reject("empty_answer");
  const start = raw.replace(fillers, "").normalize("NFKD").replace(/\p{M}/gu, "");
  if ((question.test(start) || raw.endsWith("?")) && !output.trim().endsWith("?"))
    reject("question_became_statement");
  // A time with no half-day qualifier must not silently gain AM/PM. This
  // protects an actual Qwen completion observed in the native smoke corpus.
  const periods = (value) =>
    Array.from(value.matchAll(/\b([ap])\.?\s*m\.?\b/giu), (match) => match[1].toLowerCase());
  const rawPeriods = new Set(periods(raw));
  const explicitTimeContext =
    /\b(?:morning|afternoon|evening|night|tarde|noche)\b|ma[ñn]ana/iu.test(raw);
  const writtenPeriods = Array.from(output.matchAll(/\d\s*([ap])\.?\s*m\.?\b/giu), (match) =>
    match[1].toLowerCase()
  );
  if (!explicitTimeContext && writtenPeriods.some((period) => !rawPeriods.has(period)))
    reject("invented_time_period");
  const input = tokens(raw),
    result = tokens(output);
  const known = new Set(input);
  const retained = result.filter((token) => known.has(token)).length;
  if (
    input.length >= 2 &&
    result.length >= 2 &&
    (retained < Math.ceil(result.length * 0.6) || result.length > input.length * 2 + 3)
  )
    reject("insufficient_lexical_support");
}
module.exports = { assertLocalDictationOutput };
