#!/usr/bin/env python3
"""
AI Server chat — a tiny local host for the browser UI.

Serves index.html and forwards /v1/* to your AI Server.

WHY A PROXY IS NEEDED
---------------------
AI Server does not send CORS headers, and its OPTIONS preflight requires auth (which
browsers never send on a preflight). So a page opened from file:// or another origin
cannot call the server directly — the browser blocks it. This ~150-line proxy makes
the page and the API the SAME origin, which removes the problem entirely.

It also keeps your API key OUT of the browser: the key lives in this process's
environment and is attached server-side, so it never reaches page JavaScript, devtools,
localStorage, or a screenshot.

Standard library only — no pip install.

    export AISERVER_BASE_URL="http://192.168.1.42:11436/v1"
    export AISERVER_API_KEY="ai-suite_..."
    python serve.py            # then open http://localhost:8800
"""
import http.server
import json
import os
import socketserver
import sys
import urllib.error
import urllib.request

BASE_URL = os.environ.get("AISERVER_BASE_URL", "http://localhost:11436/v1").rstrip("/")
API_KEY = os.environ.get("AISERVER_API_KEY", "")
PORT = int(os.environ.get("PORT", "8800"))

HERE = os.path.dirname(os.path.abspath(__file__))


class Handler(http.server.SimpleHTTPRequestHandler):
    """Static files from this folder, plus a pass-through for /v1/*."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=HERE, **kwargs)

    # ── proxy ────────────────────────────────────────────────────────────────
    def do_POST(self):
        if self.path.startswith("/v1/"):
            length = int(self.headers.get("Content-Length", 0))
            self._proxy(self.path, self.rfile.read(length) if length else None)
        else:
            self.send_error(404)

    def do_GET(self):
        if self.path.startswith("/v1/"):
            self._proxy(self.path, None)
        else:
            super().do_GET()   # index.html, app.js, styles.css

    def _proxy(self, path, body):
        url = BASE_URL + path[len("/v1"):]
        headers = {"Authorization": f"Bearer {API_KEY}"}
        if body:
            headers["Content-Type"] = "application/json"
        req = urllib.request.Request(url, data=body, headers=headers,
                                     method="POST" if body else "GET")
        try:
            upstream = urllib.request.urlopen(req, timeout=600)
        except urllib.error.HTTPError as e:
            # Pass the server's own status + body through so the UI can explain it
            # (401 = bad key, 429 = free-tier cap, 503 = busy) instead of guessing.
            detail = e.read()
            self.send_response(e.code)
            self.send_header("Content-Type", "application/json")
            for name in ("X-AISuite-Upgrade", "Retry-After"):
                if e.headers.get(name):
                    self.send_header(name, e.headers[name])
            self.end_headers()
            self.wfile.write(detail or json.dumps(
                {"error": {"message": f"HTTP {e.code} from AI Server"}}).encode())
            return
        except urllib.error.URLError as e:
            self.send_response(502)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"error": {"message":
                f"Could not reach AI Server at {BASE_URL}: {e.reason}"}}).encode())
            return

        self.send_response(upstream.status)
        content_type = upstream.headers.get("Content-Type", "application/json")
        self.send_header("Content-Type", content_type)
        if upstream.headers.get("X-AISuite-Backend"):
            self.send_header("X-AISuite-Backend", upstream.headers["X-AISuite-Backend"])
        # Streaming responses must not be buffered by us or by any intermediary,
        # or the UI would sit silent and then dump the whole answer at once.
        self.send_header("Cache-Control", "no-cache")
        self.send_header("X-Accel-Buffering", "no")
        self.end_headers()

        try:
            while chunk := upstream.read(1024):
                self.wfile.write(chunk)
                self.wfile.flush()      # push each SSE frame to the browser immediately
        except (BrokenPipeError, ConnectionResetError):
            pass                        # user navigated away or hit Stop

    def log_message(self, fmt, *args):
        # Quiet by default; never log request bodies (they contain user prompts).
        if os.environ.get("VERBOSE"):
            super().log_message(fmt, *args)


class Server(socketserver.ThreadingTCPServer):
    daemon_threads = True     # one slow completion must not block other requests
    allow_reuse_address = True


if __name__ == "__main__":
    if not API_KEY:
        print("[error] Set AISERVER_API_KEY (issue a key in AI Server -> API keys).",
              file=sys.stderr)
        sys.exit(1)

    # Bind loopback only. This process holds your API key, so it must not be reachable
    # from the network — it's a local convenience, not a shared gateway.
    with Server(("127.0.0.1", PORT), Handler) as httpd:
        print(f"AI Server chat -> {BASE_URL}")
        print(f"Open http://localhost:{PORT}  (Ctrl+C to stop)")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nStopped.")
