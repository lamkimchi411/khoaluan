"""Transparent Vietnamese lexicon baseline, not a trained PhoBERT model."""
import re
import unicodedata

POSITIVE = ['hài lòng', 'tuyệt vời', 'chất lượng tốt', 'rất tốt', 'quá tốt', 'nhiệt tình', 'uy tín', 'yêu thích', 'đáng tiền', '❤️', '😍', '👍']
NEGATIVE = ['thất vọng', 'quá tệ', 'lừa đảo', 'bực mình', 'không tốt', 'không hài lòng', 'chậm trễ', 'quá lâu', 'kém', 'hỏng', 'tẩy chay', '😡', '👎']

def analyze(text):
    text = unicodedata.normalize('NFC', text).lower()
    text = re.sub(r'\b(ko|khum|hong|k)\b', 'không', text)
    negative = sum(phrase in text for phrase in NEGATIVE)
    positive = sum(phrase in text.replace('không hài lòng', '') for phrase in POSITIVE)
    score = round((negative + 0.5) / (positive + negative + 1), 3)
    sentiment = 'negative' if negative > positive else 'positive' if positive > negative else 'neutral'
    return {'sentiment': sentiment, 'score': score, 'method': 'vietnamese-lexicon-baseline'}
