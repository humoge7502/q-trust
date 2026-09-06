"""Docs-contract tests: the README SDK quick-start must match the real API.

The README previously documented `QTrustClient(base_url=...)`, `client.verify()`
and `engine.score()` — none of which existed. These tests parse the README code
blocks and assert that every documented constructor kwarg and method call
exists on the actual SDK objects, so the docs can't silently drift again.
"""
from __future__ import annotations

import inspect
import re
from pathlib import Path

import pytest

SDK_ROOT = Path(__file__).resolve().parent.parent
README = SDK_ROOT.parent / "README.md"

pytest.importorskip("pydantic")

from qtrust import CBOMEntry, QTrustClient, RiskScoringEngine  # noqa: E402


def _readme_python_blocks() -> list[str]:
    text = README.read_text(encoding="utf-8")
    return re.findall(r"```python\n(.*?)```", text, flags=re.DOTALL)


def test_readme_client_constructor_kwargs_exist() -> None:
    """Every QTrustClient(**kw) kwarg shown in the README must be a real param."""
    params = inspect.signature(QTrustClient.__init__).parameters
    blocks = "\n".join(_readme_python_blocks())
    for match in re.finditer(r"QTrustClient\(([^)]*)\)", blocks, flags=re.DOTALL):
        for kw in re.findall(r"(\w+)\s*=", match.group(1)):
            assert kw in params, (
                f"README documents QTrustClient({kw}=...) but the SDK does not "
                f"accept it. Real params: {sorted(params)}"
            )


def test_readme_documents_no_phantom_methods() -> None:
    """client.<method>( / engine.<method>( calls in README must exist."""
    blocks = "\n".join(_readme_python_blocks())
    for obj, method in re.findall(r"\b(client|engine)\.(\w+)\s*\(", blocks):
        cls = QTrustClient if obj == "client" else RiskScoringEngine
        assert hasattr(cls, method), (
            f"README documents {cls.__name__}.{method}() but the SDK has no "
            f"such method — docs have drifted from the code"
        )


def test_readme_cbom_example_constructs() -> None:
    """The README's CBOM/CBOMEntry field names must construct a valid model."""
    blocks = "\n".join(_readme_python_blocks())
    match = re.search(r"CBOMEntry\(([^)]*)\)", blocks, flags=re.DOTALL)
    assert match, "README no longer contains a CBOMEntry example"
    fields = {f.strip() for f in match.group(1).split(",") if f.strip()}
    entry_fields = set(CBOMEntry.model_fields)
    unknown = {f.split("=")[0] for f in fields} - entry_fields
    assert not unknown, f"README uses unknown CBOMEntry fields: {unknown}"
    # And the full example payload must validate.
    CBOMEntry(asset_type="tls_cert", algorithm="RSA-2048", location="example.com:443")
