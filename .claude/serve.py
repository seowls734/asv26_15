# Local dev server: like `python -m http.server`, but tells the browser never to cache,
# so index.html and js/*.js always load as one consistent set after edits.
import http.server
import sys


class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()


port = int(sys.argv[1]) if len(sys.argv) > 1 else 8615
http.server.ThreadingHTTPServer(('', port), NoCache).serve_forever()
