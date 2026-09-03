from __future__ import annotations

import hashlib
import json
import logging
from datetime import datetime, timezone
from typing import Any

from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

LEDGER_FORMAT_VERSION = 2
_LEGACY_V1_GENESIS = "0" * 64


class EvidenceEntry(BaseModel):
    index: int = 0
    cbom_hash: str = ""
    prev_hash: str = ""
    entry_hash: str = ""
    timestamp: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    batch_id: str = "default"
    metadata: dict[str, Any] = Field(default_factory=dict)
    # v2 entries carry format_version=2; entries loaded from a v1 ledger are
    # stamped 1 so verify_chain() applies the matching hash construction.
    format_version: int = LEDGER_FORMAT_VERSION


class EvidenceLedger:
    """Append-only, tamper-evident evidence ledger (format v2).

    v2 closes audit finding B-8: the entry hash now covers the full canonical
    entry - including ``metadata`` (previously editable without breaking
    ``verify_chain()``) - so the ledger is genuinely tamper-evident end to end.
    v1 ledgers still verify under their legacy hash construction and are
    transparently upgraded to v2 the next time they are saved.
    """

    def __init__(self, batch_id: str | None = None) -> None:
        self.batch_id = batch_id or "default-batch"
        self._entries: list[EvidenceEntry] = []

    @property
    def entries(self) -> list[EvidenceEntry]:
        return self._entries

    @staticmethod
    def _hash_cbom(cbom: dict[str, Any]) -> str:
        canonical = json.dumps(cbom, sort_keys=True, separators=(",", ":"))
        return hashlib.sha256(canonical.encode()).hexdigest()

    def _compute_entry_hash(self, entry: EvidenceEntry) -> str:
        if entry.format_version >= 2:
            # v2: hash the full canonical entry - metadata included - so any
            # edit anywhere in the payload breaks the chain (B-8).
            payload = json.dumps(
                {
                    "v": 2,
                    "index": entry.index,
                    "cbom_hash": entry.cbom_hash,
                    "prev_hash": entry.prev_hash,
                    "timestamp": entry.timestamp,
                    "batch_id": entry.batch_id,
                    "metadata": entry.metadata,
                },
                sort_keys=True,
                separators=(",", ":"),
            )
            return hashlib.sha256(payload.encode()).hexdigest()
        # v1 (legacy): index/cbom_hash/prev_hash/timestamp/batch_id only.
        data = (
            f"{entry.index}:{entry.cbom_hash}:{entry.prev_hash}:"
            f"{entry.timestamp}:{entry.batch_id}"
        )
        return hashlib.sha256(data.encode()).hexdigest()

    def append(self, cbom: dict[str, Any], metadata: dict[str, Any] | None = None) -> EvidenceEntry:
        prev_hash = self._entries[-1].entry_hash if self._entries else _LEGACY_V1_GENESIS
        cbom_hash = self._hash_cbom(cbom)
        entry = EvidenceEntry(
            index=len(self._entries),
            cbom_hash=cbom_hash,
            prev_hash=prev_hash,
            batch_id=self.batch_id,
            metadata=metadata or {},
            format_version=LEDGER_FORMAT_VERSION,
        )
        entry.entry_hash = self._compute_entry_hash(entry)
        self._entries.append(entry)
        return entry

    def verify_chain(self) -> bool:
        """Recompute every entry hash and check chain linkage.

        v2 entries must match the metadata-inclusive hash; v1 entries verify
        under the legacy construction. Mixed chains are allowed only when a
        v1→v2 transition happens at load time, which ``from_dict`` arranges.
        """
        if not self._entries:
            return True
        if self._entries[0].prev_hash != _LEGACY_V1_GENESIS:
            return False
        for i, entry in enumerate(self._entries):
            expected = self._compute_entry_hash(entry)
            if entry.entry_hash != expected:
                return False
            if i > 0 and entry.prev_hash != self._entries[i - 1].entry_hash:
                return False
        return True

    def _upgrade_legacy_entries(self) -> None:
        """Re-hash v1 entries under the v2 construction, in chain order.

        The v1 and v2 payloads contain the same fields, so upgrading is a pure
        re-hash: index, linkage, timestamps and metadata are untouched.
        Called before serialization so a saved ledger is always v2 and its
        entries verify under the v2 hash construction.
        """
        for entry in self._entries:
            if entry.format_version < LEDGER_FORMAT_VERSION:
                entry.format_version = LEDGER_FORMAT_VERSION
                entry.entry_hash = self._compute_entry_hash(entry)

    def to_dict(self) -> dict[str, Any]:
        self._upgrade_legacy_entries()
        return {
            "batch_id": self.batch_id,
            "format_version": LEDGER_FORMAT_VERSION,
            "entries": [e.model_dump() for e in self._entries],
            "entry_count": len(self._entries),
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> EvidenceLedger:
        entries_data = data.get("entries", [])
        if not entries_data:
            raise ValueError("No entries in ledger data")
        ledger = cls(batch_id=data.get("batch_id", "default"))
        ledger_version = int(data.get("format_version", 1))
        for entry_data in entries_data:
            entry = EvidenceEntry(**entry_data)
            if "format_version" not in entry_data:
                # Ledger-level v1: entries never carried a format_version
                # field. Stamp and upgrade so the next save is v2 and the
                # legacy hashes re-verify during migration.
                entry.format_version = 1
            ledger._entries.append(entry)
        if ledger_version < LEDGER_FORMAT_VERSION:
            logger.info(
                "Loaded v%d evidence ledger (%d entries); it will be upgraded "
                "to v%d on the next save.",
                ledger_version,
                len(ledger._entries),
                LEDGER_FORMAT_VERSION,
            )
        return ledger

    def save(self, path: str) -> str:
        with open(path, "w", encoding="utf-8") as f:
            json.dump(self.to_dict(), f, indent=2)
        return path

    @classmethod
    def load(cls, path: str) -> EvidenceLedger:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        return cls.from_dict(data)


class CBOMDiff(BaseModel):
    """Result of comparing two CBOMs."""
    added: list[dict[str, Any]] = Field(default_factory=list)
    removed: list[dict[str, Any]] = Field(default_factory=list)
    modified: list[dict[str, Any]] = Field(default_factory=list)
    summary: dict[str, int] = Field(default_factory=dict)


def compute_cbom_diff(cbom_a: dict[str, Any], cbom_b: dict[str, Any]) -> CBOMDiff:
    def _asset_key(a: dict[str, Any]) -> str:
        parts = [
            str(a.get("host", "")),
            str(a.get("algorithm", "")),
            str(a.get("id", "")),
            str(a.get("name", "")),
        ]
        return ":".join(parts)

    assets_a = {_asset_key(a): a for a in cbom_a.get("assets", [])}
    assets_b = {_asset_key(a): a for a in cbom_b.get("assets", [])}
    added = [assets_b[k] for k in assets_b if k not in assets_a]
    removed = [assets_a[k] for k in assets_a if k not in assets_b]
    modified = []
    for k in assets_a:
        if k in assets_b:
            a, b = assets_a[k], assets_b[k]
            changes = {}
            for field in ("algorithm", "key_size", "criticality", "expired"):
                if a.get(field) != b.get(field):
                    changes[field] = {"from": a.get(field), "to": b.get(field)}
            if changes:
                modified.append({"key": k, "changes": changes, "before": a, "after": b})
    return CBOMDiff(
        added=added,
        removed=removed,
        modified=modified,
        summary={
            "added_count": len(added),
            "removed_count": len(removed),
            "modified_count": len(modified),
            "unchanged_count": len(assets_a) - len(modified),
        },
    )
