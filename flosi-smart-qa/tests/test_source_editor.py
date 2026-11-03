import unittest
from smartqa.source_editor import anchor_proposal
from smartqa.engine import InvalidPlan

class SourceProposal(unittest.TestCase):
    def test_repair_and_full_decision(self):
        for source, proposed in [
            ('Voy a enviar el contrato hoy, espera, no, mejor mañana después de revisarlo', 'Voy a enviar el contrato mañana después de revisarlo.'),
            ('Delete the backups, no, archive them until the audit finishes', 'Archive them until the audit finishes.'),
            ('Manda cinco cajas, perdón, seis cajas y no cambies la dirección', 'Manda seis cajas y no cambies la dirección.')]:
            self.assertEqual(anchor_proposal(source, proposed)['text'],proposed)

    def test_source_bytes_override_model_typography(self):
        source='La dosis es 0,125  mg y el lote RX-903 no cambia.'
        proposal='La dosis es 0,125\u202fmg y el lote RX‐903 no cambia.'
        self.assertEqual(anchor_proposal(source,proposal)['text'],source)

    def test_added_facts_or_affirmative_rewrite_rejected(self):
        for source, proposal in [('No rechaces el trato si aceptan el plazo.', 'Acepta el trato si aceptan el plazo.'),
                                 ('Send the invoice.', 'Send the invoice if approved.')]:
            with self.assertRaises(InvalidPlan):anchor_proposal(source,proposal)

    def test_withdrawal_never_becomes_canceled_order(self):
        source='Publica el anuncio a mediodía, retiro esa petición'
        self.assertEqual(anchor_proposal(source,'Retiro esa petición.')['text'],'Retiro esa petición.')
        with self.assertRaises(InvalidPlan):anchor_proposal(source,'Publica el anuncio a mediodía.')

    def test_stutter_and_hesitation_with_emphasis(self):
        self.assertEqual(anchor_proposal('Um, I I need it; it is very very urgent','I need it; it is very very urgent.')['text'],
                         'I need it; it is very very urgent.')
        with self.assertRaises(InvalidPlan):anchor_proposal('It is very very urgent.','It is very urgent.')

    def test_literal_quote_and_meaningful_words(self):
        with self.assertRaises(InvalidPlan):anchor_proposal('He said "stop, no, continue" verbatim.','He said "continue" verbatim.')
        with self.assertRaises(InvalidPlan):anchor_proposal('The well is dry.','The is dry.')

    def test_negation_loss_is_blocked(self):
        with self.assertRaises(InvalidPlan):anchor_proposal('No abras la puerta.','Abre la puerta.')

    def test_camelcase_name_and_command_are_not_capitalized(self):
        for source in ['iPhone connects to api_key','sha256sum ./release_v7.tar.gz']:
            self.assertEqual(anchor_proposal(source,source)['text'],source)

if __name__=='__main__':unittest.main()
