# Configuration matrix — S0 … S6

Self-hosted Liferay DXP 2025.Q3+ / CE 7.4 on Tomcat, JDK 21. Each stage layers on
the previous one. Config files live in `S<n>-*/`; run the k6 scenarios with
`./run.sh S<n>-<label> …` after applying a stage and compare with `summarize.py`.

**Every "expected effect" below is an expectation, not a measurement.** The only
numbers in this package that were measured are the `results/*-mock/` runs against
the mock server (which prove the scripts and metrics work, not Liferay's
behaviour). Liferay's own published benchmark figures are quoted where they
exist and labelled as such.

| Stage | What changes | Files | Scenario that shows it | Metric that should move | Expected size of the move |
|---|---|---|---|---|---|
| **S0 Baseline** | Nothing. Stock `portal-ext.properties`, bundle `setenv.sh`, Tomcat defaults. Every guest page: `Cache-Control: private, no-cache, no-store, must-revalidate` + `Set-Cookie: JSESSIONID/COOKIE_SUPPORT/SERVER_ID`. | `S0-baseline/` (shipped defaults, annotated) | `mix`, all others | — (this *is* the baseline) | `set-cookie on guest` 100 %, `cache-control private` 100 %, `edge hit` 0 % |
| **S1 Hygiene** ("advice graveyard") | `portal-developer.properties` NOT included; JSP `development=false`, `mappedFile=false`; `session.tracker.memory.enabled=false`; `index.on.startup=false` (already default); `GZipFilter`/`StripFilter` stay `false` (compress at proxy); JDK 21 flags without CMS/ParNew. **Dead advice not applied:** `minifier.enabled` (deprecated, default false), `layout.parallel.render.*` (removed 7.3), CMS GC (removed JDK 15), `CacheFilter` (deleted 7.4.3.123), `ehcache.cluster.link.replication.enabled` / `ehcache.statistics.enabled` (inert). | `S1-hygiene/portal-ext.properties`, `tomcat-web.xml.snippet`, `setenv.sh` | `mix`, `guest-browse` | p95, CPU | Expectation: small — low single-digit % on p95 unless dev properties *were* leaking (then 20–50 %). Heap freed by the session tracker scales with concurrent sessions. |
| **S2 JVM caches** | Ehcache 3 XML (DXP 2025.Q2+) sizing for hot entity/finder caches; fragment *Cacheable* and web-content template *Cacheable* (UI checkboxes); Cluster Link on, JDBC_PING, invalidation not replication; HikariCP ≈ 2 × `maxThreads`; Tomcat `maxThreads=75`, `acceptCount` raised; G1 vs Generational ZGC. | `S2-jvm-caches/portal-ext.properties`, `liferay-multi-vm-override.xml`, `jgroups/jdbc_ping.xml`, `server.xml.snippet`, `setenv.sh` (`GC=g1|zgc`), `README.md` | `headless-api` (`by_id` = DB/entity cache vs `list` = Elasticsearch), `asset-publisher`, `mix` | `headless_by_id` p95, `ap_page` p95, p99 (GC), DB queries/s | Expectation: `by_id` p95 down 20–50 % once warm; `list` unchanged; AP/content gap narrows but stays (Liferay's benchmark: AP ≈ 2.3× a content page); ZGC p99 lower, throughput 10–15 % lower. |
| **S3 Front-end delivery** | `cdn.host.https` + `cdn.dynamic.resources.enabled=true`; Adaptive Media configured and regenerated; D&M *Cache Control: Public, max-age*; `browser.cache.disabled=false` with `browser.cache.signed.in.disabled=true`; `loading="lazy"` + `width/height`; client extensions `async`/`fetchpriority`. | `S3-frontend/portal-ext.properties`, `osgi-configs/` (D&M PID verified on 2026.Q1), `fragment-image.html`, `client-extension.yaml`, `README.md` | `guest-browse` with `WITH_ASSETS=1` (`/asset` row), `dl-download`, `guest-browse` | `cache-control private` on HTML (100 % → 0 % for guests), `edge hit`/`cc private` on assets and documents | Expectation: HTML TTFB unchanged (nothing in front of Tomcat yet); asset row `edge hit` → ~100 % *once a CDN is in front of the CDN host*; DL `cc private` → 0 %. This stage is the precondition for S4, not a TTFB win by itself. |
| **S4 Edge guest-HTML cache** (Varnish, self-hosted; Cloudflare as hosted equivalent) | Varnish in front of Tomcat: bypass on auth cookies (`COMPANY_ID`, `ID`, `USER_UUID`, `REMEMBER_ME`, `LOGIN`) and non-GET; strip `Cookie` in / `Set-Cookie` out for anonymous GETs; query-string allow-list + sort; TTL from `Surrogate-Control`/`Cache-Control` else 60 s, grace 1 h; `Vary: Accept-Encoding` only; BAN/PURGE (or xkey soft purge) by tag; `X-Cache`, `Age`. Cloudflare: two-rule pair (bypass first, then cache-everything with edge TTL override, browser TTL bypass, custom cache key). | `varnish/default.vcl`, `varnish/default-xkey.vcl`, `varnish/docker-compose.yml`, `cloudflare/cache-rules.md`, `S4-edge-varnish/` | `mix`, `guest-browse`, `guest-browse-sticky`, `asset-publisher`, `search`, `login` (must NOT flip) | `edge hit` 0 → ~100 %, `set-cookie on guest` 100 → 0 %, TTFB p95, `ap_page` vs `content_page` gap, origin request rate | Expectation: guest HTML TTFB p95 from hundreds of ms to single-digit ms; AP/content gap disappears; origin req/s drops to the miss rate (≈ number of distinct URL×language objects per TTL); `login` stays `edge hit` 0 % and `private`. Mock run (`results/S4-mock`) shows the metrics flipping exactly this way. |
| **S5 Edge + tag purge on publish** | `CacheTagFilter` adds `Cache-Tag`/`Surrogate-Key` per page; `ModelListener` on `JournalArticle`/`Layout`/`BlogsEntry` soft-purges by tag after commit (`TransactionCommitCallbackUtil`); Varnish `BAN`/xkey and Cloudflare `purge_cache` implementations. Edge TTL can now be raised (minutes/hours). | `S5-edge-purge/src/…`, `S5-edge-purge/README.md`, `k6/publish-to-fresh.js` | `publish-to-fresh` | `origin_to_edge_ms` (publish → fresh at edge) | Expectation: ≤ 1–2 s with the listener vs up to TTL (60 s) without; with a longer TTL the hit ratio in `mix` rises further while freshness stays ≈ 1 s. |
| **S6 Static / precomputed** | Guest page is a static file behind the same Varnish/CDN; dynamic islands client-side/ESI. Pointer only — Part 2. | `S6-static/README.md` | `guest-browse`, `asset-publisher` (cold) | cold-request p95 (no MISS penalty), TTL independence | Expectation: S4 numbers *without* the first-request miss; freshness = build time unless incremental. |

## Reference numbers you may quote (Liferay's, not ours)

From the Liferay DXP 7.4 Performance Benchmark Study (origin only, no CDN, 8-core
node; "concurrent users" is a load-model construct with think time):

* Web content pages: 25,000 concurrent users, 95 % of page views under 2 s.
* Asset Publisher: inflection at ~11,000 concurrent users, 577 ms mean, 1,159 ms p95
  → roughly 2.3× the cost of a content page.
* Native login: degrades past ~400 concurrent login attempts (1,185 ms at threshold);
  a dedicated IdP took the same hardware to 19,000 virtual users.
* 100 KB document download: 95 % in 5.96 ms at 11,500 concurrent users.

## How the stages map to the k6 metrics

| Metric (SUMMARY.md column) | Set by | Moves at |
|---|---|---|
| `p50/p95/p99`, `TTFB p95` | `http_req_duration`, `res.timings.waiting` | S1 (little), S2 (some), S4 (a lot) |
| `edge hit` | `cf-cache-status` / `x-cache` / `x-varnish` / `Age` | S3 (assets only, if a CDN is in front), S4 (HTML) |
| `set-cookie on guest` | any `Set-Cookie` on an anonymous request | S4 (Varnish strips it) |
| `cache-control private` | `private` / `no-store` in `Cache-Control` | S3 (`browser.cache.disabled=false`, D&M Cache Control), stays 100 % for `login` and `headless-api` |
| `errors` | `http_req_failed` | should stay ≈ 0 at every stage — a rise at S4 means the probe/ACL/upstream is wrong |

## Things to check on the real box before trusting a stage

* `S1`: `grep -n include-and-override tomcat/webapps/ROOT/WEB-INF/classes/portal-ext.properties` — nothing should point at `portal-developer.properties`.
* `S2`: JMX `org.ehcache:type=CacheStatistics,*` exists (Ehcache 3) — if you see `net.sf.ehcache:*` you are on ≤ 2025.Q1 and the XML here will not parse.
* `S3`: `curl -sI http://origin/web/guest/home | grep -i cache-control` → no `no-store` for a guest.
* `S4`: `curl -sI http://edge/web/guest/home` twice → second is `X-Cache: HIT`, no `Set-Cookie`; with `-H 'Cookie: COMPANY_ID=1'` → `BYPASS`.
* `S5`: `curl -X BAN -H 'X-Cache-Tags: site-<groupId>' http://edge/` → `200`, next GET is `MISS` (BAN) or `HIT` with `Age: 0` after refetch (xkey soft purge).
