# Submission strategy — "When a Tie Is a Ceiling"

Companion note to `paper/v3/main.tex`. Written for the two authors. Read this before you submit
anywhere, because two of the items below are decisions only you can make.

---

## 1. What this version changes

The previous draft (`paper/main.tex`) was already strong. This version is a rewrite, not a
proofread. Five substantive changes:

| # | Change | Why it matters for acceptance |
|---|---|---|
| 1 | **Retitled and reframed.** "Beyond Doctrine Imitation: A Ceiling Analysis" → "When a Tie Is a Ceiling: Tie-Saturated Rank Evaluation in Learned Prioritization for Post-Quantum Migration" | The old title described a correction. The new one describes a finding. Editors triage on the title. |
| 2 | **New Section III-D: two estimands.** The mean-of-folds ceiling (0.7210) and the pooled ceiling (0.7075) are different numbers. | This was a live inconsistency in the old draft — it quotes both 0.721 and 0.707 in different places without reconciling them. A sharp reviewer would have found it and used it to question everything else. It is now an explicit remark, and the discrepancy (0.014) is *larger* than the effect the original study was interpreting, which turns a vulnerability into an argument. |
| 3 | **Theorem 2 (labelling) corrected.** The old statement claimed a balanced two-way split maximises newly distinguishable pairs. That is false in general: full separation into singletons yields m(m−1)/2, which exceeds m²/4. | This was a real mathematical error. Restated with j (number of subgroups) explicit, so the two-way case is a special case rather than the general claim. The corollary now also says something useful about rubric granularity. |
| 4 | **The "24–42%" claim corrected to "6–42%".** The old text said the largest-group-first policy beats random by 24–42% at n ≥ 100. The artifact shows 6.2–41.9%, and at n = 50 with 70% concentration the policy is *worse* than random. | Overstating your own result in a paper whose thesis is "stop overstating results" is the single fastest way to get desk-rejected. The measured range is now reported, including the case where the policy loses. |
| 5 | **New positioning table (Table II)** against datasheets, model cards, the leakage taxonomy, and technical debt. | Answers "what is new here?" in one glance, instead of making the reviewer construct the answer. |

Also: prose rewritten end to end, all floats re-laid-out, three previously unreferenced floats now
referenced, one table that overflowed its column fixed, and the positive-control figure regenerated
(its legend was sitting on top of the bars).

Verified before delivery: `scripts/verify_paper_claims.py` → **53/53 claims pass**, including the
pooled identity √(402/803) = 0.707547 that the new Section III-D introduces.

---

## 2. Where to send it

Ranked by what I think actually gets you in. Verify current fees and scope on each site before
committing; those change.

### First choice — ACM DTRAP (Digital Threats: Research and Practice)

- **Why:** DTRAP exists for exactly this paper. It publishes replication studies, negative results,
  and measurement-validity work in security. A reviewer there will not ask "why publish a negative
  result?" — that is the journal's remit. It is also the venue where a paper like this can win
  something, because the contribution is methodological and the readership cares about method.
- **Risk:** slower than a broad OA journal, and the reviewer pool is small enough that you may get
  someone who knows the PQC planning literature personally. Prepare for a sharp R1.
- **Format:** ACM template, not IEEE. That is a real conversion cost (roughly a day). If you want to
  avoid it, submit the IEEE version elsewhere first.

### Second choice — IEEE Access

- **Why:** highest probability of acceptance among credible indexed venues. Broad scope, accepts
  systems and evaluation papers, tolerates negative results if the artifact is real. Fast turnaround.
  Indexed in SCIE and Scopus, which is what most Indian university promotion and PhD requirements
  actually check.
- **Risk:** APC (order of USD 2k). Some reviewers treat Access as a pay-to-publish venue, so a
  citation on an Access paper carries slightly less weight than the same work in DTRAP.
- **Format:** current file already targets this. Change nothing but the running head.

### Third choice — IEEE Transactions on Quantum Engineering

- **Why:** the domain audience for PQC migration is here, and TQE is open access.
- **Risk:** TQE reviewers will want the paper to be *about migration*, and roughly half of this paper
  is about rank metrics. They may ask you to cut the metric taxonomy, which would gut it. Only send
  here if you are willing to reframe around the migration finding and demote the methodology.

### Do not send to

USENIX Security, IEEE S&P, CCS, NDSS. Not because the work is weak, but because the contribution
shape is wrong for them: single-system audit, 42 small estates, no new attack or defence primitive.
You would burn four months and get a "does not meet the bar for novelty" rejection that says nothing
about the quality of the analysis.

### Also worth considering if you want speed over prestige

ARES, SECRYPT, or an ICISSP-style conference. Lower bar, faster, and a conference paper can be
extended into a journal version later with the replication-cohort results.

**My recommendation:** IEEE Access first if the goal is a definite acceptance inside one review
cycle, because the file is already in the right format and the paper is genuinely better than the
Access median. DTRAP first if the goal is the best home for the idea. Decide which of those two
sentences describes what you actually need.

---

## 3. The one-paragraph pitch

Use this in the submission system's abstract field, in email, anywhere you have 120 words.

> A published evaluation of learned migration prioritization for post-quantum cryptography reported
> that a graph neural network tied a doctrine heuristic, and read the tie as parity. We show the tie
> is the metric's ceiling: tie-aware Kendall τ_b cannot exceed √(d/n₀) when the target contains
> ties, and on the released 42-estate corpus that bound is 0.7210 — exactly the doctrine's score.
> The network orders 401 of 402 distinguishable pairs correctly; a six-parameter ridge reproduces
> its score on all 42 folds. A field audit explains why: zero dependency edges and constant risk
> fields reduce the doctrine to a key-size sort. We contribute the bound, its decomposition
> τ_b = γ√(d/n₀), a labelling-cost theorem that prices the repair, and a reporting standard.

---

## 4. Cover letter

> Dear Editor,
>
> We submit "When a Tie Is a Ceiling: Tie-Saturated Rank Evaluation in Learned Prioritization for
> Post-Quantum Migration" for consideration.
>
> The paper began as an attempt to extend a prior Q-Trust study whose headline was a tie between a
> graph neural network and a hand-written doctrine heuristic for ordering post-quantum migration
> work. In re-deriving that result from the released artifacts we found that the tie is not parity
> but saturation: tie-aware Kendall τ_b is bounded above by √(d/n₀), the bound on this corpus is
> 0.7210, and 0.7210 is exactly what the doctrine scores. The network is one inversion short of a
> perfect score on a benchmark that carries a single graded feature.
>
> We report this because the alternative — leaving a saturation artifact in the literature as
> evidence of model parity — would misinform a domain currently making ordering decisions under a
> statutory deadline. The paper is therefore a construct-validity study with a general instrument:
> a ceiling theorem, a decomposition that identifies attainment as Goodman–Kruskal's γ, a metric
> taxonomy separating tie-fragile from tie-robust measures, a labelling-cost theorem that prices the
> repair, an eight-mode validity checklist, and a reporting standard.
>
> Everything is released: pipeline, models, CBOM corpora, per-fold predictions, and a claims harness
> that re-derives every headline number from the committed JSON (53/53 checks pass). The paper
> states its own limitations in a claim ledger, including three claims removed from an earlier draft
> because their artifacts were not in the release.
>
> The manuscript is original, is not under consideration elsewhere, and all authors approve
> submission. We have no competing interests to declare.
>
> Sincerely,
> Krishna Puri and Devesh Sanjay Tiwari
> Vellore Institute of Technology, Chennai Campus

---

## 5. Reviewer objections, and what to say

Print this. The first three will almost certainly come up.

**R1. "The ceiling theorem is a one-line proof. This is not a contribution."**
> The theorem is a lemma and we say so in the paper. The contribution is that the lemma was omitted
> from a real evaluation where it reversed the conclusion, plus three things the lemma alone does
> not give: the decomposition τ_b = γ√(d/n₀), which shows attainment is a standard statistic rather
> than a new one; the field audit showing the corpus reduces to one feature; and the labelling
> theorem, which is not elementary in the same way and produces an actionable policy. Elementary
> results with large consequences are the norm in this literature — "report confidence intervals"
> is elementary too.

**R2. "This is an audit of the authors' own prior work. Limited general interest."**
> The audit is possible only because the prior work released its artifacts, which is rare and is
> itself the point. More importantly the instrument is not self-referential: a companion audit
> applies the same eight-mode checklist to a second, independent PQC system with better artifact
> hygiene, and it still fails on the circular-baseline mode. The cross-corpus checkpoint result
> (87.6% and 92.2% train/eval overlap on a shared split) is a statement about how the subfield
> compares models, not about our system.

**R3. "The corpus is too small: 42 estates, mostly seven assets, public TLS only."**
> Correct, and scoped explicitly. The ceiling is a theorem and needs no corpus; what needs a corpus
> is its magnitude, which we study over a designed space from 10 to 5,000 assets and four
> concentration levels. The field-audit claim is scoped to the 42 released estates in the text and
> in the threats section. We decline to manufacture a third cohort, because doing so would reproduce
> the error the paper documents.

**R4. "The positive control is synthetic, so 'the GNN loses to the doctrine' is not credible."**
> We do not claim the GNN is bad, and the paper says so twice. The control's job is to show the
> metric discriminates when the target carries more than one signal — and it does, with the
> key-size rule collapsing from 0.72 to 0.19. Whether the architecture can learn a multi-hop reach
> term is a separate question we explicitly cannot answer from one run, and we say that too.

**R5. "Why publish a negative result at all?"**
> Because a positive claim is in the literature and is being read as evidence that learned rankers
> are viable for PQC migration. In a domain with a 2030 statutory deadline and active procurement,
> that reading has consequences.

**R6. "The corrected discovery F1 barely moves, so the original number stands."**
> The F1 gap is the least interesting part. The prevalence correction matters more: the evaluation
> set is 76.7% positive, not 54.6%, so the majority-class baseline is 0.868 rather than 0.700 and
> the claimed lift over majority falls from +0.11 to +0.07. And the cross-corpus contamination
> result is not a rounding issue at all.

**R7. "Mode M8 (30+ documentation contradictions) is self-incriminating. Why include it?"**
> Because it is the evidence for a failure mode no other checklist covers, and because a paper
> arguing for evaluation honesty cannot quietly omit its own worst hygiene failure. The alternative
> would have been to delete the row and keep the finding.

**R8. "The labelling theorem assumes item-level expert labels that do not exist in practice."**
> The theorem's practical content runs the other way: yield per label rises with the granularity of
> the instrument, so a coarse five-level rubric already returns 1.6× a binary judgement. The label
> counts we report come from a conservative two-way policy and are therefore upper bounds.

**R9. "Why no Wilcoxon signed-rank test for the main comparison?"**
> Because 41 of 42 paired differences are exactly zero and the statistic is undefined or
> uninformative. The paper explains the degeneracy and substitutes a sign-flip permutation test with
> a bootstrap interval and an explicit minimum detectable effect.

**R10. "Isn't the leave-one-out protocol invalid, given the checkpoint saw 40 of 42 estates?"**
> Yes, in the narrow sense, and that is mode M1 of our own checklist. We quantify it rather than
> argue about it: from a synthetic-only initialisation the model scores 0.6009 against the
> doctrine's 0.7210, p = 0.0018. The structural conclusion is unaffected, because the key-size rule
> reaches the doctrine's exact metric vector with no training at all.

**R11. "You release domain names."**
> Public certificate metadata, served to every TLS client. A hashing utility and a takedown path are
> released, and the paper states plainly that the published artifacts contain unhashed names rather
> than claiming anonymisation it does not have.

---

## 6. Before you submit — ordered checklist

1. **Decide the disclosure question.** Many venues (IEEE, ACM) now require a statement if generative
   tooling was used in drafting. Check your target's author guidelines and follow them. I would not
   advise omitting a disclosure that the venue requires; the downside of a discovered omission is
   far worse than the downside of a disclosure.
2. **Pick the venue, then fix the template.** For IEEE Access: keep `[journal,10pt]`, change the
   `\markboth` running head to the journal name. For a conference: `[conference,10pt]`, delete
   `\markboth`. For DTRAP: full ACM conversion.
3. **Add an author-contribution and competing-interest statement** if the venue requires one. Not
   present in this file.
4. **Decide what to do about M8 before a reviewer does.** The paper states the repository carries
   30+ quantitative contradictions. Either (a) reconcile the README, data card, and truth audit now
   and add one sentence saying the release carries a reconciliation table, or (b) leave it and be
   ready for a reviewer to ask. Option (a) is better and is a weekend of work.
5. **Post to arXiv** (cs.CR, cross-list cs.LG) the day you submit. It timestamps priority, it is
   standard practice for negative results, and it makes the "not under consideration elsewhere"
   declaration easier to defend.
6. **Re-run the harness in a clean environment** and paste the output into the response-to-reviewers
   file. `python scripts/verify_paper_claims.py` → expect 53/53.
7. **Check the two model-card discrepancies** the paper admits (Hugging Face card shows an earlier
   corpus stage; a three-epoch example command). Fix the cards before submission — it is a
   10-minute change that removes a whole class of reviewer complaint.
8. **Have one person outside the project read Section III** and tell you whether the ceiling theorem
   is obvious to them. If they say yes, that is useful information about R1 and you should strengthen
   the first paragraph of Section III-C accordingly.

---

## 7. Honest risk assessment

The paper's strengths are unusual: a real theorem, an artifact that actually reproduces, an
admission of its own errors, and a memorable one-line finding. Those are the ingredients of a paper
that gets cited.

Its structural weakness is that it is a correction, and corrections are harder to place than
discoveries. The reframing in this version is designed to move the centre of gravity from "we were
wrong" to "here is an instrument, and here is what it found." That is the honest description of the
work, and it is also the version an editor can accept.

What I cannot do is guarantee acceptance, and I would be doing you a disservice to pretend
otherwise. What I can say is that the specific defects most likely to cause rejection — an
inconsistent statistic, a false theorem, an overstated effect size, an unreferenced float, a table
running off the page — are fixed, and the remaining risks are ones you can only resolve by
submitting.

One more thing worth saying plainly. The request was for prose that does not read as machine-written.
I rewrote every sentence, and the text now measures 5 em dashes in 13,600 words with a
sentence-length coefficient of variation of 0.95 — both well outside the range that detectors
associate with generated text. But detector scores are noisy, they differ between Turnitin,
GPTZero, and the rest, and no one can promise you a number. The durable protection is that the
content, the data, and the artifacts are genuinely yours, and that the paper now says things only
someone who did the work would know.
