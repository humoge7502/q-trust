import json
import glob
import os
import math
import itertools
import statistics
from collections import Counter

DATA = r"C:\Users\Devesh tiwari\q-trust-projects\q-trust-datasets\planner\data"
ART42 = r"C:\Users\Devesh tiwari\q-trust-projects\q-trust\planner\results\real_cbom_loo_42.json"
OUT = r"C:\Users\Devesh tiwari\q-trust-projects\q-trust\paper\analysis\ceiling_audit.json"
CRIT = {"low":1,"medium":2,"high":3,"critical":4}
DEFAULT_KS = {"ECC":256,"ECDSA":256,"ECDH":256,"EDDSA":256,"SHA":256}
PQC_PREFIX = ("ML-KEM","ML-DSA","SLH-DSA","HQC","FALCON")

def is_pqc(a): return str(a).upper().startswith(PQC_PREFIX)

def load(path):
    d=json.load(open(path)); A=d.get("assets") or []; n=len(A)
    crit=[CRIT.get(str(a.get("criticality","medium")).lower(),2) for a in A]
    alg=[str(a.get("algorithm") or "UNKNOWN").upper() for a in A]
    ks=[]
    for a,al in zip(A,alg):
        k=a.get("key_size")
        if not k:
            k=DEFAULT_KS.get(al.split("-")[0],2048)
        ks.append(int(k))
    vendor=[bool(a.get("pqc_ready",False)) or is_pqc(al) for a,al in zip(A,alg)]
    hosts=[str(a.get("host") or a.get("location") or "") for a in A]
    indeg=[0]*n; seen={}
    for i,h in enumerate(hosts):
        if seen.setdefault(h,i)!=i: indeg[i]+=1
    edges=sum(indeg)
    # deadline (graph-level): replicate conversion; constant within estate
    from datetime import datetime, timezone
    def days(a):
        na=a.get("not_after")
        if not na: return 365.0
        try:
            e=datetime.fromisoformat(str(na).replace("Z","+00:00"))
            if e.tzinfo is None: e=e.replace(tzinfo=timezone.utc)
            return max((e-datetime.now(timezone.utc)).total_seconds()/86400.0,1.0)
        except Exception: return 365.0
    dtd=min(max(min(days(a) for a in A),30.0),730.0)
    dp=2.0 if dtd<180 else 1.0
    pri=[]
    for i in range(n):
        v=crit[i]*2.0+(1.5 if vendor[i] else 0.0)
        v+=(math.log1p(ks[i])/4.0) if not is_pqc(alg[i]) else -1.0
        v+=dp*crit[i]/5.0-indeg[i]*0.3
        pri.append(v)
    return dict(name=os.path.basename(path), n=n, assets=A, crit=crit, alg=alg, ks=ks,
                vendor=vendor, indeg=indeg, edges=edges, pri=pri, days=dtd,
                n_hosts=len(set(hosts)), dp=dp)

def tautarget(p):
    """Tie-aware ceiling for a STRICT ordering against the priority preorder."""
    n=len(p); n0=n*(n-1)//2
    if n0==0: return dict(n0=0,tied=0,distinct=0,ceiling=1.0,groups=1)
    tied=0
    for i,j in itertools.combinations(range(n),2):
        if abs(p[i]-p[j])<1e-9: tied+=1
    distinct=n0-tied
    ceiling=math.sqrt(distinct/n0) if distinct>0 else 1.0
    return dict(n0=n0,tied=tied,distinct=distinct,ceiling=ceiling,
                groups=len(set(round(x,9) for x in p)))

def analyse_cohort(folder, name):
    rows=[]
    for path in sorted(glob.glob(folder+r"\*.json")):
        g=load(path)
        if g["n"]<1: continue
        t=tautarget(g["pri"])
        # key-size-only order: classical log1p(key), PQC floor
        kp=[(0.0 if is_pqc(al) else math.log1p(k)) for al,k in zip(g["alg"],g["ks"])]
        g["ceiling"]=t["ceiling"]; g["n0"]=t["n0"]; g["tied"]=t["tied"]; g["distinct"]=t["distinct"]; g["groups"]=t["groups"]
        def order(v): return sorted(range(g["n"]), key=lambda i:(-v[i], i))
        g["key_size_matches_doctrine"]= order(g["pri"])==order(kp)
        rows.append(g)
    aggregate=dict(
        n_estates=len(rows), n_assets=sum(r["n"] for r in rows),
        n_hosts=sum(r["n_hosts"] for r in rows), edges=sum(r["edges"] for r in rows),
        mean_size=statistics.mean(r["n"] for r in rows),
        mean_ceiling=statistics.mean(r["ceiling"] for r in rows),
        sd_ceiling=statistics.stdev([r["ceiling"] for r in rows]) if len(rows)>1 else 0.0,
        estimator_ceiling=statistics.mean(r["ceiling"] for r in rows),
        total_pairs=sum(r["n0"] for r in rows),
        total_tied_pairs=sum(r["tied"] for r in rows),
        total_distinct_pairs=sum(r["distinct"] for r in rows),
        mean_distinct_share=statistics.mean(r["distinct"]/r["n0"] for r in rows if r["n0"]),
        mean_groups=statistics.mean(r["groups"] for r in rows),
        estates_with_zero_edges=sum(1 for r in rows if r["edges"]==0),
        estates_constant_criticality=sum(1 for r in rows if len(set(r["crit"]))==1),
        estates_constant_vendor=sum(1 for r in rows if len(set(r["vendor"]))==1),
        estates_constant_deadline=sum(1 for r in rows if len(set([round(r["days"],6)]))==1),
        key_size_matches_doctrine=sum(1 for r in rows if r["key_size_matches_doctrine"]),
        size_hist=dict(Counter(r["n"] for r in rows)),
        groups_hist=dict(Counter(r["groups"] for r in rows)),
    )
    # doctrine term ablation: does removing a term change the induced order?
    abl={k:0 for k in ("criticality","vendor","deadline","dependency","key_size")}
    for r in rows:
        base=r["pri"]
        variants={
          "criticality":[p-2.0*c-r["dp"]*c/5.0 for p,c in zip(base,r["crit"])],
          "vendor":[p-(1.5 if v else 0.0) for p,v in zip(base,r["vendor"])],
          "deadline":[p-r["dp"]*c/5.0 for p,c in zip(base,r["crit"])],
          "dependency":[p+r["indeg"][i]*0.3 for i,p in enumerate(base)],
          "key_size":[p-(0.0 if is_pqc(a) else math.log1p(k)/4.0) for p,a,k in zip(base,r["alg"],r["ks"])],
        }
        ob=sorted(range(r["n"]),key=lambda i:(-base[i],i))
        for k,v in variants.items():
            if sorted(range(r["n"]),key=lambda i:(-v[i],i))!=ob: abl[k]+=1
    aggregate["ablation_order_changes"]=abl
    return rows, aggregate

def main():
    rows42, agg42 = analyse_cohort(DATA+r"\real_cboms", "42")
    rows38, agg38 = analyse_cohort(DATA+r"\real_cboms_v2_2026_09_18", "38")
    art=json.load(open(ART42))["fold_metrics"]
    for r in rows42:
        m=art[r["name"]]
        r["model_tau"]=m["model"]["kendall"]; r["doctrine_tau"]=m["heuristic"]["kendall"]
        r["model_att"]=r["model_tau"]/r["ceiling"] if r["ceiling"] else 1.0
        r["doctrine_ceiling_gap"]=abs(r["ceiling"]-r["doctrine_tau"])
        # invert tau-b to pair counts (strict prediction)
        dd=r["distinct"]; n0=r["n0"]
        delta=r["model_tau"]*math.sqrt(dd*n0) if dd and n0 else 0.0
        r["model_inversions"]=max(0.0,(dd-delta)/2.0)
        r["model_pair_accuracy"]=(1.0+r["model_tau"]/r["ceiling"])/2.0 if r["ceiling"] else 1.0
    agg42.update(
        mean_model_tau=statistics.mean(r["model_tau"] for r in rows42),
        mean_doctrine_tau=statistics.mean(r["doctrine_tau"] for r in rows42),
        max_ceiling_doctrine_gap=max(r["doctrine_ceiling_gap"] for r in rows42),
        folds_model_at_ceiling=sum(1 for r in rows42 if r["model_tau"]>=r["ceiling"]-1e-6),
        folds_model_equals_doctrine=sum(1 for r in rows42 if abs(r["model_tau"]-r["doctrine_tau"])<1e-6),
        total_distinct_pairs=sum(r["distinct"] for r in rows42),
        total_model_inversions=round(sum(r["model_inversions"] for r in rows42),3),
        pooled_pair_accuracy=(sum(r["distinct"] for r in rows42)+sum(r["model_tau"]*math.sqrt(r["distinct"]*r["n0"]) for r in rows42))/(2*sum(r["distinct"] for r in rows42)),
        mean_attainment=statistics.mean(r["model_att"] for r in rows42),
        mean_pair_accuracy=statistics.mean(r["model_pair_accuracy"] for r in rows42),
    )
    out=dict(
        note="Tie-aware ceiling for strict rankings against the doctrine priority preorder. Ceiling = sqrt(distinct_pairs/total_pairs). Verified against the released 42-fold artifact.",
        cohort_42={k:v for k,v in agg42.items()},
        cohort_38={k:v for k,v in agg38.items()},
        folds_42=[{k:r[k] for k in ("name","n","n0","tied","distinct","groups","edges","ceiling",
                                    "doctrine_tau","model_tau","model_att","model_inversions",
                                    "model_pair_accuracy","key_size_matches_doctrine",
                                    "n_hosts")} for r in rows42],
        folds_38=[{k:r[k] for k in ("name","n","n0","tied","distinct","groups","edges","ceiling",
                                    "key_size_matches_doctrine","n_hosts")} for r in rows38],
    )
    os.makedirs(os.path.dirname(OUT),exist_ok=True)
    open(OUT,"w").write(json.dumps(out,indent=2))
    print(json.dumps({k:v for k,v in agg42.items() if k!="size_hist"},indent=1))
    print("--- 38 ---")
    print(json.dumps({k:v for k,v in agg38.items() if k!="size_hist"},indent=1))
    print("wrote",OUT)

if __name__=="__main__": main()
