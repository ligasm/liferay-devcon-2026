# Making Liferay Blazing Fast in Production
## 45-minute deep dive — two-part outline

**Liferay DevCon 2026 · Speaker: Miroslav Ligas, Proventeq · Self-hosted DXP 2025+/CE 7.4**

**The arc in one sentence:** Part 1 squeezes everything out of the portal the traditional way and *measures* it — then reaches the ceiling tuning can't lift: every request still enters the JVM, and a whole first visit stays at 200/s. Part 2 walks around it: for content-heavy sites, keep authoring in Liferay but serve plain HTML that regenerates itself, with an AI agent in charge of the regeneration and a hard token budget.

Companion material in this repository:

| | What | Where |
|---|---|---|
| Evidence | Research dossier, one file in 6 parts, re-checked on 2026-11-02 against Liferay `master`, shipped 2026.q1.12, vendor docs and the raw lab data | `docs/liferay-performance-dossier.md` |
| Slides | 29-slide deck, speaker notes, generated art, measured charts (Chart.js, PNG fallbacks) | `deck/` |
| Part 1 demos | k6 scenarios (JavaScript), S0–S6 config matrix, Varnish VCL, Cloudflare rules, purge listener, shell runners, Python summariser + charts | `part1-simulations/` |
| Part 2 demo | Astro static site from Liferay Headless, delta regeneration, AI orchestrator with budget, webhook + timers — JavaScript modules on Node | `part2-static-prototype/` |

Languages: k6 scenarios are JavaScript, the Part 1 runners are shell and Python, the Part 2 pipeline is `.mjs` on Node, and only `deck/build.ts` and `part0-base-site/build.ts` use Bun. The Java `ModelListener` sketch, the Varnish VCL and the Tomcat `setenv.sh` fragments run inside Liferay, Varnish and Tomcat.

Timing below assumes 45 min including 2:45 of Q&A. Sections with a "cut if behind" line tell you what to drop so you can land on time. Slide numbers refer to the current 29-slide deck in `deck/`.

---

## Cold open — 0:00–3:15 · *the frame for the whole talk, then the method*

**Slides:** 1 title · 2 two halves · 3 the ladder · 4 stages stack, one layer at a time

**The ladder** — the frame for the whole talk:

```
5  PRECOMPUTE     S6 · static HTML on nginx              3 ms   0.1 cores   limit: staleness, cardinality       ← Part 2
4  EDGE HTML      S3 + S4 · Varnish caches guest HTML    8 ms   0.8 cores   limit: personalization, auth safety ← Part 1 end
3  EDGE STATIC    S3 + Varnish · assets, HTML from DXP  19 ms   1.9 cores   limit: assets only
2  JVM CACHES     S2 · 16 fragments marked Cacheable    37 ms   8.2 cores   limit: user data leaks, cluster invalidation
1  ORIGIN RENDER  S0 · stock                           344 ms    13 cores   limit: CPU first (600 pages/s also hit a fragment-render OOM)
```

Same test on every rung: 200 first-visit page views a second, HTML plus every file, p95 and server CPU with k6 excluded (`part1-simulations/results/RUNG-RESULTS.md`). One box, no network: on a real CDN add the round trip to rungs 3–5, and 8 vs 3 ms stops mattering. Those rungs differ in what must stand behind them. Rung 3 is the surprise: 84 % of Liferay's CPU in a first visit was static files (worst case, an empty browser cache; 78–84 % across rates). Rung 5 is a lighter page by design, 4.6 requests and 96 KB against 56 and 533 KB, so its gain over rung 4 comes from fewer requests, not from nginx being cheaper than Varnish.

**If asked what database:** DXP 2026.q1.12 on the image defaults, Hypersonic and sidecar Elasticsearch, a small site (10 fragment pages, 14 posts, 323 search documents). DB-bound costs are optimistic, so read these as ratios, not capacity.

"Part 1 climbs rungs 1–4 and measures every step. Part 2 is what you do when rung 4 isn't enough."

**The method** (2:15–3:15): one DXP 2026.q1.12 on one 20-core box, Varnish as the local edge, k6 as the load. Stages stack, each changes one layer. S0–S4 run the same two passes (near idle, and the 70/15/10/5 mix at ≈ 120 req/s). The ladder comes from one more test run on every rung: same pages, same rates, 60 s per rate, a whole first visit. S5 is measured as publish-to-fresh; S6 has no sign-in. A gap only counts when it beats the noise between runs: 1 vs 2 ms is a tie.

*Cut if behind:* nothing — this is the frame.

---

# PART 1 — Traditional optimisation, measured (3:15–24:15)

## 1.1 The baseline — 3:15–5:15

**Slides:** 5 a stock guest page on the wire · 6 check the app tier's CPU first

**Demo 1 (30 s, zero risk, commands in `docs/demos/demo1-curl.md`):** `curl -sSD- -o /dev/null https://<your-liferay>/` — read out the cache-killing headers and the three cookies (`JSESSIONID`, `COOKIE_SUPPORT`, `GUEST_LANGUAGE_ID` on stock 2026.q1.12; Liferay-hosted sites also send `SERVER_ID`, which is not in the portal). "This is what every CDN on earth sees when it looks at a stock Liferay: *do not cache me*."

**Say:** `browser.cache.disabled=true` → `ServicePreAction` emits `Cache-Control: private, no-cache, no-store, must-revalidate`, `Pragma` and `Expires`. Independently, `ServicePreAction` calls `getSession()` unconditionally — there is no supported way to not create a guest session; `session.disabled` was last present in 7.4.0-ga1. Both facts from source (dossier 03 §2–3). The usual workaround is stripping the cookie at the edge. "And Liferay deleted its own page cache in 2024. In their tests its hit ratio was 'always 0, since none of our test URLs are cacheable', and the commit calls it 'really useless'. The edge is what's left." (`CacheFilter`, gone at `7.4.3.123-ga123`, 27 June 2024; `brianchandotcom/liferay-portal` PRs #151255, which disabled it, and #151316, which removed it.)

**Where the time goes** — Liferay's own 2024.Q2 benchmark study: one 8-core node, 25,000 concurrent users on plain web content, **11,000** on an Asset Publisher page (the study's summary says 15,000, its Table 2 marks 11,000 and shows a 6.2 s 2σ response at 15,000), 93–94% CPU at the inflection (the study doesn't name the server in those columns and gives no database CPU; the app server is the natural reading). Native login degrades past ~400 concurrent attempts; with password encryption disabled, the study's stand-in for a dedicated IdP, it reaches 19,000. "Check app-tier CPU before you upsize your database." (dossier 04 §9, corrected figures.)

*Cut if behind:* the login/IdP numbers.

## 1.2 S1 Hygiene — 5:15–7:00

**Slide:** 7

`portal-developer.properties` verified absent, `index.on.startup=false`, `session.tracker.memory.enabled=false`, filters left off, JDK 21 `setenv.sh` with G1. (Tomcat JSP `development=false` is Liferay's advice too, but `apply-stage.sh` never touches `conf/web.xml`, so the measured runs did not include it. Liferay's docs print `mappedFile`; Jasper reads `mappedfile`.) Small, honest gains — "this is the floor, not the win." The point of S1 is credibility: remove the noise so later stages measure the real thing.

## 1.3 S2 JVM caches — 7:00–10:30

**Slide:** 8

- **Entity + finder cache sizing per hot entity** — the usual advice, and on paper the biggest query-elimination lever. Our lab could not test it fairly: 10 req/s on in-process Hypersonic, not isolated from the rest of S2. The measured gain came from fragments ("Cache the fragments, not the pages"). **DXP 2025.Q2 moved to Ehcache 3.10.8 (LPD-40485); your 7.4 `liferay-multi-vm.xml` must be rewritten to the 3.x schema.**
- **Fragment `Cacheable` and Web Content template `Cacheable`** — the fragment flag is measured; the template flag is not. The data-leak trap: a cacheable template that renders anything user-specific leaks it to every viewer who passes the article's VIEW check. Audit before ticking.
- **Cluster Link** — `replicatePutsViaCopy=false` is hard-coded; a PUT carries a null value and the receiver *removes*. Turning replication on is almost always the wrong answer. JDBC_PING for cloud discovery.
- **HikariCP:** the shipped pool of 180 is already above the deadlock floor of `maxThreads + 1` (76 for 75 threads). Size it from pool monitoring (`ThreadsAwaitingConnection`). S2 lowered it to 150; it did not raise it.
- Result: a tie at low load (17 vs 17 ms at 100 pages/s), then the gap opens: at 400 pages/s, p95 90 → 13 ms and Liferay 12.4 → 2.1 cores; capacity 400 → 1,200 pages/s. `edge_hit` still 0%. "We are still on rung 2."

*Cut if behind:* Cluster Link internals.

## 1.4 S3 Front-end delivery — 10:30–12:45

**Slide:** 9

`cdn.host.https` + `cdn.dynamic.resources.enabled=true` → theme/module JS/CSS, combo, ES modules, portal images. **Not** Documents & Media, Adaptive Media, portlet resource URLs or HTML. `browser.cache.disabled=false` with `browser.cache.signed.in.disabled=true` **kept**. Rung 3 (Varnish caches assets, HTML passes): Liferay falls to what HTML alone costs. We did not measure `cdn.host.*`; there is no CDN in the lab. "Assets aren't slow, but they eat the CPU": page latency stays flat, yet on a first visit static files were 84 % of Liferay's CPU, and caching them took 200 page views/s from 8.2 to 1.9 cores and clean capacity from 200 to 600 (`RUNG-RESULTS.md`).

## 1.5 S4 Guest HTML at the edge — 12:45–22:15 · *the core of Part 1*

**Slides:** 10 two rules, bypass first (true of VCL) · 11 **the breach** · 12 S4 result · 13 the edge is the step that counts (p95 per stage) · 14 how far each stage goes (capacity) · 15 S5 purge by tag · 16 one sign-in costs a hundred HTML page renders · 17 one setting, twelve times the search

**Demo 2 (90 s, commands in `docs/demos/demo2-varnish.md`, fallback in `deck/recordings/`):** `docker compose up` Varnish in front of the same Liferay (`part1-simulations/matrix/varnish/`), `./run.sh S4-edge-varnish mix`, open `results/SUMMARY.md` and the p95 chart. Measured (`part1-simulations/results/LAB-RESULTS.md`): guest browse journey p95 under load 49 → 21 → 2 ms (S0 → S3 → S4), the mix 521 → 6 ms, 18,656 hits / 16 misses at Varnish across the S4 campaign, Liferay CPU 10.1 → 1.9 cores, and **sign-in stays at 0% edge hit** — the bypass works. Capacity (`STRESS-RESULTS.md`, `RUNG-RESULTS.md`): 400 → 1,200 → 24,800 guest pages/s clean, the last bounded by k6 (static nginx stops at the same number); a sign-in costs ≈ 100 HTML pages of CPU, a search ≈ 50; against a whole first visit, the ladder's page view, a sign-in is about twenty. ZGC gave no gain on the 6 GB heap; stay on G1. If asked about crashes: stock 3 of 13 starts, ZGC 2 of 40, G1 0 of 49, a runaway fragment render (one 2 GB string from jsoup), trigger unknown, not a GC verdict.

**Search highlighting off (slide 17, 1:00):** `highlightEnabled=false` on the Search Results widget. Same results in the same order on the three terms compared, because our compact template shows no snippets. If yours does, you lose the bold terms and, from reading the source, probably the text around the match too. Test it. 25 → 300 searches/s clean, p95 at 20/s 687 → 38 ms, CPU 9.5 → 0.8 cores. Sidecar Elasticsearch on a small index, so the factor will differ elsewhere.

*Cut if behind:* slide 16 (cost), say its one line on the wall slide instead; slide 17 (highlighting), say "turn off search highlighting: twelve times the capacity, same results" over slide 16.

1. Bypass when any auth cookie is present (`COMPANY_ID`, `ID`, `USER_UUID`, `REMEMBER_ME`, `LOGIN`, `PASSWORD`), an `Authorization` header is sent, or method ≠ GET/HEAD.
2. For anonymous GETs: strip `Cookie` in, strip `Set-Cookie` out, normalise the query string, `Vary: Accept-Encoding` only, TTL from origin with `grace` 1 h.

**Order depends on the edge.** In this VCL the bypass comes first, because `return (pass)` ends evaluation. In Cloudflare Cache Rules it's the reverse: the last matching rule wins, so the bypass goes **last**, and the cache rule repeats the auth-cookie exclusions (vendor docs, not tested on a live zone).

**SSO caveat:** `COMPANY_ID` and `ID` are written only by password-style login. SSO auto-login (OIDC, SAML) only sets session attributes, so an SSO user can be signed in with none of these cookies (measured with OIDC, 2026-11-02; SAML read from `master`, not run). Our VCL strips `Cookie` before the origin, so that user sees a guest page rather than leaking (measured). A Cloudflare override TTL has no such protection: in a Varnish model of those rules, the next anonymous visitor got the user's name, email and `authToken`. Cloudflare itself is untested.

**The breach slide (do not skip):** one wrong character in the bypass is a data breach, not a bug. Defence in depth: origin keeps `private` on signed-in responses, though a Cloudflare override TTL ignores it; browser TTL stays bypass; nothing on a public page may need `authToken`.

**S5:** `ModelListener` → purge by `Surrogate-Key` after commit is the design; the listener is an unbuilt sketch. `k6/publish-to-fresh.js` measures publish→fresh-at-edge: 55.7 s on the 60 s TTL alone, fresh within one 250 ms poll (gap 17–19 ms) with a BAN sent by script right after the publish, not yet the listener and not a soft purge. Publications has a public SPI, `CTEventListener.onAfterPublish`, but no Learn page. Object Actions can't fire from `JournalArticle`/`Layout`. Listeners run on the writing node only, so there is no "cluster storm".

## 1.6 The wall — 22:15–24:15

**Slide:** 18

Locale must be in the URL; personalisation moves to late hydration; forms and `ActionURL`s must leave guest pages; every publish needs a purge; a cold page still costs a full JVM render; the origin still runs 24/7 for the misses. **"The edge makes the fast path fast. It doesn't make the slow path cheap."**

---

# PART 2 — A static site that regenerates itself, with AI in charge (24:15–40:15)

## 2.1 The idea — 24:15–27:15

**Slides:** 19 don't render it at all · 20 draw the line by cardinality · 21 authored in Liferay, served as files

Precompute when the output space is small and read:write is high; render live when output is per-user. Everything editors love stays in Liferay; what leaves is the request path.

## 2.2 Demo — 27:15–32:15 · *commands in `docs/demos/demo3-regenerate.md`, fallback in `deck/recordings/`*

**Slides:** 22 live demo · 23 same post, two deliveries

1. `node pipeline/regenerate.mjs --full --no-ai --max-items 80` → 136 pages in ~11–36 s, 3.5 MB.
2. Run again → "nothing changed → skip build (0 tokens)" in ~0.1 s offline / 2–3 s live.
3. Side by side, the same post: **23 kB, 2 scripts, no `authToken`** vs **202 kB, 35 scripts**.
4. Edit one post → plan `+0 ~1 -0`, done in ~1.5 s, purge list = that post + home + blog list + its category page.
5. `--dry-run --full --offline` → ≈12–16k tokens ≈ $0.03 for the whole catalogue, once; lower `AI_BUDGET_TOKENS` and fallbacks kick in.
6. `node tools/check-links.mjs` → 0 broken of ~4,020 links.

## 2.3 Token efficiency — 32:15–35:15

**Slide:** 24 ($0.03)

Plan before model · hash only the fields that matter · rules cached per layout · content-hash AI cache · batching + cheap model + prompt caching (min cacheable prompt 4,096 tokens on the cheap model) · hard budget + ledger.

## 2.4 Static against the edge — 35:15–37:15

**Slide:** 25 static wins on the page, not the HTML

Measured against Varnish (`part1-simulations/results/STATIC-VS-EDGE.md`), same box, same k6: HTML alone is a tie at ≈ 25,000 req/s, k6-bound for both. A whole first-visit page view is 56 requests through Varnish vs 4–5 static; at 1,000 page views/s that is 12× the requests, 5.5× the bytes, ≈ 10× the edge CPU, p95 13 vs 2 ms. Capacity: 1,200 page views/s (the box runs out at 1,500) vs 10,000 (k6), so both are limited by the box or k6, not the server: 67,000 vs 46,000 req/s. Found on the way: the S4 VCL never gzipped CSS/JS (1.9 MB per page view, fixed).

*Cut if behind:* slide 25; say "HTML is a tie, the page is twelve times the requests" before slide 26.

## 2.5 What you give up — 37:15–40:15

**Slide:** 26

Search → Pagefind; comments/forms → islands to the Headless API; sign-in state → late-hydration island; preview/workflow → stays in the portal. Resilience story: the site-pages listing returned HTTP 500 on liferay.dev all day; the fetcher fell back to a seed list.

---

## Close — 40:15–42:15

**Slides:** 27 pages and AI: the same move · 28 what is it, and can we have it? · 29 thank you

Static pages and AI cost control are the same architecture: expensive op → do it at publish time → cache → invalidate by event → marginal cost ≈ 0. Then the ask: `www.liferay.com` answers guests with `public, max-age=60` and `x-lfr-guest-html-cache: 1`, a header found in neither `master` nor shipped 2026.q1.12. Ask what it is and whether customers can have it, and ask for published Core Web Vitals. Also worth naming: `master` now has `StaticSiteExporter` (LPD-105480) behind a flag that is off by default, not in 2026.q1.12 or 2026.q3.1.

## Q&A — 42:15–45:00

"Why not Cloudflare APO?" (no Liferay analogue; PaaS = Google Cloud CDN, 1 h TTL; SaaS = `USE_ORIGIN_HEADERS`) · "Why Astro?" (static by default, islands; Next ISR is the alternative) · "Structured content?" (wired by `contentStructureId`; test on your DXP) · "Model cost if AI is on everywhere?" (show the ledger; the budget caps it).

---

## Prep checklist

- [x] Run the S0→S4 matrix against a real Liferay and replace the placeholder numbers on slide 12 (done 2026-10-24, DXP 2026.q1.12; charts on slides 13, 14, 16).
- [x] `varnishd -C -f matrix/varnish/default.vcl` once — compiled and loaded on Varnish 7.6.5 (`vcl.load`, 2026-10-25).
- [ ] Confirm items marked `UNVERIFIED` in `part1-simulations/matrix/`.
- [ ] Set `ANTHROPIC_API_KEY` and confirm current model IDs so the enrichment path runs live once.
- [ ] Point `.env` at your DXP for one rehearsal.
- [x] Prerecord the demos; conference Wi-Fi is where demos die (2026-11-02, `deck/recordings/`, commands in `docs/demos/`).
- [ ] Re-run the `www.liferay.com` curl the day before for slide 28. On 2026-11-02 guest pages were cached with the header, while `/c/portal/login` returned `private, no-store` (`results/curl-checks-2026-11-02/liferay-com-headers.txt`). It has already changed once.
- [x] Run Demo 1's curl on a stock container and record it (2026-11-02, `results/curl-checks-2026-11-02/stock-guest-headers.txt`): the cookies and headers match slide 5, which abbreviates `Cache-Control` by leaving off `must-revalidate`.
- [ ] Test the Cloudflare rule set on a throwaway zone, bypass last: it comes from the docs and has never run live.
- [x] Put an OIDC user through the lab edge (2026-11-02, `part1-simulations/results/oidc-check-2026-11-02/`).
- [ ] Re-check AI prices and vendor plans; the dossier's were checked on 2026-11-02.
