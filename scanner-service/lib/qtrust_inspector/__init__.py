"""Vendored scan modules from ``inspector/qtrust_inspector`` (byte-identical).

Only the modules the hosted scanner needs are vendored so the service ships
without the full inspector's optional dependencies. ``backend/tests/
scanner-service-sync.test.ts`` fails if any copy drifts from the source of
truth in ``inspector/qtrust_inspector``.
"""
from .models import AssetFinding, ScanResult

__all__ = ["AssetFinding", "ScanResult"]
