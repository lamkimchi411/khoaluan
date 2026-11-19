import json
from pathlib import Path
from nlp import analyze

SENTIMENT_LABELS = ['positive', 'neutral', 'negative']

def classification_report(rows, actual_key, predicted):
    labels = sorted({row[actual_key] for row in rows} | {predicted(row) for row in rows})
    matrix = {actual: {predicted_label: 0 for predicted_label in labels} for actual in labels}
    for row in rows:
        matrix[row[actual_key]][predicted(row)] += 1
    total = len(rows)
    correct = sum(matrix[label][label] for label in labels)
    per_label = {}
    for label in labels:
        tp = matrix[label][label]
        fp = sum(matrix[actual][label] for actual in labels if actual != label)
        fn = sum(matrix[label][predicted_label] for predicted_label in labels if predicted_label != label)
        precision = tp / (tp + fp) if tp + fp else 0
        recall = tp / (tp + fn) if tp + fn else 0
        f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0
        per_label[label] = { 'precision': round(precision, 3), 'recall': round(recall, 3), 'f1': round(f1, 3), 'support': sum(matrix[label].values()) }
    return { 'dataset_size': total, 'accuracy': round(correct / total, 3) if total else 0, 'macro_f1': round(sum(row['f1'] for row in per_label.values()) / len(labels), 3) if labels else 0, 'labels': labels, 'per_label': per_label, 'confusion_matrix': matrix }

def evaluate(rows):
    sentiment = classification_report(rows, 'label', lambda row: analyze(row['text'])['sentiment'])
    multidimensional = [row for row in rows if 'topic' in row and 'toxicity' in row]
    topics = classification_report(multidimensional, 'topic', lambda row: analyze(row['text'])['topic'])
    toxicity = classification_report(multidimensional, 'toxicity', lambda row: 'toxic' if analyze(row['text'])['toxicity_score'] >= .5 else 'non_toxic')
    return { **sentiment, 'tasks': { 'sentiment': sentiment, 'topic': topics, 'toxicity': toxicity } }

if __name__ == '__main__':
    path = Path(__file__).with_name('nlp_eval_dataset.json')
    print(json.dumps(evaluate(json.loads(path.read_text(encoding='utf-8'))), ensure_ascii=False))
