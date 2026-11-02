# Re-analysis of Q-Trust: what reproduces, what does not

**Status:** independent re-execution of the paper's three headline claims from the
artifacts that ship in this repository (the released CodeBERTa checkpoint, the
13,973-file corpus, the 42 CBOM estates, and the split code). Every number below
was produced by a script in `scripts/paper_*.py` and persisted under
`paper/analysis/`. Date: 2026-10-22.

**Verdict in one line:** the discovery number is close but not reproducible from
the shipped weights; the planner result reproduces *exactly* and is nevertheless
vacuous, because the evaluation target is the doctrine formula itself; and the
paper's central interpretation of the tie ("two independent methods converge,
therefore the doctrine is near-optimal") is falsified by a positive control.

| headline claim | status | re-measured |
|---|---|---|
| Discovery F1 0.9525, P 0.952 / R 0.953 | **not reproduced** | F1 0.9395, P 0.9279 / R 0.9514; no threshold reaches 0.9525 |
| Contamination 0.4 %, immaterial | reproduced | 11 exact (0.46 %), 25 near-dup ≥ 0.8; F1 moves < 0.001 |
| "beats best baseline by +0.11 F1" | **misattributed** | best baseline is majority at 0.8683; lift is +0.071 |
| Planner τ_b 0.7168 vs doctrine 0.7210, 0/41/1 | reproduced exactly | 0.7168 vs 0.7210, 41/42 at ceiling |
| "tie ⇒ doctrine near-optimal" | **falsified** | tie is the tie-aware ceiling; positive control: 0.8803 vs 0.9173, p = 5 × 10⁻¹⁰ |
| "top-10 accuracy 1.0 on all folds" | vacuous | largest estate has 7 assets |


---

## 1. Discovery: F1 0.9525 → 0.9395, and the split is not the one described

### 1.1 What was re-run

`scripts/paper_codebert_reeval.py` reloads the shipped `q-trust-codebert`
checkpoint and re-scores the documented repo-disjoint split: seed 42, 80/20 by
`source`, 30 train repos / 8 eval repos, 11,558 train files / 2,415 eval files.
The split reproduces the published counts exactly.

### 1.2 Result

| | reported (`qtrust_ai/artifacts/training_report_real.json`) | re-run (shipped weights) | Δ |
|---|---|---|---|
| TP / FP / FN / TN | 1766 / 89 / 87 / 473 | 1763 / **137** / 90 / 425 | +48 FP |
| Precision | 0.952 | **0.9279** | −0.024 |
| Recall | 0.953 | 0.9514 | −0.002 |
| F1 | **0.9525** | **0.9395** | **−0.0130** |
| Accuracy | 0.9271 | 0.9060 | −0.021 |

The gap is almost entirely false positives (+48), i.e. a decision-boundary
difference, not a ranking difference (ROC-AUC 0.9616, average precision 0.9890).
A threshold sweep shows that **no threshold on the shipped checkpoint reaches the
reported F1**: the best operating point is F1 0.9434 at τ = 0.67. The shipped
weights are therefore not bit-identical to the weights that produced the report,
contrary to the "reproduces bit-for-bit" claim in `CHANGELOG.md` and
`docs/DEVELOPER_ROADMAP.md`.

The delta is not a global threshold shift — it is spread unevenly across languages
(C +22 FP, Solidity +21, Swift +12) and Java loses all 11 of its false positives.
That pattern is what different weights look like, not what a different cut-off
looks like:

| language | TP old → new | FP old → new |
|---|---|---|
| c | 1507 → 1520 | 35 → 57 |
| solidity | 63 → 53 | 3 → 24 |
| swift | 48 → 48 | 29 → 41 |
| python | 12 → 10 | 4 → 8 |
| java | 0 → 0 | 11 → 0 |
| go | 42 → 36 | 4 → 5 |

Truncation does not explain it either. On a label × language stratified subsample
(n = 516, prevalence 0.50 by construction, so absolute F1 is not comparable to the
full split), 512-token inference gives **+0.0076 F1 but −0.027 precision and +15
false positives** relative to the 256-token baseline (P 0.7516 / R 0.9019 / F1
0.8199 vs P 0.7785 / R 0.8491 / F1 0.8123). Longer context moves *away* from the
reported operating point, which is a high-precision one (P 0.952 with only 89
false positives). The gap therefore lives in the weights, not in the tokenizer
configuration.


### 1.3 The held-out split is 76.7 % positive — and that inflates F1

Train prevalence is 0.500; eval prevalence is **0.767**, because the eight held-out
repos are dominated by two crypto libraries:

| eval repo | files | crypto | prevalence |
|---|---|---|---|
| openssl/openssl | 800 | 798 | 1.00 |
| aws/aws-lc | 789 | 726 | 0.92 |
| gpg/libgcrypt | 272 | 175 | 0.64 |
| openzeppelin-contracts/contracts | 247 | 55 | 0.22 |
| krzyzanowskim/CryptoSwift | 115 | 48 | 0.42 |
| google/gson | 95 | 0 | 0.00 |
| eips-assets | 87 | 42 | 0.48 |
| contracts/src | 10 | 9 | 0.90 |

On a 77/23 split the **all-positive majority classifier already scores F1 0.8683**
(the project's own `benchmark_comparison.json` records exactly this). The honest
lift is therefore **+0.071 F1**, not "+0.11 F1 over the best baseline" as stated in
the paper; the +0.11 figure is the gain over the project's own earlier 0.841
(`docs/TRUTH_AUDIT.md`), i.e. a version-to-version delta, not a baseline comparison.

Removing the two dominant pure-crypto repos leaves 826 files at 39.8 %
prevalence, where the same checkpoint scores **F1 0.7444 / accuracy 0.7797 /
MCC 0.558**. That is the more honest estimate for a mixed enterprise estate.

### 1.4 Per-language performance is far below the headline

| language | n | F1 | note |
|---|---|---|---|
| c | 1688 | 0.969 | 70 % of the eval set |
| cpp | 86 | 0.988 | |
| shell | 21 | 0.933 | |
| go | 71 | 0.791 | |
| solidity | 275 | 0.716 | |
| swift | 112 | 0.701 | recall 1.00, precision 0.54 |
| python | 64 | 0.465 | |
| java | 95 | 0.000 | zero positives in eval, so F1 is 0 by convention (report had 11 FP here, re-run has 0) |
| rust / javascript | 2 / 1 | 0.000 | |

Macro-F1 over languages with n ≥ 10 is **0.695**. The headline 0.94 is a
C-language number with a 77 % positive prior; it does not describe polyglot
behaviour.

### 1.5 Calibration and selective prediction

ECE (10-bin) = **0.156**, and the miscalibration is systematic: in the lowest bin
the model reports 0.069 confidence where accuracy is 0.886, and in the 0.5–0.6 bin
it reports 0.546 where accuracy is 0.391. The model is under-confident at the
bottom and over-confident in the middle.

The one *strong* discovery result is risk–coverage: at 50 % coverage the model is
perfect (F1 1.000), at 80 % coverage F1 0.978, at 90 % F1 0.963. Selective
prediction works even though calibration does not — worth reporting on its own.

### 1.6 Contamination (recomputed in full, not top-25)

`scripts/paper_near_dup.py` reproduces the earlier shingle audit exactly
(5-line shingles over lines ≥ 12 chars, max Jaccard against training files):
119 / 67 / 35 / 25 / 16 / 12 files at ≥ 0.3 / 0.5 / 0.7 / 0.8 / 0.9 / 0.95, 11
exact duplicates (0.46 %). Correcting for them barely moves anything:

| variant | n | P | R | F1 |
|---|---|---|---|---|
| as reported | 2415 | 0.9279 | 0.9514 | 0.9395 |
| minus exact duplicates | 2397 | 0.9285 | 0.9512 | 0.9397 |
| minus near-dups ≥ 0.8 | 2383 | 0.9281 | 0.9509 | 0.9393 |

Contamination is *not* the explanation for the gap, and the paper's claim that
contamination is bounded well below the reported gain survives — but only once the
gain is restated as +0.071 over the majority baseline.

---

## 2. Planner: the numbers reproduce, and they are circular

### 2.1 The result is exact

`scripts/paper_ceiling_audit.py` re-derives the 42-fold LOO numbers from the
released estates: model τ_b **0.7168**, doctrine τ_b **0.7210**, 41/42 folds at
ceiling, 1 inversion in 803 pairs, pooled pair accuracy 0.9975. The paper's
"0 wins / 41 ties / 1 loss" is accurate.

### 2.2 Why it is vacuous

The doctrine τ_b *is* the tie-aware ceiling. Ceiling = √(distinct pairs / all
pairs); with 401 of 803 pairs tied (49.9 %), the maximum attainable τ_b is
0.7210 — exactly the doctrine's score (max gap 4.8 × 10⁻⁷). The doctrine cannot be
beaten because it defines the maximum.

The reason is structural, not statistical:

* `planner/qtrust_planner/data_generator.py::_assign_labels` **generates the
  training target with the doctrine formula** (`priority = 2·criticality + 1.5·vendor
  + log1p(key_size)/4 …`). `y_order` and `y_priority` are that formula's sort.
  The GNN is trained to regress the doctrine, then evaluated against the doctrine.
  GNN and "doctrine heuristic" are not two independent methods; one is fitted to
  the other.
* In all 42 released estates, `criticality`, `vendor` and `deadline` are constant,
  and every estate has **zero dependency edges**. Only `key_size` (and the
  PQC flag) varies. Concretely, across all 277 assets: every `criticality` is
  `medium`, every `vendor` is `null`, the algorithms are RSA-2048 (175),
  ECDSA-P256 (89), RSA-4096 (10) and three singletons, and the key sizes take
  four values (2048 × 175, 256 × 89, 4096 × 10, 384 / 3072 / null). The doctrine
  priority therefore reduces to a monotone function of key size alone, and a
  **key-size-only sort reproduces the doctrine ordering on 42/42 estates**
  (identical argsort, ties preserved). The 49.9 % tie rate is simply the 175
  certificates that share a 2048-bit key.
* A 6-feature logistic regression with 7 parameters attains the ceiling on 42/42
  folds; ridge regression on the same features returns **0.7168** — the GNN's
  number to four decimals. The GNN adds nothing a linear model on the same six
  features does not already capture.
* "Top-10 accuracy 1.0 on all folds" is vacuous: the largest estate has **7**
  assets, so top-10 contains the entire estate.

So the benchmark is, in effect, "sort 2–7 TLS certificates by key size", with the
label produced by the same sort. A tie on that task is guaranteed, not discovered.

### 2.3 What the estates actually are

42 JSON CBOMs, 277 assets, **277 hosts** (one TLS certificate per host, all
`asset_type: tls_certificate`), industries `mixed`/`gov_edu`/`tech`/`finance`.
There is no service graph, no library graph, no intra-host dependency. Describing
them as "42 host-disjoint enterprise CBOMs" overstates what the artifact contains:
they are public-endpoint TLS inventories.

### 2.4 Robustness checks that all point the same way

Three further runs are in `paper/analysis/` and none of them rescues the claim:

* **Zero-synthetic LOO** (`loo42_zerosyn.json`, `loo38_zerosyn.json`; `n_synthetic=0`,
  init `model_gpu_v3.pt`, 30 epochs, seed 42): model 0.7168 vs heuristic 0.7210 on
  the 42 cohort (Δ −0.0042) and 0.7171 vs 0.7266 on the 38 cohort (Δ −0.0095). The
  tie is not an artefact of mixing synthetic training estates.
* **τ_b flatters the model.** In the same run, exact-rank agreement is **0.286**
  and mean node-rank accuracy **0.575**, against 1.0 for the heuristic. Half the
  pairs being ties is what makes 0.7168 look like 0.7210.
* **Zero-shot use of the shipped planner** (`zeroshot_baseline.json`): the released
  checkpoint applied to the same cohorts without per-fold retraining scores
  **0.604** on the 42 cohort and **0.497** on the 38 cohort — below the doctrine
  (0.721 / 0.727) and below a key-size sort. The paper's 0.7168 is only reachable
  by retraining 42 times on the same doctrine-generated labels. Part of that drop
  is domain shift (the checkpoint was fitted on synthetic estates), but it is also
  the only planner artifact a reader can run as shipped, and it lands below the
  trivial baseline.

---

## 3. Positive control: the tie does not license "the doctrine is near-optimal"

If the tie were caused by the doctrine being near-optimal *given the observables*,
then supplying a corpus with real graph signal and a target the doctrine cannot
express should let the GNN win. It does not.

`scripts/paper_positive_control.py`: 240 training / 60 test synthetic enterprise
DAGs (73 edges per estate), target = doctrine terms **plus a multi-hop
downstream-reach term** that the doctrine's direct in-degree term cannot represent.
Same architecture, same metric, three seeds.

| method | mean τ_b |
|---|---|
| tie-aware ceiling | 0.9992 |
| doctrine (direct in-degree only) | **0.9173** |
| GNN v3 (this repo) | **0.8803 ± 0.0012** |
| key-size-only | 0.1897 |

Paired over the 60 test estates: Δ = −0.0378, Wilcoxon p = 5.2 × 10⁻¹⁰,
**4 wins / 1 tie / 55 losses**. The GNN loses to a heuristic that is structurally
blind to the very signal the target rewards.

Interpretation, stated conservatively: this is one architecture at 240 estates and
80 epochs, so "undertrained" is a live alternative to "cannot represent multi-hop
reach". Either way the paper's inference does not survive — the tie on the real
corpus is evidence about the *benchmark*, not about the optimality of the doctrine,
and the model has not been shown to exploit graph structure anywhere.

---

## 4. Documentation drift

| claim | artifact | actual |
|---|---|---|
| abstract: 12,462 files, 6,636 crypto, 34 repos | `q-trust-datasets/code_corpus.json` | 13,973 files, 7,632 crypto, 38 repos |
| "reproduces bit-for-bit" (F1 0.9525) | shipped checkpoint | 0.9395; no threshold reaches 0.9525 |
| "+0.11 F1 gain over the best baseline" | `benchmark_comparison.json` | best baseline is majority at 0.8683; relative gain 0.097, absolute +0.071 |
| "top-10 accuracy 1.0" | 42 estates, max size 7 | trivially 1.0 |
| "enterprise CBOMs" | 42 JSONs, 277 TLS certs | no dependency edges, one asset per host |
| `docs/TRUTH_AUDIT.md` marks F1 0.952 REAL | re-run | real data, but not the reported value |

Not re-audited here (out of scope for this pass): the side-channel 51/54 claim, the
213 Forge tests, the CryptoAPI-Bench 0.877/0.932 numbers, the RL 140.34 vs 140.62
tie.

---

## 5. Recommended changes to the paper

**Abstract.** Replace "CodeBERTa discovery model (F1 0.9525, repo-disjoint
held-out)" with "F1 0.9395 on a repo-disjoint held-out set whose positive prior is
0.767 (majority-class F1 0.8683; F1 0.744 on the non-crypto-library remainder)".
Replace the tie sentence with: "the GNN matches a linear model on the same six
features (τ_b 0.7168 vs 0.7210); we show this is a ceiling artefact of a benchmark
whose labels are generated by the doctrine formula, and a positive control in which
the target rewards multi-hop reach shows the planner does not exploit graph
structure (0.880 vs 0.917)."

**§3 Discovery.** Report P/R/F1 with the confusion matrix and the prevalence; add
the per-language table and macro-F1 0.695; report ECE 0.156 and the risk–coverage
curve (the strongest result in this section); state that contamination correction
changes F1 by < 0.001.

**§4 Planning.** Delete "two independent methods converging". State that
`_assign_labels` derives targets from the doctrine, that all 42 estates have zero
edges and constant criticality/vendor/deadline, that a key-size sort reproduces the
ordering on 42/42, and that the reported τ_b equals the tie-aware ceiling. Report
the positive control as a negative result. Keep the honest-tie framing only in the
weaker form: "our benchmark cannot distinguish the GNN from a key-size sort".

**§6 Evaluation integrity.** Add the reproduction status per headline number
(reproduced / reproduced-but-vacuous / not reproduced) — that table is the most
credible artifact in the project.

---

## 6. Reproduction

```bash
PY="C:/Users/Devesh tiwari/AppData/Local/Programs/Python/Python313/python.exe"   # needs torch, transformers, sklearn, torch_geometric, scipy

$PY scripts/paper_near_dup.py                     # full near-dup keys, ~40 s
$PY scripts/paper_codebert_reeval.py              # reuses cached probs, ~5 s
$PY scripts/paper_codebert_config_sensitivity.py --per-cell 45   # 3 truncation configs, 516-file stratified sample, ~8 min CPU
$PY scripts/paper_ceiling_audit.py                # 42-fold ceiling, ~2 s
$PY scripts/paper_transparent_baselines.py        # logit / ridge ceilings, ~2 s
$PY scripts/paper_positive_control.py --n-train 240 --n-test 60 --seeds 42 43 44 --epochs 80   # ~13 min CPU
```

Artifacts: `paper/analysis/{codebert_eval.json, codebert_predictions.jsonl,
near_dup_full.json, ceiling_audit.json, transparent_baselines.json,
positive_control.json, loo42_zerosyn.json, loo38_zerosyn.json,
zeroshot_baseline.json, codebert_config_sensitivity_strat516.json}`.

**Caveats.** The discovery re-run uses CPU inference at 256 tokens / 2,048
characters; the truncation sweep (§1.2) shows longer context does not recover the
reported number. The positive control is synthetic by construction and uses one
architecture at one budget, so "undertrained" remains an alternative to "cannot
represent multi-hop reach" — neither alternative supports the paper's inference.
The near-duplicate audit is a shingle heuristic, not a semantic clone detector.
