#!/usr/bin/env python3
"""rungs_report.py: the comparison tables behind results/RUNG-RESULTS.md.

Reads results/stress/<label>/step-<rate>.{summary.json,stats.csv} for the labels written by
rungs-campaign.sh and prints Markdown: one table per workload, every rung at the same rates.

CPU is the mean over the step, without the first 10 s, for the serving containers only: k6 runs
on the same box and is reported separately, so it never counts as server cost.
"""
import csv
import json
import os
import sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "results", "stress")
SERVERS = ("liferay26112_cores", "liferay-varnish_cores", "proventeq-fidelity_cores")
PAGES = [("R1 stock", "R1-S0-pages"), ("R2 Cacheable", "R2-S2-pages"), ("S3 G1", "S3-G1-pages"),
         ("S3 ZGC", "S3-ZGC-pages"), ("R4 edge HTML", "R4-edge-html-pages"), ("R5 static", "R5-static-pages")]
VIEWS = [("R1 stock", "R1-S0-pageview"), ("R2 Cacheable", "R2-S2-pageview"),
         ("R3 edge assets", "R3-edge-assets-pageview"), ("R4 edge HTML", "R4-edge-html-pageview"),
         ("R5 static", "R5-static-pageview")]


def step(label, rate):
    base = os.path.join(ROOT, label, f"step-{rate}")
    if not os.path.exists(base + ".summary.json"):
        return None
    m = json.load(open(base + ".summary.json"))["metrics"]
    v = lambda k, f, d=0: m.get(k, {}).get("values", {}).get(f, d)
    rows = [r for r in csv.DictReader(open(base + ".stats.csv")) if float(r["t"]) > 10]
    mean = lambda col: sum(float(r.get(col) or 0) for r in rows) / max(1, len(rows))
    per = {c: mean(c) for c in SERVERS}
    it, dropped = v("iterations", "count"), v("dropped_iterations", "count")
    secs = 60
    return {
        "rate": rate, "achieved": it / secs, "req_s": v("http_reqs", "rate"),
        "drop": 100 * dropped / max(1, it + dropped), "err": 100 * v("http_req_failed", "rate"),
        "checks": 100 * v("checks", "rate", 1),
        "http_p95": v("http_req_duration", "p(95)"), "http_p50": v("http_req_duration", "med"),
        "pv_p50": v("page_view_duration", "med"), "pv_p95": v("page_view_duration", "p(95)"),
        "kb_per_iter": v("data_received", "count") / max(1, it) / 1024,
        "reqs_per_iter": v("http_reqs", "count") / max(1, it),
        "server": sum(per.values()), "liferay": per[SERVERS[0]], "varnish": per[SERVERS[1]], "nginx": per[SERVERS[2]],
        "k6": mean("k6_cores"), "host": mean("host_cores"),
    }


def steps(label):
    d = os.path.join(ROOT, label)
    if not os.path.isdir(d):
        return []
    rates = sorted(int(f[5:-13]) for f in os.listdir(d) if f.endswith(".summary.json") and f.startswith("step-"))
    return [s for s in (step(label, r) for r in rates) if s]


def clean(s, latency="http_p95"):
    return s["drop"] < 1 and s["err"] < 1 and s[latency] < 2000 and s["checks"] > 99


def table(rungs, rates, latency):
    print(f"| Rung | Rate/s | {'Page view p95' if latency == 'pv_p95' else 'HTML p95'} | Server cores | Liferay | Varnish | nginx | CPU ms per unit | k6 cores | Dropped | Errors |")
    print("|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|")
    for name, label in rungs:
        for rate in rates:
            s = step(label, rate)
            if not s:
                continue
            cost = 1000 * s["server"] / max(1, s["achieved"])
            print(f"| {name} | {rate:,} | {s[latency]:.1f} ms | {s['server']:.2f} | {s['liferay']:.2f} | {s['varnish']:.2f} | {s['nginx']:.2f} | {cost:.2f} | {s['k6']:.1f} | {s['drop']:.1f} % | {s['err']:.2f} % |")


def capacity(rungs, latency):
    print("| Rung | Highest clean rate/s | p95 there | Server cores there | k6 cores there | First failed step |")
    print("|---|---:|---:|---:|---:|---|")
    for name, label in rungs:
        ss = steps(label)
        if not ss:
            continue
        good, bad = None, None
        for s in ss:
            if clean(s, latency):
                good = s
            else:
                bad = s
                break
        if good is None:
            print(f"| {name} | none | | | | {bad['rate'] if bad else ''} |")
            continue
        fail = f"{bad['rate']:,}/s: {bad['achieved']:,.0f} achieved, {bad['drop']:.1f} % dropped, {bad['err']:.2f} % errors" if bad else "none, top of the ladder"
        print(f"| {name} | {good['achieved']:,.0f} | {good[latency]:.1f} ms | {good['server']:.2f} | {good['k6']:.1f} | {fail} |")


if __name__ == "__main__":
    print("## HTML only at common rates\n")
    table(PAGES, [100, 200, 400, 800, 1200], "http_p95")
    print("\n## Whole page views at common rates\n")
    table(VIEWS, [5, 20, 80, 200], "pv_p95")
    print("\n## Clean capacity, HTML only\n")
    capacity(PAGES, "http_p95")
    print("\n## Clean capacity, whole page views\n")
    capacity(VIEWS, "pv_p95")
    print("\n## Size of one page view\n")
    print("| Rung | Requests | KB on the wire |\n|---|---:|---:|")
    for name, label in VIEWS:
        s = step(label, 80)
        if s:
            print(f"| {name} | {s['reqs_per_iter']:.1f} | {s['kb_per_iter']:.0f} |")
    print("\n## Search with highlighting on and off (S3)\n")
    print("| Highlighting | Rate/s | Search p95 | Liferay + Elasticsearch cores | CPU ms per search | Dropped |\n|---|---:|---:|---:|---:|---:|")
    for name, label in (("on", "S3-search-highlight"), ("off", "S3-search-nohighlight")):
        for s in steps(label):
            print(f"| {name} | {s['rate']:,} | {s['http_p95']:.0f} ms | {s['liferay']:.2f} | {1000 * s['liferay'] / max(1, s['achieved']):.0f} | {s['drop']:.1f} % |")
    sys.exit(0)
