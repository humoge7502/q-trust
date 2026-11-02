"""Shared request handling for the planner endpoints."""
from __future__ import annotations

import traceback
from typing import Any, Callable

from http_json import JsonHandler
from planner_core import ModelIntegrityError, ValidationError, authorized


def handle_post(handler: JsonHandler, fn: Callable[[dict[str, Any]], dict[str, Any]]) -> None:
    if not authorized(handler.headers):
        handler.send_json(401, {"detail": "unauthorized", "error": "planner API key required"})
        return
    try:
        payload = handler.read_json()
    except (ValueError, UnicodeDecodeError):
        handler.send_json(400, {"detail": "body must be a JSON object"})
        return
    try:
        handler.send_json(200, fn(payload))
    except ValidationError as exc:
        handler.send_json(422, {"detail": exc.detail})
    except ModelIntegrityError:
        handler.send_json(503, {"error": "planner model integrity check failed", "code": "planner_model_integrity_failed"})
    except Exception:
        traceback.print_exc()
        handler.send_json(500, {"error": "planner inference failed", "code": "planner_internal_error"})
