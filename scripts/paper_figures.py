"""Generate the paper's figures from audited artifacts."""
from __future__ import annotations
import json
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
A = ROOT / "paper" / "analysis"
FIG = ROOT / "paper" / "figures"
FIG.mkdir(parents=True, exist_ok=True)
plt.rcParams.update({
    "font.family": "serif", "font.size": 8, "axes.labelsize": 8,
    "axes.titlesize": 9, "legend.fontsize": 7, "xtick.labelsize": 7,
    "ytick.labelsize": 7, "axes.spines.top": False, "axes.spines.right": False,
})
C = {"blue": "#2b6cb0", "red": "#c53030", "gray": "#718096", "green": "#2f855a",
     "orange": "#c05621", "light": "#cbd5e0"}


def scatter_cohort(ax, cohort, label):
    rows = cohort
    x = np.array([r["ceiling"] for r in rows])
    y = np.array([r["model"] for r in rows])
    rng = np.random.default_rng(1)
    xj = x + rng.uniform(-0.006, 0.006, len(x))
    ax.plot([0, 1.02], [0, 1.02], color=C["gray"], lw=0.8, ls="--", zorder=0)
    ax.scatter(xj, y, s=22, color=C["blue"], alpha=0.75, edgecolor="white", linewidth=0.4, zorder=2)
    for r in rows:
        if r["model"] < r["ceiling"] - 1e-6:
            ax.annotate(r["name"].replace(".json", ""), (r["ceiling"], r["model"]),
                        xytext=(6, -9), textcoords="offset points", fontsize=5.5,
                        color=C["red"], arrowprops=dict(arrowstyle="-", lw=0.5, color=C["red"]))
    ax.set_xlim(0.45, 1.02); ax.set_ylim(0.25, 1.03)
    ax.set_xlabel("Attainable ceiling  $\\sqrt{d/n_0}$")
    ax.set_ylabel("GNN tie-aware $\\tau_b$")
    ax.set_title(label)
    ax.text(0.04, 0.94, f"n={len(rows)} folds", transform=ax.transAxes, fontsize=7, va="top")


def fig_ceiling():
    fs = json.loads((A / "final_stats.json").read_text(encoding="utf-8"))
    r42 = list(fs["ranking_42"]["per_fold"].values())
    r38 = list(fs["ranking_38"]["per_fold"].values())
    # per_fold is a dict; rebuild names
    r42 = [dict(name=k, **v) for k, v in fs["ranking_42"]["per_fold"].items()]
    r38 = [dict(name=k, **v) for k, v in fs["ranking_38"]["per_fold"].items()]
    fig, axes = plt.subplots(1, 2, figsize=(7.16, 3.0), sharey=True)
    scatter_cohort(axes[0], r42, "(a) Primary cohort: 42 estates")
    scatter_cohort(axes[1], r38, "(b) Repacked cohort: 38 estates")
    axes[1].set_ylabel("")
    fig.tight_layout(pad=0.4)
    fig.savefig(FIG / "fig_ceiling.pdf", bbox_inches="tight")
    plt.close(fig)


def fig_pairs():
    # 7 assets: 6 share key size 2048 (tied), 1 has 256; 6 cross pairs,
    # 15 within-group ties. One cross pair is inverted by the model.
    n = 7
    M = np.zeros((n, n))
    for i in range(n):
        for j in range(n):
            if i == j:
                M[i, j] = 0
            elif i < 6 and j < 6:
                M[i, j] = 1  # tied within the large group
            else:
                M[i, j] = 2  # distinguishable
    # the model puts the singleton above the last large asset: invert one pair
    M[5, 6] = 3
    M[6, 5] = 3
    cmap = matplotlib.colors.ListedColormap([ "white", C["light"], C["blue"], C["red"]])
    fig, ax = plt.subplots(figsize=(3.35, 3.0))
    ax.imshow(M, cmap=cmap, vmin=0, vmax=3)
    ax.set_xticks(range(n)); ax.set_yticks(range(n))
    ax.set_xticklabels([f"$a_{i+1}$" for i in range(6)] + ["$b$"], fontsize=6)
    ax.set_yticklabels([f"$a_{i+1}$" for i in range(6)] + ["$b$"], fontsize=6)
    ax.set_xlabel("asset"); ax.set_ylabel("asset")
    ax.set_title("21 pairs: 15 tied, 6 distinguishable")
    for i in range(n):
        for j in range(n):
            if M[i, j] == 3:
                ax.text(j, i, "×", ha="center", va="center", fontsize=8, color="white")
    # legend
    from matplotlib.patches import Patch
    ax.legend(handles=[Patch(color=C["light"], label="tied (ignored)"),
                       Patch(color=C["blue"], label="concordant"),
                       Patch(color=C["red"], label="discordant")],
              loc="upper center", bbox_to_anchor=(0.5, -0.18), ncol=3, frameon=False, fontsize=6)
    fig.tight_layout(pad=0.3)
    fig.savefig(FIG / "fig_pairs.pdf", bbox_inches="tight")
    plt.close(fig)


def fig_ablation():
    fs = json.loads((A / "final_stats.json").read_text(encoding="utf-8"))
    ab = fs["field_audit"]["cohort_42"]["ablation_order_changes"]
    labels = ["key size", "criticality", "vendor", "deadline", "dependency"]
    vals = [ab[k] for k in ["key_size", "criticality", "vendor", "deadline", "dependency"]]
    fig, ax = plt.subplots(figsize=(3.35, 2.2))
    bars = ax.barh(labels, vals, color=[C["red"]] + [C["gray"]] * 4, height=0.6)
    for b, v in zip(bars, vals):
        ax.text(v + 0.6, b.get_y() + b.get_height() / 2, f"{v}/42", va="center", fontsize=7)
    ax.set_xlim(0, 42); ax.set_xlabel("estates whose doctrine order changes")
    ax.set_title("Leave-one-term-out ablation")
    fig.tight_layout(pad=0.3)
    fig.savefig(FIG / "fig_ablation.pdf", bbox_inches="tight")
    plt.close(fig)


def fig_discovery():
    cb = json.loads((A / "codebert_eval.json").read_text(encoding="utf-8"))
    rc = cb["risk_coverage"]
    cov = [r["coverage"] for r in rc]
    f1 = [r["f1"] for r in rc]
    prec = [r["precision"] for r in rc]
    fig, axes = plt.subplots(1, 2, figsize=(7.16, 2.7))
    ax = axes[0]
    ax.plot(cov, f1, marker="o", ms=3, color=C["blue"], label="F1")
    ax.plot(cov, prec, marker="s", ms=3, color=C["orange"], label="precision")
    ax.axhline(cb["f1"], color=C["gray"], ls=":", lw=0.8, label="full-coverage F1")
    ax.set_xlabel("coverage (fraction auto-labelled)")
    ax.set_ylabel("score")
    ax.set_ylim(0.85, 1.005)
    ax.legend(frameon=False, loc="lower left")
    ax.set_title("(a) Selective prediction")
    ax = axes[1]
    langs = [x for x in cb["per_language"] if x["n"] >= 10]
    langs = sorted(langs, key=lambda x: -x["n"])
    xs = np.arange(len(langs))
    ax.bar(xs, [x["f1"] for x in langs], color=C["blue"], width=0.65)
    for i, x in enumerate(langs):
        ax.text(i, x["f1"] + 0.02, f"{x['n']}", ha="center", fontsize=5.5, color=C["gray"])
    ax.set_xticks(xs); ax.set_xticklabels([x["language"] for x in langs], rotation=30, ha="right")
    ax.set_ylim(0, 1.08); ax.set_ylabel("F1")
    ax.set_title("(b) Per-language F1 (n$\\geq$10)")
    fig.tight_layout(pad=0.4)
    fig.savefig(FIG / "fig_discovery.pdf", bbox_inches="tight")
    plt.close(fig)


def fig_positive():
    pc = json.loads((A / "positive_control.json").read_text(encoding="utf-8"))["summary"]
    fs = json.loads((A / "final_stats.json").read_text(encoding="utf-8"))
    real_ceiling = fs["ranking_42"]["mean_ceiling"]
    real_doctrine = fs["ranking_42"]["mean_doctrine"]
    real_model = fs["ranking_42"]["mean_model"]
    fig, ax = plt.subplots(figsize=(3.35, 2.5))
    groups = ["Real TLS corpus", "Synthetic positive control"]
    methods = ["ceiling", "doctrine", "GNN"]
    colors = [C["gray"], C["green"], C["blue"]]
    width = 0.26
    for k, (m, c) in enumerate(zip(methods, colors)):
        vals = [{"ceiling": real_ceiling, "doctrine": real_doctrine, "GNN": real_model}[m],
                {"ceiling": pc["ceiling"]["mean"], "doctrine": pc["doctrine"]["mean"],
                 "GNN": pc["gnn"]["mean"]}[m]]
        ax.bar(np.arange(2) + (k - 1) * width, vals, width, color=c,
               label={"ceiling": "ceiling", "doctrine": "doctrine", "GNN": "GNN"}[m])
        for i, v in enumerate(vals):
            ax.text(i + (k - 1) * width, v + 0.01, f"{v:.3f}", ha="center", fontsize=5.5)
    ax.set_xticks([0, 1]); ax.set_xticklabels(groups, fontsize=7)
    ax.set_ylim(0.5, 1.05); ax.set_ylabel("tie-aware $\\tau_b$")
    ax.legend(frameon=False, ncol=3, loc="upper left", fontsize=6)
    fig.tight_layout(pad=0.3)
    fig.savefig(FIG / "fig_positive.pdf", bbox_inches="tight")
    plt.close(fig)


if __name__ == "__main__":
    fig_ceiling(); fig_pairs(); fig_ablation(); fig_discovery(); fig_positive()
    print("wrote", sorted(p.name for p in FIG.glob("*.pdf")))
