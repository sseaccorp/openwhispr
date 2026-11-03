import argparse
import base64
import json
import os
import tempfile
import threading
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from .audio import AudioPipeline
from .engine import correct
from .provider import Provider, LOCAL_MODEL

ROOT = Path(__file__).resolve().parents[1]

def make_handler(provider, pipeline, runtime, port):
    gate = threading.Lock()
    expected_host = f'127.0.0.1:{port}'
    expected_origin = f'http://{expected_host}'

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass  # No transcripts, audio or request bodies in access logs.

        def send(self, status, payload, mime='application/json'):
            raw = json.dumps(payload, ensure_ascii=False).encode() if mime == 'application/json' else payload
            self.send_response(status)
            self.send_header('Content-Type', mime)
            self.send_header('Content-Length', str(len(raw)))
            self.send_header('Cache-Control', 'no-store')
            self.send_header('X-Content-Type-Options', 'nosniff')
            self.send_header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; media-src 'self' blob:; object-src 'none'; frame-ancestors 'none'")
            self.end_headers(); self.wfile.write(raw)

        def do_GET(self):
            if self.headers.get('Host') != expected_host:
                return self.send(403, {'error': 'invalid_host'})
            files = {'/': ('index.html', 'text/html; charset=utf-8'), '/app.js': ('app.js', 'application/javascript'),
                     '/capture.js': ('capture.js', 'application/javascript'), '/style.css': ('style.css', 'text/css')}
            if self.path == '/api/status':
                return self.send(200, {'name': 'Flosi Smart QA', 'experimental': True, 'audio': pipeline is not None,
                                      'provider': 'local' if provider.local else 'groq_free_tier',
                                      'model': provider.model, 'originalQAAccess': False,
                                      'asrSource':pipeline.model_source if pipeline else None,
                                      'asrLoadMs':pipeline.load_ms if pipeline else None})
            if self.path not in files:
                return self.send(404, {'error': 'not_found'})
            name, mime = files[self.path]
            return self.send(200, (ROOT/'web'/name).read_bytes(), mime)

        def do_POST(self):
            if self.headers.get('Host') != expected_host or self.headers.get('Origin') != expected_origin:
                return self.send(403, {'error': 'invalid_origin_or_host'})
            if self.headers.get('Content-Type') != 'application/json':
                return self.send(415, {'error': 'json_required'})
            if self.path not in ('/api/correct', '/api/audio'):
                return self.send(404, {'error': 'not_found'})
            try:
                size = int(self.headers.get('Content-Length', '0'))
                if not 1 <= size <= 40*1024*1024:
                    return self.send(413, {'error': 'max_request_40MiB'})
            except ValueError:
                return self.send(400, {'error': 'invalid_length'})
            if not gate.acquire(blocking=False):
                return self.send(409, {'error': 'processing_in_progress'})
            tmp = None
            try:
                body = json.loads(self.rfile.read(size))
                if not isinstance(body, dict):
                    raise ValueError()
                if self.path == '/api/correct':
                    record = correct(body.get('text'), provider)
                else:
                    if pipeline is None:
                        return self.send(503, {'error': 'asr_model_not_loaded'})
                    if body.get('language') not in ('es', 'en', None):
                        raise ValueError()
                    raw = base64.b64decode(body['audioBase64'], validate=True)
                    # Browser capture is PCM WAV; uploads deliberately require WAV.
                    if len(raw) < 44 or raw[:4] != b'RIFF' or raw[8:12] != b'WAVE':
                        return self.send(415, {'error': 'wav_required'})
                    if len(raw) > 25*1024*1024:
                        return self.send(413, {'error': 'audio_max_25MiB'})
                    with tempfile.NamedTemporaryFile(dir=runtime, suffix='.wav', delete=False) as f:
                        tmp = Path(f.name); f.write(raw)
                    record = pipeline.process(tmp, body.get('language'), body.get('reference') or None)
                if body.get('saveEvidence') is True:
                    directory = runtime/'runs'/str(uuid.uuid4())
                    directory.mkdir(parents=True, exist_ok=False)
                    (directory/'result.json').write_text(json.dumps(record, ensure_ascii=False, indent=2), encoding='utf-8')
                    if tmp:
                        (directory/'audio.wav').write_bytes(tmp.read_bytes())
                    record['savedEvidence'] = str(directory)
                self.send(200, record)
            except (ValueError, TypeError, KeyError):
                self.send(400, {'error': 'invalid_input'})
            except Exception:
                self.send(500, {'error': 'processing_failed_original_not_replaced'})
            finally:
                if tmp:
                    tmp.unlink(missing_ok=True)
                gate.release()
    return Handler

def main():
    p = argparse.ArgumentParser()
    p.add_argument('--port', type=int, default=18766)
    p.add_argument('--endpoint', default='http://127.0.0.1:18765/v1/chat/completions')
    p.add_argument('--model', default=LOCAL_MODEL)
    p.add_argument('--groq-free-tier', action='store_true')
    p.add_argument('--asr-model', type=Path)
    p.add_argument('--runtime', type=Path, default=ROOT/'runtime')
    args = p.parse_args()
    args.runtime.mkdir(parents=True, exist_ok=True)
    provider = Provider(endpoint=args.endpoint, model=args.model, free_tier=args.groq_free_tier)
    pipeline = AudioPipeline(args.asr_model, provider) if args.asr_model else None
    server = ThreadingHTTPServer(('127.0.0.1', args.port), make_handler(provider, pipeline, args.runtime, args.port))
    print(f'Flosi Smart QA experimental: http://127.0.0.1:{args.port} (Ctrl+C stops)', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()

if __name__ == '__main__':
    main()
