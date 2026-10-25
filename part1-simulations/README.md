# Part 1 simulations — "Making Liferay Blazing Fast in Production"

Runnable k6 load tests + a configuration matrix (S0 … S6) + a summariser that
turns the runs into slide tables and charts. Target: a **self-hosted Liferay DXP
2025+/CE 7.4 on Tomcat** that you own. Everything here was verified against a
local mock of Liferay (`mock/server.mjs`) and then run for real against a local
DXP 2026.Q1 with the Part 0 base site: the fixed-load S0…S6 ladder is in
[results/LAB-RESULTS.md](results/LAB-RESULTS.md), the capacity ladders (step the rate up until
it breaks) in [results/STRESS-RESULTS.md](results/STRESS-RESULTS.md), and the static site against
Varnish in [results/STATIC-VS-EDGE.md](results/STATIC-VS-EDGE.md).

```
part1-simulations/
├── bin/k6                     k6 v2.2.0 linux/amd64 (downloaded from GitHub releases)
├── run.sh                     ./run.sh <STAGE_LABEL> [scenario …]
├── campaign.sh, run-stage.sh  one stage of the lab ladder (standard pass + load pass)
├── stress.sh                  capacity ladder: ./stress.sh <label> pages|search|login|mix|pageview <rate …>
├── stress-campaign.sh         every ladder in STRESS-RESULTS.md (S3, S4, S0, refinements, light edge)
├── static-vs-edge.sh          every ladder in STATIC-VS-EDGE.md (static nginx vs Varnish, HTML and page views)
├── capture_pageview.py        Chromium net log → k6/data/pageview-*.json (what a first visit fetches)
├── static_vs_edge_report.py   results/stress/S6-static-*, S4-edge-page* → STATIC-VS-EDGE.steps.md
├── stress_sampler.py          host / container / k6 CPU + Liferay heap, every 2 s
├── stress_report.py           results/stress/*/steps.csv → STEPS.md + stress-*.png
├── summarize.py               results/*/*.json → SUMMARY.md, SUMMARY.csv, DELTAS.md, PNGs
├── k6/
│   ├── lib/config.js          env vars + defaults, executors, shared options
│   ├── lib/checks.js          custom metrics (ttfb, edge_hit, set_cookie_on_guest, …)
│   ├── lib/summary.js         handleSummary() → results/<stage>/<scenario>.summary.json
│   ├── guest-browse.js        fresh anonymous visitor: home → 2 content pages → blog
│   ├── guest-browse-sticky.js same, but keeps the cookie jar (JSESSIONID effect)
│   ├── asset-publisher.js     AP page vs plain content page, side by side
│   ├── search.js              /search?q=<term>
│   ├── login.js               real form login → signed-in page → logout (arrival-rate)
│   ├── dl-download.js         Documents & Media download, bytes/s + edge hit
│   ├── headless-api.js        list (search index) vs get-by-id (DB)
│   ├── mix.js                 70/15/10/5 mixed workload, ramping-arrival-rate
│   ├── stress.js              one capacity step: open model, no think time (LIGHT=1 for edge)
│   └── publish-to-fresh.js    S5: time from publish to fresh page at the edge
├── matrix/
│   ├── MATRIX.md              the S0…S6 table: what changes, which scenario, which metric
│   ├── S0-baseline/ … S6-static/   config files per stage
│   ├── varnish/               default.vcl, default-xkey.vcl, docker-compose.yml
│   ├── local/apply-stage.sh   apply S0…S3 to the local Docker Liferay (incl. fragment Cacheable)
│   └── cloudflare/cache-rules.md
├── mock/server.mjs            Node 22 fake Liferay (MODE=origin | MODE=edge)
└── results/                   S0-mock/, S4-mock/ example runs + SUMMARY.md, PNGs
```

## Install

* **k6** — `bin/k6` is included (Linux amd64). For another OS get the binary from
  <https://github.com/grafana/k6/releases> and set `K6=/path/to/k6`, or install
  with your package manager (`brew install k6`, …). Scripts need k6 ≥ 0.50.
* **Python 3.8+** for `summarize.py` (stdlib only; `pip install matplotlib` for the PNGs).
* **Node 22** only for the mock server.
* **Docker** only for the Varnish stage.

## Run

```bash
cd part1-simulations

# 1. point it at your Liferay and describe your site
export BASE_URL=http://liferay.example.internal:8080
export SITE_PATH=/web/guest HOME_PATH=/web/guest/home
export CONTENT_PAGES=/web/guest/about,/web/guest/services
export AP_PAGE=/web/guest/news BLOG_PATH=/web/guest/blog
export SEARCH_TERMS=liferay,cache,performance
export DL_URL=/documents/20117/0/brochure.pdf/1a2b3c4d-…   # copy from a document's download link
export SITE_ID=20117                                        # Site Settings → Site ID
export LOGIN_USER=loadtest@example.com LOGIN_PASS='…'       # a throwaway user

# 2. load shape
export VUS=20 DURATION=60s          # closed model: 20 VUs with think time, or
export RATE=10                      # open model: 10 iterations/s (recommended for before/after)

# 3. run a stage
./run.sh S0-baseline                 # every scenario
./run.sh S0-baseline mix             # just the mixed workload
./run.sh S4-edge-varnish mix guest-browse login

# 4. tables + charts
python3 summarize.py                 # → results/SUMMARY.md, SUMMARY.csv, DELTAS.md, *.png
```

`run.sh` passes `--tag stage=<label>` and `--summary-export`; every script also
sets `options.tags.stage` and writes `results/<stage>/<scenario>.summary.json`
from `handleSummary()`. Add `RAW=1` to also write the full NDJSON metric stream
(`--out json=…`, large). `QUIET=0` shows k6's live progress bar.

### Environment variables (all optional; defaults in `k6/lib/config.js`)

| Variable | Default | Used by |
|---|---|---|
| `BASE_URL` | `http://localhost:8080` | all — point at the origin (S0–S3) or the edge (S4+) |
| `SITE_PATH` / `HOME_PATH` | `/web/guest` / `$SITE_PATH/home` | browse, mix |
| `CONTENT_PAGES` | `$SITE_PATH/about,$SITE_PATH/services` | browse, asset-publisher (first entry), mix |
| `AP_PAGE` | `$SITE_PATH/news` | asset-publisher, mix, publish-to-fresh |
| `BLOG_PATH` | `$SITE_PATH/blog` | browse |
| `SEARCH_PATH` / `SEARCH_PARAM` / `SEARCH_TERMS` | `$SITE_PATH/search` / `q` / a word list | search, mix |
| `DL_URL` | `/documents/guest/0/sample.pdf` (set it!) | dl-download |
| `SITE_ID` / `BLOG_ID` | `20117` / auto-discovered | headless-api |
| `LOGIN_USER` / `LOGIN_PASS` / `LOGIN_NS` / `SIGNED_IN_MARKER` | `test@liferay.com` / `test` / LoginPortlet namespace / `/c/portal/logout` | login, mix |
| `VUS` / `RATE` / `DURATION` | `10` / unset / `30s` | executors (RATE set → arrival-rate, open model) |
| `THINK_MIN` / `THINK_MAX` | `1` / `3` seconds | think time between page views |
| `WITH_ASSETS` / `ASSET_LIMIT` | `0` / `10` | guest-browse: also fetch top-N `<script src>`/`<link href>` |
| `STAGE_LABEL` | `S0-baseline` (set by `run.sh`) | tag + results folder |
| `INSECURE=1` | off | skip TLS verification (self-signed edge) |

Search URL: Liferay's Search Bar widget sends keywords as `q` to the site's
`/search` page (`/web/guest/search?q=data`, per learn.liferay.com "Searching for
Content"); `SEARCH_PARAM` covers a renamed parameter. Login field names come from
`login-web/…/login.jsp` (`_com_liferay_login_web_portlet_LoginPortlet_login`,
`…_password`, hidden `…_formDate/saveLastPath/redirect/doActionAfterLogin`,
`p_auth` on the action URL); `login.js` parses the live form so it survives
customised themes.

## Mapping the matrix to a live demo

Suggested on-stage flow (≈ 4 minutes of wall time):

1. `curl -sI $BASE_URL/web/guest/home | grep -iE "cache-control|set-cookie"` — the
   three cookies and the `no-store`. "This is why your CDN does nothing."
2. `RATE=10 DURATION=60s ./run.sh S0-baseline mix` (origin). Point at the console
   box: p95, `edge hit 0 %`, `set-cookie on guest 100 %`.
3. Apply S3's two lines (`browser.cache.disabled=false`, keep `…signed.in.disabled=true`),
   start Varnish: `cd matrix/varnish && LIFERAY_UPSTREAM=host-gateway docker compose up -d`.
   `curl -sI http://localhost:6081/web/guest/home` twice → `X-Cache: HIT`, `Age`, no cookie.
   Once more with `-H 'Cookie: COMPANY_ID=1'` → `BYPASS`. (No time to restart
   Liferay? `GUEST_HTML_OVERRIDE=1 docker compose up -d` makes Varnish ignore the
   origin's `no-store` for anonymous HTML — the Cloudflare "override TTL" behaviour.)
4. `BASE_URL=http://localhost:6081 RATE=10 DURATION=60s ./run.sh S4-edge-varnish mix`.
5. `python3 summarize.py` → open `results/SUMMARY.md` (the "p95 by stage" pivot) and
   `results/p95-by-stage.png`. `login` row unchanged = the safety proof.
6. Optional S5: `BASE_URL=http://localhost:6081 FRESH_MARKER=devcon2026 ./run.sh S5 publish-to-fresh`,
   edit the article in another window, watch `origin_to_edge_ms`.

For the fuller ladder, run every stage the day before (`./run.sh S1-hygiene`,
`S2-jvm-caches`, …) and only re-run S0 and S4 live; `summarize.py` merges all
`results/*` folders it finds. Throughput (`req/s`) only differs between stages
when the origin was saturated or when you use the closed model (`VUS` without
`RATE`); under a fixed `RATE` the honest comparison is p95/TTFB and `edge hit`.

## Safety notes

* **Never load-test production without written permission** and a maintenance
  window. `mix` at `RATE=10` is ~30 HTML requests/s plus search and login — enough
  to notice on a small box. Start at `RATE=2`, watch CPU, then raise.
* **`login.js` creates real sessions** (one per iteration, until `session.timeout`).
  Use a dedicated throwaway user, keep `RATE` low (default 2/s), and remember
  Liferay's own benchmark saw native login degrade past ~400 concurrent attempts.
  Do not run it against an IdP you do not own.
* **Cap `RATE` / `maxVUs`.** The arrival-rate executors will spin up to `VUS×4`
  (mix: `VUS×20`) VUs if the server slows down — that is the open model doing its
  job, but it can amplify an incident. Thresholds abort nothing; use k6's
  `abortOnFail` if you want a circuit breaker.
* `WITH_ASSETS=1` multiplies request volume by ~`ASSET_LIMIT`.
* `publish-to-fresh.js` with `PUBLISH_VIA_API=1` **modifies content** (PATCHes a title).
* The Varnish `acl purge` and Cloudflare tokens in the matrix are examples; lock
  them down before exposing an edge to the internet.

## Results template for the slides

Fill from `results/SUMMARY.md` (one row per stage you actually ran):

| Stage | Scenario | req/s | p50 ms | p95 ms | p99 ms | TTFB p95 | errors | edge hit | set-cookie on guest | cc private |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| S0 baseline | mix (all) | | | | | | | 0 % | 100 % | 100 % |
| S0 baseline | asset-publisher/ap_page | | | | | | | | | |
| S0 baseline | asset-publisher/content_page | | | | | | | | | |
| S1 hygiene | mix (all) | | | | | | | | | |
| S2 JVM caches (G1) | mix (all) | | | | | | | | | |
| S2 JVM caches (ZGC) | mix (all) | | | | | | | | | |
| S2 JVM caches | headless-api/headless_by_id | | | | | | | | | |
| S3 front-end | guest-browse/asset | | | | | | | | | |
| S3 front-end | dl-download | | | | | | | | | |
| S4 edge (Varnish) | mix (all) | | | | | | | | | |
| S4 edge (Varnish) | guest-browse-sticky | | | | | | | | | |
| S4 edge (Varnish) | login | | | | | | | 0 % | | 100 % |
| S5 edge + purge | publish-to-fresh (`origin_to_edge_ms`) | | | | | | | | | |

and the one-liner per stage from `results/DELTAS.md` ("p95 −xx % vs S0").

## The mock (for checking the scripts, not Liferay)

```bash
node mock/server.mjs                       # origin behaviour on :8080
MODE=edge PORT=8081 node mock/server.mjs   # "behind Varnish/Cloudflare" behaviour on :8081
./run.sh S0-mock && BASE_URL=http://localhost:8081 ./run.sh S4-mock && python3 summarize.py
```

`results/S0-mock` and `results/S4-mock` are the output of exactly that (10 s per
scenario, `RATE=15`, `THINK 0.2–0.6 s`). What they prove: every scenario runs to
completion with 0 % errors and passing checks/thresholds; `edge hit` goes
0 % → 100 % and `set-cookie on guest` / `cache-control private` go 100 % → 0 %
for anonymous HTML and documents between the two modes, while `login` and
`headless-api` correctly stay at 0 % / 100 % (bypassed). The absolute
milliseconds are the mock's simulated latencies and mean nothing.

## What was verified, and what was not

Verified: k6 v2.2.0 executes all nine scripts against the mock in both modes;
`summarize.py` produces the tables, CSV, deltas and both PNGs; the Liferay
search URL parameter (`q`, `/search`) and the login form field names (from
`login.jsp` on liferay-portal master); the `portal.properties` defaults quoted
in `matrix/S0-baseline` (from liferay-portal master); Tomcat/HikariCP/JSP
values from learn.liferay.com "Tuning Liferay"; the D&M Cache Control UI path.

Not verified (marked `UNVERIFIED — check learn.liferay.com` in the files): the
OSGi PID/keys for D&M Cache Control, `${liferay.home}` expansion in
`cluster.link.channel.properties.*`, the exact JGroups protocol list for your
bundled JGroups version, G1 sub-flags, the counter pool property names, whether
guests receive `LFR_SESSION_STATE_*`, and the module-entity Ehcache aliases
beyond the ones shipped in `liferay-multi-vm.xml`. The Varnish VCL and the Java
sketch were reviewed but not compiled here (no Varnish/JDK in the build
environment) — run `varnishd -C -f default.vcl` once before the talk.
