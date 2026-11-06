from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from nlp import analyze

class Handler(BaseHTTPRequestHandler):
    def respond(self, code, data):
        payload = json.dumps(data, ensure_ascii=False).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self):
        self.respond(200 if self.path == '/health' else 404, {'status': 'ok', 'model': 'Vietnamese lexicon baseline'})

    def do_POST(self):
        if self.path != '/analyze':
            return self.respond(404, {'error': 'Not found'})
        try:
            size = int(self.headers.get('Content-Length', 0))
            if not 0 < size <= 2000000:
                raise ValueError('Body too large')
            data = json.loads(self.rfile.read(size))
            texts = data['texts']
            if not isinstance(texts, list) or len(texts) > 201 or any(not isinstance(x, str) or len(x) > 10000 for x in texts):
                raise ValueError('Invalid texts')
            self.respond(200, {'results': [analyze(x) for x in texts]})
        except (ValueError, KeyError, TypeError) as error:
            self.respond(400, {'error': str(error)})

if __name__ == '__main__':
    print('NLP service: http://localhost:8001', flush=True)
    ThreadingHTTPServer(('0.0.0.0', int(os.getenv('NLP_PORT', '8001'))), Handler).serve_forever()
