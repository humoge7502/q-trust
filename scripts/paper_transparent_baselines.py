"""Transparent learned baselines on the identical 42-fold host-disjoint protocol.

Purpose: separate "the GNN is weak" from "the corpus has no headroom".
A 6-feature pairwise logistic ranker (7 parameters) and a ridge regressor are
trained per fold on the other 41 estates and scored on the held-out estate with
the same tie-aware metric and the same priority target as the GNN.
"""
from __future__ import annotations
import json
import glob
import os
import math
import itertools
import statistics
import numpy as np
from scipy.stats import kendalltau
from sklearn.linear_model import LogisticRegression, Ridge

DATA = r"C:\Users\Devesh tiwari\q-trust-projects\q-trust-datasets\planner\data\real_cboms"
OUT = r"C:\Users\Devesh tiwari\q-trust-projects\q-trust\paper\analysis\transparent_baselines.json"
CRIT = {"low":1,"medium":2,"high":3,"critical":4}
DEFAULT_KS = {"ECC":256,"ECDSA":256,"ECDH":256,"EDDSA":256,"SHA":256}
PQC = ("ML-KEM","ML-DSA","SLH-DSA","HQC","FALCON")
TYPE = {"RSA":0,"ECC":1,"DSA":2,"DH":3,"ECDH":4,"ECDSA":5,"EDDSA":6,"SHA":7,"AES":8,
        "HMAC":9,"CHACHA20":10,"ML-KEM":11,"ML-DSA":12,"SLH-DSA":13,"UNKNOWN":14}
def is_pqc(a): return str(a).upper().startswith(PQC)
def type_code(a):
    a=str(a).upper(); fam=a.split("-")[0]
    if a in TYPE: return TYPE[a]
    if "WITHRSA" in a or a.startswith("RSA"): return 0
    if "ECDSA" in a: return 5
    if "ED25519" in a or "ED448" in a: return 6
    if "EC" == a: return 1
    if "ML-KEM" in a or "MLKEM" in a or a=="KYBER": return 11
    if "ML-DSA" in a or "MLDSA" in a or a=="DILITHIUM": return 12
    if "SLH-DSA" in a or "SPHINX" in a: return 13
    return TYPE.get(fam,14)

def estate(path):
    d=json.load(open(path)); A=d.get("assets") or []; n=len(A)
    crit=[CRIT.get(str(a.get("criticality","medium")).lower(),2) for a in A]
    alg=[str(a.get("algorithm") or "UNKNOWN").upper() for a in A]
    ks=[]
    for a,al in zip(A,alg):
        k=a.get("key_size") or DEFAULT_KS.get(al.split("-")[0],2048)
        ks.append(int(k))
    vendor=[bool(a.get("pqc_ready",False)) or is_pqc(al) for a,al in zip(A,alg)]
    hosts=[str(a.get("host") or a.get("location") or "") for a in A]
    indeg=[0]*n; seen={}
    for i,h in enumerate(hosts):
        if seen.setdefault(h,i)!=i: indeg[i]+=1
    dtd=365.0
    dp=1.0
    pri=[]
    for i in range(n):
        p=crit[i]*2.0+(1.5 if vendor[i] else 0.0)
        p+=(math.log1p(ks[i])/4.0) if not is_pqc(alg[i]) else -1.0
        p+=dp*crit[i]/5.0-indeg[i]*0.3
        pri.append(p)
    X=np.array([[type_code(alg[i])/14.0, min(ks[i]/4096.0,1.0), float(vendor[i]),
                 crit[i]/5.0, dtd/730.0, min(dp*crit[i]/5.0,1.0)] for i in range(n)], dtype=float)
    return dict(name=os.path.basename(path), n=n, X=X, pri=np.array(pri), ks=ks, alg=alg,
                crit=crit, vendor=vendor, indeg=indeg)

def ceiling(p):
    n=len(p); n0=n*(n-1)//2
    if n0==0: return 1.0
    tied=sum(1 for i,j in itertools.combinations(range(n),2) if abs(p[i]-p[j])<1e-9)
    d=n0-tied
    return math.sqrt(d/n0) if d else 1.0

def tau(pred_score, target_pri):
    n=len(pred_score)
    pred_rank=[0]*n
    for pos,i in enumerate(np.argsort(-np.asarray(pred_score), kind="stable")): pred_rank[i]=pos
    t=[-float(v) for v in target_pri]
    if len(set(np.round(t,10)))<=1: return 1.0
    return float(kendalltau(pred_rank, t, variant="b").statistic)

def main():
    E=[estate(p) for p in sorted(glob.glob(DATA+r"\*.json"))]
    for e in E: e["ceiling"]=ceiling(e["pri"])
    folds=[]
    for k,e in enumerate(E):
        train=[x for j,x in enumerate(E) if j!=k]
        # pairwise differences, ties dropped
        Xd=[]; yd=[]
        for t in train:
            for i,j in itertools.combinations(range(t["n"]),2):
                if abs(t["pri"][i]-t["pri"][j])<1e-9: continue
                Xd.append(t["X"][i]-t["X"][j])
                yd.append(1 if t["pri"][i]>t["pri"][j] else 0)
        Xd=np.array(Xd); yd=np.array(yd)
        lr=LogisticRegression(C=1.0, max_iter=2000, fit_intercept=False, solver="lbfgs")
        lr.fit(Xd,yd)
        s_lr=e["X"] @ lr.coef_[0]
        # ridge on pooled priorities
        Xp=np.vstack([t["X"] for t in train]); yp=np.concatenate([t["pri"] for t in train])
        rg=Ridge(alpha=1e-3).fit(Xp,yp)
        s_rg=e["X"] @ rg.coef_
        folds.append(dict(name=e["name"], n=e["n"], ceiling=e["ceiling"],
                          logit_tau=tau(s_lr,e["pri"]), ridge_tau=tau(s_rg,e["pri"]),
                          logit_att=tau(s_lr,e["pri"])/e["ceiling"] if e["ceiling"] else 1.0,
                          ridge_att=tau(s_rg,e["pri"])/e["ceiling"] if e["ceiling"] else 1.0))
    agg={}
    for m in ("logit","ridge"):
        taus=[f[m+"_tau"] for f in folds]
        agg[m]={"mean_tau":statistics.mean(taus),"sd_tau":statistics.stdev(taus),
                "mean_attainment":statistics.mean(f[m+"_att"] for f in folds),
                "folds_at_ceiling":sum(1 for f in folds if f[m+"_tau"]>=f["ceiling"]-1e-6)}
    agg["ceiling_mean"]=statistics.mean(f["ceiling"] for f in folds)
    out=dict(protocol="42-fold LOO, identical folds/target/metric as the GNN campaign",
             pairwise_logistic="6 features, no intercept, 7 parameters; trained on all distinguishable pairs of the 41 training estates",
             ridge="6 features, trained on pooled priority values of the 41 training estates",
             aggregate=agg, folds=folds)
    open(OUT,"w").write(json.dumps(out,indent=2))
    print(json.dumps(agg,indent=1))
    print("logit folds not at ceiling:",[(f["name"],round(f["logit_tau"],3),round(f["ceiling"],3)) for f in folds if f["logit_tau"]<f["ceiling"]-1e-6][:10])
    print("ridge folds not at ceiling:",[(f["name"],round(f["ridge_tau"],3),round(f["ceiling"],3)) for f in folds if f["ridge_tau"]<f["ceiling"]-1e-6][:10])

if __name__=="__main__": main()
