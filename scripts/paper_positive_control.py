"""Positive control: does the same GNN escape the doctrine when the corpus
actually carries graph-dependent signal?

The released TLS corpus has zero dependency edges, so it cannot test graph
reasoning. Here we generate dependency-rich estates with a KNOWN target that
includes a multi-hop blast-radius term the doctrine (direct in-degree only)
cannot express. Same architecture, same metric, same protocol shape.

This is a controlled positive control, not a claim about real enterprises.
"""
from __future__ import annotations
import argparse
import json
import math
import statistics
import sys
from pathlib import Path
import numpy as np
import torch
from torch_geometric.loader import DataLoader

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT/"planner"))
from qtrust_planner.data_generator import generate_migration_graph, _is_pqc_algorithm  # noqa
from qtrust_planner.model_v3 import MigrationGNNv3  # noqa
from qtrust_planner.train_gpu import per_graph_listMLE_loss  # noqa
from scipy.stats import kendalltau, wilcoxon

OUT = ROOT/"paper"/"analysis"/"positive_control.json"

def downstream_reach(g):
    n=int(g.num_nodes)
    adj=[[] for _ in range(n)]
    for s,d in zip(g.edge_index[0].tolist(), g.edge_index[1].tolist()):
        adj[s].append(d)
    reach=[]
    for i in range(n):
        seen=set(); stack=list(adj[i])
        while stack:
            u=stack.pop()
            if u in seen: continue
            seen.add(u); stack.extend(adj[u])
        reach.append(len(seen))
    return np.array(reach, dtype=float)

def relabel(g, graph_weight=0.9):
    n=int(g.num_nodes)
    reach=downstream_reach(g)
    rec=g.asset_records
    indeg=np.zeros(n) 
    for d in g.edge_index[1].tolist(): indeg[d]+=1
    ks=np.array([r[1] for r in rec],dtype=float)
    crit=np.array([r[3] for r in rec],dtype=float)
    vendor=np.array([1.0 if r[2] else 0.0 for r in rec])
    alg=[r[0] for r in rec]
    pqc=np.array([1.0 if _is_pqc_algorithm(a) else 0.0 for a in alg])
    days=float(g.x[0,4].item())*730.0
    dp=2.0 if days<180 else 1.0
    # doctrine terms + a multi-hop blast-radius term the doctrine cannot see
    p=2.0*crit+1.5*vendor+np.where(pqc>0,-1.0,np.log1p(ks)/4.0)+dp*crit/5.0-0.3*indeg
    p=p+graph_weight*(reach/(n-1.0))*5.0
    order=np.argsort(-p, kind="stable")
    y=np.zeros(n,dtype=np.int64)
    for rank,i in enumerate(order): y[i]=rank
    lo,hi=p.min(),p.max()
    g.y_order=torch.tensor(y,dtype=torch.long)
    g.y_priority=torch.tensor((p-lo)/(hi-lo) if hi>lo else np.zeros(n),dtype=torch.float32)
    g.reach=reach; g.doctrine_p=(2.0*crit+1.5*vendor+np.where(pqc>0,-1.0,np.log1p(ks)/4.0)+dp*crit/5.0-0.3*indeg)
    return g

def ceiling_from_scores(score):
    n=len(score); n0=n*(n-1)//2
    tied=sum(1 for i in range(n) for j in range(i+1,n) if abs(score[i]-score[j])<1e-9)
    d=n0-tied
    return math.sqrt(d/n0) if d else 1.0

def tau(pred, target):
    # pred: higher = earlier; target: higher = earlier. tie-aware tau-b
    n=len(pred)
    pr=[0]*n
    for pos,i in enumerate(np.argsort(-np.asarray(pred),kind="stable")): pr[i]=pos
    if len(set(np.round(target,10)))<=1: return 1.0
    return float(kendalltau(pr,[-float(x) for x in target],variant="b").statistic)

def rand_order(n, seed):
    r=np.random.default_rng(seed); o=list(range(n)); r.shuffle(o); return np.array([n-pos for pos in range(n)])  # score for rank

def make_estates(n, seed0):
    out=[]
    for i in range(n):
        g=generate_migration_graph(n_assets=int(np.random.default_rng(seed0+i).integers(20,61)), seed=seed0+i, enterprise_topology=True)
        out.append(relabel(g))
    return out

def train_gnn(train, seed, epochs=80):
    torch.manual_seed(seed)
    model=MigrationGNNv3(input_features=6, hidden_dim=256, embedding_dim=128, heads=8,
                         dropout=0.1, use_centrality=True, variant="hybrid", norm="layer")
    opt=torch.optim.Adam(model.parameters(), lr=5e-4)
    loader=DataLoader(train, batch_size=16, shuffle=True, generator=torch.Generator().manual_seed(seed))
    model.train()
    for ep in range(epochs):
        for batch in loader:
            opt.zero_grad()
            logits,_=model(batch)
            loss=per_graph_listMLE_loss(logits,batch.y_order,batch.batch)
            loss.backward(); opt.step()
    model.eval(); return model

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--n-train",type=int,default=240)
    ap.add_argument("--n-test",type=int,default=60)
    ap.add_argument("--seeds",type=int,nargs="+",default=[42,43,44])
    ap.add_argument("--epochs",type=int,default=80)
    ap.add_argument("--out",type=Path,default=OUT)
    a=ap.parse_args()
    train=make_estates(a.n_train,1000)
    test=make_estates(a.n_test,50000)
    print("estates",len(train),len(test),"edges/estate",statistics.mean(int(g.edge_index.shape[1]) for g in train),flush=True)
    results={}
    for seed in a.seeds:
        model=train_gnn(train,seed,a.epochs)
        rows=[]
        with torch.no_grad():
            for g in test:
                logits,_=model(g)
                rows.append(dict(n=int(g.num_nodes),
                                 gnn=tau(logits.numpy(),g.y_priority.numpy()),
                                 doctrine=tau(g.doctrine_p,g.y_priority.numpy()),
                                 keysize=tau(np.where([_is_pqc_algorithm(r[0]) for r in g.asset_records],0.0,
                                                      np.log1p([r[1] for r in g.asset_records])),g.y_priority.numpy()),
                                 ceiling=ceiling_from_scores(g.y_priority.numpy())))
        results[seed]=rows
        print("seed",seed,"gnn",round(statistics.mean(r["gnn"] for r in rows),4),
              "doctrine",round(statistics.mean(r["doctrine"] for r in rows),4),
              "keysize",round(statistics.mean(r["keysize"] for r in rows),4),
              "ceil",round(statistics.mean(r["ceiling"] for r in rows),4),flush=True)
    summary={}
    for k in ("gnn","doctrine","keysize","ceiling"):
        vals=[statistics.mean(r[k] for r in results[s]) for s in a.seeds]
        summary[k]={"mean":statistics.mean(vals),"sd":statistics.stdev(vals) if len(vals)>1 else 0.0}
    # paired over test estates, first seed
    rows=results[a.seeds[0]]
    d=[r["gnn"]-r["doctrine"] for r in rows]
    try: p=float(wilcoxon(d).pvalue)
    except Exception: p=1.0
    summary["gnn_minus_doctrine"]={"mean":statistics.mean(d),"sd":statistics.stdev(d),"wilcoxon_p":p,
                                   "wins":sum(1 for x in d if x>1e-9),"ties":sum(1 for x in d if abs(x)<=1e-9),
                                   "losses":sum(1 for x in d if x<-1e-9)}
    out=dict(protocol="positive control; synthetic enterprise DAGs; target adds a multi-hop downstream-reach term (weight 0.9*5/(n-1)) that the doctrine's direct in-degree term cannot express",
             n_train=len(train),n_test=len(test),epochs=a.epochs,seeds=a.seeds,summary=summary,
             per_fold={str(s):results[s] for s in a.seeds})
    a.out.write_text(json.dumps(out,indent=2))
    print(json.dumps(summary,indent=1))

if __name__=="__main__":
    try: sys.stdout.reconfigure(encoding="utf-8")
    except Exception: pass
    main()
