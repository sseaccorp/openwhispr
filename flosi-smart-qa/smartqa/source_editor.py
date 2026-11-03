"""A free-text contextual proposal, accepted only as deletions from source words.

The LLM does not calculate spans. We infer exact source edits deterministically,
then reuse the mechanical guards. Formatting from the LLM never rewrites bytes.
"""
import re
from pathlib import Path
from .engine import WORDS, REPAIR, apply_plan, InvalidPlan, word_sequence

EDITOR_PROMPT = Path(__file__).with_name('editor.txt').read_text(encoding='utf-8')
FILLER_WORDS = {'um', 'uh', 'eh', 'ehm', 'mmm', 'well', 'like', 'bueno', 'pues'}
FUNCTION_WORDS = {'i', 'the', 'a', 'we', 'it', 'yo', 'el', 'la', 'un', 'una', 'que', 'es'}

def anchor_proposal(text, proposal):
    source, wanted = list(WORDS.finditer(text)), word_sequence(proposal)
    if not wanted:
        raise InvalidPlan('empty_proposal')
    # Earliest monotone alignment. Identical words carry their source bytes;
    # protected-span and boundary checks below reject unsafe ambiguous cuts.
    kept, at = [], 0
    for word in wanted:
        while at < len(source) and source[at].group().casefold() != word:
            at += 1
        if at == len(source):
            raise InvalidPlan('proposal_added_or_reordered_words')
        kept.append(at); at += 1
    keep_set, edits = set(kept), []
    at = 0
    while at < len(source):
        if at in keep_set:
            at += 1; continue
        first = at
        while at < len(source) and at not in keep_set:
            at += 1
        dropped = [m.group().casefold() for m in source[first:at]]
        if at < len(source):
            start, end = source[first].start(), source[at].end()
            after = source[at].group()
        else:
            # End deletion borrows the final retained word as its nonempty
            # anchor; overlap is conservative rejection, never a guessed merge.
            if not kept:
                raise InvalidPlan('empty_proposal')
            anchor = kept[-1]
            start, end, after = source[anchor].start(), len(text), source[anchor].group()
        before = text[start:end]
        if all(w in FILLER_WORDS for w in dropped):
            kind = 'filler'
            ambiguous = {'well', 'like', 'bueno', 'pues'} & set(dropped)
            prefix = text[:start].rstrip()
            if ambiguous and prefix and prefix[-1] not in '.!?;':
                raise InvalidPlan('meaningful_filler_context')
        elif all(w in FUNCTION_WORDS for w in dropped):
            kind = 'stutter'
        else:
            kind = 'repair'
        # The exact substring must uniquely anchor. Expand with source context,
        # not a model-generated spelling or character offset.
        if text.count(before) != 1:
            raise InvalidPlan('ambiguous_alignment')
        edits.append({'before': before, 'after': after, 'kind': kind})
    result = apply_plan(text, {'uncertain': False, 'edits': edits})
    if result['status'] in ('edited', 'unchanged') and word_sequence(result['text']) != wanted:
        raise InvalidPlan('proposal_alignment_changed_words')
    result['proposal'] = proposal
    return result

def correct_text(text, provider):
    if not isinstance(text, str) or not text.strip() or len(text) > 24000:
        raise ValueError('input must contain 1..24000 characters')
    response = provider.complete(EDITOR_PROMPT, text)
    base = {'original': text, 'text': text, 'status': 'provider_error', 'reason': response.get('error'),
            'edits': [], 'provider': response}
    if response['status'] != 'ok':
        return base
    try:
        result = anchor_proposal(text, response['content'])
    except InvalidPlan as error:
        return {**base, 'status': 'rejected', 'reason': str(error)}
    return {**result, 'provider': response}
