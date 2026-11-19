import unittest
from evaluate_nlp import evaluate

class EvaluationTests(unittest.TestCase):
    def test_perfect_labeled_rows_have_full_metrics(self):
        rows = [{ 'text': 'rất tốt', 'label': 'positive' }, { 'text': 'quá tệ', 'label': 'negative' }, { 'text': 'xin thêm thông tin', 'label': 'neutral' }]
        report = evaluate(rows)
        self.assertEqual(report['dataset_size'], 3)
        self.assertEqual(report['accuracy'], 1.0)
        self.assertEqual(report['macro_f1'], 1.0)

if __name__ == '__main__':
    unittest.main()
