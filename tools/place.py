"""One-off tool: drag the class names and the head of the olfactory arrow to new default places.

    python tools/place.py            then open http://localhost:8792

Every drop is saved to data/placement.json (positions relative to the centre of the tree); `python tools/build_tree.py`
then draws the names and the arrow there. Delete data/placement.json (or use "Reset this tree") to go back to the
automatic placement.
"""
import json
import sys
from http.server import HTTPServer, SimpleHTTPRequestHandler
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FILE = ROOT / 'data' / 'placement.json'
TREES = {'gpcr': ROOT / 'js' / 'data' / 'tree.js', 'olfactory': ROOT / 'data' / 'olfactory_tree.json'}


def saved():
    return json.loads(FILE.read_text()) if FILE.exists() else {}


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT / 'tools'), **kwargs)

    def reply(self, body, kind='application/json'):
        data = body.encode()
        self.send_response(200)
        self.send_header('Content-Type', kind)
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        path = self.path.split('?')[0]
        if path == '/':
            self.reply((ROOT / 'tools' / 'place.html').read_text(), 'text/html; charset=utf-8')
        elif path.startswith('/tree/') and path[6:] in TREES:
            text = TREES[path[6:]].read_text()
            self.reply(text[text.index('{'):text.rindex('}') + 1])      # tree.js wraps the data in an assignment
        elif path == '/placement':
            self.reply(json.dumps(saved()))
        else:
            self.send_error(404)

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        everything = saved()
        if body['placement']:
            everything[body['view']] = body['placement']
        else:
            everything.pop(body['view'], None)
        if everything:
            FILE.write_text(json.dumps(everything, indent=1) + '\n')
        else:
            FILE.unlink(missing_ok=True)
        self.reply('{}')

    def log_message(self, *args):
        pass


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8792
    print(f'Drag the names and the arrow head at http://localhost:{port}  (Ctrl+C when done)')
    HTTPServer(('127.0.0.1', port), Handler).serve_forever()
