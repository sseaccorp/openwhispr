"""Full-output annotation checks, separate safety and abstention reporting."""
import hashlib
import json
import math
from .engine import word_sequence, _technical, QUOTE

def digest(value):
    data = value if isinstance(value, bytes) else value.encode('utf-8')
    return hashlib.sha256(data).hexdigest()

def score(case, result):
    output = result['text']
    expected = case['expected']
    # Complete sequences; extras, omissions, repeated phrases and inverted
    # negations all fail. Unicode/spacing for technical spans is checked apart.
    full = any(word_sequence(output) == word_sequence(e) for e in expected)
    technical = any(_technical(output) == _technical(e) for e in expected)
    technical = technical and all(span in _technical(output) for span in case.get('technical', []))
    # ASR without quotation marks may legitimately gain minimal quote punctuation.
    # Existing explicit quotes have a byte contract; unmarked speech has a full
    # word/order contract. Never turn added quotes alone into a meaning failure.
    explicit = list(QUOTE.finditer(case.get('input', '')))
    quotes = not explicit or any([m.group() for m in QUOTE.finditer(output)] == [m.group() for m in QUOTE.finditer(e)] for e in expected)
    if case.get('exact'):
        technical = technical and output in expected
    return {'completeAnnotationMatch': full and technical and quotes,
            'completeWordSequenceMatch': full, 'technicalExact': technical,
            'literalQuoteExact': quotes, 'byteReferenceMatch': output in expected,
            'reviewRequested': result['status'] not in ('edited', 'unchanged', 'baseline'),
            'semanticReview': 'pending', 'outputSha256': digest(output)}

def percentile(values, p):
    if not values:
        return None
    return sorted(values)[max(0, math.ceil(len(values)*p)-1)]

def summarize(rows):
    valid = [r for r in rows if r['result'].get('provider', {}).get('status') == 'ok']
    times = [r['result']['provider']['latencyMs'] for r in valid]
    return {'cases': len(rows), 'annotationMatches': sum(r['evaluation']['completeAnnotationMatch'] for r in rows),
            'reviewRequested': sum(r['evaluation']['reviewRequested'] for r in rows),
            'technicalFailures': sum(not r['evaluation']['technicalExact'] for r in rows),
            'providerSuccesses': len(valid), 'correctionP50Ms': percentile(times, .50),
            'correctionP95Ms': percentile(times, .95),
            'tokens': {k: sum(r['result']['provider']['usage'][k] for r in valid)
                       for k in ('prompt_tokens', 'completion_tokens', 'total_tokens')},
            'semanticApproval': 'not_established_by_automatic_checks'}
