import { DIMENSIONS, normalize } from './shared.mjs';

export function evaluate(c, output, status = 'ok') {
  const text = normalize(output ?? '');
  const checks = c.checks.map(check => {
    let pass = false;
    if (status === 'ok') {
      if (check.kind === 'terminal') pass = /[.!?…]["'»”)]?$/u.test((output ?? '').trim());
      else if (check.kind === 'contains') pass = check.values.some(v => text.includes(normalize(v)));
      else pass = check.values.every(v => !text.includes(normalize(v)));
    }
    return { ...check, pass };
  });
  const signals = Object.fromEntries(DIMENSIONS.map(d => {
    const applicable = checks.filter(x => x.dimension === d);
    return [d, status !== 'ok' ? 'unavailable' : !applicable.length ? 'not_checked' : applicable.every(x => x.pass) ? 'pass' : 'flag'];
  }));
  return {
    exactReferenceMatch: status === 'ok' && c.expected.some(x => normalize(x) === text),
    checks, signals,
    automaticFlags: checks.filter(x => !x.pass).length,
    reviewRequired: true,
    // A lexical match does not establish semantic equivalence or punctuation quality.
    human: Object.fromEntries(DIMENSIONS.map(d => [d, 'pending'])),
    decision: 'pending'
  };
}

export function applyReviews(rows, document) {
  if (document.schemaVersion !== 1 || !Array.isArray(document.reviews)) throw new Error('Invalid review schema');
  const byId = new Map(rows.map(r => [r.caseId, r]));
  const seen = new Set();
  for (const review of document.reviews) {
    const row = byId.get(review.caseId);
    if (!row || seen.has(review.caseId) || review.outputHash !== row.outputHash || document.runId !== row.runId) throw new Error('Review does not match this run/output, or duplicate review');
    seen.add(review.caseId);
    if (!review.reviewer?.trim() || !review.notes?.trim()) throw new Error('Review requires reviewer and notes');
    if (row.status !== 'ok') throw new Error('Cannot approve an unsuccessful API response');
    for (const d of DIMENSIONS) {
      if (!['pass', 'fail', 'uncertain', 'na'].includes(review.dimensions?.[d])) throw new Error(`Review requires dimension ${d}`);
    }
    // Meaning and punctuation always apply. Ambiguity cannot be waived automatically.
    if (['na'].includes(review.dimensions.meaning) || ['na'].includes(review.dimensions.punctuation)) throw new Error('Meaning and punctuation must be reviewed');
    const values = Object.values(review.dimensions);
    row.evaluation.human = review.dimensions;
    row.evaluation.decision = values.includes('fail') ? 'fail' : values.includes('uncertain') ? 'uncertain' : 'pass';
    row.evaluation.reviewRequired = row.evaluation.decision === 'uncertain';
    row.review = review;
  }
  return rows;
}
