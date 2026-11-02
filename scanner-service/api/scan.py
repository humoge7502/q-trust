import os
import sys
import traceback

_here = os.path.dirname(os.path.abspath(__file__))
for _candidate in (_here, os.path.dirname(_here)):
    _lib = os.path.join(_candidate, "lib")
    if os.path.isdir(_lib):
        sys.path.insert(0, _lib)
        break

from http_json import JsonHandler  # noqa: E402
from scan_core import ValidationError, authorized, scan_payload  # noqa: E402


class handler(JsonHandler):
    def do_POST(self):
        if not authorized(self.headers):
            self.send_json(401, {"detail": "unauthorized", "error": "scanner API key required"})
            return
        try:
            payload = self.read_json()
        except (ValueError, UnicodeDecodeError):
            self.send_json(400, {"detail": "body must be a JSON object"})
            return
        try:
            self.send_json(200, scan_payload(payload))
        except ValidationError as exc:
            self.send_json(422, {"detail": exc.detail})
        except Exception:
            traceback.print_exc()
            self.send_json(500, {"error": "scan failed", "code": "scanner_internal_error"})
