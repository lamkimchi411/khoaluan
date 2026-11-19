"""Transparent Vietnamese lexicon baseline, not a trained PhoBERT model."""
import re
import unicodedata

POSITIVE = ['hài lòng', 'tuyệt vời', 'chất lượng tốt', 'rất tốt', 'quá tốt', 'nhiệt tình', 'uy tín', 'yêu thích', 'đáng tiền', '❤️', '😍', '👍']
NEGATIVE = ['thất vọng', 'quá tệ', 'lừa đảo', 'bực mình', 'không tốt', 'không hài lòng', 'chậm trễ', 'quá lâu', 'kém', 'hỏng', 'tẩy chay', '😡', '👎']
TOPICS = {
    'quality': ['chất lượng', 'hỏng', 'lỗi', 'kém', 'sản phẩm'],
    'service': ['dịch vụ', 'nhân viên', 'hỗ trợ', 'chăm sóc', 'thái độ'],
    'price': ['giá', 'đắt', 'khuyến mãi', 'hoàn tiền', 'phí'],
    'delivery': ['giao hàng', 'vận chuyển', 'ship', 'chậm trễ', 'đơn hàng'],
    'scam': ['lừa đảo', 'lừa', 'giả mạo', 'chiếm đoạt'],
}
TOXIC = ['lừa đảo', 'tẩy chay', 'vô trách nhiệm', 'rác rưởi', 'đồ tệ', 'kinh khủng', '😡']

def analyze(text):
    text = unicodedata.normalize('NFC', text).lower()
    text = re.sub(r'\b(ko|khum|hong|k)\b', 'không', text)
    negative = sum(phrase in text for phrase in NEGATIVE)
    positive = sum(phrase in text.replace('không hài lòng', '') for phrase in POSITIVE)
    score = round((negative + 0.5) / (positive + negative + 1), 3)
    sentiment = 'negative' if negative > positive else 'positive' if positive > negative else 'neutral'
    matched_topics = {topic: [phrase for phrase in phrases if phrase in text] for topic, phrases in TOPICS.items()}
    matched_topics = {topic: phrases for topic, phrases in matched_topics.items() if phrases}
    topic = max(matched_topics, key=lambda key: len(matched_topics[key])) if matched_topics else 'other'
    toxic_hits = [phrase for phrase in TOXIC if phrase in text]
    toxicity_score = round(min(1, len(toxic_hits) * .35 + (0.2 if sentiment == 'negative' else 0)), 3)
    signal = abs(negative - positive)
    confidence = round(min(.99, .5 + signal * .16 + min(1, len(matched_topics)) * .05 + len(toxic_hits) * .05), 3)
    return {
        'sentiment': sentiment, 'score': score, 'topic': topic,
        'toxicity_score': toxicity_score, 'confidence': confidence,
        'evidence': {'negative_terms': [p for p in NEGATIVE if p in text], 'topics': matched_topics, 'toxic_terms': toxic_hits},
        'method': 'vietnamese-lexicon-multidimensional-baseline'
    }
