import os
import sys

_here = os.path.dirname(os.path.abspath(__file__))
for _candidate in (_here, os.path.dirname(_here)):
    _lib = os.path.join(_candidate, "lib")
    if os.path.isdir(_lib):
        sys.path.insert(0, _lib)
        break

from http_json import JsonHandler  # noqa: E402
from planner_core import health  # noqa: E402


class handler(JsonHandler):
    def do_GET(self):
        self.send_json(200, health())
