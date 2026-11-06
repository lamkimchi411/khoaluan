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

if __name__ == '__main__':
    unittest.main()
