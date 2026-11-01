# Slide 3 verification: "The ladder"

Checked 2026-11-01 against `deck/project/slides/ladder.html` and its speaker notes.

Labels used below:

- **[DATA]** This repo's raw results, with file and line.
- **[SOURCE]** First-party code at a pinned tag.
- **[DOC]** Official documentation.
- **[TESTED]** I ran it for this check. No load test was run and Liferay was not started.
- **[INFERRED]** My reasoning, not stated by a source.
- **[UNVERIFIED]** I could not confirm it.

Paths under `results/` mean `part1-simulations/results/`. Liferay source is pinned to tag `2026.q1.0`. The lab ran DXP 2026.q1.12-lts ([DATA] `LAB-RESULTS.md` L17), which has no public tag, so source lines are the nearest available. The thread dumps' line numbers match that tag for the FreeMarker classes (`FreeMarkerFragmentEntryProcessor` L170) and are 4 lines off for `FragmentEntryFragmentRenderer` (L470 in the dump, L466 in the tag). Raw p95 values were recomputed from the `*.summary.json` files.

> **Status, 2026-11-01:** this checks the earlier ladder. The slide now uses one test on all five rungs, from `part1-simulations/results/RUNG-RESULTS.md`, and has moved to slide 4. The mixed-test problem below no longer applies to it. The source and background findings still do.

## Is it always the same test? No.

The working assumption was that every number comes from one test. It doesn't. **The deck rests on six distinct tests** (section 9), and **the ladder's own figures come from two of them, mixed within single rows, across four different flows.**

| Rung figure | Pass | Flow or object |
|---|---|---|
| 14 ms | Standard (near idle) | Content page |
| 1 s | Load (about 120 req/s) | Search |
| 9 ms | Standard | Content page |
| 21 ms | Load | Four-page guest journey |
| 2 ms | Standard | 210 KB PDF, body discarded |
| 2–3 ms | Load (2), standard (3) | Guest pages |
| 3 ms | Standard | Guest journey, on a different site build |

Directly comparable today: 14 → 9 → rung 4's 3 ms (content page, near idle), and 21 ms or 1 s → rung 4's 2 ms (same flow, under load). Nothing shown spans all five rungs. A comparable set exists in the standard pass: **14 / 9 / 2 (PDF) / 3 / 4 ms**, content page throughout except rung 3 (section 9). `rig.html`'s "same load every time" holds only within each pass, and only for S0–S4 (section 10). On-screen labels are in section 11.

## 1. Summary

Every figure on the slide reproduces from the raw data after rounding. No number is wrong. The problem is what the numbers are said to mean:

1. **"Each rung is cheaper per request" fails at the top.** Edge HTML costs about twice the CPU per request of edge assets, on the same Varnish.
2. **Rung 3 has no stage of its own.** Its 2 ms is one 210 KB PDF through the S4 Varnish. No CSS or JS was measured in any S0–S4 stage run.
3. **Rung 2's 9–21 ms compares two different things.** The 9 is one content page at idle. The 21 is a four-page guest journey under load.
4. **Rung 2's stated limitation (memory, cluster invalidation) was not observed.** The measured limit is still CPU.
5. **Rung 5's 3 ms is not from `STATIC-VS-EDGE.md`.** It comes from the S6 stage run, the guest-browse row, on the simpler pipeline build. The same run gives 2–4 ms by flow.

| Claim as written | Verdict | Reason and proposed wording |
|---|---|---|
| Rung 1 "14 ms – 1 s" | **HOLDS** | 14.32 ms content page at RATE=10; 993.59 ms search at about 120 req/s. It spans flow and load, and 1 s is not a ceiling (sign-in 1.1 s; saturated 4.1 s). |
| "14 ms for a stock content page at idle up to about a second for search under load" | **HOLDS** | Exactly those two cells. Keep the wording. |
| Rung 2 "9–21 ms" | **MISLEADING** | Different flows. Say "9 for a content page at idle, 21 for a browse journey under load". Like for like, the journey is 17 ms idle and 21 ms under load. |
| "JVM caches ... once fragments are Cacheable" | **NEEDS CORRECTION** | S2 also changed the heap, Ehcache override, Hikari and connector, but Cacheable alone reproduces the gain (see 3.2). Stock S0 already has entity and finder caches on, so "JVM caches" is literally true only because the fragment output cache is a portal cache. Name Cacheable in the notes. |
| Rung 3 "2 ms" | **MISLEADING** | 1.69 ms p95 for a PDF at S4, RATE=10, body discarded. Say "2 ms for a PDF through Varnish". |
| Rung 4 "2–3 ms" | **HOLDS** | 3.20–3.41 ms at RATE=10; 2.00–2.29 ms in the load pass. Mostly k6, not Varnish (see 3.4). |
| Rung 5 "3 ms" | **NEEDS CORRECTION (minor)** | Guest browse is 3.16 ms, but content and Asset Publisher pages are 3.72 and 3.84, search 2.28. The honest figure is 2–4 ms. Either change the slide or say "guest browse". |
| Footer "Measured p95 · one box, no network round trip · add your CDN's RTT to rungs 3–5" | **HOLDS** | Also no TLS. k6 shares the box. |
| "Each rung is cheaper per request than the one below it" | **NEEDS CORRECTION** | True for 1→2→edge. False for 3→4; 3 and 5 are level. Proposed: "each rung takes work off the request path, at a price". |
| "each imposes a sharper limitation" | **MISLEADING** | Rhetoric. The limits are different in kind and cannot be ordered, and rung 4's limit also applies to rung 5. Proposed: "a different limitation". |
| "Origin render is limited by CPU, always CPU" | **NEEDS CORRECTION** | Every origin ladder here ended on CPU, but on embedded Hypersonic with no network database. Proposed: "in this lab every origin ladder ran out of CPU". |
| "JVM caches by memory and cluster invalidation" | **NOT VERIFIED** | Single node, Cluster Link skipped. The heap growth seen was guest sessions. The measured limits are CPU and the leak risk. |
| "Edge static only ever covers assets" | **HOLDS** | By design and in the VCL's asset branch. |
| "Edge HTML is limited by personalisation and auth safety" | **HOLDS** | The 403 login bug, the bypass rules and the sign-in ceiling are all evidence. Personalisation itself was not tested. |
| "Precompute by staleness and cardinality" | **NOT VERIFIED** | Sound reasoning, but neither was measured: 75 pages, no S6 publish-to-fresh run. |
| "Part 1 climbs rungs 1 to 4 and measures every step" | **NEEDS CORRECTION** | Rung 3 was not a measured step. Proposed: "Part 1 climbs to rung 4". |
| "Part 2 is rung 5" | **HOLDS** | |
| "edge static, edge HTML and precompute all answer in 2 to 3 milliseconds" | **NEEDS CORRECTION (minor)** | 2–4 ms by flow. |
| "The top rungs do not differ in latency" | **HOLDS, per request only** | Whole page view: 13 ms vs 2 ms at 1,000 views/s. Slide `staticvsedge` depends on that difference. |
| "the edge still needs the full origin for every miss and every purge" | **HOLDS** | With a nuance: grace serves stale while the refresh runs, so no visitor waits, but the origin must still render. |
| "precompute needs none at request time" | **NEEDS CORRECTION** | True for a guest page view on the fidelity build. Not for the build behind the 3 ms, whose images point at Liferay. Sign-in, forms and comments still need it, and so does every rebuild. Proposed: "a static guest page needs it only at build time". |
| Notes on other slides: 69 % of busy threads re-parsing FreeMarker | **HOLDS, wrong load quoted** | Recounted: 179 of 261 runnable threads. Taken at the 600/s step, not 400/s as `s2.html` says. |

## 2. Rung → stage → config → results

Rungs and stages do not map one to one. S1 and S5 have no rung, S3 is a precondition rather than a rung, and rung 3 has no stage.

| Rung | Stage | What was applied | Config | Results | Slide figure from |
|---|---|---|---|---|---|
| 1 Origin render | S0 (S1 is hygiene on the same rung) | Nothing; S1 adds properties and a 4 GB heap | `matrix/S0-baseline/`, `matrix/S1-hygiene/` | `results/S0-baseline/`, `S0-baseline-load/`, `stress/S0-origin-pages/` | `SUMMARY.md` L14 and L37 |
| 2 JVM caches | S2 | 16 fragments Cacheable, Ehcache override, Hikari, 6 GB heap, connector | `matrix/S2-jvm-caches/`, `matrix/local/apply-stage.sh` L108-116 | `results/S2-jvm-caches/`, `S2-jvm-caches-load/` | `SUMMARY.md` L97 and L118 |
| 3 Edge static | None. S3 sets the D&M header; S4 Varnish serves it | `cdn.host.*` skipped (`apply-stage.sh` L10, L41) | `matrix/S3-frontend/osgi-configs/`, `matrix/varnish/default.vcl` L136-143, L211-234 | `results/S4-edge-varnish/dl-download.*` | `SUMMARY.md` L166 |
| 4 Edge HTML | S3 (precondition) + S4; S5 adds purge | `browser.cache.disabled=false`, then Varnish | `matrix/S3-frontend/portal-ext.properties` L26-27, `matrix/varnish/` | `results/S4-edge-varnish/`, `S4-edge-varnish-load/` | `SUMMARY.md` L164-165, L167, L178 (3 ms) and L191-194 (2 ms) |
| 5 Precompute | S6 | Pipeline output on nginx :8090, no CDN | `matrix/S6-static/local/`, `part2-static-prototype/pipeline/` | `results/S6-static/`, `S6-static-gb80/` | `SUMMARY.md` L239; `LAB-RESULTS.md` L106 |

`STATIC-VS-EDGE.md` is a separate run using the other generator (`fidelity/`, nginx :8091). It contains no 3 ms figure.

## 3. Rung by rung

### 3.1 Rung 1: Origin render

**The problem.** Every guest request enters the JVM, gets a new session and has its page assembled from scratch. Stock headers then forbid any cache from helping.

**What we changed.** Nothing at S0. `apply-stage.sh S0` restores the stock `setenv.sh` (2.56 GB heap, `matrix/local/original/setenv.sh` L1) and stock connector (`maxThreads=75`, `original/server.xml` L70), and clears the Cacheable flag. S1 is a hygiene pass on the same rung.

**How it works.**

- [SOURCE] `browser.cache.disabled=true` is the default ([portal.properties L5391](https://github.com/liferay/liferay-portal/blob/2026.q1.0/portal-impl/src/portal.properties#L5391)). [`ServicePreAction` L927-936](https://github.com/liferay/liferay-portal/blob/2026.q1.0/portal-impl/src/com/liferay/portal/events/ServicePreAction.java#L927-L936) then sets `Cache-Control: private, no-cache, no-store, must-revalidate` on the response.
- [DATA] Set-Cookie and `private` on 100 % of guest pages (`SUMMARY.md` L14; headers in `results/S0-baseline/headers.txt`).
- [DATA] The render path is visible in the dumps: `RenderLayoutStructureTag` → `LayoutStructureRenderer` → `FragmentRendererControllerImpl` → `FragmentEntryFragmentRenderer` → each fragment's processors (`stress/S0-origin-pages/threads-600-*.txt.gz`).
- [SOURCE] Entity and finder caches are already on at S0 ([L5797](https://github.com/liferay/liferay-portal/blob/2026.q1.0/portal-impl/src/portal.properties#L5797), [L5822](https://github.com/liferay/liferay-portal/blob/2026.q1.0/portal-impl/src/portal.properties#L5822)). So rung 1 already includes those JVM caches.

**What was measured (DXP 2026.q1.12).** [DATA]

| Flow | Load | p95 | Where |
|---|---|---|---|
| Content page (slide's 14 ms) | RATE=10, 60 s | 14.32 ms | `SUMMARY.md` L14 |
| Asset Publisher page | RATE=10 | 30.17 ms | L13 |
| Guest browse journey | RATE=10 | 18.73 ms | L16 |
| Search | RATE=10 | 391.88 ms | L27 |
| Guest browse journey | mix, about 120 req/s | 48.85 ms | L35 |
| Search (slide's 1 s) | mix, about 120 req/s | 993.59 ms | L37 |
| Sign-in | mix, about 120 req/s | 1,105.58 ms | L36 |
| Guest pages | ladder, 400/s (clean capacity) | 118 ms | `stress/S0-origin-pages/steps.csv` |
| Guest pages | ladder, 600/s target (saturated) | 4,132.7 ms | same file |

- "Guest page 49 ms under load", used elsewhere, is `mix/guest_browse`: home, two content pages, the blog ([DATA] `k6/guest-browse.js` L83-92). It is not a content page.
- Is the range fair? Yes, as the light-load span of guest flows. It mixes flow and load, so it must be spoken as those two cells, which the notes do.

**The limitation.** [DATA] CPU in every origin ladder: 17.4 cores of 18.8 at S0 400/s; search about 90 % Elasticsearch in the same container; sign-in 100 % PBKDF2 (`STRESS-RESULTS.md` L20-24, L40-44). Heap is a secondary limit at saturation: 2.53 GB old gen and 9 full GCs at 600/s (L20). "Always" is not provable here, because the lab uses embedded Hypersonic, so a networked database and connection-pool contention were never tested (`LAB-RESULTS.md` L182-185).

**Alternatives.** Generational ZGC was **not run**: no ZGC result exists, and `GC=zgc` is only an option in `apply-stage.sh`. Don't imply a measurement. For the expensive flows: a real Elasticsearch cluster and an IdP for sign-in (`STRESS-RESULTS.md` L104, L120).

### 3.2 Rung 2: JVM caches

**The problem.** [TESTED, recount of raw dumps] At the S0 600/s step, 179 of 261 RUNNABLE request-thread samples (69 %) were inside `freemarker.template.Template.<init>`, below `FreeMarkerFragmentEntryProcessor`. Same load at S3: 17 of 200 RUNNABLE, 0 parsing. This matches `threads-600-summary.txt`.

Three limits on that figure:

- It is the 600/s target, a saturated step (442 it/s, 26 % dropped), not 400/s.
- It is four samples, 4 s apart ([DATA] summary file L1).
- It is a share of runnable threads on this site. Only 4 of the 16 fragments contain FreeMarker directives ([TESTED] grep of `part0-base-site/fragments/`), but the processor parses all of them ([SOURCE] [L110-112](https://github.com/liferay/liferay-portal/blob/2026.q1.0/modules/apps/fragment/fragment-entry-processor/fragment-entry-processor-freemarker/src/main/java/com/liferay/fragment/entry/processor/freemarker/FreeMarkerFragmentEntryProcessor.java#L110-L112) has no check for directives; the only skip is the instance setting at L81-86, default `true`).

**What we changed in S2** ([DATA] `LAB-RESULTS.md` L44; `apply-stage.sh`):

| Change | Where | Did it matter? |
|---|---|---|
| **16 fragments Cacheable** (JSONWS `update-fragment-entry`, a database flag) | `apply-stage.sh` L108-116 | **Yes, the measured lever** |
| Ehcache 3 override | `S2-jvm-caches/liferay-multi-vm-override.xml` (12 cache entries) | No measurable effect. Headless by-id p95 8 → 8 ms (`LAB-RESULTS.md` L67). No cache statistics were captured. |
| HikariCP 150, Hibernate properties | `S2-jvm-caches/portal-ext.properties` | Not separable |
| 6 GB pre-touched G1 heap | `apply-stage.sh` L60 | Not separable |
| Connector: `acceptCount=1000`, NIO | `apply-stage.sh` L71 | `maxThreads=75` is already stock |
| Cluster Link, JDBC_PING | **Skipped** | Single node (`LAB-RESULTS.md` L52) |
| Web content template Cacheable | **Not toggled** | Not measured |

So the notes on `s2.html` imply more than was done. Entity and finder sizing, Cluster Link and template Cacheable are advice, not results.

**How it works.** [SOURCE]

- [`FragmentEntryFragmentRenderer` L406-419](https://github.com/liferay/liferay-portal/blob/2026.q1.0/modules/apps/fragment/fragment-impl/src/main/java/com/liferay/fragment/internal/renderer/FragmentEntryFragmentRenderer.java#L406-L419): if the fragment is cacheable and content is in the cache, return it, swapping in the nonce. The processors at L466 never run, so neither does the parse.
- [L197-236](https://github.com/liferay/liferay-portal/blob/2026.q1.0/modules/apps/fragment/fragment-impl/src/main/java/com/liferay/fragment/internal/renderer/FragmentEntryFragmentRenderer.java#L197-L236): not used for input fragments, outside view mode, in previews, for draft layouts or for display pages.
- [`FragmentEntryLinkCacheImpl` L86-87](https://github.com/liferay/liferay-portal/blob/2026.q1.0/modules/apps/fragment/fragment-impl/src/main/java/com/liferay/fragment/internal/cache/FragmentEntryLinkCacheImpl.java#L86-L87): a **multi-VM** portal cache.
- [L98-104](https://github.com/liferay/liferay-portal/blob/2026.q1.0/modules/apps/fragment/fragment-impl/src/main/java/com/liferay/fragment/internal/cache/FragmentEntryLinkCacheImpl.java#L98-L104): the key is link ID, locale and segments experience. **No user or role is in the key**, which is the source-level basis for the leak warning.
- [`liferay-multi-vm.xml` L13-19](https://github.com/liferay/liferay-portal/blob/2026.q1.0/modules/apps/portal-cache/portal-cache-ehcache-impl/src/main/resources/ehcache/liferay-multi-vm.xml#L13-L19): default template, TTI 600 s, 200,000 entries. [DOC, legacy KB] [Caches for widget pages and content pages](https://learn.liferay.com/en/kb-article/caches-for-widget-pages-and-content-pages) also gives 600 s for fragments.

**Why does it re-parse when a template cache exists?** An engineer may ask. `LiferayTemplateCache` does have a second-level cache ([L97-103](https://github.com/liferay/liferay-portal/blob/2026.q1.0/modules/apps/portal-template/portal-template-freemarker/src/main/java/com/liferay/portal/template/freemarker/internal/LiferayTemplateCache.java#L97-L103)). [SOURCE, conclusion INFERRED, not run] Reading the code, it is defeated for fragments:

1. Every fragment uses the same ID: `new StringTemplateResource("template_id", "[#ftl] " + html)` (FMP L112).
2. The `FreeMarkerTemplate` constructor calls `cacheTemplateResource` ([L68-70](https://github.com/liferay/liferay-portal/blob/2026.q1.0/modules/apps/portal-template/portal-template-freemarker/src/main/java/com/liferay/portal/template/freemarker/internal/FreeMarkerTemplate.java#L68-L70)).
3. If the content differs from what is stored under that ID, it does a `put` ([`BaseTemplate` L219-228](https://github.com/liferay/liferay-portal/blob/2026.q1.0/modules/apps/portal-template/portal-template-engine-api/src/main/java/com/liferay/portal/template/engine/BaseTemplate.java#L219-L228)).
4. That update fires a listener that removes the same resource from the parsed-template cache ([`BaseTemplateResourceCache` L209-216](https://github.com/liferay/liferay-portal/blob/2026.q1.0/portal-impl/src/com/liferay/portal/template/BaseTemplateResourceCache.java#L209-L216); the new value is passed by [`PortalCacheCacheEventListener`](https://github.com/liferay/liferay-portal/blob/2026.q1.0/modules/apps/portal-cache/portal-cache-ehcache-impl/src/main/java/com/liferay/portal/cache/ehcache/internal/events/PortalCacheCacheEventListener.java)).

So any render of a fragment different from the last one parses again. The dumps fit this. The same ID is still there at `2026.q3.0` and master. **Confirm on a live instance before saying this on stage, in front of Liferay engineers.** Until then, say "threads were re-parsing", not "the cache is broken".

**What was measured.** [DATA]

| Flow | Load | S0 | S1 | S2 | S3 |
|---|---|---|---|---|---|
| Content page (slide's 9 ms) | RATE=10 | 14.32 | 14.53 | **9.28** | 9.32 |
| Guest browse journey | RATE=10 | 18.73 | 18.83 | 16.83 | 16.72 |
| Asset Publisher page | RATE=10 | 30.17 | 31.14 | 30.08 | 29.05 |
| Guest browse journey (slide's 21 ms) | mix, about 120 req/s | 48.85 | 34.77 | **20.73** | 20.62 |
| Asset Publisher page | mix, about 120 req/s | 76.11 | 54.66 | 34.36 | 35.96 |
| Search | mix, about 120 req/s | 993.59 | 792.10 | 638.81 | 652.60 |

Like for like, the ladder's content flow at 200/s is 9.3 ms (S0) and 4.5 ms (S3) (`stress/*/step-200.summary.json`).

**Cacheable isolated, by accident.** [DATA] `stress/_invalid-S0-cacheable-on/` is a stock S0 run with the flag left on, discarded as invalid for its original purpose. It is the only isolation of Cacheable in the repo:

| Guest pages, 200/s | Liferay cores p90 | p50 | p95 | content p95 |
|---|---:|---:|---:|---:|
| S0 stock | 2.46 | 6.5 | 16.5 | 9.3 |
| **S0 stock + Cacheable** | **1.69** | **3.1** | **14.0** | **4.6** |
| S3 all tuning | 1.63 | 3.0 | 13.7 | 4.5 |

**Correction after review:** the 200/s step above was cut short (k6 was terminated: 14 of 29 CPU samples, and the step is missing from `steps.csv`), so treat it as partial. The complete steps agree: at 100/s stock is 1.63 cores and content p95 8.6 ms, stock + Cacheable 1.27 and 6.1, S3 1.30 and 6.1; at 50/s 1.01 and 11.2, 0.76 and 8.4, 0.76 and 8.5. So at these rates Cacheable alone reproduces all of the tuned result. The run stops at 200/s, so the claim that it explains the rise from 400 to 1,200 req/s remains an inference, supported by the 0 % parsing at S3. Capacity: 400 → 1,200 req/s (`STRESS-RESULTS.md` L20-21).

**Did the Asset Publisher benefit?** At idle no: 30.17 → 30.08 ms. Under load yes: 54.66 → 34.36 ms, which cannot be separated from the other S2 changes. "Did not move" and "the gap widened to 3.3×" (30/9) are idle-only statements. The 3.3× compares a page to a page. Don't compute a gap from the load table, whose other row is a journey.

**Is "JVM caches" fair?** As a category, yes: the fragment output cache is a JVM portal cache. As a description of what we did, no. What moved the numbers is caching *rendered output*, which is why `s2.html`'s headline "Cache the entities, not the pages" sits oddly with its own measurement.

**The limitation.**

- Evidenced: [DATA] still CPU. S3 tops out at 1,200 req/s with 15 Liferay cores (`STRESS-RESULTS.md` L21), and every request still enters the JVM.
- Evidenced: [SOURCE] leak risk, because no user is in the key.
- Not evidenced: **memory.** The heap growth seen is guest sessions, 0.7 → 2.1 GB (`STRESS-RESULTS.md` L141-144), not caches.
- Not evidenced: **cluster invalidation.** Single node, never exercised.

**Alternatives.** Web content template Cacheable (not tested). Turning off the FreeMarker processor for instances that don't use it (setting exists, not tested).

### 3.3 Rung 3: Edge static

**The problem.** Assets add requests, but the origin handles them quickly. A page view is 55.9 requests ([DATA] `STATIC-VS-EDGE.md` L41).

**What we changed.** In the lab, little:

- [DATA] `cdn.host.*` was **skipped** because there is no CDN (`LAB-RESULTS.md` L53; `apply-stage.sh` L10).
- [DATA] D&M Cache Control set to `public`, `maxAge=86400` (`S3-frontend/osgi-configs/…CacheControlConfiguration.config` L7-8).
- [DATA] Varnish's asset branch: strip cookies, cache, gzip text (`default.vcl` L136-143, L211-234).

**How it works.** The JVM is not touched on a hit. [INFERRED] from the VCL; Liferay stayed at 0.1–0.2 cores across the page-view ladder (`STATIC-VS-EDGE.steps.md` L50-59).

**What was measured.** So is rung 3 measured or inferred? **Measured, but narrowly.**

- [DATA] The 2 ms is `dl-download` at S4: one 210 KB PDF, RATE=10, p95 1.69 ms, TTFB p95 1.39 ms, 99.8 % edge hit (`SUMMARY.md` L166; `S4-edge-varnish/dl-download.log`). The same PDF from the S3 origin is 4.66 ms (L129).
- [DATA] `WITH_ASSETS=0` in all 14 passes of the stage logs (`results/*.run.log`), so the CSS and JS rows are empty. `http_req_duration{type:asset}` is 0 in `S4-edge-varnish/guest-browse.summary.json`.
- [DATA] Better evidence exists, though not on the slide: the page-view ladder, mostly assets, has request p95 0.3–0.8 ms from 100 to 1,000 views/s (`STATIC-VS-EDGE.steps.md` L51-58, light mode).
- **Why is it faster than rung 4?** Not because assets are cheaper to serve. `dl-download` discards the body (`k6/dl-download.js` L35); HTML runs decompress and read it. Varnish TTFB p95 is the same in both: 1.39 ms PDF, 1.33 ms content page.

**Does slide 9's "TTFB stayed flat" conflict?** No, and it clarifies things. S3 changed headers, not milliseconds (`LAB-RESULTS.md` L142-143), and the PDF stayed flat at S3 (4.54 → 4.66 ms). The 2 ms comes from S4. Rung 3 is therefore not an S3 result.

**The limitation.** Assets only: true by construction. Also found: the VCL originally stored CSS and JS uncompressed, 1.9 MB per page view (`STATIC-VS-EDGE.md` L74-77).

**Alternatives.** A real CDN via `cdn.host.*` plus Frontend Resource Caching (`S3-frontend/README.md`), not run.

### 3.4 Rung 4: Edge HTML

**The problem.** Guest HTML is identical for every anonymous visitor, but stock Liferay forbids sharing it and gives each visitor a session.

**What we changed.**

1. S3: `browser.cache.disabled=false`, `browser.cache.signed.in.disabled=true` (`S3-frontend/portal-ext.properties` L26-27).
2. S4: Varnish 7.6 with `default.vcl` on :6081.

**How it works, given `private, no-store` and Set-Cookie.**

- [SOURCE] With the property false, `ServicePreAction` L927-936 only sets the no-cache headers for signed-in users. [DATA] Guest HTML then has **no** `Cache-Control`, and `private` falls from 100 % to 0 % (`results/S3-frontend/headers.txt`; `SUMMARY.md` L128).
- [DATA] Set-Cookie is still on 100 % at S3 (`SUMMARY.md` L128). A stock Varnish would not store that: [SOURCE] [`builtin.vcl` at varnish-7.6.0](https://github.com/varnishcache/varnish-cache/blob/varnish-7.6.0/bin/varnishd/builtin.vcl) passes on request `Cookie` or `Authorization` (L85-94) and marks responses with `Set-Cookie` or `no-store` as uncacheable (L230-238).
- [DATA] Our VCL gets past this by stripping and returning before the builtin runs. In order:
  - Pass non-GET/HEAD, `/c/`, APIs, `p_auth` and the login portlet (L98-119).
  - Pass auth cookies and `Authorization` (L122-127).
  - Delete `Cookie` (L150) and `return (hash)` (L174).
  - Delete `Set-Cookie` (L238).
  - Respect `private|no-store|no-cache` unless `GUEST_HTML_OVERRIDE=1` (L252-266). This is why S3 is a precondition.
  - TTL 60 s (`docker-compose.yml` L33), grace 1 h (L271).
  - `return (deliver)` (L298).
  - Browser gets `no-cache, must-revalidate, max-age=0` (L295).

**What was measured.** [DATA]

| Flow | Load | S3 | S4 |
|---|---|---|---|
| Content page | RATE=10 | 9.32 | 3.20 |
| Asset Publisher | RATE=10 | 29.05 | 3.41 |
| Search | RATE=10 | 370.78 | 3.26 |
| Guest browse | mix, about 120 req/s | 20.62 | 2.15 |
| Asset Publisher | mix, about 120 req/s | 35.96 | 2.29 |
| Search | mix, about 120 req/s | 652.60 | 2.00 |
| Sign-in | mix, about 120 req/s | 921.29 | 537.17 |

Liferay CPU p90: 10.1 → 1.9 cores ([TESTED] recomputed from `docker-stats.txt`). Clean capacity 24,800 req/s (`STRESS-RESULTS.md` L22).

**The 18,656 hits and 16 misses.** [DATA] `S4-edge-varnish/varnishstat.txt`: `client_req` 23,574, `cache_hit` 18,656, `cache_miss` 16, `s_pass` 4,902, `backend_req` 4,999.

- Hits + misses + passes = 23,574 exactly. 18,656 / 18,672 = 99.91 %, so slide `s4results`'s "99.9 %, cacheable requests" holds. Of all requests it is 79 %.
- **These counters cover the whole S4 campaign, not the ≈120 req/s pass.** The file was written at 12:31:45, after everything. k6 counted 9,623 requests in the RATE=10 pass and 12,060 in the load pass, and the remaining 1,891 are warm-ups. `LAB-RESULTS.md` L89, `s4results` and `stages` read as if they describe the load pass.
- `backend_req` exceeds misses + passes by 81. [INFERRED] These are grace background refreshes, which count as hits. `s_bgfetch` was not captured. So guest renders are closer to 97 than 16, still about 0.5 % of cacheable requests.
- 16 misses reflect a tiny URL set, with only 8 search terms (`STRESS-RESULTS.md` L195-196). Real long-tail traffic would be worse.

**Why 2–3 ms is mostly the load generator.** [DATA] The same Varnish at 4,000 req/s in light mode, where k6 never reads the body, has p95 0.4 ms (`STATIC-VS-EDGE.steps.md` L22). TTFB p95 at RATE=10 is 1.33 ms against 3.20 ms total. Idle (3 ms) being slower than load (2 ms) also shows this spread isn't a server signal. [INFERRED] The remainder is k6 receiving and decompressing the body. Don't read 2 vs 3 as meaningful.

**The limitation.** [DATA]

- Auth safety: the VCL originally cached the login redirect page and stripped its cookie, so **every** login through the edge failed with 403 (`LAB-RESULTS.md` L152-157).
- Sign-in never leaves the origin and caps the edge mix at 400 it/s (`STRESS-RESULTS.md` L27, L126-130).
- Freshness: 55.7 s on TTL, 17–19 ms with a BAN (`LAB-RESULTS.md` L117-118). The BAN was sent by script; the Java listener was not built (L120-122).
- Personalisation was not tested.

**Alternatives.** Cloudflare Cache Rules: `matrix/cloudflare/cache-rules.md` is written but **no run exists**.

### 3.5 Rung 5: Precompute

**The problem.** The edge still leaves a full-size JVM behind it for misses, and a Liferay page drags 56 requests with it.

**What we changed.** Generated static HTML and served it from nginx. **No Varnish or CDN in front in any run**, although `S6-static/README.md` describes that design.

Two different builds exist, and the slide's figure uses the simpler one:

| | S6 stage run (slide's 3 ms) | Static vs edge run |
|---|---|---|
| Generator | `pipeline/regenerate.mjs` → `dist-proventeq` | `fidelity/build.mjs` → `dist-fidelity` |
| Output | 29 pages, 1.15 MB, 7.3 s (`LAB-RESULTS.md` L22) | 75 pages, about 6 s, 34 Liferay requests (`fidelity/README.md`) |
| Look | Theme stripped (`LAB-RESULTS.md` L192-194) | Matches the portal |
| Server | nginx :8090, **gzip per request** (`S6-static/local/nginx.conf` L12) | nginx :8091, `gzip_static` |
| Assets | **Images and PDF still from Liferay** ([TESTED] 14 `src` values point at `127.0.0.1:8086`) | Copied into the output |

**How it works.** The file is already rendered, so no JVM, session or template work happens at request time.

**What was measured.** [DATA]

| Flow | Load | S4 Varnish | S6 nginx |
|---|---|---|---|
| Guest browse (slide's 3 ms) | RATE=10 | 3.39 | **3.16** |
| Guest browse | 39 req/s | 3.33 | 3.06 |
| Content page | RATE=10 | 3.20 | 3.72 |
| Asset Publisher | RATE=10 | 3.41 | 3.84 |
| Search (static shell) | RATE=10 | 3.26 | 2.28 |

- [DATA] TTFB p95 is **worse** for S6: 1.80–3.15 ms vs 1.32–1.38 ms. [INFERRED] The on-the-fly gzip.
- [DATA] S6 did not run the ≈120 req/s mix, so "under load" has no rung 5 equivalent. Its ladder is in `STATIC-VS-EDGE`.
- [DATA] Static vs edge run: HTML is a tie, 0.4 ms at 4,000 req/s for both (steps L9, L22), 24,900 vs 24,800 req/s clean, both limited by k6.
- [DATA] Whole page view at 1,000/s: 4.6 vs 55.9 requests, 99 vs 545 MB/s, 0.3 vs 3.1 cores, **2 vs 13 ms** (`STATIC-VS-EDGE.md` L28-31, L41). This is where rung 5 actually wins, and slide 3 can't show it because it measures one request.

**What rung 5 still calls Liferay for.**

- Every rebuild: 34 API requests in the fidelity build.
- Sign-in: 75 pages link to `:8086/c/portal/login` ([TESTED] grep of `dist-fidelity`).
- Contact form: markup only, no endpoint (`fidelity/README.md`).
- Comments, forms, sign-in state: islands calling Headless API (`breaks.html`).
- Editors, workflow and preview: stay in the portal (`boundary.html`).

**The limitation.**

- Staleness: [DATA] 15-minute timer (`schedule/crontab` L3, `liferay-static.timer`), optional webhook. **No S6 publish-to-fresh run exists.**
- Cardinality: **not tested.** 75 pages is small. The build fails on unsupported FreeMarker or widgets (`fidelity/README.md`, Limits).

**Alternatives.** The repo uses Astro and a custom generator. Next ISR, ESI: no data here. Mention as options only.

## 4. Cross-rung claims

### "Each rung is cheaper per request"

[DATA, derived] CPU ÷ rate from the steps files (cores p90; Liferay's figure includes the Elasticsearch sidecar).

| Rung | Evidence | CPU per request |
|---|---|---|
| 1, S0 guest page | 2.5 cores at 200/s, 5.0 at 300/s | 12–17 ms; 43 ms at 400/s |
| 2, S3 guest page | 2.4 at 300/s, 8.8 at 1,000/s | 8–10 ms |
| 3, Varnish, nearly all assets | 0.9 at 16,807 req/s, 3.1 at 55,873 | **0.054 ms** (9.8 KB per request) |
| 4, Varnish, HTML | 1.5 at 16,000 req/s, 2.6 at 24,789 | **0.09–0.105 ms** (23 KB per request) |
| 5, nginx, HTML | 0.8 at 16,000 req/s, 1.1 at 24,946 | **0.044–0.05 ms** (6 KB per request) |

- **1 → 2:** holds.
- **2 → edge:** holds, about 100×.
- **3 → 4:** **fails.** Edge HTML costs about twice edge assets. They are different objects, so "cheaper" isn't even a like-for-like comparison.
- **4 → 5:** holds by 2×, but it largely tracks bytes (6 vs 23 KB) and is a different server.
- **3 → 5:** level.

Per whole page view, the idea does hold: 3.1 ms CPU at the edge vs 0.3 ms static (`STATIC-VS-EDGE.md` L30). Per **origin** CPU it also holds: 8–10 ms → 0 on a hit. Also not counted above: rung 4's misses, and rung 5's build.

### "A sharper limitation"

Rhetoric. Rung 3's limit is scope, rung 4's is safety, rung 5's is freshness. They can't be ordered, and rung 5 inherits rung 4's personalisation limit, handled by islands. The honest framing is "each has a different price".

### What stands behind each rung

| Rung | Needed at request time | Evidence |
|---|---|---|
| 1, 2 | Full Liferay on every request | S3 at 1,200 req/s: 15 cores |
| 3 | Liferay for misses and all HTML | VCL |
| 4 | Liferay for misses, purges, sign-in, APIs. Guests wait only on a true miss | Liferay 0.2 cores at 24,800 req/s; 1.9 cores in the mix |
| 5 | Nothing for a guest page view on the fidelity build. Liferay for rebuilds, sign-in, forms | 0.1–0.2 cores was Liferay's idle floor in the static ladder |

On purge: `default.vcl` uses BAN, a hard invalidation, so the next visitor triggers a miss. `default-xkey.vcl` soft-purges, so visitors get stale while the origin refreshes. Either way the origin renders.

## 5. Proposed speaker notes

Two versions, depending on whether the slide's figures change. Plain text, as they go in the aside element. If a methods slide is added before the ladder, the timing label needs moving in both.

### 5A. Slide figures unchanged

Spoken part: 201 words. Whole aside: 3,238 characters including the timing label.

```html
<aside>[1:00–2:15 · 1:15] The frame for the whole talk. Five rungs, and each one takes work off the request path, at a price. Rung 1, origin render: 14 milliseconds for a stock content page at idle, about a second for search under load. In this lab every origin ladder ran out of CPU. Rung 2: mark fragments Cacheable and Liferay stops re-parsing their FreeMarker templates. 9 milliseconds for a content page at idle, 21 for a browse journey under load. The price: anything user-specific leaks, and every request still reaches the JVM. Rung 3: assets at the edge, 2 milliseconds for a PDF through Varnish, but assets only. Rung 4: guest HTML at the edge, 2 to 3 milliseconds, as long as auth stays out of the cache. Rung 5: pre-rendered files, 3 milliseconds on nginx, at the price of staleness and cardinality. All measured on one box with no network, so add your CDN's round trip to the top three. Those three tie on latency. They differ in what stands behind them: the edge still needs Liferay for every miss and purge; a static guest page needs it only at build time. Part 1 climbs to rung 4. Part 2 is rung 5.<br><br>IF ASKED (not spoken)<br>Rung 1, S0, stock. Every guest request enters the JVM, gets a session and is assembled from scratch. browser.cache.disabled=true sends private, no-store, so no cache may help. 14 ms is the content page at 10 req/s, 1 s is search in the mix at about 120 req/s; the guest browse there is 49 ms. Stock capacity is 400 pages a second.<br>Rung 2, S2. Thread dumps at the 600 a second step: 179 of 261 runnable request threads, 69 percent, parsing fragment FreeMarker. We marked 16 fragments Cacheable through JSONWS. FragmentEntryFragmentRenderer then returns cached output before any processor runs, keyed by link, locale and experience. No user in the key, hence the leak. S2 also changed heap, Ehcache, Hikari and connector, but a stock run left with Cacheable on matched fully tuned at 100 a second: 1.27 cores against 1.30, stock 1.63; content page 6.1 ms against 6.1, stock 8.6. Capacity 400 to 1,200, still CPU. Entity sizing showed nothing: headless by-id stayed 8 ms. Asset Publisher stayed 30 ms at idle. Single node, so cluster invalidation is untested.<br>Rung 3. No stage of its own: cdn.host skipped, no CSS or JS measured in the stage runs. 2 ms is the 210 KB brochure PDF, Documents and Media set to public, max-age 86400, served by Varnish; 4.7 ms from the origin.<br>Rung 4, S3 plus S4. browser.cache.disabled=false removes no-store for guests. Set-Cookie stays, so the VCL strips Cookie in and Set-Cookie out, bypasses on auth cookies, TTL 60 seconds, grace one hour. Across the whole S4 run 18,656 hits, 16 misses, on a small URL set. Liferay 10.1 to 1.9 cores. Most of the 2 to 3 ms is k6 reading the body: 0.4 ms with the body unread.<br>Rung 5, S6. Part 2's pipeline output, 29 pages on nginx, no CDN. Guest browse 3.2 ms; by flow 2 to 4. Images in that build still came from Liferay; the fidelity build copies them. It makes 34 API requests in about 6 seconds for 75 pages. Sign-in and forms still need the portal.<br>CPU per request: stock page 12 to 17 ms, Cacheable 8 to 10, Varnish HTML 0.1, nginx 0.05. Edge assets cost less than edge HTML, so don't claim every rung is cheaper. Per page view: edge 3.1 ms, static 0.3.</aside>
```

### 5B. Recommended: one comparable set (14 / 9 / 2 / 3 / 4 ms, section 9)

Spoken part: 198 words. Whole aside: 3,395 characters including the timing label.

```html
<aside>[1:00–2:15 · 1:15] The frame for the whole talk. Five rungs, and each one takes work off the request path, at a price. One test on every rung: p95 for one content page, near idle, about 10 requests a second. Rung 1, stock Liferay: 14 milliseconds. Near idle flatters it: under load, search on the same origin reaches a second. In this lab every origin ladder ran out of CPU. Rung 2: mark fragments Cacheable and Liferay stops re-parsing their FreeMarker templates. 9 milliseconds. The price: anything user-specific leaks, and every request still reaches the JVM. Rung 3, assets at the edge: 2 milliseconds, measured on a PDF, not a page. Assets only. Rung 4, guest HTML at the edge: 3 milliseconds, as long as auth stays out of the cache. Rung 5, pre-rendered files: 4 milliseconds on nginx, at the price of staleness and cardinality. Add your CDN's round trip to the top three. Those three tie: 3 against 4 is noise. They differ in what stands behind them: the edge still needs Liferay for every miss and purge; a static guest page needs it only at build time. Part 1 climbs to rung 4. Part 2 is rung 5.<br><br>IF ASKED (not spoken)<br>Rung 1, S0, stock. Every guest request enters the JVM, gets a session and is assembled from scratch. browser.cache.disabled=true sends private, no-store, so no cache may help. Under the mix at about 120 req/s, guest browse is 49 ms and search 1 s. Stock capacity is 400 pages a second.<br>Rung 2, S2. Thread dumps at the 600 a second step: 179 of 261 runnable request threads, 69 percent, parsing fragment FreeMarker. We marked 16 fragments Cacheable through JSONWS. FragmentEntryFragmentRenderer then returns cached output before any processor runs, keyed by link, locale and experience. No user in the key, hence the leak. S2 also changed heap, Ehcache, Hikari and connector, but a stock run left with Cacheable on matched fully tuned at 100 a second: 1.27 cores against 1.30, stock 1.63; content page 6.1 ms against 6.1, stock 8.6. Browse under the mix 21 ms. Capacity 400 to 1,200, still CPU. Entity sizing showed nothing: headless by-id stayed 8 ms. Asset Publisher stayed 30 ms at idle. Single node, so cluster invalidation is untested.<br>Rung 3. No stage of its own: cdn.host skipped, no CSS or JS measured in the stage runs. 2 ms is the 210 KB brochure PDF, Documents and Media set to public, max-age 86400, served by Varnish; 4.7 ms from the origin.<br>Rung 4, S3 plus S4. browser.cache.disabled=false removes no-store for guests. Set-Cookie stays, so the VCL strips Cookie in and Set-Cookie out, bypasses on auth cookies, TTL 60 seconds, grace one hour. Across the whole S4 run 18,656 hits, 16 misses, on a small URL set. Liferay 10.1 to 1.9 cores. 2 ms in the mix. Most of it is k6 reading the body: 0.4 ms with the body unread.<br>Rung 5, S6. Part 2's pipeline output, 29 pages on nginx, no CDN. Content page 3.7 ms, guest browse 3.2; by flow 2 to 4. Images in that build still came from Liferay; the fidelity build copies them. It makes 34 API requests in about 6 seconds for 75 pages. Sign-in and forms still need the portal.<br>CPU per request: stock page 12 to 17 ms, Cacheable 8 to 10, Varnish HTML 0.1, nginx 0.05. Edge assets cost less than edge HTML, so don't claim every rung is cheaper. Per page view: edge 3.1 ms, static 0.3.<br>Tests. These figures: the standard pass, every scenario, 60 s, near idle. Load pass: S0 to S4 only. Capacity and static-vs-edge are separate ladders.</aside>
```

## 6. Inconsistencies in other slides and docs

| Where | Says | Evidence | Fix |
|---|---|---|---|
| `capacity.html`, `staticvsedge.html`, `STRESS-RESULTS.md` L22, L65, `STATIC-VS-EDGE.md` L65 | Varnish's **default** 2,000-thread cap | **Wrong.** [TESTED] `varnishd -x parameter` on `varnish:7.6`: default `thread_pool_max` 5000, `thread_pools` 2. [DATA] 1,000 per pool is **our** setting (`varnish/docker-compose.yml` L36). | "our 2,000-thread setting". The 1,200 page views/s limit is our configuration. Raise it and re-run before saying more. |
| `s2.html` notes | Dumps "at 400 pages a second" | 600/s target, saturated (`STRESS-RESULTS.md` L81) | "at the 600 a second step" |
| `capacity.html` notes, `STRESS-RESULTS.md` L20 | Places 69 % beside the 400/s capacity | Same | Name the 600/s step |
| `s2.html` visible and notes | "content page ... 35 → 21 ms under load" | `mix/guest_browse`, a journey, not a content page | "guest pages" |
| `stages.html` notes, `s4results.html` notes, `LAB-RESULTS.md` L80 | "content page" 49 → 21 → 2 | Same | "guest pages" |
| `s2.html` notes | Asset Publisher "did not move" | Idle only. 54.66 → 34.36 ms under load | Add "at idle" |
| `s2.html` headline and notes | "Cache the entities, not the pages"; entity sizing "biggest query-elimination lever" | Entity sizing unmeasured here, by-id flat; the measured lever is output caching | Separate advice from measurement |
| `s2.html` notes | "marking the 16 fragments Cacheable took the content page..." | S2 changed more, though the accidental run supports it | Acceptable; cite it if challenged |
| `s4results.html`, `stages.html`, `LAB-RESULTS.md` L89 | 18,656 / 16 next to the ≈120 req/s mix | Whole S4 campaign | "across the S4 run" |
| `LAB-RESULTS.md` L146, `MATRIX.md` L19 | "query allow-list" | [DATA] VCL L157-158 **removes** listed params and keeps the rest. It is a deny-list. Unknown params create new objects | Fix the docs, or add an allow-list |
| `s4rules.html` notes | Bypass cookies: four names | VCL L122-124 also has `LOGIN`, `PASSWORD`, `Authorization` | Minor |
| `s5purge.html` notes | `publish-to-fresh.ts` | File is `k6/publish-to-fresh.js` | Minor |
| `talk-outline-45min.md` L27-39, `speaker-notes.md` L13, dossier L60 | Same ladder wording | Same corrections as section 1 | Sync with the notes |
| `rig.html` title and notes | "One layer per stage, same load every time"; "Every stage changes one layer and runs the same mix" | Holds only within a pass, S0–S4 (section 10) | See section 10 |
| `agenda.html` notes | "every stage runs the same load test" | Same | "S0 to S4 run the same two passes" |
| `rig.html` footer and notes, `demo.html`, `architecture.html` | k6 scenarios "in TypeScript", "run with Bun"; `bun pipeline/regenerate.ts`; pipeline "all TypeScript on Bun" | [TESTED] No `.ts` files in `part1-simulations/k6/` or `part2-static-prototype/pipeline/`. The repo has `k6/*.js` and `pipeline/*.mjs`, and `LAB-RESULTS.md` L210 runs `node pipeline/regenerate.mjs` | Match the repo, or confirm a port is planned |
| `capacity.html` | Compares 400, 1,200 and 24,800 req/s as one chart | Origin ladders ran full k6 checks; the 24,800 is `LIGHT=1` (`stress-campaign.sh` L61). Full checks stopped at about 6,800 because k6 saturated (`STRESS-RESULTS.md` L70-74) | Footnote "edge ladder: k6 light mode" |
| `talk-outline-45min.md` L75 | "origin p95 drops ... still on rung 2" | Consistent | None |
| `MATRIX.md` L16, `S1-hygiene/portal-ext.properties` | "CMS removed JDK 15" | JDK 14 per `docs/slide-3-verification.md` | Fix |

Consistent, checked: `s1.html` (49 → 35), `s3.html` (flat, 100 % → 0 %), `s4results.html` (−96 %), `wall.html` (15–50 ms, about 1 s), `cost.html` (matches `STRESS-RESULTS.md` L40-44), `staticvsedge.html` (all figures). `sidebyside.html` measures liferay.dev, not this lab, so its kB figures don't conflict.

The task brief named `regenerate.ts`; the repo has `pipeline/regenerate.mjs`.

## 7. Not verified

- **The template-cache explanation in 3.2** is from reading source, not from a running instance.
- **The exact 2026.q1.12 source.** No public tag; I used `2026.q1.0`.
- **The cause of Asset Publisher's improvement under load.** Not separable.
- **Cacheable's share above 200/s.** The accidental run stops there.
- **The 81 extra backend requests** being grace refreshes. `s_bgfetch` wasn't captured.
- **Whether the Ehcache override changed anything.** No JMX statistics captured.
- **Who invalidates the fragment cache on publish.** I did not trace the callers of `removeFragmentEntryLinkCache`.
- **Official docs for Cacheable.** The Learn page I tried returned 404. Only legacy KB articles were reached, and they are marked as not official documentation.
- **Varnish user-guide pages.** The fetch tool returned no page content, so Varnish claims rest on `builtin.vcl`, `params` and the `varnishd -x parameter` output.
- **Why S3's sign-in rate is lower in the load pass** (7.5 vs about 11 req/s). `LAB-RESULTS.md` L165-168 describes a `login.js` check that skipped the signed-in page from S3 on, which fits, but no log confirms which script version ran.
- **The on-screen labels' fit.** Estimated from the slide's CSS, not rendered.
- **Not run in this lab:** ZGC, Cloudflare, a real CDN, TLS, a networked database, multi-node, personalisation, S6 publish-to-fresh.
- **`fidelity/README.md` figures** (about 6 s, 34 requests) are as stated there. I didn't re-run the build.

## 8. Sources

**First-party code**

- Liferay `2026.q1.0`: [`FreeMarkerFragmentEntryProcessor`](https://github.com/liferay/liferay-portal/blob/2026.q1.0/modules/apps/fragment/fragment-entry-processor/fragment-entry-processor-freemarker/src/main/java/com/liferay/fragment/entry/processor/freemarker/FreeMarkerFragmentEntryProcessor.java), [`FragmentEntryFragmentRenderer`](https://github.com/liferay/liferay-portal/blob/2026.q1.0/modules/apps/fragment/fragment-impl/src/main/java/com/liferay/fragment/internal/renderer/FragmentEntryFragmentRenderer.java), [`FragmentEntryLinkCacheImpl`](https://github.com/liferay/liferay-portal/blob/2026.q1.0/modules/apps/fragment/fragment-impl/src/main/java/com/liferay/fragment/internal/cache/FragmentEntryLinkCacheImpl.java), [`LiferayTemplateCache`](https://github.com/liferay/liferay-portal/blob/2026.q1.0/modules/apps/portal-template/portal-template-freemarker/src/main/java/com/liferay/portal/template/freemarker/internal/LiferayTemplateCache.java), [`FreeMarkerTemplate`](https://github.com/liferay/liferay-portal/blob/2026.q1.0/modules/apps/portal-template/portal-template-freemarker/src/main/java/com/liferay/portal/template/freemarker/internal/FreeMarkerTemplate.java), [`BaseTemplate`](https://github.com/liferay/liferay-portal/blob/2026.q1.0/modules/apps/portal-template/portal-template-engine-api/src/main/java/com/liferay/portal/template/engine/BaseTemplate.java), [`BaseTemplateResourceCache`](https://github.com/liferay/liferay-portal/blob/2026.q1.0/portal-impl/src/com/liferay/portal/template/BaseTemplateResourceCache.java), [`ServicePreAction`](https://github.com/liferay/liferay-portal/blob/2026.q1.0/portal-impl/src/com/liferay/portal/events/ServicePreAction.java), [`portal.properties`](https://github.com/liferay/liferay-portal/blob/2026.q1.0/portal-impl/src/portal.properties), [`liferay-multi-vm.xml`](https://github.com/liferay/liferay-portal/blob/2026.q1.0/modules/apps/portal-cache/portal-cache-ehcache-impl/src/main/resources/ehcache/liferay-multi-vm.xml).
- Varnish `varnish-7.6.0`: [`builtin.vcl`](https://github.com/varnishcache/varnish-cache/blob/varnish-7.6.0/bin/varnishd/builtin.vcl). `varnishd -x parameter` from the `varnish:7.6` image.

**Official docs (legacy KB, marked as not official documentation)**

- [Caches for widget pages and content pages](https://learn.liferay.com/en/kb-article/caches-for-widget-pages-and-content-pages)
- [How does the fragment caching work](https://learn.liferay.com/kb-article/how-does-the-fragment-caching-work-)

**This repo's data**

- `part1-simulations/results/`: `LAB-RESULTS.md`, `STRESS-RESULTS.md`, `STATIC-VS-EDGE.md`, `STATIC-VS-EDGE.steps.md`, `SUMMARY.md`, `*.run.log`, `S*/*.summary.json`, `S4-edge-varnish/varnishstat.txt`, `stress/*/steps.csv`, `stress/*/threads-600-*`, `stress/_invalid-S0-cacheable-on/`.
- `part1-simulations/matrix/`: `MATRIX.md`, `local/apply-stage.sh`, `varnish/default.vcl`, `varnish/docker-compose.yml`, `S6-static/local/nginx.conf`.
- `part2-static-prototype/`: `fidelity/README.md`, `schedule/`, `dist-proventeq/`, `dist-fidelity/`.

**Secondary, leads only:** `docs/liferay-performance-dossier.md`. Nothing above rests on it.

## 9. Test method inventory

### The tests

| | 1. Standard pass | 2. Load pass | 3. Guest-traffic pass | 4. Publish test | 5. Stress ladders | 6. Static-vs-edge ladders |
|---|---|---|---|---|---|---|
| **Driver** | `run-stage.sh` → `campaign.sh` | `run-stage.sh` L14 | `campaign.sh` with `RATE=80 VUS=20 DURATION=90s` | `matrix/local/s5-publish.sh` | `stress-campaign.sh` → `stress.sh` | `static-vs-edge.sh` → `stress.sh` |
| **Asked for** | `RATE=10` iterations/s, `VUS=10`, max 40 VUs | `RATE=80`, `VUS=20`, about 360 VUs | `RATE=80`, `VUS=20`, max 80 VUs | Poll every 250 ms | Stepped rates, `MAX_VUS` 1,500 (3,000 edge) | Stepped rates, `MAX_VUS` 3,000 |
| **Actually ran** | 9.3 req/s per single-page scenario. Journeys capped: guest-browse 18.4 req/s, 4.4 it/s, 4.6 it/s dropped | 114–120 req/s **averaged over a ramp**, 38 it/s, about 12.4 it/s dropped | 38.5–39.2 req/s, about 9.4 journeys/s, about 66 dropped | n/a | To saturation | To saturation |
| **Duration** | 60 s, plus 30 s warm-up | 90 s (ramp 25 %, 100 %, hold, down), plus warm-up | 90 s, plus warm-up | One publish: TTL ×1, purge ×3 | 60 s per step, 20 s cooldown | 60 s per step |
| **Model** | Open, constant arrival, think time 1–3 s | Open, ramping arrival, think time 1–3 s | As standard | k6 polling | Open, constant arrival, **no think time**, 10 s timeout | As stress, **`LIGHT=1`**: body never read |
| **Scenarios** | guest-browse, sticky, asset-publisher, search, login, dl-download, headless-api, mix. **S6: first four only (no mix)** | `mix` only: 70 % browse, 15 % search, 10 % AP, 5 % sign-in | guest-browse only | `publish-to-fresh` | `stress.js`: `pages`, `search`, `login`, `mix` (**85/12/3, a different mix**) | `pages` and `pageview` (HTML plus every same-origin file) |
| **Target** | S0–S3 :8086, S4 :6081, S6 :8090 | S0–S4 only | S3 :8086, S4 :6081, S6 :8090 | Origin and :6081 | S0, S3 :8086, S4 :6081 | Varnish :6081, nginx :8091 |
| **Site** | Part 0 on Liferay. S6: `dist-proventeq` (29 pages, theme stripped) | Part 0 on Liferay | As standard | News page | Part 0 on Liferay | Liferay vs `dist-fidelity` (75 pages, same look) |
| **State before** | `apply-stage.sh` restart; S0 on a long-lived JVM (`LAB-RESULTS.md` L138-139) | Follows the standard pass, no restart | Run later, on the live stage | Live | Restart + 60 s warm before each origin ladder | Not restarted between ladders |
| **Date** | 2026-10-24 | 2026-10-24 | 2026-10-24 | 2026-10-24 | 2026-10-24 | 2026-10-25 |
| **Results** | `results/<stage>/`, `LAB-RESULTS.md` L58-74 | `results/<stage>-load/`, L76-92 | `results/*-gb80/`, L94-106 | `results/S5-*/`, L110-122 | `results/stress/`, `STRESS-RESULTS.md`, `stress/STEPS.md` | `results/stress/S6-static-*`, `S4-edge-pages-r2`, `S4-edge-pageview`, `STATIC-VS-EDGE.md`, `.steps.md` |

All six use DXP 2026.q1.12, one 20-core host shared with k6, no network, no TLS. Each configuration ran once, apart from the three purge runs and one repeated sign-in step.

Sources: [DATA] `campaign.sh` L8-9, L20; `run-stage.sh`; `k6/lib/config.js` L87-104; `k6/mix.js` L36-58, L74-77; `static-vs-edge.sh` L18-22; `stress-campaign.sh`; `results/*/*.summary.json` (`dropped_iterations`, `vus_max`, `http_reqs`); `*.run.log`.

Corrections to the first-look list in the brief:

- **The standard pass isn't quite "RATE=10" either.** The rate is iterations, and journey scenarios hit the 40-VU cap and dropped about half.
- **The load pass isn't a steady 120 req/s.** That is the average over a ramp, so the plateau is higher.
- **There is a third pass, `gb80`,** used by no slide. It is the only test that runs the origin, the edge and static at one load.
- **`mix` means two things.** 70/15/10/5 journeys in the load pass; 85/12/3 single requests in the stress ladders. `rig.html` names only the first.
- **The load pass was not identical at S3.** Sign-in ran at 7.5 req/s against about 11 elsewhere (`SUMMARY.md` L156 vs L36, L119, L193), hence 114 rather than about 118 req/s. Mix p95 at S3 is not strictly comparable.
- **Other evidence is not load testing:** thread dumps (probe steps during test 5), `varnishstat` (cumulative across S4), `headers.txt` (curl), and `*-mock` runs (scripts only, excluded).

### Which slide figure comes from which test

| Slide | Figure | Test |
|---|---|---|
| **ladder** rung 1 | 14 ms | 1 Standard, S0, content page |
| **ladder** rung 1 | 1 s | 2 Load, S0, search |
| **ladder** rung 2 | 9 ms | 1 Standard, S2, content page |
| **ladder** rung 2 | 21 ms | 2 Load, S2, guest journey |
| **ladder** rung 3 | 2 ms | 1 Standard, S4, PDF |
| **ladder** rung 4 | 3 ms | 1 Standard, S4, guest flows |
| **ladder** rung 4 | 2 ms | 2 Load, S4, guest flows |
| **ladder** rung 5 | 3 ms | 1 Standard, S6, guest journey (test 3 agrees: 3.06) |
| `s1` | 49 → 35 ms | 2 Load |
| `s1` notes | "nothing measurable" | 1 Standard |
| `s2` | 14 → 9 ms | 1 Standard |
| `s2` | 35 → 21 ms | 2 Load |
| `s2`, `capacity` | 69 % | Probe during 5 Stress, S0 at 600/s |
| `s3` | Flat TTFB, `private` 100 % → 0 % | 1 and 2 |
| `s3` | `public, max-age=86400` | `headers.txt`, 1 dl-download |
| `s4results`, `stages` | −96 %, 49 → 21 → 2, 10.1 → 1.9 cores, 521 → 6 | 2 Load |
| `s4results`, `stages` | 99.9 %, 18,656 / 16 | `varnishstat`, whole S4 campaign (1 + 2 + warm-ups) |
| `capacity`, `cost` | 400, 1,200, 24,800; CPU per unit | 5 Stress |
| `s5purge` | 55.7 s, 17–19 ms | 4 Publish |
| `wall` | 15–50 ms; about 1 s; 400 journeys/s | 1 and 2; 2; 5 |
| `staticvsedge` | Tie, 56 vs 4–5, 13 vs 2 ms, 1,200 vs 10,000+ | 6 Static-vs-edge |
| `wire`, `sidebyside`, `demo` | Headers, kB, build times | None of these; curl and liferay.dev |
| `benchmark` | 25k, 15k, 93 % | Liferay's own study |

### Do the ladder's numbers come from one comparable test?

**No.** Two passes, four flows, two sites. What compares directly today:

| Comparison | Comparable? | Why |
|---|---|---|
| 14 ms → 9 ms | **Yes** | Same pass, same URL |
| 14, 9 → rung 4's 3 ms (3.20) | **Yes** | Same pass and URL; S4 is the same Liferay behind Varnish |
| 21 ms → rung 4's 2 ms (2.15) | **Yes** | Same pass and flow |
| 1 s → rung 4's 2 ms (2.00) | **Yes** | Same pass and flow, search |
| 14 ms → 1 s | **No** | Different flow and load |
| 9 ms → 21 ms | **No** | Different flow and load |
| Rung 3's 2 ms → anything but the same PDF | **No** | Different object; k6 discards the body |
| Rung 5's 3 ms → 14, 9 | **No** | Different flow. The comparable rung 1 figure is 19 ms |
| Rung 5's 3 ms → rung 4's 3 ms | **Yes, at flow level** | Same flow (3.16 vs 3.39), but smaller HTML, nginx |

### A comparable set

**Recommended: standard pass, content page (`/web/proventeq/about`).** The only pass containing all five rungs, and the only flow where Cacheable is visible.

| Rung | Figure | Raw p95 | Stage | Where |
|---|---|---|---|---|
| 5 Precompute | **4 ms** | 3.72 | S6 | `SUMMARY.md` L238 |
| 4 Edge HTML | **3 ms** | 3.20 | S4 | L165 |
| 3 Edge static | **2 ms, PDF** | 1.69 | S3 + S4 | L166 |
| 2 JVM caches | **9 ms** | 9.28 | S2 | L97 |
| 1 Origin render | **14 ms** | 14.32 | S0 | L14 |

Proposed footer: `Measured p95 · content page near idle · rung 3 is a PDF · one box, no network · add your CDN's RTT to rungs 3–5`

What you need to accept:

- **It loses the "up to 1 s" drama.** Say it instead; note 5B does. The notes on `stages` and `wall` carry it later.
- **Precompute shows slower than the edge.** 3.72 vs 3.20 is inside the noise (`LAB-RESULTS.md` L189-190) and fits nginx gzipping per request. Someone may ask, so note 5B calls it a tie. The alternative "3–4 ms" on both rows would be fair, but isn't a single figure.
- **Rung 3 stays a different object.** No pass measured an asset as a guest would load one, so the row must say PDF.
- **Near idle says nothing about capacity.** That is what `capacity` is for.

Alternatives considered:

| Set | Figures | Problem |
|---|---|---|
| Standard, guest journey | 19 / 17 / 2 PDF / 3 / 3 | Hides Cacheable: rung 2 barely moves. [INFERRED] The slower blog page in the journey dominates its p95 |
| Load, guest journey | 49 / 21 / none / 2 / none | The strongest story, but no rung 3 or 5 data. S6 never ran it |
| `gb80`, guest journey | Rung 2 at S3 15 / rung 4 3 / rung 5 3 | Only three rungs. A new run on S0 and S2 could fill it, and that is a choice for the user. I ran nothing |

Rung 2's 14 → 9 is independently supported by the stress ladder's content flow at 200/s, 9.3 → 4.5 ms.

### If a methods slide goes before the ladder

Three rows would cover it, with static-vs-edge introduced where it is used:

| Name | Shape | Stages |
|---|---|---|
| Near idle | 10 iterations/s · 60 s · every scenario | S0–S4, S6 |
| Light load | Mix, about 120 req/s average · 90 s | S0–S4 |
| Until it breaks | 60 s steps · no think time | S0, S3, S4, static |

The ladder's footer should still name its test. Moving the slide takes time from the 2:15 cold open, so the timing labels will need to shift.

## 10. `rig.html`: "One layer per stage, same load every time"

**NEEDS CORRECTION.** Neither half holds across the deck.

**"Same load every time":**

- Holds within test 1 and within test 2, for S0–S4, with the S3 sign-in exception above.
- S5 ran no load: it is a publish test.
- S6 ran only four standard scenarios and `gb80`. It has **no mix** result, so the notes' "every stage ... runs the same mix" is false for S5 and S6.
- `capacity`, `cost` and `staticvsedge` use different tests entirely.

**"One layer per stage":**

- Holds for S1, S3 and S4 as broad layers, though S1 changes the heap from 2.5 to 4 GB.
- S2 changes five things: Cacheable, Ehcache, Hikari and Hibernate, heap, connector.
- S3 skipped `cdn.host.*` and S2 skipped Cluster Link, both shown as part of those stages elsewhere.
- S6 isn't a layer. It replaces Liferay on the request path.

**Proposed title:** "Stages stack. S0–S4 run the same two passes."

**Proposed notes** (replacing the last two sentences and the TypeScript claim):

> The rig: k6 scenarios against a self-hosted DXP on Tomcat, with Varnish in front as the local edge. [scenarios and metrics unchanged] The stages stack. S0 to S4 each run the same two passes: every scenario near idle, then the mix at about 120 requests a second. S5 is a publish test. S6 runs the guest scenarios near idle, with no mix. Separately, we stepped the rate up until things broke, and that is what the capacity slides show. S4 is the core of Part 1; S6 is Part 2.

**Proposed footer:** "k6 · Varnish as the local edge · DXP 2026.q1.12 · one 20-core box". The current "TypeScript · Bun" doesn't match the repo (section 6).

`stages.html`'s "same load at every stage" is fine as written, since that chart shows only S0–S4 from the load pass. `agenda.html`'s notes need the same fix.

## 11. On-screen labels

One line per rung saying what the lab actually changed.

| Rung | Label | Chars | Figure now | Recommended figure |
|---|---|---:|---|---|
| 5 Precompute | S6 · static HTML on nginx | 25 | 3 ms | **4 ms** |
| 4 Edge HTML | S3 + S4 · no-store off, Varnish added | 37 | 2–3 ms | **3 ms** |
| 3 Edge static | S3 + S4 · documents public, cached by Varnish | 44 | 2 ms | **2 ms** (PDF, in the footer) |
| 2 JVM caches | S2 · 16 fragments marked Cacheable | 34 | 9–21 ms | **9 ms** |
| 1 Origin render | S0 · stock, nothing changed | 26 | 14 ms – 1 s | **14 ms** |

Why these words:

- **Rung 1 is S0 only.** S1 did not move this page (14.53 ms), so it earns no mention here.
- **Rung 2 names only Cacheable,** though S2 changed more. The accidental run shows Cacheable alone gives the gain (3.2). "Entity cache sizing" would be false advertising.
- **Rung 3 can't say "CDN" or "CSS and JS".** `cdn.host.*` was skipped and neither was measured.
- **Rung 4 needs both stages.** S3 alone changed no milliseconds, and S4 alone would cache nothing, because the VCL respects `no-store` (L252-266).
- **Rung 5 says nginx, not "CDN".** Nothing was in front of it.
- S5 has no label. It changes freshness, not this latency.

**Layout.** [INFERRED from the CSS, not rendered.] Rows are 1,664 px wide on the 1,920 × 1,080 canvas. Stacked under the name at 28 px, each row grows by about 34 px, to about 739 px in total against about 665 px available, so stacking needs the row padding cut from 24 to 16 px. **Inline, between name and figure, it fits without touching height:** about 950 px are free, and the longest label needs about 620 px. Recommend inline, in `#6a7a84` on light rows, and a lighter tone on the two dark rows.
