import unittest
from nlp import analyze

class SentimentTests(unittest.TestCase):
    def test_positive(self):
        self.assertEqual(analyze('Dịch vụ rất tốt, nhiệt tình')['sentiment'], 'positive')
    def test_negative_negation(self):
        self.assertEqual(analyze('Không hài lòng')['sentiment'], 'negative')
        self.assertEqual(analyze('ko hài lòng')['sentiment'], 'negative')
    def test_neutral(self):
        self.assertEqual(analyze('Sản phẩm mới ra mắt hôm nay')['sentiment'], 'neutral')
    def test_topic_toxicity_and_evidence(self):
        result = analyze('Dịch vụ giao hàng quá chậm, thật lừa đảo 😡')
        self.assertIn(result['topic'], ['delivery', 'service', 'scam'])
        self.assertGreater(result['toxicity_score'], 0)
        self.assertIn('lừa đảo', result['evidence']['negative_terms'])
        self.assertGreaterEqual(result['confidence'], .5)

if __name__ == '__main__':
    unittest.main()
