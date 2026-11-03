import json
import unittest
from smartqa.engine import apply_plan, correct, InvalidPlan
from smartqa.evaluate import score
from smartqa.provider import Provider
from smartqa.provider import LOCAL_MODEL

def plan(before, after, kind='repair'):
    return {'uncertain': False, 'edits': [{'before': before, 'after': after, 'kind': kind}]}

def envelope(content, **change):
    result = {'model': LOCAL_MODEL, 'id': 'fixture',
              'usage': {'prompt_tokens': 100, 'completion_tokens': 20, 'total_tokens': 120},
              'choices': [{'finish_reason': 'stop', 'message': {'role': 'assistant', 'content': content}}]}
    result.update(change)
    return result

class SourceEdits(unittest.TestCase):
    def test_equivalent_user_reproduction(self):
        text = 'Voy a enviarle el contrato hoy, espera, no, mejor mañana después de revisarlo'
        result = apply_plan(text, plan('hoy, espera, no, mejor mañana', 'mañana'))
        self.assertEqual(result['text'], 'Voy a enviarle el contrato mañana después de revisarlo.')

    def test_whole_decision_and_condition(self):
        text = 'Delete the old files, no, archive them until the audit finishes'
        self.assertEqual(apply_plan(text, plan(text, 'archive them until the audit finishes'))['text'],
                         'Archive them until the audit finishes.')

    def test_unrelated_instruction_is_byte_preserved(self):
        text = 'Send to Mara, sorry, Marta; do not move AB-239 or change 0,125  mg.'
        result = apply_plan(text, plan('Mara, sorry, Marta', 'Marta'))
        self.assertEqual(result['text'], 'Send to Marta; do not move AB-239 or change 0,125  mg.')

    def test_no_generic_negation_deletion(self):
        with self.assertRaisesRegex(InvalidPlan, 'missing_repair'):
            apply_plan('No abras la puerta.', plan('No abras', 'abras'))

    def test_initial_apology_or_advice_is_not_an_abandoned_decision(self):
        for source, after in [("Sorry, I'm treading on your territory", "I'm treading on your territory"),
                              ('Mejor consulta con la oficina','consulta con la oficina')]:
            with self.assertRaisesRegex(InvalidPlan,'missing_repair_evidence'):
                apply_plan(source,plan(source,after))

    def test_observed_withdrawal_inversion_is_rejected(self):
        text='Publica el anuncio a mediodía, retiro esa petición'
        with self.assertRaisesRegex(InvalidPlan, 'withdrawal_lost'):
            apply_plan(text, plan(text, 'Publica el anuncio a mediodía'))
        self.assertEqual(apply_plan(text, plan(text, 'retiro esa petición'))['text'], 'Retiro esa petición.')

    def test_explicit_withdrawal_families_keep_withdrawal_and_scope(self):
        for source, after in [('Approve the refund, I take back that instruction.','I take back that instruction.'),
                              ('Confirm the order, I retract that request.','I retract that request.'),
                              ('Registra mi dirección, me retracto de esa petición.','me retracto de esa petición.')]:
            result=apply_plan(source,plan(source,after))
            self.assertEqual(result['text'].casefold(),after.casefold())
            with self.assertRaises(InvalidPlan):
                apply_plan(source,plan(source,source.split(',')[0]))

    def test_final_replacement_condition_cannot_be_dropped(self):
        text='Open it, no, do not open it unless the supervisor is present'
        with self.assertRaisesRegex(InvalidPlan, 'replacement_or_withdrawal_lost'):
            apply_plan(text, plan(text, 'do not open it'))

    def test_explicit_quote_must_survive(self):
        text = 'Ella dijo "abre, no, cierra" y salió.'
        with self.assertRaisesRegex(InvalidPlan, 'literal_quote'):
            apply_plan(text, plan('abre, no, cierra', 'cierra'))

    def test_unbounded_literal_is_review(self):
        text = 'He said verbatim open no wait close the gate'
        with self.assertRaisesRegex(InvalidPlan, 'unbounded_literal'):
            apply_plan(text, plan('open no wait close', 'close'))

    def test_technical_space_and_lookalike_changes_rejected(self):
        for before, after in [('AB-9, sorry, AB-8', 'AB‐8'),
                              ('-2 V, sorry, -1 V', '1 V')]:
            with self.subTest(after=after), self.assertRaises(InvalidPlan):
                apply_plan(before, plan(before, after))

    def test_retained_quantity_spacing_is_copied_from_unique_source(self):
        text='Use -2,5  mg, sorry, -1,5  mg with QK-8'
        p=plan('-2,5  mg, sorry, -1,5  mg','-1,5 mg')
        self.assertEqual(apply_plan(text,p)['text'],'Use -1,5  mg with QK-8.')

    def test_same_quantity_different_spacing_cannot_select_old_form(self):
        text='Use 0.5 mg, sorry, 0.5  mg'
        with self.assertRaises(InvalidPlan):apply_plan(text,plan(text,'Use 0.5 mg'))

    def test_cosmetic_technical_rewrite_does_not_block_separate_repair(self):
        text='Send it today, sorry, tomorrow. The threshold is 0,5  mg.'
        p=plan('today, sorry, tomorrow','tomorrow')
        p['edits'].append({'before':'The threshold is 0,5  mg.','after':'The threshold is 0,5 mg.','kind':'repair'})
        self.assertEqual(apply_plan(text,p)['text'],'Send it tomorrow. The threshold is 0,5  mg.')

    def test_capitalized_replacement_copies_source_case(self):
        text='Send the file, actually, keep it until Friday'
        self.assertEqual(apply_plan(text,plan(text,'Keep it until Friday'))['text'],'Keep it until Friday.')

    def test_explicit_identifier_case_repair_keeps_final_case(self):
        text='Use AB-4, sorry, aB-4'
        self.assertEqual(apply_plan(text,plan(text,'Use aB-4'))['text'],'Use aB-4.')
        with self.assertRaisesRegex(InvalidPlan,'final_technical_replacement_lost'):
            apply_plan(text,plan(text,'Use AB-4'))

    def test_explicit_technical_replacement(self):
        before = 'El umbral es -2,5 V, perdón, -1,5 V y el sensor QK-6'
        result = apply_plan(before, plan('-2,5 V, perdón, -1,5 V', '-1,5 V'))
        self.assertIn('-1,5 V', result['text'])
        self.assertIn('QK-6', result['text'])

    def test_no_added_words_or_reordering(self):
        for after in ['Marta si es posible', 'Marta Mara', 'Mar']:
            with self.subTest(after=after), self.assertRaises(InvalidPlan):
                apply_plan('Mara, sorry, Marta', plan('Mara, sorry, Marta', after))

    def test_source_span_can_extend_to_unique_exact_later_replacement(self):
        text = 'Voy a enviarle el contrato hoy, espera, no, mejor mañana después de revisarlo'
        p = plan('Voy a enviarle el contrato hoy', 'Voy a enviarle el contrato mañana')
        result = apply_plan(text, p)
        self.assertEqual(result['text'], 'Voy a enviarle el contrato mañana después de revisarlo.')
        self.assertEqual(len(result['reanchored']), 1)
        result = apply_plan('Delete the backups, no, archive them until the audit finishes',
                            plan('Delete the backups, no', 'archive them until the audit finishes'))
        self.assertEqual(result['text'], 'Archive them until the audit finishes.')
        result = apply_plan('Deliver it to Martin, sorry, to Martina at reception', plan('Martin, sorry,', 'Martina'))
        self.assertEqual(result['text'], 'Deliver it to Martina at reception.')

    def test_span_extension_rejects_duplicate_replacement_or_crossed_quote(self):
        text='Send A, sorry, B then B'
        with self.assertRaises(InvalidPlan):
            apply_plan(text, plan('Send A', 'Send B'))
        with self.assertRaises(InvalidPlan):
            apply_plan('Send A, sorry, quote "B"', plan('Send A', 'B'))

    def test_model_noop_is_ignored_and_unsolved_repair_is_review(self):
        text='No changes are needed.'
        self.assertEqual(apply_plan(text, plan(text, text))['status'],'unchanged')
        text='Compra pan, espera, mejor guarda el dinero'
        self.assertEqual(apply_plan(text, plan(text, text))['status'],'needs_review')

    def test_initial_source_case_anchor_uses_source_bytes(self):
        text='Call the north office, actually, call the south office if the train is late'
        p=plan('call the north office, actually, call the south office if the train is late',
               'call the south office if the train is late')
        self.assertEqual(apply_plan(text,p)['text'],'Call the south office if the train is late.')

    def test_overlapping_plans_and_ambiguous_anchors_rejected(self):
        text = 'A, sorry, B, sorry, C'
        p = plan('A, sorry, B', 'B')
        p['edits'].append({'before': 'B, sorry, C', 'after': 'C', 'kind': 'repair'})
        with self.assertRaisesRegex(InvalidPlan, 'overlap'):
            apply_plan(text, p)
        with self.assertRaisesRegex(InvalidPlan, 'ambiguous'):
            apply_plan('I I need I', plan('I', 'I', 'stutter'))

    def test_stutter_and_emphasis(self):
        self.assertEqual(apply_plan('I I need it; very very soon', plan('I I need', 'I need', 'stutter'))['text'],
                         'I need it; very very soon.')
        with self.assertRaisesRegex(InvalidPlan, 'stutter'):
            apply_plan('No no, very very important', plan('No no', 'No', 'stutter'))

    def test_command_and_path_edges(self):
        for text in ['printf "%s\\n" "$VALUE"', 'C:\\data\\Ab_2.csv', './script.sh --no-color', 'sha256sum ./release_v7.tar.gz', 'api_key']:
            self.assertEqual(apply_plan(text, {'uncertain': False, 'edits': []})['text'], text)

    def test_unchanged_source_identity_protects_arbitrary_commands(self):
        for text in ['cargo test','make clean','customtool inspect','iPhone uses api_key','value = -0.25  V']:
            self.assertEqual(apply_plan(text,{'uncertain':False,'edits':[]})['text'],text)

    def test_empty_plan_is_not_forced_success_with_unresolved_repair(self):
        result = apply_plan('Send it today, espera, no, mejor tomorrow', {'uncertain': False, 'edits': []})
        self.assertEqual(result['status'], 'needs_review')

    def test_uncertainty_preserves_exact_original(self):
        text = 'quizá tres o cuatro'
        self.assertEqual(apply_plan(text, {'uncertain': True, 'edits': []})['text'], text)

class Evaluation(unittest.TestCase):
    def test_keywords_do_not_pass_complete_output(self):
        c = {'expected': ['Do not open the valve unless it is safe.']}
        for out in ['Open the valve unless it is safe.', 'Do not open the valve.',
                    'Do not open the valve unless it is safe. Also start the pump.']:
            self.assertFalse(score(c, {'text': out, 'status': 'edited'})['completeAnnotationMatch'])

    def test_technical_whitespace_is_never_normalized(self):
        c = {'expected': ['Use 0.5 mg.'], 'technical': ['0.5 mg']}
        self.assertFalse(score(c, {'text': 'Use 0.5\u202fmg.', 'status': 'edited'})['completeAnnotationMatch'])

    def test_semantically_material_punctuation_can_require_complete_exact_output(self):
        c={'input':'No, quiero entrar.','expected':['No, quiero entrar.'],'exact':True}
        result=score(c,{'text':'No quiero entrar.','status':'edited'})
        self.assertTrue(result['completeWordSequenceMatch'])
        self.assertFalse(result['completeAnnotationMatch'])

    def test_fallback_is_failed_correction(self):
        c = {'expected': ['Send it tomorrow.']}
        result = score(c, {'text': 'Send it today, no, tomorrow.', 'status': 'needs_review'})
        self.assertFalse(result['completeAnnotationMatch'])
        self.assertTrue(result['reviewRequested'])

class FailureIsolation(unittest.TestCase):
    def test_truncation_usage_wrong_model_and_tool_calls_keep_original(self):
        original = 'no publicar todavía'
        variants = [envelope('{}', usage=None), envelope('{}', model='other'),
                    envelope('{}', choices=[{'finish_reason': 'length', 'message': {'role': 'assistant', 'content': '{}'}}]),
                    envelope('{}', choices=[{'finish_reason': 'stop', 'message': {'role': 'assistant', 'content': '{}', 'tool_calls': [{}]}}])]
        for payload in variants:
            calls = []
            provider = Provider(transport=lambda body: calls.append(body) or payload)
            result = correct(original, provider)
            self.assertEqual(result['text'], original)
            self.assertEqual(result['status'], 'provider_error')
            self.assertEqual(len(calls), 1)
            self.assertEqual(provider.complete('system','another input')['status'],'error')
            self.assertEqual(len(calls), 1)

    def test_invalid_plan_keep_original(self):
        p = Provider(transport=lambda _: envelope('{"uncertain":false,"edits":[{"before":"missing","after":"invented","kind":"repair"}]}'))
        result = correct('No borrar estos datos.', p)
        self.assertEqual(result['text'], result['original'])
        self.assertEqual(result['status'], 'rejected')

    def test_reference_not_sent(self):
        calls = []
        p = Provider(transport=lambda body: calls.append(body) or envelope('{"uncertain":false,"edits":[]}'))
        correct('entrada del micrófono', p)
        self.assertEqual(json.loads(calls[0]['messages'][1]['content']), {'transcript': 'entrada del micrófono'})

    def test_paid_endpoint_not_enabled(self):
        for endpoint in ['https://api.groq.com/openai/v1/chat/completions', 'https://example.com/v1/chat/completions', 'http://192.168.0.2/v1/chat/completions']:
            with self.assertRaises(ValueError):
                Provider(endpoint=endpoint)

    def test_cap_prevents_extra_requests(self):
        calls = []
        p = Provider(max_requests=1, transport=lambda _: calls.append(1) or envelope('{}'))
        p.complete('s', 'u'); second = p.complete('s', 'u')
        self.assertEqual(second['error'], 'request_cap')
        self.assertEqual(len(calls), 1)

if __name__ == '__main__':
    unittest.main()
