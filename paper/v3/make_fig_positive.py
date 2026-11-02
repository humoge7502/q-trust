"""Regenerate fig_positive with a layout that does not collide with the bars.

Same data as scripts/paper_figures.py:fig_positive, read from the audited
artifacts in paper/analysis/. Only the presentation changes.
"""
from __future__ import annotations
import json
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

ROOT = Path(__file__).resolve().parent.parent.parent
A = ROOT / "paper" / "analysis"
FIG = ROOT / "paper" / "v3" / "figures"
FIG.mkdir(parents=True, exist_ok=True)

plt.rcParams.update({
    "font.family": "serif", "font.size": 8, "axes.labelsize": 8,
    "axes.titlesize": 9, "legend.fontsize": 7, "xtick.labelsize": 7,
    "ytick.labelsize": 7, "axes.spines.top": False, "axes.spines.right": False,
})
C = {"blue": "#2b6cb0", "red": "#c53030", "gray": "#718096", "green": "#2f855a",
     "orange": "#c05621", "light": "#cbd5e0"}

pc = json.loads((A / "positive_control.json").read_text(encoding="utf-8"))["summary"]
fs = json.loads((A / "final_stats.json").read_text(encoding="utf-8"))
r42 = fs["ranking_42"]

rows = {
    "ceiling": [r42["mean_ceiling"], pc["ceiling"]["mean"]],
    "doctrine": [r42["mean_doctrine"], pc["doctrine"]["mean"]],
    "GNN": [r42["mean_model"], pc["gnn"]["mean"]],
}
labels = {"ceiling": "ceiling", "doctrine": "doctrine", "GNN": "GNN"}
colors = {"ceiling": C["gray"], "doctrine": C["green"], "GNN": C["blue"]}

fig, ax = plt.subplots(figsize=(3.4, 2.35))
groups = ["Real TLS corpus\n(ceiling $\\approx$ 0.72)", "Synthetic positive control\n(ceiling $\\approx$ 1.00)"]
width = 0.25
x = np.arange(2)

for k, m in enumerate(["ceiling", "doctrine", "GNN"]):
    vals = rows[m]
    bars = ax.bar(x + (k - 1) * width, vals, width, color=colors[m],
                  label=labels[m], edgecolor="white", linewidth=0.4)
    for b, v in zip(bars, vals):
        ax.text(b.get_x() + b.get_width() / 2, v + 0.008, f"{v:.3f}",
                ha="center", va="bottom", fontsize=5.6)

ax.set_xticks(x)
ax.set_xticklabels(groups, fontsize=6.5)
ax.set_ylim(0.0, 1.20)
ax.set_yticks([0.0, 0.2, 0.4, 0.6, 0.8, 1.0])
ax.set_ylabel("tie-aware $\\tau_b$")
ax.axhline(1.0, color=C["light"], lw=0.7, zorder=0)
ax.legend(frameon=False, ncol=3, loc="upper center", bbox_to_anchor=(0.5, 1.14),
          handlelength=1.2, columnspacing=1.2, borderaxespad=0.0)
fig.tight_layout(pad=0.3)
fig.savefig(FIG / "fig_positive.pdf", bbox_inches="tight")
print("wrote", FIG / "fig_positive.pdf")
