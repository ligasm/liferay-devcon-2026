# Static vs Varnish: the same guests, both pushed until they break (2026-10-25)

Is a static site worth it when Varnish already caches Liferay's guest HTML? This run compares two
targets on the same box, on the same day, with the same k6:

* **static**: `part2-static-prototype/fidelity`, the Proventeq site generated from Liferay's
  APIs, on nginx 1.27 (:8091). The HTML, CSS, JS and SVG are precompressed at build time
  (`gzip_static`), so nginx never compresses per request.
* **edge**: Liferay DXP 2026.q1.12 (S3 tuning) behind Varnish (:6081), the S4 configuration.
  Every request in these ladders was a Varnish hit; Liferay stayed at 0.1–0.2 cores.

The setup is the one in [LAB-RESULTS.md](LAB-RESULTS.md#setup) and the method is the one in
[STRESS-RESULTS.md](STRESS-RESULTS.md#method): open model, 60 s per step, no think time, and the
ladder stops at the first saturated step. Both workloads run with `LIGHT=1`: k6 checks the status
and `Content-Length` but never reads a body, or k6 runs out of CPU first.

Every step is in [STATIC-VS-EDGE.steps.md](STATIC-VS-EDGE.steps.md).

## Headline numbers

| | edge (Varnish) | static (nginx) | |
|---|---:|---:|---|
| **HTML only**: clean capacity | 24,800 req/s | 24,900 req/s | a tie; **both limited by k6** (13 cores of 20) |
| HTML only: p95 at that rate | 71 ms | 66 ms | |
| HTML only: server CPU there | 2.6 cores | 1.1 cores | |
| HTML only: bytes on the wire | 575 MB/s | 150 MB/s | Liferay's HTML is ≈ 22 KB gzipped, the static HTML ≈ 5.5 KB |
| **Page views**: clean capacity | **1,200 /s** (67,000 req/s) | **10,000 /s** (46,000 req/s) | Varnish: the box (k6 + Varnish, 17–19 of 20 cores). Static: k6 again. Rerun with 5,000 Varnish threads: 1,200 clean, 1,500 not; see `RUNG-RESULTS.md` |
| **at the same 1,000 page views/s**: requests | 55,900 req/s | 4,600 req/s | **12×** |
| bytes on the wire | 545 MB/s | 99 MB/s | **5.5×** |
| server CPU | 3.1 cores | 0.3 cores | **≈ 10×** |
| page-view p95 | 13 ms | 2 ms | loopback; no network RTT |

A **page view** is a first visit with an empty browser cache: the HTML, then every same-origin
file Chromium fetched for it, 6 at a time like a browser over HTTP/1.1. `capture_pageview.py`
recorded those lists (`k6/data/pageview-*.json`); Google Fonts, which both sites load, are left
out. The page mix is the `pages` workload's: home 25 %, four content pages 45 %, blog 15 %,
News 15 %.

| per page view | edge (Varnish) | static (nginx) |
|---|---:|---:|
| requests (weighted) | 55.9 | 4.6 |
| bytes, gzipped (weighted, from `Content-Length`) | 508 KB | 95 KB |
| on the home page | the HTML, 41 JS files (AUI combo, React, Clay modules), 8 CSS files including Clay (89 KB gzipped), 2 images, the favicon | the HTML, 1 CSS file, 2 images |

## Findings

### 1. For the HTML alone, Varnish already is a static site

Both targets reached ≈ 25,000 req/s with < 1 % dropped, and both stopped because k6 had taken
13 of the 20 cores. Varnish needed 2.4× the CPU of nginx and sent 3.8× the bytes, because
Liferay's HTML is four times larger. That is a lower bound for both servers, not a ranking.

### 2. The difference is everything around the HTML

A Liferay page view is **56 requests**; the static one is **4–5**. At the same 1,000 page
views/s, the edge served 12× the requests, 5.5× the bytes and used ≈ 10× the CPU. The p95 of a
whole page view was 13 ms against 2 ms, on loopback; every extra round of requests costs one
RTT more on a real network.

### 3. Through Varnish the box tops out at 1,200 page views/s

At 1,500 page views/s (84,000 req/s target) 68 % of iterations were dropped and 3.5 % of
requests failed. During that step `MAIN.sess_dropped` grew by ≈ 130,000 and
`MAIN.threads_limited` by ≈ 40,000: Varnish runs one thread per connection, and the 2 pools × 1,000 threads we had
set could not hold k6's connections (3,000 VUs × up to 6 each). The host was at 18–20 cores
too. The 2026-11-01 rerun raised `thread_pool_max` to 5,000: the 1,500/s step went from 485 to
1,145 page views/s, still 23.6 % dropped, with the host at 19 of 20 cores (k6 10, Varnish 4.4).
So the thread limit was real, but the box is the next limit, and 1,200 stays the clean figure.

The static ladder reached 11,400 page views/s at 12,000 (5 % dropped) and collapsed at 15,000,
with nginx at 2.1 cores and k6 at 13.7: the limit there is the load generator.

### 4. Found on the way: the S4 VCL served CSS and JS uncompressed

From S1 on, Liferay's `GZipFilter` and Tomcat compression are off, so that the proxy compresses.
The VCL's static-asset branch returned before `set beresp.do_gzip = true`, which only the HTML
branch had. Varnish therefore stored and served `clay.css` at 790 KB instead of 89 KB, and the
icon sprite at 365 KB, and a page view weighed **1.9 MB** instead of 508 KB.

* The fix is in `matrix/varnish/default.vcl` and `default-xkey.vcl`: the asset branch now sets
  `do_gzip` for text types and SVG.
* The first edge page-view ladder ran before the fix and is kept as
  `stress/_S4-edge-pageview-uncompressed-assets/`. Its capacity was the same 1,200 page views/s,
  at 2.4 GB/s.
* The earlier S0–S6 and stress results are not affected: those workloads request HTML only.

**Check that your edge compresses the assets, not just the HTML.**

## Reproduce

```sh
cd part2-static-prototype && ENV_FILE=.env.local-proventeq node fidelity/build.mjs
docker compose -f fidelity/docker-compose.yml up -d     # nginx on :8091
cd ../part1-simulations && ./static-vs-edge.sh          # ≈ 60 min; then python3 static_vs_edge_report.py
```

## Caveats

* **One box, no network, no TLS.** Latencies are loopback. k6 shares the 20 cores with both
  servers.
* **HTTP/1.1, 6 connections per host.** Over HTTP/2 the request count costs fewer connections
  but the same bytes and server work.
* **Empty cache on every page view.** Returning visitors cache Liferay's hashed assets, which
  narrows the gap to the HTML (finding 1). First visits, crawlers and cache-busting deploys do
  not.
* **Each step ran once.** As in the stress run, treat differences under ~10 % as noise.
