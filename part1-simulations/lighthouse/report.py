#!/usr/bin/env python3
"""Summarise Lighthouse runs written by run.sh.

    report.py OUT_DIR

Prints the median per target, page and preset, and writes OUT_DIR/runs.csv with every run. The
setup checks matter as much as the numbers: a run with failed requests, or anything not served
over HTTP/2 from the front, does not compare the sites.
"""
import csv
import glob
import json
import os
import statistics
import sys
from collections import defaultdict

METRICS = [
    ("fcp_ms", "first-contentful-paint"),
    ("lcp_ms", "largest-contentful-paint"),
    ("tbt_ms", "total-blocking-time"),
    ("cls", "cumulative-layout-shift"),
    ("si_ms", "speed-index"),
    ("ttfb_ms", "server-response-time"),
    ("main_thread_ms", "mainthread-work-breakdown"),
    ("js_boot_ms", "bootup-time"),
]


def read_run(path):
    report = json.load(open(path))
    audits = report["audits"]
    row = {"path": path, "version": report["lighthouseVersion"]}
    row["benchmark"] = report["environment"]["benchmarkIndex"]
    row["error"] = report.get("runtimeError", {}).get("code", "") if report.get("runtimeError") else ""
    row["warnings"] = len(report.get("runWarnings", []))
    for key, audit in METRICS:
        row[key] = audits[audit].get("numericValue")
    row["score"] = report["categories"]["performance"]["score"]
    requests = audits["network-requests"]["details"]["items"]
    port = report["finalDisplayedUrl"].split(":")[2].split("/")[0]
    own = [r for r in requests if f"localhost:{port}" in r["url"]]
    row["requests"] = len(requests)
    row["own_requests"] = len(own)
    row["kb"] = sum(r.get("transferSize", 0) for r in requests) / 1024
    row["own_kb"] = sum(r.get("transferSize", 0) for r in own) / 1024
    row["own_not_h2"] = sum(1 for r in own if r.get("protocol") != "h2")
    row["failed"] = sum(1 for r in requests if not r.get("statusCode") or r["statusCode"] >= 400)
    row["script_kb"] = sum(r.get("transferSize", 0) for r in requests if r.get("resourceType") == "Script") / 1024
    return row


def main(out):
    rows = []
    for path in sorted(glob.glob(os.path.join(out, "*", "*", "*.json"))):
        target, page, name = path.split(os.sep)[-3:]
        row = read_run(path)
        row.update(target=target, page=page, preset=name.split("-")[0], run=name.split("-")[1].split(".")[0])
        rows.append(row)
    if not rows:
        sys.exit(f"no runs under {out}")

    fields = ["target", "page", "preset", "run", "score"] + [k for k, _ in METRICS] + [
        "requests", "own_requests", "kb", "own_kb", "script_kb", "own_not_h2", "failed", "warnings", "benchmark", "error",
    ]
    with open(os.path.join(out, "runs.csv"), "w", newline="") as f:
        writer = csv.DictWriter(f, fields, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)

    groups = defaultdict(list)
    for row in rows:
        groups[(row["page"], row["preset"], row["target"])].append(row)

    print("| page | preset | target | n | score | FCP s | LCP s | LCP range | TBT ms | TBT range | CLS | SI s | main thread s | requests | KB | script KB | not h2 | failed |")
    print("|---|---|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|")
    for (page, preset, target), group in sorted(groups.items()):
        med = lambda k: statistics.median(r[k] for r in group)
        lcp = [r["lcp_ms"] for r in group]
        tbt = [r["tbt_ms"] for r in group]
        print(
            f"| {page} | {preset} | {target} | {len(group)} | {med('score') * 100:.0f} | {med('fcp_ms') / 1000:.1f} "
            f"| {med('lcp_ms') / 1000:.1f} | {min(lcp) / 1000:.1f}–{max(lcp) / 1000:.1f} | {med('tbt_ms'):.0f} | {min(tbt):.0f}–{max(tbt):.0f} "
            f"| {med('cls'):.3f} | {med('si_ms') / 1000:.1f} | {med('main_thread_ms') / 1000:.1f} | {med('requests'):.0f} | {med('kb'):.0f} "
            f"| {med('script_kb'):.0f} | {max(r['own_not_h2'] for r in group)} | {max(r['failed'] for r in group)} |"
        )

    print()
    print(f"runs: {len(rows)} · lighthouse {rows[0]['version']} · benchmarkIndex {min(r['benchmark'] for r in rows):.0f}–{max(r['benchmark'] for r in rows):.0f}")
    errors = [r for r in rows if r["error"]]
    print(f"runtime errors: {len(errors)} · runs with warnings: {sum(1 for r in rows if r['warnings'])}")


if __name__ == "__main__":
    main(sys.argv[1])
