"""Re-evaluate the released CodeBERTa checkpoint on the repo-disjoint split.

Produces per-file probabilities so that the paper can report calibration,
risk-coverage (human-review budget), per-language CIs, and contamination-
corrected metrics from a single deterministic forward pass.
"""
from __future__ import annotations
import json
import random
import math
import statistics
import sys
from pathlib import Path

import numpy as np
from sklearn.metrics import (roc_auc_score, average_precision_score, brier_score_loss,
                             precision_recall_fscore_support, confusion_matrix)

ROOT = Path(r"C:\Users\Devesh tiwari\q-trust-projects")
CORPUS = ROOT/"q-trust-datasets"/"code_corpus.json"
MODEL = ROOT/"q-trust-codebert"
OUT = ROOT/"q-trust"/"paper"/"analysis"
OUT.mkdir(parents=True, exist_ok=True)

def split(corpus, seed=42):
    srcs=sorted({c.get("source","unknown") for c in corpus})
    rnd=random.Random(seed); rnd.shuffle(srcs)
    n=max(1,int(len(srcs)*0.8))
    tr=set(srcs[:n]); ev=set(srcs[n:])
    return [c for c in corpus if c.get("source") in tr], [c for c in corpus if c.get("source") in ev]

def wilson(k,n,z=1.96):
    if n==0: return (0.0,0.0)
    p=k/n; d=1+z*z/n
    c=(p+z*z/(2*n))/d; h=z*math.sqrt(p*(1-p)/n+z*z/(4*n*n))/d
    return (max(0,c-h),min(1,c+h))

def main():
    corpus=json.load(open(CORPUS))["corpus"]
    train,ev=split(corpus)
    print("split",len(train),len(ev),flush=True)
    preds_path=OUT/"codebert_predictions.jsonl"
    cached=[]
    if preds_path.exists():
        cached=[json.loads(l) for l in preds_path.read_text(encoding="utf-8").splitlines() if l.strip()]
    if len(cached)==len(ev):
        print("reusing",len(cached),"cached predictions",flush=True)
        probs=[r["prob_crypto"] for r in cached]
    else:
        import torch
        from transformers import AutoTokenizer, AutoModelForSequenceClassification
        tok=AutoTokenizer.from_pretrained(str(MODEL))
        model=AutoModelForSequenceClassification.from_pretrained(str(MODEL)).eval()
        print("model loaded",sum(p.numel() for p in model.parameters()),flush=True)
        probs=[]
        B=32
        with torch.inference_mode():
            for i in range(0,len(ev),B):
                batch=ev[i:i+B]
                enc=tok([c.get("code","")[:2048] for c in batch],truncation=True,max_length=256,
                        padding=True,return_tensors="pt")
                logits=model(**enc).logits
                p=torch.softmax(logits.float(),dim=-1)[:,1].cpu().numpy()
                probs.extend(p.tolist())
                if (i//B)%20==0: print("batch",i//B,"/",math.ceil(len(ev)/B),flush=True)
    recs=[]
    for c,p in zip(ev,probs):
        recs.append({"source":c.get("source"),"path":c.get("path"),"language":c.get("language"),
                     "label":int(bool(c.get("is_crypto"))),"prob_crypto":float(p)})
    with open(OUT/"codebert_predictions.jsonl","w",encoding="utf-8") as f:
        for r in recs: f.write(json.dumps(r)+"\n")
    y=np.array([r["label"] for r in recs]); p=np.array([r["prob_crypto"] for r in recs])
    pred=(p>=0.5).astype(int)
    P,R,F1,_=precision_recall_fscore_support(y,pred,average="binary",zero_division=0)
    acc=float((pred==y).mean())
    cm=confusion_matrix(y,pred,labels=[0,1])
    tn,fp,fn,tp=cm.ravel().tolist()
    # calibration
    ece=0.0; bins=[]
    for k in range(10):
        lo,hi=k/10,(k+1)/10
        m=(p>=lo)&(p<hi if k<9 else p<=hi)
        if m.sum()==0: continue
        conf=p[m].mean(); accb=(pred[m]==y[m]).mean(); n=int(m.sum())
        ece+=n/len(p)*abs(conf-accb)
        bins.append({"lo":lo,"hi":hi,"n":n,"mean_conf":float(conf),"accuracy":float(accb)})
    # risk-coverage
    conf=np.maximum(p,1-p); order=np.argsort(-conf)
    cov=[]; best={}
    for frac in [0.5,0.6,0.7,0.8,0.9,0.95,0.99,1.0]:
        k=max(1,int(round(frac*len(p)))); idx=order[:k]
        pp,rr,ff,_=precision_recall_fscore_support(y[idx],pred[idx],average="binary",zero_division=0)
        cov.append({"coverage":frac,"n":k,"precision":float(pp),"recall":float(rr),"f1":float(ff)})
        best[frac]=(pp,rr,ff)
    thr_rows=[]
    for t in np.arange(0.05,0.96,0.05):
        pr=(p>=t).astype(int)
        pp,rr,ff,_=precision_recall_fscore_support(y,pr,average="binary",zero_division=0)
        thr_rows.append({"threshold":round(float(t),2),"precision":float(pp),"recall":float(rr),"f1":float(ff)})
    # per language
    langs=sorted(set(r["language"] for r in recs))
    per=[]
    for L in langs:
        idx=[i for i,r in enumerate(recs) if r["language"]==L]
        yy=y[idx]; pp_=pred[idx]
        P2,R2,F2,_=precision_recall_fscore_support(yy,pp_,average="binary",zero_division=0)
        c2=confusion_matrix(yy,pp_,labels=[0,1]); tn2,fp2,fn2,tp2=c2.ravel().tolist()
        per.append({"language":L,"n":len(idx),"pos":int(yy.sum()),"tp":int(tp2),"fp":int(fp2),
                    "fn":int(fn2),"tn":int(tn2),"precision":float(P2),"recall":float(R2),"f1":float(F2),
                    "recall_ci":wilson(int(tp2),int(tp2+fn2))})
    macro=statistics.mean(x["f1"] for x in per if x["n"]>=10)
    macro_all=statistics.mean(x["f1"] for x in per)
    # contamination-corrected
    split_audit=json.load(open(OUT.parent/"analysis_split_audit.json"))
    exact=set(split_audit["exact_dup_eval_keys"])
    near=set()
    npth=OUT/"near_dup_full.json"
    if npth.exists(): near=set(json.load(open(npth)).get("high_sim_keys_0.8",[]))
    def key(r): return r["source"]+"::"+r["path"]
    def metrics_excluding(ex):
        idx=[i for i,r in enumerate(recs) if key(r) not in ex]
        yy=y[idx]; pp_=pred[idx]
        P3,R3,F3,_=precision_recall_fscore_support(yy,pp_,average="binary",zero_division=0)
        return {"n":len(idx),"precision":float(P3),"recall":float(R3),"f1":float(F3),
                "excluded":len(recs)-len(idx),"excluded_pos":int(sum(r["label"] for r in recs if key(r) in ex))}
    out={"checkpoint":str(MODEL),"split":{"train":len(train),"eval":len(ev),"repos_eval":len(set(c.get('source') for c in ev))},
         "base_rate_eval":float(y.mean()),"base_rate_corpus":float(np.mean([1 if c.get("is_crypto") else 0 for c in corpus])),
         "confusion":{"tp":int(tp),"fp":int(fp),"fn":int(fn),"tn":int(tn)},
         "precision":float(P),"recall":float(R),"f1":float(F1),"accuracy":acc,
         "roc_auc":float(roc_auc_score(y,p)),"average_precision":float(average_precision_score(y,p)),
         "brier":float(brier_score_loss(y,p)),"ece_10bin":float(ece),"calibration_bins":bins,
         "risk_coverage":cov,"threshold_sweep":thr_rows,
         "per_language":per,"macro_f1_lang_n_ge_10":float(macro),"macro_f1_all_lang":float(macro_all),
         "contamination_corrected":{"exact_dup":metrics_excluding(exact),"near_dup_0.8":metrics_excluding(near)},
         "excluded_keys_near_0.8":sorted(near)[:30]}
    open(OUT/"codebert_eval.json","w").write(json.dumps(out,indent=2))
    print(json.dumps({k:out[k] for k in ("confusion","precision","recall","f1","accuracy","roc_auc",
          "average_precision","brier","ece_10bin","macro_f1_lang_n_ge_10","contamination_corrected")},indent=1))
    print("risk-coverage:",json.dumps(cov,indent=1))

if __name__=="__main__":
    try: sys.stdout.reconfigure(encoding="utf-8")
    except Exception: pass
    main()
