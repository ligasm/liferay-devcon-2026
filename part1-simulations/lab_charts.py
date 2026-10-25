"""lab_charts.py — the three charts for results/LAB-RESULTS.md (local lab, real Liferay).

Reads results/SUMMARY.csv (run summarize.py first) and results/<stage>-load/docker-stats.txt.
Writes results/lab-p95-under-load.png, results/lab-origin-cpu.png, results/lab-origin-edge-static.png.
Needs matplotlib.   python3 lab_charts.py

Palette: reference categorical slots 1–3 (blue, orange, aqua), validated adjacent and
all-pairs in light mode; every bar carries a direct value label (aqua is < 3:1 on the
surface, so the label — in text ink — carries the value, not the colour).
"""
import csv
import os

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
RES = os.path.join(HERE, "results")
SURFACE, INK, INK2, GRID = "#fcfcfb", "#0b0b0b", "#52514e", "#e4e3df"
SERIES = ["#2a78d6", "#eb6834", "#1baf7a"]

rows = {(r["stage"], r["scenario"]): r for r in csv.DictReader(open(os.path.join(RES, "SUMMARY.csv")))}
p95 = lambda stage, scen: float(rows[(stage, scen)]["p95"])

LADDER = [("S0-baseline", "S0\nbaseline"), ("S1-hygiene", "S1\nhygiene"), ("S2-jvm-caches", "S2\nJVM caches"),
          ("S3-frontend", "S3\nfront-end"), ("S4-edge-varnish", "S4\nVarnish edge")]


def style(ax, title, xlabel):
    ax.set_facecolor(SURFACE)
    ax.set_title(title, loc="left", fontsize=13, color=INK, fontweight="bold", pad=14)
    ax.set_xlabel(xlabel, color=INK2, fontsize=10)
    ax.tick_params(colors=INK2, labelsize=10, length=0)
    for side in ("top", "right", "left"):
        ax.spines[side].set_visible(False)
    ax.spines["bottom"].set_color(GRID)
    ax.xaxis.grid(True, color=GRID, linewidth=0.8)
    ax.set_axisbelow(True)


def label_bars(ax, bars, fmt="{:.0f} ms"):
    xmax = ax.get_xlim()[1]
    for b in bars:
        w = b.get_width()
        ax.text(w + xmax * 0.008, b.get_y() + b.get_height() / 2, fmt.format(w), va="center", ha="left", fontsize=9, color=INK)


def save(fig, name):
    fig.patch.set_facecolor(SURFACE)
    fig.tight_layout()
    fig.savefig(os.path.join(RES, name), dpi=160, facecolor=SURFACE)
    print("wrote results/" + name)


# 1. p95 under load per stage: guest page / Asset Publisher page / search ------------
series = [("mix/guest_browse", "Guest content page"), ("mix/ap_page", "Asset Publisher page"), ("mix/search", "Search")]
fig, ax = plt.subplots(figsize=(10, 6.2))
h = 0.26
for i, (scen, name) in enumerate(series):
    ys = [n - (i - 1) * (h + 0.02) for n in range(len(LADDER))]
    vals = [p95(f"{s}-load", scen) for s, _ in LADDER]
    bars = ax.barh(ys, vals, height=h, color=SERIES[i], label=name, edgecolor=SURFACE, linewidth=2)
    ax.set_xlim(0, max(p95(f"{s}-load", "mix/search") for s, _ in LADDER) * 1.12)
    label_bars(ax, bars)
ax.set_yticks(range(len(LADDER)))
ax.set_yticklabels([l for _, l in LADDER])
ax.invert_yaxis()
style(ax, "p95 response time under moderate load (mix, ≈ 120 req/s)", "p95 ms — lower is better")
ax.legend(frameon=False, loc="lower right", fontsize=10, labelcolor=INK)
save(fig, "lab-p95-under-load.png")


# 2. origin CPU under load (Liferay container, p90 of 10 s samples) ---------------------
def cpu_p90(stage):
    path = os.path.join(RES, f"{stage}-load", "docker-stats.txt")
    if not os.path.exists(path):
        return None
    v = sorted(float(l.split()[1].rstrip("%")) for l in open(path) if l.strip())
    return v[int(len(v) * 0.9) - 1] / 100 if v else None


stages = [(s, l) for s, l in LADDER if cpu_p90(s) is not None]
fig, ax = plt.subplots(figsize=(10, 4.4))
vals = [cpu_p90(s) for s, _ in stages]
bars = ax.barh(range(len(stages)), vals, height=0.55, color=SERIES[0], edgecolor=SURFACE, linewidth=2)
ax.set_xlim(0, max(vals) * 1.18)
label_bars(ax, bars, "{:.1f} cores")
ax.set_yticks(range(len(stages)))
ax.set_yticklabels([l for _, l in stages])
ax.invert_yaxis()
style(ax, "Liferay CPU during the load run (p90 of 10 s samples)", "CPU cores busy (20-core host)")
save(fig, "lab-origin-cpu.png")

# 3. same guest load, three ways of serving it -------------------------------------------
three = [("S3-frontend-gb80", "Liferay origin\n(S3 config)"), ("S4-edge-varnish-gb80", "Varnish edge\n(S4)"), ("S6-static-gb80", "Static files\n(S6, nginx)")]
fig, ax = plt.subplots(figsize=(10, 4.2))
for i, (key, name) in enumerate([("p95", "p95"), ("p99", "p99")]):
    ys = [n + (i - 0.5) * 0.36 for n in range(len(three))]
    vals = [float(rows[(s, "guest-browse")][key]) for s, _ in three]
    bars = ax.barh(ys, vals, height=0.34, color=SERIES[i], label=name, edgecolor=SURFACE, linewidth=2)
    ax.set_xlim(0, max(float(rows[(s, "guest-browse")]["p99"]) for s, _ in three) * 1.2)
    label_bars(ax, bars, "{:.1f} ms")
ax.set_yticks(range(len(three)))
ax.set_yticklabels([l for _, l in three])
ax.invert_yaxis()
style(ax, f"Same guest traffic (guest-browse, ≈{float(rows[(three[0][0], 'guest-browse')]['rps']):.0f} req/s), three ways to serve it", "ms — lower is better")
ax.legend(frameon=False, loc="lower right", fontsize=10, labelcolor=INK)
save(fig, "lab-origin-edge-static.png")
