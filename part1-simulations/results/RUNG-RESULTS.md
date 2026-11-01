# Rung results: one comparable test on every rung

Run 2026-11-01 on DXP 2026.q1.12-lts, one 20-core, 62 GB host. k6 shares the box. Scripts: `rungs-campaign.sh`, `rungs_report.py`. Raw data: `results/stress/<label>/`. Logs: `results/rungs-campaign*.log`, `results/rungs-search.log`.

## What was compared

| Rung | Label | Configuration |
|---|---|---|
| R1 | Origin render | S0, stock |
| R2 | JVM caches | S2: S1 hygiene, heap, Ehcache, Hikari, connector, 16 fragments marked Cacheable |
| R3 | Edge static | S3 plus Varnish with `GUEST_HTML_CACHE=0`: assets cached, guest HTML passed to Liferay |
| R4 | Edge HTML | S3 plus Varnish caching guest HTML (S4) |
| R5 | Precompute | S6: the fidelity build on nginx |

Same method for all: open-model k6, 60 s per rate, `LIGHT=1`, `MAX_VUS=3000`, same weighted pages (home 25 %, four content pages 45 %, blog 15 %, News 15 %). Liferay is restarted and warmed for 60 s before each origin ladder. Varnish allows 5,000 threads per pool, so our config is not the limit.

Two workloads:

- **HTML only:** one GET per iteration.
- **Whole page view:** a first visit with an empty browser cache, the HTML plus every file a browser fetched (6 connections per host). The p95 is for the whole page view (`page_view_duration`).

CPU is the mean over each step without its first 10 s, for the serving containers only. k6 is listed separately. The R5 rows include about 0.05 cores of idle Liferay, which the ladder leaves out because nginx alone serves that rung.

## The ladder slide's figures

At 200 whole page views a second:

| Rung | p95 | Server cores | CPU per page view | Clean capacity | Requests / KB per page view |
|---|---:|---:|---:|---:|---:|
| R1 stock | 344 ms | 13.1 | 66 ms | 200/s | 56 / 2,044 |
| R2 Cacheable | 37 ms | 8.2 | 41 ms | 200/s | 56 / 2,036 |
| R3 edge assets | 19 ms | 1.9 | 9.5 ms | 600/s | 56 / 625 |
| R4 edge HTML | 8 ms | 0.8 | 4 ms | 1,200/s | 56 / 533 |
| R5 static | 3 ms | 0.1 | 0.6 ms | 10,000/s | 4.6 / 96 |

R5 is a lighter page by design, so it is not the same set of files as R1–R4.

## Findings

1. **Stock and Cacheable tie at low load.** Page view p95 30 vs 25 ms at 80/s; HTML 17 vs 17 ms at 100/s. The gap opens near saturation: HTML at 400/s is 90 vs 13 ms and 12.4 vs 2.1 cores.
2. **Static files were 84 % of Liferay's CPU in a first visit.** At 200 page views/s Liferay used 8.2 cores serving everything and 1.3 cores once Varnish served the assets. This is the worst case, an empty browser cache.
3. **Search highlighting was the largest origin gain we found.** Turning off `highlightEnabled` on the Search Results widget took clean capacity from 25 to 300 searches/s, and at 20 searches/s p95 from 687 to 38 ms and CPU from 9.5 to 0.8 cores. Result counts, titles and order were identical for the three terms checked (`liferay`, `migration`, `azure`) and the page changed by about 180 bytes, because the compact display template we use does not show snippets. A template that shows snippets would lose the bold terms. Repeated on → off → on with single requests: 210, 78, 295 ms. The corpus is small and the search index is the sidecar Elasticsearch, so the factor will differ elsewhere. The site itself was left with highlighting on.
4. **Generational ZGC gave no gain on this 6 GB heap.** A tie at 400 pages/s (14.0 vs 15.5 ms, 2.3 vs 3.0 cores), then more CPU than G1: 6.2 vs 5.8 cores at 800/s and 11.8 vs 10.8 at 1,200/s. Clean to 1,200/s; at 1,500/s 5.3 % dropped with p95 1.9 s, where G1 dropped 0.5 % with p95 312 ms.
5. **ZGC failed once in five starts.** At 17:47:10, 43 s after start, Liferay exited with `OutOfMemoryError`: old gen 4,839 MB live after collection, allocation stalls, against about 600 MB live in the other starts. It did not reproduce. The heap dump was deleted before analysis, so the cause is unknown; `stress/zgc-oom-gc.log` holds the GC log. G1 never did this.
6. **S3 ties S2 for HTML.** Same origin work: 15.5 vs 13.0 ms at 400/s, 26.1 vs 25.2 ms at 1,200/s. Its value is headers, which only pay off with an edge.
7. **HTML alone, edge and static tie at about 24,800/s.** Both are bounded by k6 (13 of 20 cores). nginx used 1.2 cores and Varnish 2.7.
8. **The stock heap fails at saturation.** At 600 pages/s stock threw `OutOfMemoryError: Java heap space` on its 2.5 GB heap.

## How far to trust the numbers

- **Noise.** S2 and S3 serve HTML identically, yet used 2.1 and 3.0 cores at 400/s. Treat CPU gaps smaller than that as ties at low rates.
- **Near the knee, numbers move.** The R1 page view at 200/s gave 269 ms in the earlier run (`*.host-busy`) and 344 ms here; read it as about 300 ms. The tuned origin was clean at 1,200 pages/s in all four runs (the earlier S3, R2, S3 G1 and S3 ZGC) and at 1,500 in two of them, so 1,200 is the figure the deck uses.
- **First R1 run.** It ran while other containers shared the host until about 16:59, so R1 was repeated on a quiet host. HTML results matched (90.4 and 90.3 ms at 400/s). The first run is kept as `R1-S0-*.host-busy`.
- **k6 shares the box,** so top-end capacity on rungs 4 and 5 is the lab's limit, not the server's. At 1,500 page views/s through Varnish the host was at 19 of 20 cores: k6 10, Varnish 4.4.
- **Search ladder.** The first off step after a restart (100/s, 182 ms) still shows warm-up; the 200 and 300/s steps do not. The 400/s step dropped 1.5 %, so 300/s is the clean figure.
- **First step of a ladder** includes warm-up, which is why some p95s fall as the rate rises.

## Full tables

## HTML only at common rates

| Rung | Rate/s | HTML p95 | Server cores | Liferay | Varnish | nginx | CPU ms per unit | k6 cores | Dropped | Errors |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| R1 stock | 100 | 17.2 ms | 1.20 | 1.20 | 0.00 | 0.00 | 12.03 | 0.1 | 0.0 % | 0.00 % |
| R1 stock | 200 | 16.7 ms | 2.09 | 2.08 | 0.00 | 0.00 | 10.43 | 0.1 | 0.0 % | 0.00 % |
| R1 stock | 400 | 90.3 ms | 12.40 | 12.40 | 0.00 | 0.00 | 31.01 | 0.4 | 0.0 % | 0.00 % |
| R2 Cacheable | 100 | 17.0 ms | 0.92 | 0.92 | 0.00 | 0.00 | 9.19 | 0.1 | 0.0 % | 0.00 % |
| R2 Cacheable | 200 | 13.6 ms | 1.17 | 1.17 | 0.00 | 0.00 | 5.84 | 0.1 | 0.0 % | 0.00 % |
| R2 Cacheable | 400 | 13.0 ms | 2.13 | 2.13 | 0.00 | 0.00 | 5.32 | 0.3 | 0.0 % | 0.00 % |
| R2 Cacheable | 800 | 18.2 ms | 5.31 | 5.31 | 0.00 | 0.00 | 6.64 | 0.6 | 0.0 % | 0.00 % |
| R2 Cacheable | 1,200 | 25.2 ms | 10.25 | 10.25 | 0.00 | 0.00 | 8.54 | 1.1 | 0.0 % | 0.00 % |
| S3 G1 | 100 | 16.6 ms | 0.97 | 0.97 | 0.00 | 0.00 | 9.67 | 0.1 | 0.0 % | 0.00 % |
| S3 G1 | 200 | 15.1 ms | 1.44 | 1.44 | 0.00 | 0.00 | 7.20 | 0.2 | 0.0 % | 0.00 % |
| S3 G1 | 400 | 15.5 ms | 2.97 | 2.97 | 0.00 | 0.00 | 7.42 | 0.3 | 0.0 % | 0.00 % |
| S3 G1 | 800 | 19.8 ms | 5.76 | 5.76 | 0.00 | 0.00 | 7.19 | 0.6 | 0.0 % | 0.00 % |
| S3 G1 | 1,200 | 26.1 ms | 10.75 | 10.75 | 0.00 | 0.00 | 8.96 | 1.1 | 0.0 % | 0.00 % |
| S3 ZGC | 100 | 17.3 ms | 0.88 | 0.87 | 0.00 | 0.00 | 8.77 | 0.1 | 0.0 % | 0.00 % |
| S3 ZGC | 200 | 14.1 ms | 1.20 | 1.20 | 0.00 | 0.00 | 6.00 | 0.1 | 0.0 % | 0.00 % |
| S3 ZGC | 400 | 14.0 ms | 2.28 | 2.28 | 0.00 | 0.00 | 5.70 | 0.3 | 0.0 % | 0.00 % |
| S3 ZGC | 800 | 20.7 ms | 6.21 | 6.21 | 0.00 | 0.00 | 7.77 | 0.6 | 0.0 % | 0.00 % |
| S3 ZGC | 1,200 | 27.6 ms | 11.81 | 11.81 | 0.00 | 0.00 | 9.84 | 1.0 | 0.0 % | 0.00 % |
| R4 edge HTML | 100 | 1.4 ms | 0.10 | 0.06 | 0.04 | 0.00 | 1.00 | 0.2 | 0.0 % | 0.00 % |
| R4 edge HTML | 200 | 1.2 ms | 0.11 | 0.05 | 0.06 | 0.00 | 0.57 | 0.3 | 0.0 % | 0.00 % |
| R4 edge HTML | 400 | 0.9 ms | 0.15 | 0.05 | 0.10 | 0.00 | 0.38 | 0.5 | 0.0 % | 0.00 % |
| R4 edge HTML | 800 | 0.7 ms | 0.22 | 0.06 | 0.16 | 0.00 | 0.27 | 0.8 | 0.0 % | 0.00 % |
| R4 edge HTML | 1,200 | 0.6 ms | 0.27 | 0.05 | 0.23 | 0.00 | 0.23 | 1.1 | 0.0 % | 0.00 % |
| R5 static | 100 | 1.2 ms | 0.11 | 0.09 | 0.00 | 0.02 | 1.12 | 0.2 | 0.0 % | 0.00 % |
| R5 static | 200 | 1.0 ms | 0.12 | 0.09 | 0.00 | 0.03 | 0.62 | 0.3 | 0.0 % | 0.00 % |
| R5 static | 400 | 0.8 ms | 0.11 | 0.06 | 0.00 | 0.05 | 0.28 | 0.5 | 0.0 % | 0.00 % |
| R5 static | 800 | 0.6 ms | 0.15 | 0.06 | 0.00 | 0.08 | 0.18 | 0.8 | 0.0 % | 0.00 % |
| R5 static | 1,200 | 0.6 ms | 0.17 | 0.06 | 0.00 | 0.11 | 0.14 | 1.1 | 0.0 % | 0.00 % |

## Whole page views at common rates

| Rung | Rate/s | Page view p95 | Server cores | Liferay | Varnish | nginx | CPU ms per unit | k6 cores | Dropped | Errors |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| R1 stock | 5 | 40.0 ms | 0.96 | 0.96 | 0.00 | 0.00 | 191.50 | 0.1 | 0.0 % | 0.00 % |
| R1 stock | 20 | 30.0 ms | 1.71 | 1.71 | 0.00 | 0.00 | 85.66 | 0.3 | 0.0 % | 0.00 % |
| R1 stock | 80 | 30.0 ms | 4.35 | 4.35 | 0.00 | 0.00 | 54.33 | 0.9 | 0.0 % | 0.00 % |
| R1 stock | 200 | 344.0 ms | 13.07 | 13.07 | 0.00 | 0.00 | 65.69 | 2.3 | 0.5 % | 0.00 % |
| R2 Cacheable | 5 | 38.0 ms | 0.93 | 0.93 | 0.00 | 0.00 | 185.83 | 0.1 | 0.0 % | 0.00 % |
| R2 Cacheable | 20 | 29.0 ms | 1.72 | 1.72 | 0.00 | 0.00 | 85.82 | 0.3 | 0.0 % | 0.00 % |
| R2 Cacheable | 80 | 25.0 ms | 3.79 | 3.79 | 0.00 | 0.00 | 47.36 | 0.9 | 0.0 % | 0.00 % |
| R2 Cacheable | 200 | 37.0 ms | 8.20 | 8.20 | 0.00 | 0.00 | 40.98 | 2.2 | 0.0 % | 0.00 % |
| R3 edge assets | 5 | 35.0 ms | 0.22 | 0.19 | 0.03 | 0.00 | 44.02 | 0.1 | 0.0 % | 0.00 % |
| R3 edge assets | 20 | 31.0 ms | 0.48 | 0.37 | 0.11 | 0.00 | 24.00 | 0.3 | 0.0 % | 0.00 % |
| R3 edge assets | 80 | 19.0 ms | 0.98 | 0.69 | 0.29 | 0.00 | 12.27 | 0.7 | 0.0 % | 0.00 % |
| R3 edge assets | 200 | 19.0 ms | 1.91 | 1.33 | 0.58 | 0.00 | 9.54 | 1.4 | 0.0 % | 0.00 % |
| R4 edge HTML | 5 | 13.1 ms | 0.11 | 0.06 | 0.04 | 0.00 | 21.25 | 0.1 | 0.0 % | 0.00 % |
| R4 edge HTML | 20 | 12.0 ms | 0.20 | 0.05 | 0.15 | 0.00 | 9.97 | 0.4 | 0.0 % | 0.00 % |
| R4 edge HTML | 80 | 10.0 ms | 0.53 | 0.05 | 0.48 | 0.00 | 6.68 | 1.3 | 0.0 % | 0.00 % |
| R4 edge HTML | 200 | 8.0 ms | 0.79 | 0.05 | 0.74 | 0.00 | 3.97 | 2.1 | 0.0 % | 0.00 % |
| R5 static | 5 | 5.0 ms | 0.06 | 0.06 | 0.00 | 0.00 | 12.00 | 0.0 | 0.0 % | 0.00 % |
| R5 static | 20 | 5.0 ms | 0.08 | 0.06 | 0.00 | 0.02 | 3.96 | 0.1 | 0.0 % | 0.00 % |
| R5 static | 80 | 4.0 ms | 0.12 | 0.05 | 0.00 | 0.06 | 1.45 | 0.3 | 0.0 % | 0.00 % |
| R5 static | 200 | 3.0 ms | 0.17 | 0.05 | 0.00 | 0.11 | 0.82 | 0.6 | 0.0 % | 0.00 % |

## Clean capacity, HTML only

| Rung | Highest clean rate/s | p95 there | Server cores there | k6 cores there | First failed step |
|---|---:|---:|---:|---:|---|
| R1 stock | 400 | 90.3 ms | 12.40 | 0.4 | 600/s: 458 achieved, 23.7 % dropped, 0.01 % errors |
| R2 Cacheable | 1,500 | 103.1 ms | 15.21 | 1.4 | 2,000/s: 1,588 achieved, 20.6 % dropped, 0.00 % errors |
| S3 G1 | 1,493 | 312.0 ms | 15.72 | 1.3 | 2,000/s: 1,510 achieved, 24.5 % dropped, 0.00 % errors |
| S3 ZGC | 1,200 | 27.6 ms | 11.81 | 1.0 | 1,500/s: 1,420 achieved, 5.3 % dropped, 0.00 % errors |
| R4 edge HTML | 24,767 | 72.2 ms | 2.69 | 13.2 | 30,000/s: 25,693 achieved, 14.2 % dropped, 0.00 % errors |
| R5 static | 24,764 | 68.9 ms | 1.21 | 13.2 | 30,000/s: 28,701 achieved, 4.3 % dropped, 0.00 % errors |

## Clean capacity, whole page views

| Rung | Highest clean rate/s | p95 there | Server cores there | k6 cores there | First failed step |
|---|---:|---:|---:|---:|---|
| R1 stock | 199 | 344.0 ms | 13.07 | 2.3 | 300/s: 205 achieved, 25.4 % dropped, 3.29 % errors |
| R2 Cacheable | 200 | 37.0 ms | 8.20 | 2.2 | 300/s: 293 achieved, 2.5 % dropped, 0.00 % errors |
| R3 edge assets | 600 | 79.0 ms | 9.51 | 5.3 | 800/s: 732 achieved, 8.5 % dropped, 0.33 % errors |
| R4 edge HTML | 1,200 | 24.0 ms | 3.88 | 8.5 | 1,500/s: 1,145 achieved, 23.6 % dropped, 0.00 % errors |
| R5 static | 9,948 | 120.0 ms | 2.01 | 11.5 | 12,000/s: 11,224 achieved, 6.4 % dropped, 0.00 % errors |

## Size of one page view

| Rung | Requests | KB on the wire |
|---|---:|---:|
| R1 stock | 56.1 | 2044 |
| R2 Cacheable | 55.8 | 2036 |
| R3 edge assets | 55.9 | 625 |
| R4 edge HTML | 55.9 | 533 |
| R5 static | 4.6 | 96 |

## Search with highlighting on and off (S3)

| Highlighting | Rate/s | Search p95 | Liferay + Elasticsearch cores | CPU ms per search | Dropped |
|---|---:|---:|---:|---:|---:|
| on | 10 | 418 ms | 3.38 | 338 | 0.0 % |
| on | 20 | 687 ms | 9.47 | 473 | 0.0 % |
| on | 25 | 1004 ms | 15.06 | 603 | 0.3 % |
| on | 30 | 6015 ms | 18.22 | 659 | 7.9 % |
| off | 10 | 44 ms | 0.61 | 61 | 0.0 % |
| off | 20 | 38 ms | 0.80 | 40 | 0.0 % |
| off | 25 | 33 ms | 0.81 | 32 | 0.0 % |
| off | 30 | 29 ms | 0.75 | 25 | 0.0 % |
| off | 35 | 27 ms | 0.89 | 25 | 0.0 % |
| off | 40 | 24 ms | 0.83 | 21 | 0.0 % |
| off | 60 | 24 ms | 1.24 | 21 | 0.0 % |
| off | 100 | 182 ms | 3.44 | 34 | 0.2 % |
| off | 200 | 37 ms | 5.64 | 28 | 0.0 % |
| off | 300 | 42 ms | 9.94 | 33 | 0.0 % |
| off | 400 | 1006 ms | 18.09 | 46 | 1.5 % |
| off | 600 | 7961 ms | 18.00 | 41 | 26.7 % |
