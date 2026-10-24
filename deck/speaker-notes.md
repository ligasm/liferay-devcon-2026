# Making Liferay Blazing Fast — speaker notes

## 1. Making Liferay blazing fast

Introduce yourself and Proventeq. One sentence on the shape of the talk: first we squeeze the portal the traditional way and measure every step; then we walk around the wall with a static site that regenerates itself from Liferay.

## 2. Two halves

Part 1, about 22 minutes: hygiene, JVM caches, front-end delivery, guest HTML at the edge, purge on publish. One layer changes per stage and every stage runs the same load test. It ends at a wall no setting can move. Part 2, about 16 minutes: for content-heavy sites, editors keep Liferay but visitors get plain HTML generated from the Headless API, rebuilt on change, with an AI orchestrator on a token allowance. Live demo.

## 3. The advice graveyard

Hook: half of what the internet tells you about Liferay performance is dead, and I can prove it from the source. minifier.enabled is deprecated and defaults to false, minification moved to build time. Server-side layout.parallel.render was removed in 7.3, LPS-110359. GZipFilter and StripFilter are off by default; compress at the edge. The CMS garbage collector was removed in JDK 15, so that flag will not boot on the JDK 17 or 21 that DXP 2024.Q3 and later require, yet it is still in Liferay's own Deployment Checklist PDF. And the punchline: CacheFilter, the only built-in guest full-page cache, was deleted at 7.4.3.123 on 28 June 2023, with no breaking-change entry.

## 4. The ladder

The frame for the whole talk. Each rung is cheaper per request than the one below it, and each imposes a sharper limitation. Origin render is limited by CPU, always CPU. JVM caches by memory and cluster invalidation. Edge static only ever covers assets. Edge HTML is limited by personalisation and auth safety. Precompute by staleness and cardinality. Part 1 climbs rungs 1 to 4 and measures every step. Part 2 is rung 5.

## 5. A stock guest page is uncacheable. Twice.

Live demo here, 30 seconds: curl your own Liferay. The no-store header comes from browser.cache.disabled=true, which is the default; ServicePreAction emits it on every guest page. Independently, ServicePreAction calls getSession() unconditionally, so the first anonymous request gets three cookies. Either one alone makes any CDN refuse to cache. session.disabled existed through 7.3 and was removed in 7.4 with no replacement; Liferay's own KB says a user always has a session. Everyone strips the cookie at the edge instead. Captured on learn.liferay.com and liferay.dev.

## 6. It's CPU in the app tier

Liferay's own benchmark, one node, AMD Epyc, 8 cores, 16 vCPU, 64 GB. 25,000 concurrent users on plain web content, 15,000 on an Asset Publisher page, 93 to 94 percent application-tier CPU at peak. Bonus fact: native login degrades past about 400 concurrent attempts; a dedicated IdP took it to 19,000, because password hashing is CPU by design. Caveats: vendor-published, the PDF says 7.4 but tested DXP 2024.Q2, and these are load-model users with think time. Takeaway: you cannot buy your way out with a bigger database.

## 7. One layer per stage, same load every time

The rig: k6 scenarios written in TypeScript, run with Bun, against a self-hosted DXP on Tomcat with Varnish in front as the local edge. Scenarios: guest browse, a sticky-session variant, Asset Publisher versus plain page, search, real form login, document download, Headless list versus get-by-id, and a 70/15/10/5 mix. The metrics that matter more than latency: edge hit ratio, set-cookie on guest requests, cache-control private, TTFB, and publish-to-fresh time at the edge. Every stage changes one layer and runs the same mix. S4 is the core of Part 1; S6 is Part 2.

## 8. Remove the noise first

Small, honest gains. index.on.startup false, session tracker off, Tomcat JSP development and mappedFile false, GZipFilter left off, JDK 21 with G1 or Generational ZGC, and make sure portal-developer.properties is not loaded in production. S1 exists so every later stage measures the real thing. Result: origin p95 drops a little, edge hit still zero, set-cookie on guests still 100 percent. Files in matrix/S1-hygiene.

## 9. Cache the entities, not the pages

Entity and finder cache sizing per hot entity is the biggest query-elimination lever. DXP 2025.Q2 moved from Ehcache 2.10.6 to 3.10.8, LPD-40485: your 7.4 liferay-multi-vm.xml must be rewritten for the 3.x schema. Cluster Link: replicatePutsViaCopy is false by default; a PUT carries a null value and the receiver removes the entry. Turning replication on is almost always wrong. Use JDBC_PING for cloud discovery. Fragment and Web Content template Cacheable checkboxes are high impact, but a cacheable template that renders anything user-specific leaks it to everyone. HikariCP at about two times maxThreads, sized after cache tuning. Hibernate L2 cache does not exist in Liferay; skip it. Result: origin p95 down, but every request still reaches the JVM.

## 10. Assets were never the problem

cdn.host.https plus cdn.dynamic.resources.enabled covers theme and module JS and CSS, the combo servlet, ES modules and portal images. It does not touch Documents and Media, Adaptive Media, portlet resource URLs, or page HTML. Documents and Media has its own Cache Control setting. The first change that makes a guest page describable as cacheable is browser.cache.disabled=false, keeping browser.cache.signed.in.disabled=true. Regenerate Adaptive Media for existing content; lazy-load everything except the LCP image. Result with WITH_ASSETS=1: asset requests 100 percent edge hit, HTML still zero.

## 11. Two rules, bypass first

The core of Part 1. Rule 1: bypass when any of COMPANY_ID, ID, USER_UUID or REMEMBER_ME is present, or the method is not GET or HEAD. Rule 2, for anonymous GETs: strip Cookie on the way in and Set-Cookie on the way out, drop utm, fbclid, gclid and _gl and sort the query, Vary on Accept-Encoding only, TTL from origin with a one-hour grace for stale-while-revalidate, browser TTL bypass. Show the VCL in matrix/varnish/default.vcl. Cloudflare equivalent: a bypass-on-cookie cache rule above a cache-everything rule with Edge TTL override and a custom cache key; it is in matrix/cloudflare/cache-rules.md.

## 12. Get rule 1 wrong and it's a data breach.

Do not skip this. One anonymous visitor gets a page cached from a signed-in render: a name in the user bar, a live p_auth token, somebody's dashboard. Every visitor after them gets it too. Cloudflare's own Cache Everything docs say visitors may receive information not intended for them. Defence in depth: origin keeps Cache-Control private on signed-in responses, browser TTL stays bypass even when edge TTL is long, and nothing on a public page may need authToken. Optional 45-second demo on a throwaway zone with a fake user.

## 13. S4 result: guest browse

Demo: docker compose up Varnish in front of the same Liferay, bun run.ts S4-edge mix, open SUMMARY.md and the p95 chart. Mock reference: guest browse p95 32 to 1 ms, Asset Publisher 72 to 1, search 69 to 1, the whole mix 48 to 13 ms with 95 percent edge hit. The number that matters most is the third one: login stays at 0 percent edge hit, 100 percent private. A signed-in flow that still reaches the origin every time is the proof that rule 1 holds. Replace these with your own runs before the talk.

## 14. Purge by tag, not by URL

A ModelListener on JournalArticle, Layout and BlogsEntry fires a soft purge by Surrogate-Key after the transaction commits, via TransactionCommitCallbackUtil, so the edge never re-caches the old version. Sketch in matrix/S5-edge-purge, with Varnish and Cloudflare purgers. publish-to-fresh.ts measures publish to fresh-at-edge in milliseconds. Say what is missing: there is no listener API for "Publication published", and Object Actions and webhooks cannot fire from JournalArticle or Layout, only from Objects. Classic web content still needs Java.

## 15. The edge makes the fast path fast.

The wall. Be blunt about the limits we just imposed: locale must be in the URL or the cache serves the wrong language; personalisation moves to late hydration; forms and action URLs must leave guest pages; every publish needs a purge; a cold or purged page still costs a full JVM render of 200 to 2000 ms, with a stampede on the popular ones; and the origin still runs 24/7 at full size for the misses. For marketing, docs, community and catalogue sites, the honest question is: why is there a JVM in the request path at all?

## 16. Don't render it at all.

Pivot. For content-heavy, mostly anonymous sites: keep authoring in Liferay, serve plain HTML generated from Liferay's data, regenerated automatically, with an AI orchestrator in charge of the regeneration and on a strict token budget. The backdrop is the idea: a wall of pages rendered once, ahead of time.

## 17. Draw the line by cardinality

Scope first, or this sounds like "throw away your portal". Precompute when the output space is small and the read-to-write ratio is high. Render live when output is genuinely per user. Islands and late hydration let you draw that line inside a page instead of per page. Everything editors love stays in Liferay: page editor, workflow, permissions, Objects, translations. What leaves is the request path.

## 18. Authored in Liferay, served as files

The pipeline, all TypeScript on Bun. Fetch pulls a delta from Headless Delivery with filter dateModified gt lastRun. Plan diffs content hashes and writes a small plan.json. The AI orchestrator reads only that plan: nothing changed means exit with zero tokens and no build; a never-seen page layout means ask the smart model once for an extraction rule and cache it forever; a post missing a description means a cheap model, batched, hash-cached, under a hard budget. Deterministic transforms do the bulk work. Astro builds static HTML plus a Pagefind search index. The report lists exactly which URLs and cache tags to purge. Triggered by a Liferay webhook or Object Action, or a timer every 15 minutes.

## 19. Live demo against liferay.dev

Prerecord a fallback. Step 1: bun pipeline/regenerate.ts --full --no-ai --max-items 80 against liferay.dev's public Headless API: 132 pages in about 10 to 19 seconds, most of it fetch; Astro plus Pagefind 3 to 7 seconds; 3.4 MB. Step 2: run it again with no flags: nothing changed, skip build, zero tokens, 0.1 seconds offline, 2 to 3 seconds with the live delta check. Most cycles cost nothing. Step 3: edit one post, rerun: plan says one changed, rebuild in about 3 seconds, the report lists only that post, and the purge list is that post, the home page, the blog list and its category page. Step 4: link checker, zero broken of about 3,850 internal links; anything the static site doesn't own links back to the portal.

## 20. Same post, two deliveries

curl both. The portal's rendered page for a liferay.dev content page is about 120 kB with 34 script tags and an authToken in the body. The static post is 10.9 kB, two small inline module scripts, no authToken, and headers Cache-Control public, max-age 60, s-maxage 300, stale-while-revalidate 3600, plus a Cache-Tag per page for surgical purges.

## 21. tokens

The token-efficiency story. Six mechanisms: plan before model, so no change means no model and no build; hash only the fields that matter, a comment counter ticking is not a change; extraction rules asked once per page layout and cached forever; enrichment keyed by content hash; batching eight posts per call on a cheap model with prompt caching on the system block; and a hard budget with a ledger of every call's tokens and cost. Dry run: about 12 to 16 thousand tokens for 80 posts, roughly three cents, once. Lower AI_BUDGET_TOKENS and the batches are skipped, deterministic fallbacks used, and the report flags it. Gotcha: minimum cacheable prompt is 4,096 tokens on the cheap model, so short prompts silently don't cache.

## 22. What you give up

The honest ledger. Search relevance and facets become a Pagefind index built at build time, fully static; link advanced search back to the portal. Comments, forms and ratings become islands posting to Objects or the Headless API, plus a "comment in the portal" link. Sign-in state comes from a late-hydration island calling my-user-account, which needs same-origin or CORS with SameSite None cookies. Preview and workflow stay in the portal; the static site only sees published content, live within the timer interval or instantly via webhook. Pages that are portlets in disguise are flagged as thin pages and link back. And yes, it's a second stack, but it's a timer, a script and a folder of files. Real story: the site-pages listing returned HTTP 500 on liferay.dev all day while per-page fetches worked; the fetcher fell back to a seed list. Your pipeline will meet a broken API; design for it.

## 23. Pages and AI: the same move

The closing idea. Static generation and AI cost control are the same engineering move: take expensive, repeatable work off the request path, do it at publish time, cache the result, invalidate by event, serve stale on failure, and keep an escape hatch for the genuinely dynamic: islands for pages, a rate-limited live call for AI. Liferay already does this internally for semantic search: documents are embedded at index time, only the query is embedded live, and even that is cached. The market prices it too: batch inference is half price for accepting a 24-hour window. The counter-argument: precompute trades freshness for cost, and fails on cardinality. Content times locale times segment times device can explode.

## 24. Please ship it.

Demo the bare hostname only: curl www.liferay.com returns cache-control public max-age 60, an Age of hours, via Varnish, and this undocumented header. The /web/guest/home path returns private, no-store. Liferay's web team built a guest-HTML cache for themselves and never shipped it. Two asks to the room and to Liferay: ship it, and publish Core Web Vitals data for Liferay sites. Nobody has, so anyone in this room could be first.

## 25. Thank you

Questions. Prepared answers: Why not a Cloudflare APO equivalent? There is no Liferay analogue; Liferay PaaS is Google Cloud CDN with a one-hour TTL you cannot change, and SaaS is fixed to USE_ORIGIN_HEADERS, so origin headers are the only lever. Why Astro? Static by default, islands, fast builds; Next.js ISR is the alternative for on-demand revalidation. Structured content? Wired by contentStructureId; test it on your own DXP. Model cost if AI is on everywhere? Show the ledger; the budget caps it.
