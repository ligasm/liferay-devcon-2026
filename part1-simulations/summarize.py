#!/usr/bin/env python3
"""
summarize.py — turn results/<stage>/<scenario>.summary.json files into slide-ready
tables and charts.

Reads   results/*/*.summary.json   (written by the shared handleSummary())
        results/*/*.json           (k6 --summary-export, used only when no .summary.json exists)
Writes  results/SUMMARY.md         stage × scenario table (Markdown)
        results/SUMMARY.csv        same data, machine-readable
        results/DELTAS.md          % change vs the S0 baseline, per stage
        results/p95-by-stage.png   } only if matplotlib is importable
        results/throughput-by-stage.png }

Usage:  python3 summarize.py [--results DIR] [--baseline STAGE] [--no-charts]

Python 3.8+, standard library only; matplotlib is optional.
"""
from __future__ import annotations

import argparse
import csv
import glob
import json
import os
import re
import sys
from collections import OrderedDict

COLUMNS = [
    # key,            header,                    fmt
    ("rps",          "req/s",                    lambda v: f"{v:.1f}"),
    ("p50",          "p50 ms",                   lambda v: f"{v:.0f}"),
    ("p95",          "p95 ms",                   lambda v: f"{v:.0f}"),
    ("p99",          "p99 ms",                   lambda v: f"{v:.0f}"),
    ("ttfb_p95",     "TTFB p95 ms",              lambda v: f"{v:.0f}"),
    ("error_rate",   "errors",                   lambda v: f"{v*100:.2f}%"),
    ("edge_hit",     "edge hit",                 lambda v: f"{v*100:.0f}%"),
    ("set_cookie",   "set-cookie on guest",      lambda v: f"{v*100:.0f}%"),
    ("cc_private",   "cache-control private",    lambda v: f"{v*100:.0f}%"),
]
# for DELTAS.md: which direction is "better"
LOWER_IS_BETTER = {"p50", "p95", "p99", "ttfb_p95", "error_rate", "set_cookie", "cc_private"}


# ----------------------------------------------------------------------------- loading
def stage_sort_key(label: str):
    m = re.match(r"^S(\d+)", label)
    return (int(m.group(1)) if m else 999, label)


def load_summary(path: str) -> dict | None:
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, ValueError) as e:
        print(f"!! skipping {path}: {e}", file=sys.stderr)
        return None
    if "metrics" not in data:
        return None
    return data


def metric_values(metrics: dict, name: str) -> dict:
    """Works for both handleSummary data ({values: {...}}) and legacy --summary-export (flat)."""
    m = metrics.get(name)
    if not m:
        return {}
    if "values" in m:
        return m["values"]
    flat = {k: v for k, v in m.items() if k != "thresholds"}
    if "value" in flat and "rate" not in flat:  # legacy Rate metric
        flat["rate"] = flat["value"]
    return flat


def row_from(metrics: dict, suffix: str = "") -> dict | None:
    """Build one table row from (possibly tag-suffixed) metrics, e.g. suffix='{scenario:login}'."""
    dur = metric_values(metrics, f"http_req_duration{suffix}")
    reqs = metric_values(metrics, f"http_reqs{suffix}") or metric_values(metrics, "http_reqs")
    if not dur or not reqs.get("count"):
        return None
    failed = metric_values(metrics, f"http_req_failed{suffix}") or metric_values(metrics, "http_req_failed")
    ttfb = metric_values(metrics, f"ttfb{suffix}") or metric_values(metrics, "ttfb")
    edge = metric_values(metrics, f"edge_hit{suffix}") or metric_values(metrics, "edge_hit")
    setc = metric_values(metrics, f"set_cookie_on_guest{suffix}") or metric_values(metrics, "set_cookie_on_guest")
    ccp = metric_values(metrics, f"cache_control_private{suffix}") or metric_values(metrics, "cache_control_private")

    def rate(m):
        if not m:
            return None
        if (m.get("passes", 0) + m.get("fails", 0)) == 0:
            return None
        return m.get("rate", m.get("value"))

    return {
        "requests": reqs.get("count"),
        "rps": reqs.get("rate"),
        "p50": dur.get("med", dur.get("p(50)")),
        "p95": dur.get("p(95)"),
        "p99": dur.get("p(99)"),
        "ttfb_p95": ttfb.get("p(95)"),
        "error_rate": rate(failed),
        "edge_hit": rate(edge),
        "set_cookie": rate(setc),
        "cc_private": rate(ccp),
    }


def collect(results_dir: str) -> "OrderedDict[str, OrderedDict[str, dict]]":
    """{stage: {row_name: row}} — one row per script, plus per-scenario rows for multi-scenario scripts."""
    files: dict[tuple[str, str], str] = {}
    for path in sorted(glob.glob(os.path.join(results_dir, "*", "*.json"))):
        stage = os.path.basename(os.path.dirname(path))
        base = os.path.basename(path)
        if base.endswith(".summary.json"):
            scenario = base[: -len(".summary.json")]
            files[(stage, scenario)] = path                     # preferred
        elif base.endswith(".json"):
            scenario = base[: -len(".json")]
            files.setdefault((stage, scenario), path)            # legacy fallback

    table: "OrderedDict[str, OrderedDict[str, dict]]" = OrderedDict()
    for (stage, scenario), path in sorted(files.items(), key=lambda kv: (stage_sort_key(kv[0][0]), kv[0][1])):
        data = load_summary(path)
        if not data:
            continue
        metrics = data["metrics"]
        rows = table.setdefault(stage, OrderedDict())

        sub = sorted({m[len("http_req_duration"):] for m in metrics
                      if m.startswith("http_req_duration{scenario:")})
        if len(sub) > 1:
            total = row_from(metrics)
            if total:
                rows[f"{scenario} (all)"] = total
            for suffix in sub:
                name = re.search(r"scenario:([^}]+)", suffix).group(1)
                r = row_from(metrics, suffix)
                if r:
                    rows[f"{scenario}/{name}"] = r
        else:
            r = row_from(metrics, sub[0] if sub else "")
            if r:
                rows[scenario] = r
        # optional html/asset split (guest-browse with WITH_ASSETS=1)
        for t in ("html", "asset"):
            r = row_from(metrics, f"{{type:{t}}}")
            if r and f"http_reqs{{type:{t}}}" in metrics and t == "asset":
                rows[f"{scenario}/{t}"] = r
    return table


# ----------------------------------------------------------------------------- output
def fmt(key, v):
    if v is None:
        return "–"
    for k, _, f in COLUMNS:
        if k == key:
            return f(v)
    return str(v)


def write_summary_md(table, path):
    lines = ["# Load-test summary", "",
             "Generated by `summarize.py` from `results/<stage>/<scenario>.summary.json`.  ",
             "Durations are k6 `http_req_duration` (full response); TTFB is `res.timings.waiting`.  ",
             "`edge hit` = share of responses served by an edge cache (cf-cache-status / x-cache / x-varnish / Age).  ",
             "`set-cookie on guest` = anonymous requests that received a `Set-Cookie`; `cache-control private` = responses a shared cache must not store.", ""]
    header = "| stage | scenario | " + " | ".join(h for _, h, _ in COLUMNS) + " |"
    sep = "|---|---|" + "|".join("---:" for _ in COLUMNS) + "|"
    for stage, rows in table.items():
        lines += [f"## {stage}", "", header, sep]
        for name, r in rows.items():
            lines.append(f"| {stage} | {name} | " + " | ".join(fmt(k, r.get(k)) for k, _, _ in COLUMNS) + " |")
        lines.append("")
    # cross-stage pivot for the headline metrics
    scenarios = OrderedDict()
    for rows in table.values():
        for name in rows:
            scenarios.setdefault(name, None)
    stages = list(table.keys())
    for key, title in (("p95", "p95 response time (ms) by stage"), ("rps", "throughput (req/s) by stage"), ("edge_hit", "edge hit ratio by stage")):
        lines += [f"## {title}", "", "| scenario | " + " | ".join(stages) + " |", "|---|" + "|".join("---:" for _ in stages) + "|"]
        for name in scenarios:
            lines.append(f"| {name} | " + " | ".join(fmt(key, table[s].get(name, {}).get(key)) for s in stages) + " |")
        lines.append("")
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))


def write_summary_csv(table, path):
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["stage", "scenario", "requests"] + [k for k, _, _ in COLUMNS])
        for stage, rows in table.items():
            for name, r in rows.items():
                w.writerow([stage, name, r.get("requests")] + ["" if r.get(k) is None else f"{r[k]:.4f}" for k, _, _ in COLUMNS])


def pick_baseline(stages: list[str], stage: str, override: str | None) -> str | None:
    if override:
        return override if override in stages else None
    mock = stage.endswith("-mock")
    for s in stages:
        if s.startswith("S0") and s.endswith("-mock") == mock:
            return s
    for s in stages:
        if s.startswith("S0"):
            return s
    return None


def write_deltas_md(table, path, baseline_override=None):
    stages = list(table.keys())
    lines = ["# Change vs S0 baseline", "",
             "Percent change of each metric relative to the S0 row of the same scenario "
             "(negative is better for latency/error/cookie columns, positive is better for req/s and edge hit). "
             "Rows are skipped when the baseline has no matching scenario.", ""]
    keys = [("rps", "req/s"), ("p50", "p50"), ("p95", "p95"), ("p99", "p99"), ("ttfb_p95", "TTFB p95"),
            ("error_rate", "errors"), ("edge_hit", "edge hit"), ("set_cookie", "set-cookie"), ("cc_private", "cc private")]
    for stage in stages:
        base = pick_baseline(stages, stage, baseline_override)
        if not base or base == stage:
            continue
        lines += [f"## {stage} vs {base}", "", "| scenario | " + " | ".join(h for _, h in keys) + " |",
                  "|---|" + "|".join("---:" for _ in keys) + "|"]
        for name, r in table[stage].items():
            b = table[base].get(name)
            if not b:
                continue
            cells = []
            for k, _ in keys:
                cur, ref = r.get(k), b.get(k)
                if cur is None or ref is None:
                    cells.append("–")
                elif k in ("edge_hit", "set_cookie", "cc_private", "error_rate"):
                    # rates: show absolute percentage-point change (more readable than % of a %)
                    d = (cur - ref) * 100
                    cells.append(f"{d:+.0f} pp")
                elif ref == 0:
                    cells.append("n/a")
                else:
                    d = (cur - ref) / ref * 100
                    if abs(d) < 0.5:
                        d = 0.0
                    better = (d < 0) if k in LOWER_IS_BETTER else (d > 0)
                    cells.append(f"{d:+.0f}% {'✓' if better and abs(d) >= 5 else ''}".rstrip())
            lines.append(f"| {name} | " + " | ".join(cells) + " |")
        lines.append("")
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))


# ----------------------------------------------------------------------------- charts
# Fixed-order categorical palette (colour follows the scenario, never its rank).
PALETTE = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7", "#e34948"]
INK, MUTED, GRID, SURFACE = "#0b0b0b", "#898781", "#e1e0d9", "#fcfcfb"


def chart(table, key, ylabel, title, path, hide_zero=False):
    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
    except ImportError:
        print("matplotlib not installed — skipping charts (pip install matplotlib)")
        return False

    stages = list(table.keys())
    # Only top-level rows (no "/sub" rows, no "(all)" duplicates) keep the chart readable
    names = []
    for rows in table.values():
        for n in rows:
            n = n[:-len(" (all)")] if n.endswith(" (all)") else n
            if n not in names and "/" not in n:
                names.append(n)
    # multi-scenario scripts contribute their "(all)" row under the plain name
    def value(stage, name):
        rows = table[stage]
        r = rows.get(name) or rows.get(f"{name} (all)")
        return None if not r else r.get(key)

    names = names[:8]  # a 9th series folds into the table, never a generated hue
    if not names or not stages:
        return False

    plt.rcParams.update({"font.size": 16, "font.family": "DejaVu Sans"})
    fig, ax = plt.subplots(figsize=(12, 6.5), dpi=150)
    fig.patch.set_facecolor(SURFACE)
    ax.set_facecolor(SURFACE)
    x = list(range(len(stages)))
    last_points = []
    for i, name in enumerate(names):
        ys = [value(s, name) for s in stages]
        ax.plot(x, ys, marker="o", markersize=9, linewidth=2.2, color=PALETTE[i], label=name,
                markeredgecolor=SURFACE, markeredgewidth=2)
        for xi in reversed(x):
            if ys[xi] is not None:
                last_points.append((xi, ys[xi]))
                break
    # Direct-label the last point of each series (selective labels, never every point),
    # collapsing labels that would collide into one.
    ymax = max((y for _, y in last_points), default=0) or 1
    placed = []
    for xi, y in sorted(last_points, key=lambda t: t[1]):
        if any(abs(y - py) < ymax * 0.05 and xi == px for px, py in placed):
            continue
        ax.annotate(f"{y:.0f}", (xi, y), textcoords="offset points", xytext=(10, 0),
                    fontsize=13, color=INK, va="center")
        placed.append((xi, y))
    ax.set_xticks(x)
    ax.set_xticklabels(stages, fontsize=15)
    ax.set_ylabel(ylabel, color=MUTED, fontsize=14)
    ax.set_title(title, loc="left", fontsize=19, color=INK, pad=14)
    ax.grid(axis="y", color=GRID, linewidth=1)
    ax.set_axisbelow(True)
    for spine in ("top", "right", "left"):
        ax.spines[spine].set_visible(False)
    ax.spines["bottom"].set_color(GRID)
    ax.tick_params(colors=MUTED, length=0)
    ax.set_ylim(bottom=0)
    ax.margins(x=0.08)
    ax.legend(frameon=False, fontsize=13, ncol=2, loc="upper left", bbox_to_anchor=(0, -0.10))
    fig.tight_layout()
    fig.savefig(path, facecolor=SURFACE)
    plt.close(fig)
    return True


# ----------------------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--results", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "results"))
    ap.add_argument("--baseline", help="stage label to use as the baseline for DELTAS.md (default: first S0*)")
    ap.add_argument("--no-charts", action="store_true")
    args = ap.parse_args()

    table = collect(args.results)
    if not table:
        print(f"no results found under {args.results}/<stage>/*.json — run ./run.sh first", file=sys.stderr)
        sys.exit(1)

    out = args.results
    write_summary_md(table, os.path.join(out, "SUMMARY.md"))
    write_summary_csv(table, os.path.join(out, "SUMMARY.csv"))
    write_deltas_md(table, os.path.join(out, "DELTAS.md"), args.baseline)
    print(f"stages: {', '.join(table)}")
    for stage, rows in table.items():
        print(f"  {stage}: {len(rows)} rows")
    print(f"wrote {out}/SUMMARY.md, SUMMARY.csv, DELTAS.md")

    if not args.no_charts:
        ok = chart(table, "p95", "http_req_duration p95 (ms)", "p95 response time by stage", os.path.join(out, "p95-by-stage.png"))
        ok = chart(table, "rps", "requests / second", "Throughput by stage", os.path.join(out, "throughput-by-stage.png")) and ok
        if ok:
            print(f"wrote {out}/p95-by-stage.png, throughput-by-stage.png")


if __name__ == "__main__":
    main()
