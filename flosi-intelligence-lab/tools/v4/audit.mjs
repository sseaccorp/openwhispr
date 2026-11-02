import { evaluate } from '../../src/evaluate.mjs';

export const GROUPS = ['A', 'B', 'C'];
const kinds = ['tokens', 'absent_tokens', 'token_count', 'exact', 'exact_output'];
export const tokens = text => (text.match(/[\p{L}\p{M}\p{N}_]+(?:['’][\p{L}\p{M}\p{N}_]+)*/gu) ?? []).map(x => x.toLowerCase());
const countSequence = (haystack, needle) => haystack.reduce((n, _, i) => n + Number(needle.every((x, j) => haystack[i + j] === x)), 0);
const extendsSpan = char => char !== undefined && /[\p{L}\p{M}\p{N}_/\\+\-−]/u.test(char);

// Prose checks tolerate punctuation, never reorder words. Technical checks do
// no Unicode, case or whitespace normalization, and reject partial identifiers.
export function exactSpan(output, value) {
  let at = output.indexOf(value);
  while (at !== -1) {
    const before = output[at - 1], after = output[at + value.length];
    const suffix = output.slice(at + value.length);
    // A final prose period is allowed; a changed sign, suffix, path extension
    // or longer identifier must not pass by containing the expected substring.
    if (!extendsSpan(before) && !extendsSpan(after) && !/^[.,:]\S/u.test(suffix)) return true;
    at = output.indexOf(value, at + 1);
  }
  return false;
}

export function validateRules(rules) {
  if (!Array.isArray(rules) || !rules.length) throw new Error('RULES_REQUIRED');
  const seen = new Set();
  for (const r of rules) {
    if (!/^[a-z0-9-]+$/u.test(r.id) || seen.has(r.id) || !GROUPS.includes(r.group) || !kinds.includes(r.kind) ||
        !['P0', 'P1', 'P2'].includes(r.priority) || typeof r.value !== 'string' || !r.value.trim() ||
        (r.kind === 'token_count' && (!Number.isSafeInteger(r.count) || r.count < 0)) ||
        (['tokens', 'absent_tokens', 'token_count'].includes(r.kind) && !tokens(r.value).length)) throw new Error('INVALID_RULE');
    seen.add(r.id);
  }
}

export function audit(c, output, status = 'ok') {
  const available = status === 'ok' && typeof output === 'string' && Boolean(output.trim());
  const results = [];
  if (c.checks) {
    const legacy = evaluate(c, output, available ? 'ok' : 'invalid_response');
    for (const [i, r] of legacy.checks.entries()) results.push({
      id: `legacy-${i}`, group: ['names', 'numbers'].includes(r.dimension) ? 'C' : ['fillers', 'punctuation'].includes(r.dimension) ? 'B' : 'A',
      priority: ['meaning', 'negations', 'self_correction', 'names', 'numbers'].includes(r.dimension) ? 'P0' : 'P1',
      kind: `legacy_${r.kind}`, value: r.values ?? null, state: available ? (r.pass ? 'no_flag' : 'flag') : 'unavailable'
    });
  }
  const outTokens = tokens(output ?? '');
  for (const r of c.rules ?? []) {
    const count = countSequence(outTokens, tokens(r.value));
    const pass = r.kind === 'tokens' ? count > 0 : r.kind === 'absent_tokens' ? count === 0 :
      r.kind === 'token_count' ? count === r.count : r.kind === 'exact' ? exactSpan(output ?? '', r.value) : output === r.value;
    results.push({ ...r, state: available ? (pass ? 'no_flag' : 'flag') : 'unavailable' });
  }
  // Invisible characters can be functional changes, even outside annotated
  // spans. Flag introductions, but never rewrite the stored model response.
  const special = /(?![ \r\n\t])[\p{Cc}\p{Cf}\p{Zs}\p{Zl}\p{Zp}]/gu;
  const originalSpecial = (c.input.match(special) ?? []).sort().join('');
  const outputSpecial = ((output ?? '').match(special) ?? []).sort().join('');
  results.push({ id: 'special-unicode', group: 'C', priority: 'P1', kind: 'codepoints', value: null,
    state: !available ? 'unavailable' : outputSpecial === originalSpecial ? 'no_flag' : 'flag' });
  return { groups: Object.fromEntries(GROUPS.map(g => {
    const rules = results.filter(r => r.group === g);
    return [g, { checked: rules.length, flags: rules.filter(r => r.state === 'flag').length, unavailable: rules.filter(r => r.state === 'unavailable').length }];
  })), rules: results, decision: 'pending', reviewRequired: true };
}
