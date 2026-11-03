"""Source-anchored editing. These checks enforce mechanical fidelity, NOT semantics."""
import json
import re
from pathlib import Path

PROMPT = Path(__file__).with_name('planner.txt').read_text(encoding='utf-8')
SCHEMA = {
    'type': 'object', 'additionalProperties': False, 'required': ['uncertain', 'edits'],
    'properties': {
        'uncertain': {'type': 'boolean'},
        'edits': {'type': 'array', 'items': {
            'type': 'object', 'additionalProperties': False,
            'required': ['before', 'after', 'kind'],
            'properties': {'before': {'type': 'string'}, 'after': {'type': 'string'},
                           'kind': {'type': 'string', 'enum': ['repair', 'filler', 'stutter']}}
        }}
    }
}
WORDS = re.compile(r"[^\W_]+(?:['’][^\W_]+)*", re.UNICODE)
ATOMS = re.compile(r"\w+(?:['’]\w+)*|[^\w\s]", re.UNICODE)
QUOTE = re.compile(r'"(?:\\.|[^"\\])*"|«[^»]*»|“[^”]*”|(?<!\w)\x27[^\x27\n]+\x27(?!\w)')
WITHDRAWAL_PATTERN = r'(?:retiro|me retracto|anula|anulo|descarta|descarto|cancela|cancelo|olvida|olvid[aá]lo|take back|never mind|forget that|withdraw(?:n|s|ing)?|withdrew|cancel(?:l?ed|l?ing|s)?|retract(?:ed|ing|s)?|rescind(?:ed|ing|s)?|scratch)'
REPAIR = re.compile(r'\b(?:'+WITHDRAWAL_PATTERN+r'|espera|perd[oó]n|mejor|rectifico|no|sorry|actually|instead|rather|wait|correction|I mean|make that)\b', re.I)
WITHDRAWAL = re.compile(r'\b'+WITHDRAWAL_PATTERN+r'\b', re.I)
RESIDUAL = re.compile(r'\b(?:espera\s*[,;]?\s*(?:no|mejor)|no\s*[,;]?\s*mejor|perd[oó]n(?=\s*[,;])|sorry(?=\s*[,;.])|scratch that|I mean(?=\s*[,;])|wait\s*[,;]?\s*no)\b', re.I)
LITERAL = re.compile(r'\b(?:literalmente|palabra por palabra|tal cual|verbatim|word for word|quote exactly|copy exactly|copia exactamente)\b', re.I)
COMMAND = re.compile(r'^(?:git|npm|npx|node|python|python3|pip|curl|wget|printf|echo|sha256sum|shasum|ls|cd|cat|grep|rg|ffmpeg|kubectl|docker|pwsh|powershell|Get-[A-Za-z]+|Set-[A-Za-z]+)(?:\s|$)')
TECH = re.compile(
    r'https?://[^\s<>"»]+|[A-Za-z]:\\[^\s<>"»]+|(?<!\w)(?:\.?\.?/)[^\s<>"»]+'
    r'|(?<!\w)--[A-Za-z][\w-]*(?:=[^\s,;]+)?'
    r'|\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b'
    r'|\b[A-Za-z_][A-Za-z0-9]*_[A-Za-z0-9_]+\b'
    r'|\b(?=[\w-]*[A-Za-z])(?=[\w-]*\d)[A-Za-z0-9]+(?:[-_][A-Za-z0-9]+)+\b'
    r'|(?<!\w)[+\-−]?\d+(?:[.,]\d+)*(?:[ \t\u00a0\u202f]+(?:mg|kg|mm|cm|mL|ml|ms|MB|GB|m|g|V|A|s|%))?(?!\w)'
)

class InvalidPlan(ValueError):
    pass

def word_sequence(text):
    """Complete words, preserving negations, order, counts, accents and numerals."""
    return [m.group().casefold() for m in WORDS.finditer(text)]

def _subsequence(needle, haystack):
    iterator = iter(haystack)
    return all(any(v == item for v in iterator) for item in needle)

def _technical(text):
    return [m.group().rstrip('.,;!?') for m in TECH.finditer(text)]

def _validate_change(before, after, kind, left_context=''):
    source = ATOMS.findall(before)
    kept = ATOMS.findall(after)
    if not _subsequence(kept, source):
        raise InvalidPlan('invented_or_reordered_characters')
    # Whitespace is data too, including nonbreaking spaces. No invisible additions.
    if any(c.isspace() and c not in ' \n\r\t' and after.count(c) > before.count(c) for c in after):
        raise InvalidPlan('introduced_whitespace')
    if before == after or not after.strip():
        raise InvalidPlan('empty_or_noop_edit')
    if kind == 'repair':
        evidence = [m for m in REPAIR.finditer(before) if (m.start() > 0 or WITHDRAWAL.fullmatch(m.group())) and (m.group().casefold() != 'no' or (
            m.start() > 0 and re.search(r',\s*$', before[:m.start()]) and
            (re.match(r'\s*,', before[m.end():]) or not before[m.end():].strip(' ,.;')) and
            any(w != 'no' for w in word_sequence(before[:m.start()]))))]
        if not evidence:
            raise InvalidPlan('missing_repair_evidence')
        final_marker = evidence[-1]
        # The final replacement is an assertion to retain, not disposable repair
        # language. This catches the observed inversion that kept the canceled
        # instruction while deleting its withdrawal. It also protects a final
        # replacement's conditions/negations from being cropped within an edit.
        begins_with_withdrawal = WITHDRAWAL.fullmatch(final_marker.group())
        final_tail = before[final_marker.start() if begins_with_withdrawal else final_marker.end():]
        required = word_sequence(final_tail)
        contextual = word_sequence(left_context + after)
        if required and contextual[-len(required):] != required:
            raise InvalidPlan('final_replacement_or_withdrawal_lost')
        required_tech, contextual_tech = _technical(final_tail), _technical(left_context + after)
        if required_tech and contextual_tech[-len(required_tech):] != required_tech:
            raise InvalidPlan('final_technical_replacement_lost')
    elif kind == 'filler':
        # These are candidates, never unconditional production stopwords.
        remainder = before
        for token in kept:
            at = remainder.find(token)
            if at >= 0:
                remainder = remainder[:at] + remainder[at + len(token):]
        if not re.fullmatch(r'\s*(?:(?:um|uh|eh|ehm|mmm|bueno|pues|well|like)[,\s]*)+', remainder, re.I):
            raise InvalidPlan('unsupported_filler_deletion')
    elif kind == 'stutter':
        context = word_sequence(left_context)[-1:]
        oldwords, newwords = context + word_sequence(before), context + word_sequence(after)
        function_words = {'i', 'the', 'a', 'we', 'it', 'yo', 'el', 'la', 'un', 'una', 'que', 'es'}
        removed = [v for op, a, b, c, d in __import__('difflib').SequenceMatcher(a=oldwords, b=newwords).get_opcodes()
                   if op == 'delete' for v in oldwords[a:b]]
        if not removed or any(v not in function_words for v in removed) or any(
            before_count <= newwords.count(v) or newwords.count(v) == 0
            for v in removed for before_count in [oldwords.count(v)]
        ):
            raise InvalidPlan('unsupported_stutter_deletion')
    else:
        raise InvalidPlan('invalid_kind')
    # A technical span can disappear only with a declared explicit repair. A
    # retained span must be byte-identical; no partial numeric/identifier matches.
    oldtech, newtech = _technical(before), _technical(after)
    if not _subsequence(newtech, oldtech):
        raise InvalidPlan('technical_character_change')
    if kind != 'repair' and oldtech != newtech:
        raise InvalidPlan('technical_deletion')

def render(text):
    # No global whitespace or typography normalizer. Only outer prose edges.
    if not text.strip():
        return text
    stripped = text.strip(' \r\n\t')
    # Standalone technical material and shell-like commands stay byte exact.
    if TECH.fullmatch(stripped) or COMMAND.match(stripped) or re.match(r'^(?:[\w./\\-]+)\s+(?:--|[\x27"$])', stripped):
        return text
    at = next((i for i, c in enumerate(text) if not c.isspace()), 0)
    first_word = next((m.group() for m in WORDS.finditer(text) if m.start() == at), '')
    if text[at].islower() and len(text[at].upper()) == 1 and not any(c.isupper() for c in first_word[1:]) and not any(m.start() <= at < m.end() for m in TECH.finditer(text)):
        text = text[:at] + text[at].upper() + text[at+1:]
    if text.rstrip().endswith(('.', '!', '?', '…', '"', '»', '”')):
        return text
    return text.rstrip(' \r\n\t') + '.'

def apply_plan(text, plan):
    if not isinstance(plan, dict) or set(plan) != {'uncertain', 'edits'} or type(plan['uncertain']) is not bool or not isinstance(plan['edits'], list) or len(plan['edits']) > 40:
        raise InvalidPlan('schema')
    if plan['uncertain']:
        if plan['edits']:
            raise InvalidPlan('uncertain_with_edits')
        return {'original': text, 'text': text, 'status': 'needs_review', 'reason': 'model_uncertain', 'edits': []}
    spans, quotes, reanchored = [], list(QUOTE.finditer(text)), []
    for edit in plan['edits']:
        if not isinstance(edit, dict) or set(edit) != {'before', 'after', 'kind'} or not all(isinstance(v, str) for v in edit.values()):
            raise InvalidPlan('edit_schema')
        before, after, kind = edit['before'], edit['after'], edit['kind']
        if before and text.count(before) != 1 and len(before[0].swapcase()) == 1:
            # Observed model formatting error: sentence-initial Call -> call in
            # an anchor. Match only this single-character case difference, then
            # retain the ACTUAL source bytes. Never case-normalize `after`.
            alternative = before[0].swapcase() + before[1:]
            if text.count(alternative) == 1:
                reanchored.append({'before': before, 'expandedBefore': alternative, 'reason': 'source_initial_case'})
                before = alternative
        if not before or text.count(before) != 1:
            raise InvalidPlan('missing_or_ambiguous_source')
        start, end = text.index(before), text.index(before) + len(before)
        if word_sequence(before) == word_sequence(after):
            # The contract authorizes source-word deletions. A proposed edit
            # with the same complete words is cosmetic: preserve ALL original
            # bytes instead of letting a whitespace/case rewrite block repairs.
            continue
        if after and len(after[0].swapcase()) == 1 and not _subsequence(ATOMS.findall(after), ATOMS.findall(before)):
            alternative = after[0].swapcase() + after[1:]
            if _subsequence(ATOMS.findall(alternative), ATOMS.findall(before)):
                reanchored.append({'before': after, 'expandedBefore': alternative, 'reason': 'retained_source_initial_case'})
                after = alternative
        # Restore a retained quantity's original spacing only when its complete
        # non-whitespace characters identify ONE source representation. Signs,
        # digits, separators and unit case are never normalized or guessed.
        source_tech = [m.group() for m in TECH.finditer(before)]
        for technical in reversed(list(TECH.finditer(after))):
            value = technical.group()
            if value in source_tech or not any(c.isspace() for c in value):
                continue
            compact = ''.join(value.split())
            matches = {s for s in source_tech if ''.join(s.split()) == compact}
            if len(matches) == 1:
                original = matches.pop()
                reanchored.append({'before': value, 'expandedBefore': original, 'reason': 'retained_source_technical_spacing'})
                after = after[:technical.start()] + original + after[technical.end():]
        if kind == 'repair' and not _subsequence(ATOMS.findall(after), ATOMS.findall(before)):
            # Observed format failure: the model selects the abandoned phrase,
            # but puts a later source replacement outside its own `before` span.
            # Extend ONLY to a unique exact later suffix, never invent a word,
            # choose between duplicate matches or cross a protected quote.
            old_atoms, new_atoms = list(ATOMS.finditer(before)), list(ATOMS.finditer(after))
            common = 0
            while common < min(len(old_atoms), len(new_atoms)) and old_atoms[common].group() == new_atoms[common].group():
                common += 1
            tail = after[new_atoms[common].start():] if common < len(new_atoms) else ''
            target = text.find(tail, end) if tail else -1
            if target != -1 and text.find(tail, target+1) == -1:
                expanded = text[start:target+len(tail)]
                if REPAIR.search(expanded) and _subsequence(ATOMS.findall(after), ATOMS.findall(expanded)):
                    reanchored.append({'before': before, 'expandedBefore': expanded})
                    before, end = expanded, target+len(tail)
        if (start and text[start-1].isalnum() and before[0].isalnum()) or (end < len(text) and text[end].isalnum() and before[-1].isalnum()):
            raise InvalidPlan('partial_word_edit')
        for quote in quotes:
            if start < quote.end() and quote.start() < end:
                # Surrounding edits may include an untouched complete quote.
                if not (start <= quote.start() and quote.end() <= end and quote.group() in after):
                    raise InvalidPlan('literal_quote_edit')
        if LITERAL.search(text) and not quotes:
            raise InvalidPlan('unbounded_literal_speech')
        spans.append((start, end, after, kind))
    spans.sort()
    if any(a[1] > b[0] for a, b in zip(spans, spans[1:])):
        raise InvalidPlan('overlap')
    output, at = '', 0
    for start, end, after, kind in spans:
        prefix = output + text[at:start]
        _validate_change(text[start:end], after, kind, prefix)
        output = prefix + after
        at = end
    output += text[at:]
    if not _subsequence(ATOMS.findall(output), ATOMS.findall(text)):
        raise InvalidPlan('boundary_created_content')
    if not _subsequence(_technical(output), _technical(text)):
        raise InvalidPlan('technical_boundary_change')
    # A common unsolved repair is visibly non-success. This is a diagnostic
    # detector, not a complete semantic check or global word-removal filter.
    residuals = list(RESIDUAL.finditer(QUOTE.sub('', output)))
    if any(m.start() > 0 or spans for m in residuals) and not LITERAL.search(text):
        return {'original': text, 'text': text, 'status': 'needs_review', 'reason': 'unresolved_repair', 'edits': []}
    return {'original': text, 'text': render(output) if spans else text, 'status': 'edited' if spans else 'unchanged',
            'reason': None, 'edits': [{'before': text[a:b], 'after': c, 'kind': d} for a,b,c,d in spans], 'reanchored': reanchored}

def correct(text, provider):
    if not isinstance(text, str) or not text.strip() or len(text) > 24000:
        raise ValueError('input must contain 1..24000 characters')
    response = provider.complete(PROMPT, json.dumps({'transcript': text}, ensure_ascii=False), SCHEMA)
    base = {'original': text, 'text': text, 'status': 'provider_error', 'reason': response.get('error'),
            'edits': [], 'provider': response}
    if response['status'] != 'ok':
        return base
    try:
        result = apply_plan(text, json.loads(response['content']))
    except (json.JSONDecodeError, InvalidPlan, TypeError) as error:
        base.update(status='rejected', reason=str(error) if isinstance(error, InvalidPlan) else 'invalid_plan_json')
        return base
    return {**result, 'provider': response}
