"""
Leakage-free splits — repository / organization / temporal (§29-31).

Never split by random rows. Always split by repository, then organization, then time.
This is the single most important guard against inflated metrics.
"""
from __future__ import annotations

import random
from collections import defaultdict
from typing import Any, Dict, List, Tuple


def repository_split(
    items: List[Dict[str, Any]],
    key: str = "repo",
    train_ratio: float = 0.70,
    val_ratio: float = 0.15,
    seed: int = 42,
) -> Dict[str, List[Dict[str, Any]]]:
    """Split by repository (no repo appears in >1 split)."""
    by_repo: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    for it in items:
        by_repo[str(it.get(key, "unknown"))].append(it)
    repos = sorted(by_repo.keys())
    rnd = random.Random(seed)
    rnd.shuffle(repos)
    n = len(repos)
    n_train = max(1, int(n * train_ratio))
    n_val = max(1, int(n * val_ratio))
    train_repos = set(repos[:n_train])
    val_repos = set(repos[n_train : n_train + n_val])
    test_repos = set(repos[n_train + n_val :])
    return {
        "train": [it for r in train_repos for it in by_repo[r]],
        "val": [it for r in val_repos for it in by_repo[r]],
        "test": [it for r in test_repos for it in by_repo[r]],
        "train_repos": sorted(train_repos),
        "val_repos": sorted(val_repos),
        "test_repos": sorted(test_repos),
    }


def organization_split(
    items: List[Dict[str, Any]],
    org_key: str = "org",
    train_orgs: List[str] | None = None,
    test_orgs: List[str] | None = None,
) -> Dict[str, List[Dict[str, Any]]]:
    """Split by organization — strongest generalization test."""
    if train_orgs is None or test_orgs is None:
        orgs = sorted({str(it.get(org_key, "unknown")) for it in items})
        mid = max(1, int(len(orgs) * 0.8))
        train_orgs = orgs[:mid]
        test_orgs = orgs[mid:]
    train = [it for it in items if str(it.get(org_key)) in train_orgs]
    test = [it for it in items if str(it.get(org_key)) in test_orgs]
    return {"train": train, "test": test, "train_orgs": train_orgs, "test_orgs": test_orgs}


def temporal_split(
    items: List[Dict[str, Any]],
    time_key: str = "commit_date",
    cutoff: str = "2026-01-01",
) -> Dict[str, List[Dict[str, Any]]]:
    """Train 2022-2025, test 2026+ — future ecosystem drift."""
    train = [it for it in items if str(it.get(time_key, "2020-01-01")) < cutoff]
    test = [it for it in items if str(it.get(time_key, "2020-01-01")) >= cutoff]
    return {"train": train, "test": test, "cutoff": cutoff}


def host_disjoint_split(
    items: List[Dict[str, Any]],
    host_key: str = "host",
    seed: int = 42,
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    """For TLS CBOMs: no host appears in both splits (see scripts/build_real_cboms.py)."""
    hosts = sorted({str(it.get(host_key)) for it in items})
    rnd = random.Random(seed)
    rnd.shuffle(hosts)
    n_train = max(1, int(len(hosts) * 0.8))
    train_hosts = set(hosts[:n_train])
    test_hosts = set(hosts[n_train:])
    train = [it for it in items if str(it.get(host_key)) in train_hosts]
    test = [it for it in items if str(it.get(host_key)) in test_hosts]
    return train, test
