"""Cohort-level provenance audit: host overlap, composition, field values."""
from __future__ import annotations
import json, glob, collections
from pathlib import Path

ROOT = Path(r"C:\Users\Devesh tiwari\q-trust-projects\q-trust-datasets\planner\data")
OUT = Path(r"C:\Users\Devesh tiwari\q-trust-projects\q-trust\paper\analysis\cohort_audit.json")
COHORTS = {"c42": ROOT / "real_cboms", "c38": ROOT / "real_cboms_v2_2026_09_18"}


def scan(d):
    hosts, algs, kts, ksz, crit, vendor, dates = (set(), collections.Counter(), collections.Counter(),
                                                 collections.Counter(), collections.Counter(),
                                                 collections.Counter(), collections.Counter())
    estates = {}
    for p in sorted(d.glob("*.json")):
        assets = json.loads(p.read_text(encoding="utf-8")).get("assets") or []
        hs = []
        for a in assets:
            h = str(a.get("host") or a.get("location") or "")
            hosts.add(h); hs.append(h)
            algs[str(a.get("algorithm"))] += 1
            kts[str(a.get("key_type"))] += 1
            ksz[str(a.get("key_size"))] += 1
            crit[str(a.get("criticality"))] += 1
            vendor[str(a.get("pqc_ready"))] += 1
            dates[str(a.get("not_after"))[:10]] += 1
        estates[p.name] = {"n": len(assets), "unique_hosts": len(set(hs))}
    return {"hosts": hosts, "algorithms": algs, "key_types": kts, "key_sizes": ksz,
            "criticality": crit, "pqc_ready": vendor, "not_after": dates, "estates": estates}


def main():
    res = {}
    for k, d in COHORTS.items():
        s = scan(d)
        res[k] = {
            "n_estates": len(s["estates"]),
            "n_assets": sum(v["n"] for v in s["estates"].values()),
            "n_unique_hosts": len(s["hosts"]),
            "hosts_repeated_within_cohort": sum(v["n"] - v["unique_hosts"] for v in s["estates"].values()),
            "algorithms": dict(s["algorithms"].most_common()),
            "key_types": dict(s["key_types"].most_common()),
            "key_sizes": dict(s["key_sizes"].most_common()),
            "criticality": dict(s["criticality"]),
            "pqc_ready": dict(s["pqc_ready"]),
            "not_after_unique": len(s["not_after"]),
            "not_after_top": dict(s["not_after"].most_common(8)),
            "estate_sizes": dict(collections.Counter(v["n"] for v in s["estates"].values())),
        }
    a, b = scan(COHORTS["c42"])["hosts"], scan(COHORTS["c38"])["hosts"]
    res["overlap"] = {"c42": len(a), "c38": len(b), "intersection": len(a & b),
                      "c42_only": len(a - b), "c38_only": len(b - a),
                      "c42_only_hosts": sorted(a - b)[:20], "c38_only_hosts": sorted(b - a)[:20]}
    OUT.write_text(json.dumps(res, indent=2), encoding="utf-8")
    print(json.dumps(res, indent=1))


if __name__ == "__main__":
    main()
