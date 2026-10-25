"""compare.py — p95 (ms) per scenario row, one column per stage, from results/SUMMARY.csv.

  python3 compare.py [STAGE …]        # default: every non-mock stage, in ladder order
"""
import csv, sys

rows = [r for r in csv.DictReader(open("results/SUMMARY.csv")) if "mock" not in r["stage"]]
stages = sys.argv[1:] or sorted({r["stage"] for r in rows}, key=lambda s: (s.split("-")[0], "load" in s, s))
table = {}
for r in rows:
    table.setdefault(r["scenario"], {})[r["stage"]] = r
print("| scenario | " + " | ".join(stages) + " |")
print("|---|" + "---:|" * len(stages))
for scen in sorted(table):
    cells = []
    for s in stages:
        r = table[scen].get(s)
        cells.append("" if not r else f"{float(r['p95']):.0f}" + (f" ({float(r['edge_hit']):.0%} hit)" if r["edge_hit"] not in ("", "0", "0.0") and float(r["edge_hit"]) > 0 else ""))
    if any(cells):
        print(f"| {scen} | " + " | ".join(cells) + " |")
