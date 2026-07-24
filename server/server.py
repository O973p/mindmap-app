"""Mini-Server für die Mindmap-App.

Liefert die statischen App-Dateien aus und speichert die Mindmaps als
JSON-Dateien in server/data/. Kein externes Paket nötig — nur Python-Stdlib.

Konfiguration über Umgebungsvariablen:
  MINDMAP_KEY   Zugangsschlüssel (leer = kein Schutz)
  MINDMAP_PORT  Port (Standard: 8123)
"""
import json
import os
import re
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

SERVER_DIR = os.path.dirname(os.path.abspath(__file__))
APP_DIR = os.path.dirname(SERVER_DIR)
DATA_DIR = os.path.join(SERVER_DIR, "data")
KEY = os.environ.get("MINDMAP_KEY", "").strip()
PORT = int(os.environ.get("MINDMAP_PORT", "8123"))
ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
MAX_BODY = 30 * 1024 * 1024  # 30 MB pro Map (Bilder!)

os.makedirs(DATA_DIR, exist_ok=True)


class Handler(SimpleHTTPRequestHandler):
    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        ".webmanifest": "application/manifest+json",
        ".js": "text/javascript",
    }

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=APP_DIR, **kwargs)

    # ---------- Hilfen ----------

    def _json(self, code, obj):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _authed(self):
        return not KEY or self.headers.get("X-Access-Key", "") == KEY

    def _map_path(self, map_id):
        return os.path.join(DATA_DIR, map_id + ".json")

    def _map_id(self):
        m = re.match(r"^/api/maps/([^/?]+)$", self.path.split("?")[0])
        if not m:
            return None
        map_id = m.group(1)
        return map_id if ID_RE.match(map_id) else None

    # ---------- API ----------

    def do_GET(self):
        path = self.path.split("?")[0]

        if path == "/api/ping":
            if not self._authed():
                return self._json(401, {"ok": False, "auth": True})
            return self._json(200, {"ok": True, "auth": bool(KEY)})

        if path == "/api/maps":
            if not self._authed():
                return self._json(401, {"error": "auth"})
            out = []
            for fn in os.listdir(DATA_DIR):
                if not fn.endswith(".json"):
                    continue
                try:
                    with open(os.path.join(DATA_DIR, fn), encoding="utf-8") as f:
                        rec = json.load(f)
                    out.append({
                        "id": rec.get("id"),
                        "name": rec.get("name", "Unbenannt"),
                        "createdAt": rec.get("createdAt", 0),
                        "updatedAt": rec.get("updatedAt", 0),
                        "count": len(rec.get("data", {}).get("nodes", [])),
                    })
                except (OSError, ValueError):
                    pass  # defekte Datei überspringen statt alles zu blockieren
            return self._json(200, out)

        map_id = self._map_id()
        if map_id:
            if not self._authed():
                return self._json(401, {"error": "auth"})
            p = self._map_path(map_id)
            if not os.path.exists(p):
                return self._json(404, {"error": "not found"})
            with open(p, "rb") as f:
                body = f.read()
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)
            return

        if path.startswith("/api/"):
            return self._json(404, {"error": "not found"})

        # Statische App-Dateien
        return super().do_GET()

    def do_PUT(self):
        map_id = self._map_id()
        if not map_id:
            return self._json(404, {"error": "not found"})
        if not self._authed():
            return self._json(401, {"error": "auth"})
        try:
            length = int(self.headers.get("Content-Length", 0))
        except ValueError:
            length = 0
        if length <= 0 or length > MAX_BODY:
            return self._json(413, {"error": "payload too large"})
        try:
            rec = json.loads(self.rfile.read(length).decode("utf-8"))
        except ValueError:
            return self._json(400, {"error": "invalid json"})
        if rec.get("id") != map_id or not isinstance(rec.get("data"), dict):
            return self._json(400, {"error": "invalid record"})

        # Atomar schreiben: erst Temp-Datei, dann umbenennen
        p = self._map_path(map_id)
        tmp = p + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(rec, f, ensure_ascii=False)
        os.replace(tmp, p)
        return self._json(200, {"ok": True})

    def do_DELETE(self):
        map_id = self._map_id()
        if not map_id:
            return self._json(404, {"error": "not found"})
        if not self._authed():
            return self._json(401, {"error": "auth"})
        p = self._map_path(map_id)
        if os.path.exists(p):
            os.remove(p)
        return self._json(200, {"ok": True})

    def log_message(self, fmt, *args):
        pass  # Zugriffs-Logs stumm schalten


if __name__ == "__main__":
    print(f"Mindmap-Server läuft auf Port {PORT}"
          + (" (mit Zugangsschlüssel)" if KEY else " (OHNE Schutz)"))
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
