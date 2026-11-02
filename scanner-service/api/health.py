import os
import sys

_here = os.path.dirname(os.path.abspath(__file__))
for _candidate in (_here, os.path.dirname(_here)):
    _lib = os.path.join(_candidate, "lib")
    if os.path.isdir(_lib):
        sys.path.insert(0, _lib)
        break

from http_json import JsonHandler  # noqa: E402
from scan_core import MAX_ARCHIVE_BYTES, SCAN_TYPES  # noqa: E402


class handler(JsonHandler):
    def do_GET(self):
        self.send_json(
            200,
            {
                "status": "ok",
                "scanner": "qtrust_inspector",
                "scan_types": sorted(SCAN_TYPES),
                "max_archive_bytes": MAX_ARCHIVE_BYTES,
            },
        )
