"""Private authenticated RPC, with one isolated bounded worker per conversion."""
import hmac
import json
import os
import shutil
import subprocess
import sys
import tempfile
import signal
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

TOKEN = os.environ.get('CONTENT_CONVERTER_TOKEN', '')
MAX_BODY = 36 * 1024 * 1024
WORKERS = threading.BoundedSemaphore(1)


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_args):
        pass  # No tokens, filenames or document content in service logs.

    def reply(self, status, result):
        raw = json.dumps(result).encode('utf8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self):
        if self.path != '/health':
            return self.reply(404, {'ok': False})
        ready = all(shutil.which(binary) for binary in ('soffice', 'pdftoppm', 'tesseract'))
        self.reply(200 if ready else 503, {'ok': ready, 'service': 'content-converter'})

    def do_POST(self):
        self.connection.settimeout(15)
        if self.path != '/convert':
            return self.reply(404, {'ok': False})
        if not TOKEN or not hmac.compare_digest(self.headers.get('X-Content-Converter-Token', ''), TOKEN):
            return self.reply(403, {'ok': False, 'code': 'FORBIDDEN'})
        if not WORKERS.acquire(blocking=False):
            return self.reply(429, {'ok': False, 'code': 'CONVERTER_BUSY', 'error': 'Converter is busy; retry later.'})
        try:
            length = int(self.headers.get('Content-Length', '0'))
            if not 0 < length <= MAX_BODY:
                return self.reply(413, {'ok': False, 'code': 'CONTENT_LIMIT'})
            body = self.rfile.read(length)
            if len(body) != length:
                return self.reply(400, {'ok': False, 'code': 'INVALID_CONTENT'})
            # No request-supplied executable, arguments, environment or server paths.
            with tempfile.TemporaryDirectory(prefix='flolah-job-') as work:
                child = subprocess.Popen([sys.executable, str(Path(__file__).with_name('converter.py'))], stdin=subprocess.PIPE,
                                         stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, shell=False,
                                         start_new_session=True, env={**os.environ, 'TMPDIR': work})
                try:
                    output, _ = child.communicate(body, timeout=120)
                except subprocess.TimeoutExpired:
                    os.killpg(child.pid, signal.SIGKILL); child.communicate()
                    raise
                if len(output) > MAX_BODY:
                    return self.reply(413, {'ok': False, 'code': 'CONTENT_LIMIT'})
                result = json.loads(output)
                self.reply(200 if result.get('ok') else 422, result)
        except subprocess.TimeoutExpired:
            self.reply(504, {'ok': False, 'code': 'CONVERSION_TIMEOUT', 'error': 'Conversion timed out; no file delivered.'})
        except Exception:
            self.reply(422, {'ok': False, 'code': 'CONVERSION_FAILED', 'error': 'Conversion failed; no file delivered.'})
        finally:
            WORKERS.release()


if __name__ == '__main__':
    if len(TOKEN) < 32:
        raise SystemExit('CONTENT_CONVERTER_TOKEN must be provisioned by deployment.')
    ThreadingHTTPServer(('0.0.0.0', 8123), Handler).serve_forever()
