# Making Liferay Blazing Fast in Production
## 45-minute deep dive — two-part outline

**Liferay DevCon 2026 · Speaker: Miroslav Ligas, Proventeq · Self-hosted DXP 2025+/CE 7.4**

**The arc in one sentence:** Part 1 squeezes everything out of the portal the traditional way and *measures* it — then hits the wall that no setting can move. Part 2 walks around the wall: for content-heavy sites, keep authoring in Liferay but serve plain HTML that regenerates itself, with an AI agent in charge of the regeneration and a hard token budget.

Companion material in this repository:

| | What | Where |
|---|---|---|
| Evidence | Research dossier, 6 parts, fact-checked | `docs/liferay-performance-dossier.md` |
| Slides | 28-slide deck, speaker notes, generated art, measured charts (Chart.js, PNG fallbacks) | `deck/` |
| Part 1 demos | k6 scenarios (TypeScript), S0–S6 config matrix, Varnish VCL, Cloudflare rules, purge listener, Bun runner + summariser + charts | `part1-simulations/` |
| Part 2 demo | Astro static site from Liferay Headless, delta regeneration, AI orchestrator with budget, webhook + timers — all TypeScript on Bun | `part2-static-prototype/` |

Everything we wrote is TypeScript run by Bun (`bun <file>.ts`); k6 executes its own `.ts` scenarios natively (≥ 0.57, no flag). Only the Java `ModelListener` sketch, the Varnish VCL and the Tomcat `setenv.sh` fragments stay in their native languages — they run inside Liferay/Varnish/Tomcat, not on your laptop.

Timing below assumes 45 min including ~5 min Q&A. Every section has a "cut if behind" line so you can land on time. Slide numbers refer to the current 28-slide deck in `deck/`.

---

## Cold open — 0:00–3:00 · *"Half of the tuning advice is dead, and I can prove it from the source"*

**Slides:** 1 title · 2 two halves · 3 the advice graveyard · 4 the ladder

**The graveyard.** `minifier.enabled` → deprecated, defaults false. `javascript.barebone.files` → deprecated, ships empty. `layout.parallel.render.*` → removed in 7.3 (LPS-110359), only AJAX rendering remains. `GZipFilter`/`StripFilter` → off by default, compress at the edge. CMS GC flag → removed in JDK 15, won't boot on the JDK 21 that DXP 2024.Q3+ requires, *still printed in Liferay's own Deployment Checklist PDF*. `retryOnConflict` → unused since 7.1. And the punchline: **`CacheFilter`, the only built-in guest full-page cache, deleted at `7.4.3.123-ga123` on 28 June 2023 with no breaking-change entry.**

**The ladder** — the frame for the whole talk:

```
5  PRECOMPUTE     build/publish time      3 ms          limit: staleness, cardinality       ← Part 2
4  EDGE HTML      CDN/Varnish, guests     2–3 ms        limit: personalization, auth safety ← Part 1 end
3  EDGE STATIC    CDN, JS/CSS/images      2 ms          limit: assets only
2  JVM CACHES     entity/finder/fragment  9–21 ms       limit: memory, cluster invalidation
1  ORIGIN RENDER  full page assembly      14 ms – 1 s   limit: CPU — always CPU
```

Measured p95 on one box with no network RTT (`part1-simulations/results/LAB-RESULTS.md`); on a real CDN add the round trip to rungs 3–5. The top three rungs do not differ in latency, they differ in what must stand behind them.

"Part 1 climbs rungs 1–4 and measures every step. Part 2 is what you do when rung 4 isn't enough."

*Cut if behind:* nothing — this is the hook.

---

# PART 1 — Traditional optimisation, measured (3:00–25:00)

## 1.1 The baseline and the method — 3:00–6:00

**Slides:** 5 a stock guest page on the wire · 6 it's CPU in the app tier · 7 one layer per stage

**Demo 1 (30 s, zero risk):** `curl -sSD- -o /dev/null https://<your-liferay>/` — read out the cache-killing headers and the three cookies (`JSESSIONID`, `COOKIE_SUPPORT`, `SERVER_ID`). "This is what every CDN on earth sees when it looks at a stock Liferay: *do not cache me*."

**Say:** `browser.cache.disabled=true` → `ServicePreAction` emits `private, no-cache, no-store, must-revalidate`. Independently, `ServicePreAction.getSession()` is unconditional — there is no supported way to not create a guest session; `session.disabled` died in 7.4. Both facts from source (dossier 03 §2–3).

**Where the time goes** — Liferay's own 2024.Q2 benchmark study: one 8-core node, 25,000 concurrent users on plain web content, **15,000** on an Asset Publisher page, 93–94% app-tier CPU at peak. Native login degrades past ~400 concurrent attempts; a dedicated IdP takes that to 19,000. "It is CPU in the app tier. You cannot buy your way out with a bigger database." (dossier 04 §9, corrected figures.)

**The rig:** k6 scenarios (`guest-browse`, `asset-publisher`, `search`, `login`, `dl-download`, `headless-api`, `mix`), the metrics that matter more than latency (`edge_hit`, `set_cookie_on_guest`, `cache_control_private`, `ttfb`), and the S0–S6 matrix. **Every stage changes one layer, and every stage runs the same `mix.ts`.**

*Cut if behind:* the login/IdP numbers.

## 1.2 S1 Hygiene — 6:00–8:30

**Slide:** 8

`portal-developer.properties` verified absent, Tomcat JSP `development=false`/`mappedFile=false`, `index.on.startup=false`, `session.tracker.memory.enabled=false`, filters left off, JDK 21 `setenv.sh` with G1 (Generational ZGC as the alternative). Small, honest gains — "this is the floor, not the win." The point of S1 is credibility: remove the noise so later stages measure the real thing.

## 1.3 S2 JVM caches — 8:30–13:00

**Slide:** 9

- **Entity + finder cache sizing per hot entity** — the biggest query-elimination lever. **DXP 2025.Q2 moved to Ehcache 3.10.8 (LPD-40485); your 7.4 `liferay-multi-vm.xml` must be rewritten to the 3.x schema.**
- **Fragment `Cacheable` and Web Content template `Cacheable`** — high impact, and the data-leak trap: a cacheable template that renders anything user-specific leaks it to everyone. Audit before ticking.
- **Cluster Link** — `replicatePutsViaCopy=false` is hard-coded; a PUT carries a null value and the receiver *removes*. Turning replication on is almost always the wrong answer. JDBC_PING for cloud discovery.
- **HikariCP ≈ 2× `maxThreads`**, sized *after* cache tuning.
- Result: origin p95 drops, `edge_hit` still 0%. "We are still on rung 2."

*Cut if behind:* Cluster Link internals.

## 1.4 S3 Front-end delivery — 13:00–16:00

**Slide:** 10

`cdn.host.https` + `cdn.dynamic.resources.enabled=true` → theme/module JS/CSS, combo, ES modules, portal images. **Not** Documents & Media, Adaptive Media, portlet resource URLs or HTML. `browser.cache.disabled=false` with `browser.cache.signed.in.disabled=true` **kept**. With `WITH_ASSETS=1`: assets go to 100% edge hit, HTML stays 0%. "Assets were never your problem."

## 1.5 S4 Guest HTML at the edge — 16:00–23:00 · *the core of Part 1*

**Slides:** 11 two rules, bypass first · 12 **the breach** · 13 S4 result · 14 the edge is the step that counts (p95 per stage) · 15 how far each stage goes (capacity) · 16 S5 purge by tag · 17 one sign-in costs a hundred page views

**Demo 2 (90 s, prerecord a fallback):** `docker compose up` Varnish in front of the same Liferay (`part1-simulations/matrix/varnish/`), `bun run.ts S4-edge mix`, open `results/SUMMARY.md` and the p95 chart. Measured (`part1-simulations/results/LAB-RESULTS.md`): guest page p95 under load 49 → 21 → 2 ms (S0 → S3 → S4), the mix 521 → 6 ms, 18,656 hits / 16 misses at Varnish, Liferay CPU 10.1 → 1.9 cores, and **sign-in stays at 0% edge hit** — the bypass works. Capacity (`STRESS-RESULTS.md`): 400 → 1,200 → 24,800 guest pages/s clean; a sign-in costs ≈ 100 page views of CPU, a search ≈ 50.

*Cut if behind:* slide 17 (cost); say its one line on the wall slide instead.

1. Bypass when any auth cookie is present (`COMPANY_ID`, `ID`, `USER_UUID`, `REMEMBER_ME`) or method ≠ GET/HEAD.
2. For anonymous GETs: strip `Cookie` in, strip `Set-Cookie` out, normalise the query string, `Vary: Accept-Encoding` only, TTL from origin with `grace` 1 h.

**The breach slide (do not skip):** one wrong character in rule 1 is a data breach, not a bug. Defence in depth: origin keeps `private` on signed-in responses, browser TTL stays bypass, nothing on a public page may need `authToken`.

**S5:** `ModelListener` → soft purge by `Surrogate-Key` after commit; `publish-to-fresh.ts` measures publish→fresh-at-edge: 55.7 s on the 60 s TTL alone, 17–19 ms with a ban right after the publish. Missing in the product: no "Publication published" listener API; Object Actions can't fire from `JournalArticle`/`Layout`.

## 1.6 The wall — 23:00–25:00

**Slide:** 18

Locale must be in the URL; personalisation moves to late hydration; forms and `ActionURL`s must leave guest pages; every publish needs a purge; a cold page still costs a full JVM render; the origin still runs 24/7 for the misses. **"The edge makes the fast path fast. It doesn't make the slow path cheap."**

---

# PART 2 — A static site that regenerates itself, with AI in charge (25:00–41:00)

## 2.1 The idea — 25:00–28:00

**Slides:** 19 don't render it at all · 20 draw the line by cardinality · 21 authored in Liferay, served as files

Precompute when the output space is small and read:write is high; render live when output is per-user. Everything editors love stays in Liferay; what leaves is the request path.

## 2.2 Demo — 28:00–35:00 · *prerecord a fallback*

**Slides:** 22 live demo · 23 same post, two deliveries

1. `bun pipeline/regenerate.ts --full --no-ai --max-items 80` → 132 pages in ~10–19 s, 3.3 MB.
2. Run again → "nothing changed → skip build (0 tokens)" in ~0.1 s offline / 2–3 s live.
3. Side by side: **11 kB, 2 scripts, no `authToken`** vs **120 kB, 34 scripts**.
4. Edit one post → plan `+0 ~1 -0`, rebuild ~3 s, purge list = that post + home + blog list + its category page.
5. `--dry-run --full --offline` → ≈12–16k tokens ≈ $0.03 for the whole catalogue, once; lower `AI_BUDGET_TOKENS` and fallbacks kick in.
6. `bun tools/check-links.ts` → 0 broken of ~3,850 links.

## 2.3 Token efficiency — 35:00–38:00

**Slide:** 24 ($0.03)

Plan before model · hash only the fields that matter · rules cached per layout · content-hash AI cache · batching + cheap model + prompt caching (min cacheable prompt 4,096 tokens on the cheap model) · hard budget + ledger.

## 2.4 What you give up — 38:00–41:00

**Slide:** 25

Search → Pagefind; comments/forms → islands to the Headless API; sign-in state → late-hydration island; preview/workflow → stays in the portal. Resilience story: the site-pages listing returned HTTP 500 on liferay.dev all day; the fetcher fell back to a seed list.

---

## Close — 41:00–43:00

**Slides:** 26 pages and AI: the same move · 27 please ship it · 28 thank you

Static pages and AI cost control are the same architecture: expensive op → do it at publish time → cache → invalidate by event → marginal cost ≈ 0. Then the ask: `www.liferay.com` already runs an unshipped guest-HTML cache (`x-lfr-guest-html-cache: 1`) — ship it, and publish Core Web Vitals.

## Q&A — 43:00–45:00

"Why not Cloudflare APO?" (no Liferay analogue; PaaS = Google Cloud CDN, 1 h TTL; SaaS = `USE_ORIGIN_HEADERS`) · "Why Astro?" (static by default, islands; Next ISR is the alternative) · "Structured content?" (wired by `contentStructureId`; test on your DXP) · "Model cost if AI is on everywhere?" (show the ledger; the budget caps it).

---

## Prep checklist

- [x] Run the S0→S4 matrix against a real Liferay and replace the placeholder numbers on slide 13 (done 2026-10-24, DXP 2026.q1.12; charts on slides 14, 15, 17).
- [ ] `varnishd -C -f matrix/varnish/default.vcl` once — the VCL was reviewed, not compiled.
- [ ] Confirm items marked `UNVERIFIED` in `part1-simulations/matrix/`.
- [ ] Set `ANTHROPIC_API_KEY` and confirm current model IDs so the enrichment path runs live once.
- [ ] Point `.env` at your DXP for one rehearsal.
- [ ] Prerecord both demos; conference Wi-Fi is where demos die.
- [ ] Demo the *bare* `www.liferay.com` hostname for slide 27.
