#!/usr/bin/env python3
"""
capture_pageview.py — record what a browser fetches on a first visit to each guest page.

    python3 capture_pageview.py <base_url> <out.json>
    python3 capture_pageview.py http://127.0.0.1:6081 k6/data/pageview-varnish.json

Headless Chromium loads every page of the `pages` workload (home, the content pages, blog,
news; paths from ../part0-base-site/dist/k6.env) with an empty profile and a net log. The
same-origin URLs it requested, page first, go to <out.json> as {path: [path, …]}, which
k6/stress.js WORKLOAD=pageview replays. Other hosts (Google Fonts) are left out, and so are
files that do not answer 200 (the static site has no /favicon.ico, which Chromium asks for).
Env: CHROMIUM (default chromium).
"""
import json, os, shlex, subprocess, sys, tempfile, urllib.error, urllib.request
from urllib.parse import urlsplit

base, out = sys.argv[1].rstrip("/"), sys.argv[2]
env = {}
for line in open(os.path.join(os.path.dirname(__file__), "../part0-base-site/dist/k6.env")):
    if line.startswith("export "):
        k, _, v = line[7:].strip().partition("=")
        env[k] = shlex.split(v)[0] if v else ""
paths = [env["HOME_PATH"], *env["CONTENT_PAGES"].split(","), env["BLOG_PATH"], env["AP_PAGE"]]

def ok(u):
    try:
        return urllib.request.urlopen(u, timeout=30).status == 200
    except urllib.error.HTTPError:
        return False

result = {}
for p in paths:
    with tempfile.TemporaryDirectory() as tmp:
        log = os.path.join(tmp, "net.json")
        subprocess.run([os.environ.get("CHROMIUM", "chromium"), "--headless=new", "--disable-gpu",
                        f"--user-data-dir={tmp}/profile", f"--log-net-log={log}", "--virtual-time-budget=15000",
                        "--dump-dom", base + p], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=120, check=True)
        d = json.load(open(log))
    start = d["constants"]["logEventTypes"]["URL_REQUEST_START_JOB"]
    urls = [e["params"]["url"] for e in d["events"] if e["type"] == start and "url" in e.get("params", {})]
    same = []
    for u in urls:
        s = urlsplit(u)
        rel = s.path + (f"?{s.query}" if s.query else "")
        if f"{s.scheme}://{s.netloc}" == base and rel not in same and ok(base + rel):
            same.append(rel)
    assert same and same[0] == p, f"{p}: the page itself is not the first request ({same[:1]})"
    result[p] = same
    print(f"{p:40} {len(same):3} requests", file=sys.stderr)

os.makedirs(os.path.dirname(out) or ".", exist_ok=True)
json.dump({"base": base, "pages": result}, open(out, "w"), indent=1)
