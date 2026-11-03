# Acceptance criteria established before final validation

This is a new, isolated experimental engine, never a production release by default.

1. All final validation outputs are compared as COMPLETE ordered word sequences
   against annotated acceptable outputs, with separate byte-exact technical checks.
   No substring or keyword score can pass a case. A full-sequence match is an
   annotation match, not proof of semantic equivalence in arbitrary speech.
2. Zero critical meaning errors: invented facts, loss of a legitimate instruction,
   reversed negation, lost conditions, edits to literal speech, or retained
   superseded decisions. A fallback retaining an uncorrected decision is a failed
   correction, even when the UI correctly requests review.
3. At least 95% complete annotation matches on clear repairs and cleanup;
   100% on preservation controls and retained technical characters.
4. All unavailable, invalid, truncated, timed-out and rate-limited requests preserve
   the original with an explicit non-success status. No automatic retries, hidden
   provider/model changes, silent truncation, or sending references to inference.
5. Repeated identical inputs (at least three repeats of selected repairs and
   controls) must have identical semantic outcomes; variations are reported.
6. Real human audio must have a documented source, license/permission, hash,
   reference, original ASR, corrected text, errors and separate stage times.
   Read speech is a preservation control, not evidence of spontaneous repair.
   No TTS or concatenation of unrelated clips masquerades as human dictation.
7. Windows microphone capture must be executed on Windows to pass that gate.
   Cloud file processing, browser tests and script parsing cannot waive it.
8. Commercial speed target: correction p95 <= 1.5 s, warm ASR RTF <= 0.5.
   Report actual CPU/cloud timings even if these gates fail. Cold model load is
   recorded separately. No commercial speed claim from a small sample.
9. Freeze source/prompt/config hashes before authoring final cases. Final results
   are append-only evidence. If modified after evaluation, the final set becomes
   development data and a new untouched set is required. The historic public
   holdout is not independent and is not used.
10. Original Flosi QA, historic lab artifacts and existing checkout stay unchanged.

No configured inference secrets were present at environment inspection. Local
CPU inference is authorized and incurs no external inference charges. Missing
Groq evidence is not inferred from another model's results. No release is approved
if any mandatory gate is unmeasured or failed. Agent review is labelled as such;
it is not an independent human product-quality review.
