# Making Liferay Blazing Fast in Production
## Research dossier — Liferay DevCon 2026

**Speaker:** M · **Compiled:** 11 August 2026
**Anchor versions:** Liferay DXP quarterly releases 2024.Q1 → 2026.Q2, Liferay Portal CE 7.4.3.x, Liferay PaaS/SaaS. Version-agnostic principles are called out throughout.

**Abstract this dossier serves:**
> This talk will provide an overview of techniques for making Liferay blazing fast in production. We'll explore a range of optimization strategies and the limitations they impose, and we'll examine whether AI can help improve performance while keeping costs under control. The standard approaches, of course, involve caching and CDNs, but we'll also look at bolder strategies, such as using code generators to precompile pages for even greater performance gains.

---

## How to use this dossier

Six documents. This one is the map and the argument; the other five are the evidence.

| Part | Topic | Best for |
|---|---|---|
| **00** (this file) | Synthesis, narrative spine, 20/45-min cuts, demo plan, corrections | Writing the talk |
| **01** | Platform-level caching inside the JVM | The "what Liferay does natively" act |
| **02** | CDN + Cloudflare config in front of Liferay | The "standard approaches" act |
| **03** | Aggressively caching public/anonymous pages | **The core of the talk** — the speaker's stated priority |
| **04** | Front-end, infrastructure, measurement, benchmarks | Credibility numbers + evidence on out-of-date settings |
| **05** | Static generation / code generators + the AI question | The "bolder strategies" act and the close |

Confidence markers used in the parts: `[DOC]` official docs · `[SRC]` Liferay source on GitHub · `[BIN]` verified by disassembling a shipped artifact · `[3P]` third-party · `[JUDGEMENT]` analysis, not sourced · `[UNVERIFIED]` could not confirm — do not assert on stage.

---

## 1. The five findings the talk is built on

These are the things most of the audience does not know, all verified against Liferay's own source or live HTTP responses.

**1. Liferay deleted its only built-in guest full-page HTML cache, with no breaking-change entry.**
`com.liferay.portal.servlet.filters.cache.CacheFilter` exists at tag `7.4.3.122-ga122` and is gone at `7.4.3.123-ga123` (27 June 2024). It has no entry in the breaking-changes list; the only trace in the docs is one "Removed property" row on the 2024.Q1 Default Setting page. Leftover `CacheFilter` lines in `portal-ext.properties` now configure a class that no longer ships. `<layout-cacheable>` still sits in the portlet DTD with no consumer. *(Part 01 §1)*

**2. Liferay's default response to an anonymous visitor is engineered to be uncacheable — twice over.**
`browser.cache.disabled=true` (default, `portal.properties` line 5524) makes `ServicePreAction` emit `Cache-Control: private, no-cache, no-store, must-revalidate` + `Pragma: no-cache` + `Expires: 0`. Independently, Liferay sets `JSESSIONID`, `COOKIE_SUPPORT` and `SERVER_ID` cookies on the very first guest request. Either one alone is enough for any CDN to refuse to cache the page forever. **Edge-caching Liferay HTML is therefore never a config toggle — it is a deliberate, slightly dangerous act.** *(Parts 01, 03)*

**3. There is no supported way to stop Liferay creating a session for a guest.**
`session.disabled` existed through 7.3 and was removed in 7.4 with no replacement. `ServicePreAction` calls `getSession()` unconditionally. Liferay's own KB states it flatly: *"A user always has a session."* The entire industry works around this by stripping the cookie at the edge. This is the single most important honest admission in the talk. *(Part 03 §3)*

**4. Liferay's own marketing site solved this — with an undocumented, unshipped mechanism.**
`https://www.liferay.com/` returns `cache-control: public, max-age=60`, an `age` of several hours, and a header found nowhere in the product or the docs:

```http
x-lfr-guest-html-cache: 1
via: 1.1 google, 1.1 varnish, 1.1 varnish
x-cache: HIT IAD
```

Liferay's web team built a bespoke guest-HTML cache and never published it. *(Demo caveat: only the bare hostname is cached — `www.liferay.com/web/guest/home` returns `private, no-store`.)* This is both a great slide and a great hallway question to ask a Liferay engineer at the conference.

**5. Precompute is the single idea underneath both halves of the abstract.**
Static generation and AI cost control are the *same engineering move*: take expensive, repeatable work off the request path, put it on the publish/build path, cache the result, invalidate by event. Liferay already does this internally for semantic search — documents are embedded at index time, only the query is embedded live, and even that is cached. OpenAI literally prices the difference: the Batch API is 50% off for accepting a 24-hour window. *(Part 05 §B10)*

---

## 2. The narrative spine

A five-layer ladder. Each rung costs less CPU per page view than the one below it, and each imposes a sharper limitation. The talk climbs it.

Measured on one box, same test on every rung: 200 first-visit page views a second, HTML plus every file (`part1-simulations/results/RUNG-RESULTS.md`, 2026-11-01). CPU excludes k6. On a real CDN add the round trip to layers 3–5.

```
  Layer 5   PRECOMPUTE      Build/publish time     3 ms    0.1 cores   limit: staleness, cardinality
  Layer 4   EDGE HTML       CDN, guest pages       8 ms    0.8 cores   limit: personalization, auth safety
  Layer 3   EDGE STATIC     CDN, JS/CSS/images    19 ms    1.9 cores   limit: only assets, not pages
  Layer 2   JVM CACHES      entity/finder/fragment 37 ms   8.2 cores   limit: memory, cluster invalidation
  Layer 1   ORIGIN RENDER   full page assembly    344 ms    13 cores   limit: CPU, and it is always CPU
```

Layer 3 is a CPU gain more than a latency one: 84 % of Liferay's CPU in a first visit was static files, not rendering. Layers 1 and 2 tie at low load (30 vs 25 ms at 80 page views/s); the gap opens near saturation.

Search has its own lever: with highlighting off on the Search Results widget, clean capacity went from 25 to 300 searches/s, with the same results (our compact template never shows snippets). Generational ZGC gave no gain on the 6 GB heap (§5.2).

The rhetorical move: **most teams spend their whole budget optimising Layer 1 and never leave it.** The benchmark data says Liferay saturates application-tier CPU (93–94% at peak in Liferay's own study) — you cannot tune your way out of Layer 1, you have to leave it.

Three questions structure the middle of the talk:

1. **Can I avoid rendering this at all?** → Layers 4–5
2. **If I must render it, can I avoid the work inside the render?** → Layer 2
3. **If I must do the work, can I make the delivery cheap?** → Layer 3 + front-end

And one question runs underneath all of them: **what did this optimisation cost me?** — freshness, personalization, correctness, operational complexity, or a data breach. That is the abstract's "limitations they impose", and it should be a recurring beat, not a single slide.

---

## 3. The auth boundary — the slide that earns the talk

The failure mode, stated plainly, because it is the thing the audience will actually go home and get wrong:

> One anonymous visitor requests `/web/guest/home`. The edge has an entry cached from a response rendered **for a signed-in user** — their name in the user bar, their `p_auth` token, their dashboard. Every subsequent anonymous visitor gets it.

It is not a subtle bug. It is a data breach, and it is one character of rule expression away at all times. Cloudflare's own "Cache Everything" documentation says it in as many words: *"visitors may receive information not intended for them."*

The minimum safe pattern is a **two-rule pair, ordered, with the bypass first**:

1. **Bypass** cache when any Liferay auth cookie is present (`COMPANY_ID`, `ID`, `USER_UUID`, `REMEMBER_ME`, `JSESSIONID` on authenticated paths).
2. **Cache-everything** for guest HTML, with an explicit Edge TTL override, query-string allow-list, and `Vary: Accept-Encoding` only.

Rule 2 is what strips `Set-Cookie` — which is exactly why rule 1 has to be right. Defence in depth: origin also emits `Cache-Control: private` for signed-in responses (`browser.cache.signed.in.disabled=true`, keep it), and browser TTL stays at *bypass* even when edge TTL is long. Full expressions in **Part 02 §6.3**.

---

## 4. Talk cuts

> **Status, 2026-11-01:** the talk being delivered is `docs/talk-outline-45min.md`. The two cuts below are the original proposals. The advice-graveyard hook was dropped from the deck after `docs/slide-3-verification.md` found little of that advice is still being given; only `CacheFilter` survives, as one line on the wire slide.

### 20-minute cut — "The three things that actually matter"

Ruthless. One demo. Drop the JVM tuning, drop the benchmarks, drop the framework survey.

| Min | Beat | Source |
|---|---|---|
| 0–3 | **Hook: the advice graveyard** (since dropped, see the status note above). Five out-of-date Liferay settings, each dead or reversed, proven from Liferay's own source. Ends on: "including Liferay's only built-in guest page cache." | 04 §10, 01 §1 |
| 3–6 | **Why Liferay is uncacheable by default.** Live `curl` of a guest page. Three cookies, four cache-killing headers. `session.disabled` is gone and isn't coming back. | 03 §0, §2, §3 |
| 6–14 | **The fix: guest HTML at the edge.** `browser.cache.disabled=false`, the two-rule Cloudflare pair, cookie stripping, query-string allow-list, `stale-while-revalidate`. **Plus the breach slide** — this section is worthless without it. Live before/after `cf-cache-status`. | 02 §4, §6 · 03 §1, §2.4 |
| 14–18 | **Precompute: the same move, twice.** Static shell + dynamic islands for pages; embed-at-index-time + semantic cache for AI. One table showing the two are isomorphic. | 05 §A6, §B10 |
| 18–20 | **Close:** the `x-lfr-guest-html-cache` slide — Liferay solved this for themselves and never shipped it. Ask for it. Q&A. | 03 §11 |

**Cut from the 20:** all of Part 01 except the CacheFilter removal, all JVM/DB/Elasticsearch tuning, the CDN vendor comparison, Core Web Vitals, the full SSG survey, AI tooling for perf engineering.

### 45-minute cut — "The ladder"

| Min | Beat | Source |
|---|---|---|
| 0–4 | **Hook: the advice graveyard** (since dropped, see the status note above; extended — 7 entries, including the CMS GC flag from Liferay's 2023 Deployment Checklist, which won't boot on the JDK 17 or 21 that DXP requires). | 04 §10 |
| 4–8 | **Where the time actually goes.** Liferay's published benchmark: 25,000 concurrent users on web content vs 11,000 at the Asset Publisher inflection (Table 2; the study's summary says 15,000, where its own table shows 6.2 s), same 8-core node. 93–94% app-tier CPU at peak. Native login saturates at ~400 concurrent attempts; a dedicated IdP takes it to 19,000. Establish: it's CPU in the app tier. | 04 §9 |
| 8–14 | **Layer 2 — inside the JVM.** Entity/finder cache sizing (on paper the biggest query-elimination lever; no measurable gain in our lab), fragment `Cacheable` (the measured gain), web content template `Cacheable` and the data-leak it can cause, Cluster Link invalidates rather than replicates, and the Ehcache 3 migration that breaks your XML on 2025.Q2. | 01 |
| 14–19 | **Layer 3 — static at the edge.** What `cdn.host.*` actually rewrites and — more importantly — what it doesn't (DL files, Adaptive Media, portlet resource URLs, page HTML). Cache Control for Documents & Media. The duplicate `Cache-Control` bug on `/o/*`. | 02 §1–2 |
| 19–30 | **Layer 4 — guest HTML at the edge.** The full core: default headers, cookies, sessions, `p_auth` nonces, the two-rule pair, cache keys, tag purge wired to a `ModelListener`, locale-in-URL correctness, `stale-while-revalidate`. **Demo.** **Breach slide.** | 03 (all) · 02 §4, §6 |
| 30–33 | **Personalization vs cache.** The five patterns, ranked: late hydration of user chrome (default), segment-in-cache-key (≤5 segments), ESI, Worker `HTMLRewriter`, give up. Trade-offs: CLS, flicker, extra RTT. | 03 §5 |
| 33–39 | **Layer 5 — precompile.** What works (Varnish/nginx full-page cache + tag purge — best ROI; scoped Astro/Next static shell for the marketing subtree) and what doesn't (full headless SSG of a whole portal at 10k+ pages; crawler freeze except for microsites). The honest cost ledger: a second rendering stack, editorial preview, time-to-publish. | 05 Part A |
| 39–43 | **AI: the honest ledger.** AI features make pages *slower and more expensive* — semantic search puts a third-party API in your search request path with a provider-timeout p99 ceiling. Then the inversion: prompt caching, semantic caching, model routing, batch inference, embed-once. Precompute again. | 05 Part B |
| 43–45 | **Close + Q&A.** The isomorphism table, then the `x-lfr-guest-html-cache` ask. | 05 §B10 · 03 §11 |

**Optional 45-min inserts if a section runs short:** Core Web Vitals on a Liferay page (04 §2), Adaptive Media + WebP/AVIF (04 §3), the CDN vendor comparison table (02 §5.5), Liferay's announced Integrated CDN (02 §3.6).

---

## 5. Demos

Ranked by payoff-per-risk. All are reproducible on a laptop; record fallback video for anything network-dependent.

1. **The curl reveal** *(20s, zero risk, huge payoff)* — `curl -sSD- -o /dev/null https://yoursite/` on a stock Liferay next to `https://www.liferay.com/`. Four cache-killing headers and three cookies vs `public, max-age=60` and `x-lfr-guest-html-cache: 1`. Nothing else in the talk lands as fast.
2. **Before/after `cf-cache-status`** *(60s)* — same URL, MISS → HIT, TTFB in the browser waterfall. Prerecord: Wi-Fi at conferences is where demos die.
3. **The breach, safely** *(45s)* — a deliberately wrong bypass rule on a throwaway zone, showing a signed-in header leaking to an incognito window. Then fix it live. This is the moment people remember. Use a fake user; never real data.
4. **The CacheFilter archaeology** *(30s)* — two `curl` calls against raw.githubusercontent.com: 200 at `7.4.3.122-ga122`, 404 at `7.4.3.123-ga123`. Proof, not assertion. *(Commands in Part 01 Appendix B.)*
5. **Tag purge on publish** *(90s, higher risk)* — edit a web content article, watch a `ModelListener` fire a soft purge by surrogate key, page updates within a second. Great if it works; skip if time is tight.

---

## 6. Corrections applied after an adversarial verification pass

An independent fact-check tried to refute the headline claims. Results worth carrying into the slides. A second pass on 2026-11-01 (`docs/slide-3-verification.md`) corrected the `CacheFilter`, CMS, GZip, parallel-render and minifier claims in place throughout this dossier.

| Claim as first written | Correction |
|---|---|
| Asset Publisher page handles ~11,000 concurrent users | **Both numbers are in the study; use 11,000.** The executive summary says 15,000. Table 2 highlights 11,000 as the inflection (577 ms mean, 1,159 ms 2σ) and shows 6,164 ms 2σ at 15,000, three times the study's own 2 s target. An earlier pass changed 11,000 to 15,000 here; re-reading the PDF on 2026-11-01 reversed that. Compare 25k with 11k, the highlighted row of each table. |
| "The DXP 7.4 benchmark study" | The PDF is named 7.4 but states *"we tested DXP 2024 Q2."* Call it the 2024.Q2 study. |
| "40% Web Tier / 95% App Tier / <5% DB Tier" | **Not found in either source. Drop it.** The defensible version is the study's own 93–94% app-tier CPU at peak. |
| `layout.parallel.render.enable` "removed recently" | Removed in **7.3** (LPS-110359), and only *server-side* parallel rendering is gone — parallel rendering still exists via AJAX rendering. |
| Old `liferay-multi-vm.xml` "will not parse" | Docs say configs *"must be reviewed and rewritten to adhere to the Ehcache 3.x schema."* Say that. |
| CacheFilter "removed around 7.4.3.123" | Exactly at `7.4.3.123-ga123`, 27 June 2024, **with no breaking-changes entry**. One "Removed property" row on the 2024.Q1 Default Setting page exists, so say "quietly", not "silently". |
| "Liferay SaaS is pinned to a 1-hour TTL" | Two different products fused. **PaaS**: Google Cloud CDN hard-limited to 1h `CLIENT_TTL`/`DEFAULT_TTL`, not customer-changeable. **SaaS**: cache mode fixed to `USE_ORIGIN_HEADERS` — meaning your origin `Cache-Control` is the only lever. |
| `www.liferay.com` demo | Only the **bare hostname** is publicly cached. `/web/guest/home` returns `private, no-store`. Demo the bare domain. |
| Guest cookies: `JSESSIONID`, `COOKIE_SUPPORT` | Add **`SERVER_ID`** — there are three. |
| Liferay Cloud "is Cloudflare-backed" | No evidence either way; the Load Balancer doc names no vendor. Google Cloud is confirmed. Don't assert Cloudflare. |

---

## 7. Open questions — say these out loud

The talk gets more credible, not less, by naming what nobody has answered. These are also the best Q&A bait and the best hallway conversations at DevCon.

1. **No supported way to suppress the guest `HttpSession`.** Removed in 7.4, no replacement, no documented workaround. Everyone strips the cookie at the edge.
2. **`CacheFilter`'s removal is barely documented.** It has no breaking-changes entry, only one "Removed property" row on the 2024.Q1 Default Setting page.
3. **There is no product feature for "cache this page publicly."** Liferay's CDN documentation is explicitly about static assets; HTML is never mentioned.
4. **`x-lfr-guest-html-cache` is unshipped and unpublished.** Liferay solved guest HTML caching for themselves. Ask them to ship it.
5. **No documented listener API for "Publication published"** (change-tracking / `CTCollection`). Workaround: `ModelListener` on `CTProcess`, or subscribe to `DestinationNames.BACKGROUND_TASK_STATUS`.
6. **Object Actions and webhooks can't fire from `JournalArticle`, `Layout` or `DLFileEntry`** — Objects only. Classic Web Content still needs Java.
7. **Rendered Liferay pages carry no `ETag`.** `ETagFilter` is mapped only to static and DL paths.
8. **`www.liferay.com` publicly caches HTML containing a live `authToken`.** Nobody has published guidance. The de-facto answer is "make sure nothing on a public page needs it."
9. **No published Liferay TTFB/LCP before-and-after for full guest-HTML edge caching, and no published Liferay Core Web Vitals data at all.** Every published benchmark is server-side throughput. **Measure your own and put it on a slide — you would be first, and that alone could carry the talk.**

---

## 8. Title options

- *Blazing Fast Liferay: Everything You Know About Caching It Is Wrong*
- *The Cache Liferay Deleted* — leads with the strongest finding
- *Don't Render It: Five Layers Between Your User and Your JVM*
- *Precompute Everything: Static Pages, AI, and the Same Idea Twice*

---

*Parts 01–05 follow.*


---


# Liferay Platform-Level Caching — Research Brief
### For "Making Liferay Blazing Fast in Production", Liferay DevCon 2026
Scope: everything inside the JVM. No CDN. Anchored on **Liferay DXP quarterly releases (2024.Q1 → 2026.Q2)** and **Liferay Portal CE 7.4.3.x**, with version-agnostic principles called out.

**Verification note:** claims below are labelled `[DOC]` (official documentation), `[SRC]` (Liferay source on GitHub), or `[BIN]` (verified by me by downloading the shipped Maven artifact and disassembling it — reproducible commands included). `[BIN]` findings are the ones most likely to be new to your audience, and they're all reproducible live on stage.

---

## 0. Three headline findings (lead with these)

| # | Finding | Evidence |
|---|---|---|
| 1 | **`CacheFilter` no longer exists.** It was removed from Liferay Portal between CE `7.4.3.122-ga122` (June 14, 2024) and CE `7.4.3.123-ga123` (June 27, 2024). DXP binaries tested: **present** in 2024.Q1 patches up to Q1.12 and in 2024.Q2.0 and Q2.1; gone from 2024.Q2.2, 2024.Q1.13 and 2024.Q3.0 onward. | `[SRC][BIN]` |
| 2 | **Liferay moved off Ehcache 2 in DXP 2025.Q2.** `net.sf.ehcache-2.10.6.LIFERAY-PATCHED-2.jar` → `ehcache-3.10.8.jar` (`org.ehcache.*`). Your `liferay-multi-vm.xml` from 7.4 must be rewritten for the 3.x schema. (LPD-40485) | `[DOC][BIN]` |
| 3 | **Cluster Link does not replicate cache values by default — it invalidates.** `replicatePutsViaCopy=false`, `replicateUpdatesViaCopy=false` are the hard-coded defaults. A "PUT" event carries a key with a null value, and the receiving node calls `removeWithoutReplicator()`. | `[DOC][BIN]` |

---

## 1. Cache Filter / Portal Cache Filter

### 1.1 The headline: it's gone

`com.liferay.portal.servlet.filters.cache.CacheFilter` was the full-page HTML cache for guest users. **It has been deleted from the product.**

Reproducible proof:

```bash
# exists in 7.4.0-ga1 (CE tag committed 2021-04-20) and every release up to 7.4.3.122 (14 Jun 2024)
curl -o /dev/null -w "%{http_code}\n" \
  https://raw.githubusercontent.com/liferay/liferay-portal/7.4.3.122-ga122/portal-impl/src/com/liferay/portal/servlet/filters/cache/CacheFilter.java
# -> 200

# gone from 7.4.3.123 (27 Jun 2024) onward, including master
curl -o /dev/null -w "%{http_code}\n" \
  https://raw.githubusercontent.com/liferay/liferay-portal/7.4.3.123-ga123/portal-impl/src/com/liferay/portal/servlet/filters/cache/CacheFilter.java
# -> 404
```

Corroborating evidence `[BIN]`:
- Current `com.liferay.portal.impl:114.1.0` JAR (Maven Central, July 2025) contains **no** `servlet/filters/cache/` package at all.
- Current `portal-web/docroot/WEB-INF/liferay-web.xml` on `master` declares 43 filters — **none** is a `CacheFilter`.
- The `portal.properties` toggle `com.liferay.portal.servlet.filters.cache.CacheFilter=true` existed in 7.4 GA1 and is **absent from `master`**.

**Orphaned properties.** Two properties survive in `master/portal-impl/src/portal.properties` with no remaining consumer — `PropsValues.CACHE_CONTENT_THRESHOLD_SIZE` and `PropsValues.CACHE_FILTER_INCLUDE_USER_AGENT` are still compiled fields but nothing reads them:

```properties
##
## Cache
##

    #
    # The cache filter caches processed web content. Set the threshold size to
    # prevent caching resources that are too large. The default value is 500 kb.
    #
    cache.content.threshold.size=512000

    #
    # Set this to false to disable user agent matching in the cache filter.
    # Excluding the user agent improves the cache hit ratio but should not be
    # used when content is browser specific. Each cache filter can be
    # individually configured with the "includeUserAgent" init parameter.
    #
    cache.filter.include.user.agent=true
```
Source: https://raw.githubusercontent.com/liferay/liferay-portal/master/portal-impl/src/portal.properties

Similarly, `LayoutTypePortletImpl.isCacheable()` and the `<layout-cacheable>` element in `liferay-portlet-app_7_4_0.dtd` still exist but are now **dead code** — `CacheFilter` was their only caller `[BIN]`.

**Talk framing:** this is the single best "optimization strategies and the limitations they impose" story you have. Liferay didn't tune the full-page cache — they deleted it. PR #151255 says its hit ratio was "always 0" in their tests because none of the test URLs were cacheable, while preparing the cache key was "pure waste"; commit `7af5ad9` adds that `LanguageFilter` overlapped it. That it rarely hit on real portals is an inference, not Liferay's statement.

### 1.2 What it did, and why it stopped working (for the historical slide)

Config from `liferay-web.xml` @ `7.4.3.122-ga122` (verbatim, the last release that had it):

```xml
<filter>
    <filter-name>Cache Filter - Friendly</filter-name>
    <filter-class>com.liferay.portal.servlet.filters.cache.CacheFilter</filter-class>
    <init-param>
        <param-name>pattern</param-name>
        <param-value>0</param-value>
    </init-param>
</filter>
<filter>
    <filter-name>Cache Filter - Layout</filter-name>
    <filter-class>com.liferay.portal.servlet.filters.cache.CacheFilter</filter-class>
    <init-param>
        <param-name>pattern</param-name>
        <param-value>1</param-value>
    </init-param>
</filter>
<filter>
    <filter-name>Cache Filter - Resource</filter-name>
    <filter-class>com.liferay.portal.servlet.filters.cache.CacheFilter</filter-class>
    <init-param>
        <param-name>url-regex-ignore-pattern</param-name>
        <param-value>(.+/-/.+|/webdav/.*)</param-value>
    </init-param>
    <init-param>
        <param-name>pattern</param-name>
        <param-value>2</param-value>
    </init-param>
</filter>
<filter>
    <filter-name>Cache Filter - Resource JSP</filter-name>
    <filter-class>com.liferay.portal.servlet.filters.cache.CacheFilter</filter-class>
    <init-param>
        <param-name>url-regex-pattern</param-name>
        <param-value>.+/(barebone|css|everything|main)\.jsp</param-value>
    </init-param>
    <init-param>
        <param-name>pattern</param-name>
        <param-value>2</param-value>
    </init-param>
</filter>
```

The cache key (`getCacheKey`), verbatim logic:
```
METHOD # REQUEST_URL [? QUERY_STRING] # LANGUAGE_ID [# userAgent.toLowerCase().hashCode()] # acceptsGzip
```

**When it silently did nothing** — from `isCacheableRequest()`, verbatim:

```java
protected boolean isCacheableRequest(HttpServletRequest httpServletRequest) {
    String portletId = ParamUtil.getString(httpServletRequest, "p_p_id");

    if (Validator.isNotNull(portletId)) {
        return false;                         // (1) any portlet-targeted URL
    }

    if ((_pattern == _PATTERN_FRIENDLY) || (_pattern == _PATTERN_LAYOUT)) {
        long userId = PortalUtil.getUserId(httpServletRequest);

        if ((userId > 0) ||
            Validator.isNotNull(httpServletRequest.getRemoteUser())) {

            return false;                     // (2) ANY signed-in user
        }
    }
    ...
}
```

So the classic failure modes were:
1. **Signed-in users were never cached.** Guest-only. On an intranet, hit rate ≈ 0.
2. **Any `p_p_id` in the URL disabled it** — i.e. any portlet interaction.
3. **The query string was part of the key**, so UTM/tracking params fragmented the cache into infinity.
4. **`cache.filter.include.user.agent=true` (default)** put a User-Agent hash in the key → fragmentation across browser versions. See [LPS-68125](https://issues.liferay.com/browse/LPS-68125) ("Cached pages are stored using user-agent as a key, which is unnecessary, and requires more memory") and [LPS-60638](https://issues.liferay.com/browse/LPS-60638).
5. **The page had to be marked cacheable at the layout level** (`layoutTypePortlet.isCacheable()`, driven by `<layout-cacheable>` in every portlet on the page). One non-cacheable widget poisoned the whole page.
6. **Responses > 500 KB were skipped** (`cache.content.threshold.size`).
7. **`Pragma: no-cache` in the response header** disabled it.
8. Double-check on write: `isCacheableRequest()` was evaluated **twice** with the comment *"We have to test the cacheability of a request twice because the user could have been authenticated after the initial test."*

### 1.3 What replaced it

Nothing at the full-page HTML level inside the JVM. Liferay's answer today is:
- **Frontend resource caching** (hashed JS/CSS filenames, per-instance TTLs) — see §4.5.
- `browser.cache.disabled=true` and `browser.cache.signed.in.disabled=true` (both default `true`) explicitly tell browsers **not** to cache rendered HTML.
- Everything else pushed down to fragment / entity / finder caches, plus an external CDN/reverse proxy (out of scope here).

| | |
|---|---|
| **Impact** | N/A today. Historically high on guest-heavy public sites, ~zero on authenticated portals. |
| **Effort** | N/A |
| **Limitation** | Guest-only, whole-page granularity, query-string-fragile — which is exactly why it's gone. |

---

## 2. Ehcache → the current cache provider

### 2.1 The SPI: `PortalCache`, `MultiVMPool`, `SingleVMPool`

Liferay has **never** exposed Ehcache directly to application code. Everything goes through a provider-neutral SPI in `portal-kernel`:

```java
public interface PortalCache<K extends Serializable, V> {
    public static final int DEFAULT_TIME_TO_LIVE = 0;
    public V get(K key);
    public List<K> getKeys();
    public PortalCacheManager<K, V> getPortalCacheManager();
    public String getPortalCacheName();
    public boolean isMVCC();
    public boolean isSharded();
    public void put(K key, V value);
    public void put(K key, V value, int timeToLive);
    public void registerPortalCacheListener(PortalCacheListener<K, V> portalCacheListener);
    public void remove(K key);
    public void removeAll();
}
```
Source: https://raw.githubusercontent.com/liferay/liferay-portal/master/portal-kernel/src/com/liferay/portal/kernel/cache/PortalCache.java

Two pools, two managers:

```java
public interface PortalCacheManagerNames {
    public static final String MULTI_VM  = "MULTI_VM_PORTAL_CACHE_MANAGER";
    public static final String SINGLE_VM = "SINGLE_VM_PORTAL_CACHE_MANAGER";
}
```

- **`SingleVMPool`** — node-local, never replicated, value need not be `Serializable`. Use for derived/computed data that is cheap to recompute.
- **`MultiVMPool`** — participates in Cluster Link. Key **and** value must be `Serializable`.

Typical OSGi usage:

```java
@Reference
private MultiVMPool _multiVMPool;

PortalCache<Serializable, Serializable> portalCache =
    (PortalCache<Serializable, Serializable>)_multiVMPool.getPortalCache("MY_CACHE_NAME");
```
Docs: https://learn.liferay.com/kb-article/liferay-s-clustering-api

There is also `PortalCacheHelperUtil` with the important cluster-safety methods `putWithoutReplicator()`, `removeAllWithoutReplicator()`, `removeWithoutReplicator()` — used by the cluster listener to avoid echo storms.

### 2.2 The provider migration: Ehcache 2.10.6 → Ehcache 3.10.8 (DXP 2025.Q2)

`[DOC]` Liferay DXP 2025.Q2 Breaking Changes, **LPD-40485**, verbatim:

> "Ehcache 2.x is no longer maintained. Liferay DXP's internal caching now uses Ehcache version 3.10.8. Existing XML configuration files must be reviewed and rewritten to adhere to the Ehcache 3.x schema."

`[DOC]` Related breaking change **LPD-43563**, verbatim:

> "The `PortalCacheListenerFactory` class is removed. Instead, register a custom `PortalCacheListener` implementation using `PortalCache`'s `registerPortalCacheListener` methods."
>
> "Declaring a portal cache listener factory in the Ehcache XML configuration file for Liferay to process it is no longer supported, in preparation for upgrading to Ehcache 3. Ehcache 3 no longer supports declaring cache event listener factories (such as portal cache listener factories) in XML configurations."

`[BIN]` Exact artifact timeline — `com.liferay:com.liferay.portal.cache.ehcache.impl`:

| Module version | Date | Bundled cache library |
|---|---|---|
| ≤ 4.0.35 | 2025-02-25 | `lib/net.sf.ehcache-2.10.6.LIFERAY-PATCHED-2.jar` |
| **4.0.36** | **2025-04-04** | **`lib/ehcache-3.10.8.jar`** |
| 4.0.39+ | 2025-05-31 | `lib/ehcache-3.10.8-jakarta.jar` (Jakarta EE namespace, matching the 2025.Q3 Jakarta migration) |

Reproduce:
```bash
curl -sO https://repo1.maven.org/maven2/com/liferay/com.liferay.portal.cache.ehcache.impl/4.0.40/com.liferay.portal.cache.ehcache.impl-4.0.40.jar
unzip -l com.liferay.portal.cache.ehcache.impl-4.0.40.jar | grep -E "lib/|ehcache/"
#   4962  ehcache/liferay-multi-vm.xml
#    797  ehcache/liferay-single-vm.xml
# 1814241 lib/ehcache-3.10.8-jakarta.jar
```

### 2.3 The properties (unchanged names, changed file format)

`master/portal-impl/src/portal.properties`, verbatim:

```properties
##
## Ehcache
##

    #
    # Set the classpath to the location of the Ehcache config file for internal
    # caches. Edit the file specified in the property
    # "ehcache.multi-vm.config.location" to enable clustered cache.
    #
    ehcache.single.vm.config.location=/ehcache/liferay-single-vm.xml
    ehcache.multi.vm.config.location=/ehcache/liferay-multi-vm.xml

    #
    # Input a list of comma delimited key value pair to set replication
    # properties for the default cache.
    #
    ehcache.replicator.properties.default=

    #
    # Input a list of comma delimited key value pair to set replication
    # properties for a specific cache.
    #
    #ehcache.replicator.properties.${specific.cache.name}=
    ehcache.replicator.properties.com.liferay.dynamic.data.mapping.data.provider.internal.rest.DDMRESTDataProvider=replicatePuts=false
    ehcache.replicator.properties.com.liferay.journal.util.JournalContent=replicatePuts=false
    ehcache.replicator.properties.com.liferay.portal.security.permission.PermissionCacheUtil_PERMISSION=replicatePuts=false
    ehcache.replicator.properties.com.liferay.portal.security.permission.PermissionCacheUtil_PERMISSION_CHECKER_BAG=replicatePuts=false
    ehcache.replicator.properties.com.liferay.portal.security.permission.PermissionCacheUtil_RESOURCE_BLOCK_IDS_BAG=replicatePuts=false
    ehcache.replicator.properties.com.liferay.portal.kernel.webserver.WebServerServletToken=replicatePuts=false
    ehcache.replicator.properties.com.liferay.portlet.social.service.impl.SocialActivitySettingLocalServiceImpl=replicatePuts=false
    ehcache.replicator.properties.com.liferay.wiki.model.WikiPageDisplay=replicatePuts=false

    #
    # Set this to true to enable JMX integration in
    # com.liferay.portal.cache.EhcachePortalCacheManager.
    #
    ehcache.portal.cache.manager.jmx.enabled=true
```

Also relevant, in the same file:

```properties
    #
    # Set this property to true to enable transactional cache. When enabled,
    # changes to caches take effect when transaction commits successfully.
    # Caches rollback when transactions rollback.
    #
    transactional.cache.enable=true

    #
    # Set a list of comma delimited transactional portal cache names. The "?"
    # character represents a single character wildcard. The "*" symbol character
    # a multiple character wildcard. The "%" character is used to escape
    # characters.
    #
    transactional.cache.names=\
        com.liferay.portal.internal.service.util.PortalPreferencesCacheUtil,\
        com.liferay.portal.kernel.dao.orm.EntityCache*,\
        com.liferay.portal.kernel.dao.orm.FinderCache*,\
        com.liferay.portal.kernel.service.persistence.impl.TableMapper-*
```

**Properties removed since 7.4 GA1** `[BIN]` (`diff` of cache keys between `7.4.3.4-ga4` and `master`):
```
cache.clear.on.plugin.undeploy
com.liferay.portal.servlet.filters.cache.CacheFilter
ehcache.replicator.properties.com.liferay.portal.kernel.template.TemplateResourceLoader.{css,ftl,vm}
ehcache.replicator.properties.com.liferay.portal.servlet.filters.cache.CacheUtil
ehcache.socket.so.timeout
ehcache.socket.start.port
mobile.device.session.cache.enabled
```
Also long gone: `ehcache.cluster.link.replication.enabled` (unnecessary since DXP 7.0) and `ehcache.statistics.enabled` (6.x-era; do not put it in `portal-ext.properties`).

### 2.4 The shipped XML — before and after

**AFTER (Ehcache 3, module `4.0.40`, current) — `ehcache/liferay-single-vm.xml`, verbatim:**

```xml
<config
	xmlns="http://www.ehcache.org/v3"
	xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
	xsi:schemaLocation="http://www.ehcache.org/v3 https://www.ehcache.org/schema/ehcache-core-3.10.xsd"
>

	<!--
	Caches in this file are designed to be unique per VM and should not be
	clustered.
	-->

	<cache-template name="default">
		<key-type>java.io.Serializable</key-type>
		<value-type>java.lang.Object</value-type>
		<expiry>
			<tti>600</tti>
		</expiry>
		<heap>10000</heap>
	</cache-template>
	<cache alias="default" uses-template="default" />
	<cache alias="com.liferay.portal.servlet.ComboServlet" uses-template="default">
		<heap>1000</heap>
	</cache>
	<cache alias="com.liferay.portal.servlet.ComboServlet$FileContentBag" uses-template="default">
		<heap>1000</heap>
	</cache>
</config>
```

**AFTER — `ehcache/liferay-multi-vm.xml` (excerpt, verbatim):**

```xml
<config
	xmlns="http://www.ehcache.org/v3"
	xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
	xsi:schemaLocation="http://www.ehcache.org/v3 https://www.ehcache.org/schema/ehcache-core-3.10.xsd"
>

	<!--
	Caches in this file can be clustered and are configured to be clustered.
	-->

	<!-- Default cache template -->

	<cache-template name="default">
		<key-type>java.io.Serializable</key-type>
		<value-type>java.io.Serializable</value-type>
		<expiry>
			<tti>600</tti>
		</expiry>
		<heap>200000</heap>
	</cache-template>

	<!-- Default cache -->

	<cache alias="default" uses-template="default" />

	<!-- Entity cache -->

	<cache
		alias="com.liferay.portal.kernel.dao.orm.EntityCache.com.liferay.portal.model.impl.ResourcePermissionImpl"
		uses-template="default"
	>
		<heap>1000000</heap>
	</cache>
	<cache
		alias="com.liferay.portal.kernel.dao.orm.EntityCache.com.liferay.portal.model.impl.UserImpl"
		uses-template="default"
	>
		<heap>100000</heap>
	</cache>
	...
	<!-- FinderCache -->

	<cache
		alias="com.liferay.portal.kernel.dao.orm.FinderCache.com.liferay.portal.model.impl.ResourcePermissionImpl.List1"
		uses-template="default"
	>
		<heap>100000</heap>
	</cache>
	...
	<!-- Other -->

	<cache
		alias="com.liferay.portal.security.permission.PermissionCacheUtil_PERMISSION"
		uses-template="default"
	>
		<heap>100000</heap>
	</cache>
</config>
```

**BEFORE (Ehcache 2, module `4.0.35`, ≤ DXP 2025.Q1) — same file:**

```xml
<ehcache
	dynamicConfig="true"
	monitoring="off"
	name="liferay-multi-vm"
	updateCheck="false"
	xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
	xsi:noNamespaceSchemaLocation="http://www.ehcache.org/ehcache.xsd"
>
	<defaultCache
		eternal="false"
		maxElementsInMemory="200000"
		overflowToDisk="false"
		timeToIdleSeconds="600"
	>
	</defaultCache>

	<cache
		eternal="false"
		maxElementsInMemory="100000"
		name="com.liferay.portal.kernel.dao.orm.EntityCache.com.liferay.portal.model.impl.UserImpl"
		overflowToDisk="false"
		timeToIdleSeconds="600"
	>
	</cache>
	...
</ehcache>
```

**Migration cheat-sheet slide:**

| Ehcache 2 | Ehcache 3 |
|---|---|
| `<ehcache name="liferay-multi-vm">` | `<config xmlns="http://www.ehcache.org/v3">` |
| `<defaultCache .../>` | `<cache-template name="default">` + `<cache alias="default" uses-template="default"/>` |
| `name="..."` attribute | `alias="..."` attribute |
| `maxElementsInMemory="100000"` | `<heap>100000</heap>` |
| `timeToIdleSeconds="600"` | `<expiry><tti>600</tti></expiry>` |
| `timeToLiveSeconds="3600"` | `<expiry><ttl>3600</ttl></expiry>` |
| `eternal="false"` | (implied; use `<expiry><none/></expiry>` for eternal) |
| `overflowToDisk` / `diskPersistent` | `<disk persistent="true" unit="GB">…</disk>` resource pool |
| `net.sf.ehcache.*` | `org.ehcache.*` |
| `<cacheEventListenerFactory>` in XML | **removed** — use `PortalCache.registerPortalCacheListener()` |

Source for the mapping table and placement guidance: Daniel Martinez Cisneros, *Tunning EHCACHE 3.X*, liferay.dev, 6 Nov 2025 — https://liferay.dev/b/tunning-ehcache-3-x

### 2.5 How to actually override the XML (this trips everyone up)

Recommended layout (from the Ehcache-3 blog):

```
TOMCAT_HOME/webapps/ROOT/WEB-INF/classes/ehcache/
├── liferay-single-vm-override.xml
└── liferay-multi-vm-override.xml
```
```properties
ehcache.single.vm.config.location=/ehcache/liferay-single-vm-override.xml
ehcache.multi.vm.config.location=/ehcache/liferay-multi-vm-override.xml
```

**Gotcha `[DOC]`:** if you name your file `liferay-multi-vm.xml` you get
`java.lang.NullPointerException: Configuration path is null`, because that name already exists inside the shipped Ehcache bundle JAR. Rename it and use a **classpath-relative** value, not an absolute filesystem path:

```properties
ehcache.multi.vm.config.location=cache/module-multi-vm.xml
```
with the file in `tomcat/webapps/ROOT/WEB-INF/classes/cache/`. Then clear `osgi/state`, `work`, `temp` and restart.
Source: https://learn.liferay.com/kb-article/using-the-ehcache.multi.vm.config.location-property-the-java.lang.nullpointerexception-configuration-path-is-null-error-occured

**Module-based override** (older but still documented pattern, `[DOC]`): ship a module with `/portal-cache-override-config/src/main/resources/ehcache/override-liferay-[multi|single]-vm-clustered.xml` plus a `PortalCacheConfiguratorSettingsOverrider` component. Source: https://learn.liferay.com/kb-article/cache-override

### 2.6 Off-heap, disk, and Redis

- **Off-heap / disk tiers:** `[BIN]` `EhcachePortalCacheManagerConfigurator` parses the file via **`org.ehcache.xml.XmlConfiguration`** and inspects `CacheConfiguration.getResourcePools()` / `ResourceType.requiresSerialization()`. That means the **full Ehcache 3 XML schema is available**, including `<offheap unit="MB">` and `<disk>` resource pools. Liferay ships *only* `<heap>` and does not document off-heap; treat it as "supported by the underlying engine, unsupported by Liferay". Ehcache 3 open-source gives you heap → offheap → disk tiering; the clustered (Terracotta) tier is not part of what Liferay bundles.
- **Redis:** there is **no** official Liferay Redis cache provider. The `PortalCacheManager` SPI is pluggable, and community implementations exist (mimacom's `RedisVMPool extends MultiVMPool` using Jedis — https://blog-es.mimacom.com/redis-como-cache-liferay-dxp/, Beatriz Estévez, 2018), but the article's own conclusion is instructive for the talk: to get consistency they had to disable the local L1 layer, and "each time a value is required, the database is consulted" — i.e. **a remote cache with a network hop per `get()` is slower than Liferay's local-heap + invalidate design.** That is a great "the limitation the optimization imposes" beat.
- **Legacy modules to be aware of** `[BIN]`: `com.liferay.portal.cache.ehcache.ee.provider` (Terracotta/BigMemory, last released 2023-07, still ships `.class_terracotta` files), `com.liferay.portal.cache.ehcache.multiple` (RMI replication + `EhcachePortalCacheBootstrapLoader`, last released 2018). Both are effectively dead; don't build on them.

| | |
|---|---|
| **Impact** | Very high — entity/finder/permission caches are the difference between 5 and 500 queries per page. |
| **Effort** | Low to enable (it's on by default); medium to size correctly. |
| **Limitation** | Heap-only by default; `<heap>N</heap>` counts **entries, not bytes**, so a wrong estimate of average entry size is how you OOM. Ehcache 3 migration is a hard breaking change on upgrade to 2025.Q2. |

---

## 3. Cluster Link and cache replication

### 3.1 Enabling it

```properties
cluster.link.enabled=true
```
That single property turns on distributed caching. `[DOC]` https://learn.liferay.com/w/dxp/self-hosted-installation-and-upgrades/setting-up-liferay/clustering-for-high-availability/configuring-cluster-link

Full `Cluster Link` block from `master/portal.properties` (verbatim, abridged to the load-bearing keys):

```properties
    cluster.link.enabled=false

    cluster.link.auth.cert.alias=
    cluster.link.auth.cert.password=
    cluster.link.auth.cipher.type=RSA
    cluster.link.auth.keystore.password=
    cluster.link.auth.keystore.path=
    cluster.link.auth.keystore.type=PKCS12
    cluster.link.auth.value=liferay-cluster

    cluster.link.channel.logic.name.control=
    cluster.link.channel.logic.name.transport.0=

    cluster.link.channel.name.control=liferay-channel-control
    cluster.link.channel.name.transport.0=liferay-channel-transport-0

    #
    # Set the JGroups properties for each channel, we support up to 10 transport
    # channels and 1 single required control channel. Use as few transport
    # channels as possible for best performance. By default, only one UDP
    # control channel and one UDP transport channel are enabled. The value can
    # be a file containing a JGroups XML configuration, a URL pointing to an XML
    # configuration, or a path of XML configuration in class path.
    #
    cluster.link.channel.properties.control=jgroups/secure/md5/udp_control.xml
    cluster.link.channel.properties.transport.0=jgroups/secure/md5/udp_transport.xml

    cluster.link.autodetect.address=www.google.com:80
    cluster.link.bind.addr["cluster-link-control"]=localhost
    cluster.link.bind.addr["cluster-link-udp"]=localhost

    #
    # Set this to true to register JGroups JMX MBeans with the platform MBean
    # server. This enables JMX based monitoring of the cluster protocol stack.
    #
    cluster.link.jmx.enabled=false
```

Note the defaults are `jgroups/secure/md5/*` — **MD5 authentication is on by default** (`cluster.link.auth.value=liferay-cluster`). `[DOC]` The three built-in options are unsecure / MD5 (default) / X509 (recommended for production), and **all nodes must use matching encryption types**.

### 3.2 Two channels, two jobs

`[DOC]` (Mariano Alvaro, *How to diagnose and recover Liferay cluster*, liferay.dev, 31 Aug 2020):
- **`transport-0`** — carries **cache invalidation** messages.
- **`control`** — carries cluster membership, master election, and `MEMORY_CLUSTERED` scheduler job synchronisation.

Default multicast groups `[DOC]`:
```
multicast.group.address["cluster-link-control"]=239.255.0.1   port 23301
multicast.group.address["cluster-link-udp"]=239.255.0.2       port 23302
multicast.group.address["cluster-link-mping"]=239.255.0.3     port 23303
multicast.group.address["multi-vm"]=239.255.0.5               port 23305
```
> "If UDP can be used, there is no need to use or configure any other protocol."

### 3.3 Unicast over TCP (the cloud reality)

Multicast is unavailable on AWS/Azure/GCP/most k8s CNIs. Options `[DOC]` (https://learn.liferay.com/kb-article/managing-distributed-cache-in-liferay-dxp):

**JDBC_PING** (most robust — the DB is the rendezvous point):
```properties
cluster.link.channel.properties.control=[CONFIG_FILE_PATH]/jdbc_ping_config.xml
cluster.link.channel.properties.transport.0=[CONFIG_FILE_PATH]/jdbc_ping_config.xml
```
```xml
<JDBC_PING connection_url="jdbc:mysql://[DATABASE_IP]/[DATABASE_NAME]?"
connection_username="DATABASE_USER" connection_password="[PASSWORD]"
connection_driver="com.mysql.jdbc.Driver"/>
```
> "If the database user does not have the ability to create tables, they will need to manually create the JGROUPSPING table in advance."

**TCP_PING** (static host list):
```properties
cluster.link.channel.properties.control=[CONFIG_FILE_PATH]/tcp.xml
cluster.link.channel.properties.transport.0=[CONFIG_FILE_PATH]/tcp.xml
```
```
-Djgroups.bind_addr=<node_address>
-Djgroups.tcpping.initial_hosts=<node1>[port1],<node2>[port2]...
```
> "TCP_PING is not an auto-discovery protocol (e.g. adding/removing members of cluster not supported)."
> **This is the autoscaling killer.** If your nodes are ephemeral, TCP_PING is wrong; use JDBC_PING or a k8s-native ping.

**S3_PING** (AWS):
```xml
<S3_PING secret_access_key="SECRETKEY" access_key="ACCESSKEY" location="ControlBucket"/>
```

**Gotcha `[DOC]`:** on 7.2 FP1+ do **not** add `singleton_name="liferay_tcp_cluster"` to TCP tags. And only set `external_addr` (firewall public IP) when nodes span multiple networks.

### 3.4 Replication vs invalidation — the core mechanic

`[DOC]` from *Configuring Cluster Link*:
> Cluster Link "sends *remove* messages when entities are deleted or modified to invalidate them across the cluster. When an entity is requested on a node lacking it in cache, a database retrieval occurs and the entity populates that node's local cache."

`[DOC]` from Liferay's Clustering API KB:
> "replicatePutsViaCopy and replicateUpdatesViaCopy have a default of false for performance reasons."

`[BIN]` **Proof from the shipped bytecode**, `com.liferay.portal.cache.multiple:5.0.33`:

```bash
javap -p -c -cp com.liferay.portal.cache.multiple-5.0.33.jar \
  com.liferay.portal.cache.multiple.internal.ClusterLinkPortalCacheReplicator
```
Constructor defaults (the `iconst_1`/`iconst_0` passed to `GetterUtil.getBoolean`):

| Replication property | Default |
|---|---|
| `replicatePuts` | **true** |
| `replicatePutsViaCopy` | **false** |
| `replicateUpdates` | **true** |
| `replicateUpdatesViaCopy` | **false** |
| `replicateRemovals` | **true** |

And the receiving side, `ClusterLinkPortalCacheClusterListener._handlePortalCacheClusterEvent()`:

```
REMOVE_ALL          -> PortalCacheHelperUtil.removeAllWithoutReplicator(cache)
PUT / UPDATE:
    value == null   -> PortalCacheHelperUtil.removeWithoutReplicator(cache, key)   // <-- the default path
    value != null   -> PortalCacheHelperUtil.putWithoutReplicator(cache, key, value, ttl)
EVICTED / EXPIRED   -> (not propagated at all — no-op on the sending side)
```

So the mental model to put on a slide:

```
Node A: cache.put(k, v)
   └─> replicatePuts=true, replicatePutsViaCopy=false
        └─> PortalCacheClusterEvent{name, key=k, value=NULL, type=PUT}  ──JGroups──►
Node B: value == null  ->  cache.remove(k)   // INVALIDATE, not populate
Node B (next request): cache miss -> DB -> repopulate locally
```

`EVICTED` and `EXPIRED` events are deliberately **not** propagated — each node ages out independently. This is why cluster nodes legitimately have different cache contents and different hit ratios.

### 3.5 The classic scaling pitfall: turning replication on

To switch a cache to true replication:
```properties
ehcache.replicator.properties.MY_CACHE_NAME=replicatePutsViaCopy=true,replicateUpdatesViaCopy=true
```
(Pre-DE-26 syntax was `ehcache.cluster.link.replicator.properties.*` — `[DOC]` https://learn.liferay.com/kb-article/cache-override)

**Why this is almost always wrong:**
1. Every `put` now serialises the value and multicasts it. Cluster network traffic goes from O(keys changed) to O(bytes cached).
2. Traffic scales as **O(n²)** in node count for a broadcast topology — 2 nodes is fine, 8 nodes is a saturated NIC.
3. Every value must be `Serializable`, and serialisation cost is on the write path of the *originating* request.
4. Liferay itself only ever tunes in the **opposite** direction. Look at the shipped defaults again — the eight `ehcache.replicator.properties.*` lines in `portal.properties` all set `replicatePuts=false`, i.e. for `JournalContent`, the three `PermissionCacheUtil` caches, `WebServerServletToken`, `WikiPageDisplay`, `DDMRESTDataProvider` and `SocialActivitySetting`, Liferay says *don't even send the invalidation on put*. These are all "expensive to serialise, cheap to recompute, and node-local churn is fine."

**Legitimate uses of `viaCopy=true`:** small, hot, expensive-to-recompute, rarely-written caches (a config/lookup table). Measure the message rate first.

**Related knobs `[BIN]** — `com.liferay.portal.cache.multiple.configuration.PortalCacheClusterConfiguration` (System Settings):
```xml
<AD name="priorities" id="priorities" cardinality="2147483647" required="false"
    default="LEVEL1,LEVEL2" type="String"/>  <!-- LEVEL1..LEVEL10 -->
<AD name="using-coalesced-pipe" id="usingCoalescedPipe" cardinality="0"
    required="false" default="false" type="Boolean"/>
```
- `priorities` maps cache events onto JGroups transport channels (`transport.0`..`transport.9`). Portal properties warn: *"Use as few transport channels as possible for best performance."*
- **`usingCoalescedPipe=true`** is Liferay's built-in **invalidation-storm damper**: `CoalescedPipePortalCacheClusterEventQueue` collapses duplicate events for the same cache+key before sending (`PortalCacheClusterEventCoalesceComparator`). Off by default. This is the knob to reach for when a bulk import floods `transport-0`.

### 3.6 Diagnosing cluster cache problems

Symptoms and log lines to put on a troubleshooting slide `[DOC]` (Mariano Alvaro):
```
[JGroupsReceiver:91] Accepted view [node2-23516|1] (2) [node2-23516, node1-18511]
```
→ healthy; first node listed is master by convention.
```
[BaseReceiver:83] Accepted view MergeView::[node1-38143|3]
```
→ **split-brain healed.** During the split, MultiVM caches in the two subgroups diverged. Expect stale content; clear caches.

> "When several nodes need to be started it must be done sequentially, not in parallel, to avoid concurrency problems."

Diagnostic Groovy scripts referenced: `SchedulerDebugInformation.groovy`, `ClusterNodesDebugInformation.groovy`. Recovery via Gogo:
```
scr:disable com.liferay.asset.publisher.web.internal.messaging.CheckAssetEntryMessageListener
scr:enable  com.liferay.asset.publisher.web.internal.messaging.CheckAssetEntryMessageListener
```
Also see [LPS-70512] *"Cache stops working properly when certain nodes in a cluster become idle."*

Related: `clusterable.advice.call.master.timeout=10` (seconds) — the `@Clusterable(onMaster=true)` RPC timeout.

| | |
|---|---|
| **Impact** | High (correctness, not just speed — without it, nodes serve stale content). |
| **Effort** | Low for UDP/multicast; medium for JDBC_PING/TCP_PING + X509. |
| **Limitation** | Invalidation-by-default means **every write causes N-1 cold misses**; a write-heavy workload gets *worse* as you add nodes. Nodes are never identical, so per-node hit ratios legitimately differ. Autoscaling + TCP_PING is broken by design. |

---

## 4. Fragment / portlet / web content / template caching

### 4.1 Portlet `<expiration-cache>` — and the trap nobody mentions

Liferay **does** honour the JSR-286/362 `<expiration-cache>` element in `portlet.xml`:

```xml
<portlet>
    <portlet-name>my-portlet</portlet-name>
    ...
    <expiration-cache>300</expiration-cache>
    <cache-scope>public</cache-scope>
</portlet>
```

`[SRC]` Parsed in `PortletLocalServiceImpl` (master):
```java
Element expirationCacheElement = portletElement.element("expiration-cache");

if (expirationCacheElement != null) {
    portletModel.setExpCache(
        GetterUtil.getInteger(expirationCacheElement.getText()));
}
```

`[BIN]` **Where the cached markup actually lives** — `InvokerPortletUtil` (portal-impl 114.1.0):
```
getResponses(HttpSession)  ->  session.getAttribute("CACHE_PORTLET_RESPONSES")   // a ConcurrentHashMap
encodeResponseKey(long plid, String portletId, String languageId)
                           ->  StringUtil.toHexString(plid) + "_" + portletId + "_" + languageId
```
and the stored value is `InvokerPortletResponse implements Serializable { String _content; String _title; long _time; }`.

**This is a per-user HTTP session cache, not a shared cache.** Consequences to put on a slide:
- Memory cost = `expiration-cache` markup × **number of concurrent sessions**, not × number of distinct pages.
- It is `Serializable`, so if you do **session replication** you are now shipping rendered HTML across the cluster on every request.
- It is keyed by `plid + portletId + languageId` only — **no user, no permission, no segment**. Within one session that's fine; but it means it can't be promoted to a shared cache without breaking security.
- It buys you nothing for first-time visitors — which is most of your public traffic.

Related declarative knobs in `liferay-portlet.xml` (`liferay-portlet-app_7_4_0.dtd`, verbatim):
```
<!--
Set the layout-cacheable flag to true if the data contained in this portlet can
will never change unless the layout or Journal portlet entry is changed.
-->
<!ELEMENT layout-cacheable (#PCDATA)>

<!--
The default value of render-weight is 1.
If set to a value of 1 or greater, the portlet is rendered serially. Portlets
with a greater render weight have greater priority and will be rendered before
portlets with a lower render weight.
If set to a value less than 1 when the ajaxable value is set to true, then the
portlet is rendered in parallel. When the ajaxable value is set to false, then
the render-weight is always set to 1 and the portlet is rendered in serial.
-->
<!ELEMENT render-weight (#PCDATA)>

<!--
The default value of ajaxable is true. If set to false, this portlet can never
be displayed via Ajax.
-->
<!ELEMENT ajaxable (#PCDATA)>
```
`<layout-cacheable>` is now **inert** (its only consumer was `CacheFilter`). `<render-weight>` + `<ajaxable>` are still live and are the *actual* lever for slow widgets: `render-weight` < 1 with `ajaxable=true` → the widget is rendered out-of-band via Ajax so it doesn't block the page. **That's a latency optimisation, not a caching one, and it's the honest replacement for full-page caching on a slow widget.**

| | |
|---|---|
| **Impact** | Low–medium, and only for repeat views in the same session. |
| **Effort** | Low (one XML element). |
| **Limitation** | Session-scoped → memory scales with concurrent users; hostile to session replication; no benefit for first views. |

### 4.2 Page Fragments — the modern, and actually useful, layer

In the page-fragment world (7.4+ / all quarterly releases), **fragments carry a `Cacheable` flag**.

`[DOC]` https://learn.liferay.com/w/dxp/sites/creating-pages/page-fragments-and-widgets/using-fragments/managing-fragments:
- Actions menu on a fragment → **"Mark or Unmark the fragment as cacheable"**.
- When enabled, caching "improves the performance of its pages."
- **Trade-off, verbatim from the docs:** caching "delays visibility of updates to mapped assets, with changes only appearing after page republication or manual cache clearing."
- Some default fragments (e.g. HTML) are **"cached by design, and their cacheable setting cannot be changed."**
- Doc recommendation: for content that must update immediately, "use uncached fragments or create custom fragments with tailored caching settings."

Original feature ticket: [LPS-108376] *"As a fragment developer I can mark a fragment as cacheable to improve performance."*

**Practical talk advice:** fragment caching is the highest leverage, lowest risk page-level cache you have in 2026 — but it is *not* segment-aware in the way people assume. If a fragment renders anything derived from the current user or their segment, mark it non-cacheable, or push the user-specific bit into a separate uncached fragment. The pattern is "cache the chrome, not the personalised hole."

| | |
|---|---|
| **Impact** | High on content-heavy pages. |
| **Effort** | Very low (a checkbox per fragment) but requires content-model discipline. |
| **Limitation** | Stale mapped-asset content until republish/clear; unsafe for anything personalised. |

### 4.3 Web Content article caching (`JournalContent`)

This is the big one for content sites, and it has precise, surprising rules.

**The cache:** a `MultiVMPool` cache named `com.liferay.journal.util.JournalContent` (note the shipped `ehcache.replicator.properties....JournalContent=replicatePuts=false`).

`[BIN]` from `com.liferay.journal.service:7.0.172`, `JournalContentImpl`:

**Cache key fields** (`JournalContentImpl$JournalContentKey`):
```java
private final long   _groupId;
private final String _articleId;
private final double _version;
private final String _ddmTemplateKey;
private final long   _layoutSetId;
private final String _languageId;
private final String _viewMode;
private final int    _page;
private final boolean _secure;
```
**There is no userId, no roleId, no segmentId in the key.** The rendered article markup is shared across all users. If your DDM template renders anything user-specific, the first requester's output is served to everyone until eviction. This is the single most dangerous cache in Liferay for personalisation bugs.

**Three conditions must all hold for a render to be cached** (disassembled from `getDisplay(...)`):
1. `journalArticleDisplay.isCacheable()` — comes straight from the DDM template flag (§4.4).
2. **`lifecycleRender == true`** — from `PortletRequestModel.getLifecycle().equals("RENDER_PHASE")` or `ThemeDisplay.isLifecycleRender()`. **Serving the same article from a `serveResource`/AJAX path bypasses the cache entirely.** If you moved a widget to Ajax rendering "for performance", you may have silently disabled article caching.
3. **`CTCollectionThreadLocal.isProductionMode() == true`** — **caching is disabled inside a Publication (Change Tracking collection).** Editors working in a publication will see uncached, much slower page renders. Tell your content team this is expected, not a bug.

**Invalidation:** `JournalContentImpl` maintains two `PortalCacheIndexer`s keyed by `articleId` and `ddmTemplateKey`, so publishing one article evicts only its entries rather than the whole cache. `clearCache()` is broadcast cluster-wide via `ClusterRequest.createMulticastRequest(...)` with `setFireAndForget(true)` and `ClusterExecutorUtil.execute(...)`, gated on `ClusterInvokeThreadLocal.isEnabled()`.

**`journal.article.check.interval`** — this 6.x property no longer exists in `portal.properties`. `[BIN]` It moved to OSGi config `com.liferay.journal.configuration.JournalServiceConfiguration` (System Settings → Content & Data → Web Content):
```xml
<AD name="check-interval" id="checkInterval" cardinality="0" required="false"
    default="15" type="Integer" min="1"
    description="check-interval-in-minutes-description"/>
```
Default **15 minutes**. This is the scheduled sweep that expires/reviews articles — it is *not* a cache TTL, but it's the reason "my article expired but the page still shows it" for up to 15 minutes. Other cache-adjacent entries in the same OCD: `journalArticleExportImportProcessorCacheEnabled` (default `true`), `expireAllArticleVersionsEnabled`, `indexAllArticleVersionsEnabled`.

| | |
|---|---|
| **Impact** | Very high on content-driven pages (skips DDM structure parse + FreeMarker render + DB reads). |
| **Effort** | Low — it's on by default; the work is auditing templates. |
| **Limitation** | Not user-aware → personalisation leaks; RENDER_PHASE only; off inside Publications; stale until article/template save. |

### 4.4 The `Cacheable` checkbox on Web Content Templates

`[SRC]` `JournalArticleLocalServiceImpl.getArticleDisplay(...)` (master), verbatim:
```java
boolean cacheable = true;
...
if (ddmTemplate != null) {
    script = ddmTemplate.getScript();
    cacheable = ddmTemplate.isCacheable();
}
else {
    DDMStructure ddmStructure = article.getDDMStructure();
    script = _journalDefaultTemplateProvider.getScript(ddmStructure.getStructureId());
    cacheable = _journalDefaultTemplateProvider.isCacheable();
}
...
return new JournalArticleDisplayImpl(..., paginate, cacheable);
```

So **one checkbox on the DDM template is the master switch** for §4.3. See [LPS-87736] for its UI history.

**The failure mode, from the field** (Javeed Chida, *A Checkbox Named Cacheable*, liferay.dev, 12 Jun 2017 — https://liferay.dev/blogs/-/blogs/a-checkbox-named-cacheable): a template that pulls *other* content at render time via `journalContentUtil.getContent()` / `journalArticleService` produces output whose freshness is not tracked by the article's own invalidation. Result: content updates never appear; the author needed reindexes and re-saves. Conclusion, verbatim: *"A Cacheable template is not good here. Uncheck and reap the benefits."*

**Rule for the slide:**
> Cacheable = ON is correct only when the template's output is a pure function of *this* article + *this* template + locale.
> Any of these means turn it OFF: pulling other articles, calling services, reading `themeDisplay.getUser()`, rendering permission-dependent branches, time-of-day logic, segment logic.

Also from that post, and worth repeating: **the cacheable flag change is itself cached** — expect to clear caches (or recreate the item) before the change takes effect.

| | |
|---|---|
| **Impact** | High (it gates the whole article display cache). |
| **Effort** | Trivial to flip; the audit is the work. |
| **Limitation** | Binary and per-template — no partial caching, no per-segment variants. |

### 4.5 Template engine / FreeMarker caching

Two distinct layers:

**(a) Compiled-template cache** — `portal.properties`, verbatim:
```properties
##
## Template Engine
##

    #
    # Set this to true to enable cache for the template engine.
    #
    template.engine.cache.enabled=true
```
`[BIN]` backed by `com.liferay.portal.template.BaseTemplateResourceCache`, which holds a `_multiVMPortalCache` plus a `_secondLevelPortalCache` and a `volatile long _modificationCheckInterval`, wired to `MULTI_VM_PORTAL_CACHE_MANAGER` / `SINGLE_VM_PORTAL_CACHE_MANAGER`.

**(b) `resourceModificationCheck`** — the historical dev-mode kill switch:
```
# osgi/configs/com.liferay.portal.template.freemarker.configuration.FreeMarkerEngineConfiguration.config
resourceModificationCheck="0"
```
(https://gist.github.com/balcsida/fcc9dce2df77c775fcc01045916e20eb)

`[BIN]` **Heads-up: `resourceModificationCheck` was removed from `FreeMarkerEngineConfiguration`.** Present in `com.liferay.portal.template.freemarker` **7.0.54** (2024-06-03); **absent from 7.0.55** (2024-08-28) onward. The current OCD contains only: `allowedClasses`, `asyncRender*`, `includeNavItemsInTheContext`, `localizedLookup`, `logTemplateExceptions`, `loopCountThreshold`, `macroLibrary`, `restrictedClasses`, `restrictedMethods`, `restrictedVariables`, `templateExceptionHandler`. If your runbook still contains that `.config` file, **it is silently doing nothing on 2024.Q3+.**

Also in that OCD and worth a mention as an anti-stampede/latency guard: `asyncRenderTimeout` (default `0`), `asyncRenderTimeoutThreshold` (default `10`), `asyncRenderThreadPoolMaxSize`, `loopCountThreshold` (default `0` = unlimited — a runaway `#list` in a WCM template is an availability incident waiting to happen).

**Production hygiene** `[DOC]` (*Tuning Liferay*): make sure `portal-developer.properties` is not included, and set Tomcat's JSP engine to `development=false`, `mappedFile=false`:
```properties
#include-and-override=portal-developer.properties
#include-and-override=${liferay.home}/portal-developer.properties
```
```xml
<init-param>
    <param-name>development</param-name>
    <param-value>false</param-value>
</init-param>
<init-param>
    <param-name>mappedFile</param-name>
    <param-value>false</param-value>
</init-param>
```

Related: `direct.servlet.context.enabled=true` / `direct.servlet.context.reload=false` (JSP dispatch shortcut, see LPS-13776), `combo.check.timestamp=false` (*"should be set to true during development for easier debugging but set to false during production for faster performance"*), `layout.template.cache.enabled=true`, `minifier.inline.content.cache.enabled=true`.

### 4.6 Frontend resource caching (JS/CSS) — new in 2025.Q4 / 2026.Q1

`[DOC]` https://learn.liferay.com/w/dxp/security-and-administration/administration/configuring-liferay/virtual-instances/configuring-frontend-resource-caching

Control Panel → Configuration → **Instance Settings → Platform → Infrastructure → Frontend Caching**:
- **Caching Strategy:** "one hash per resource file" (e.g. `clay.(tvERyCVfuRc).css`) or no hashed resources. Hashed names allow effectively infinite caching.
- Per-type **Max Age** (seconds): CSS Style Sheets, JavaScript Files, Labels Modules (`all.js`), Tokenized CSS, Translated JavaScript.
- Per-type **no-cache** toggles forcing server revalidation.
- **Cannot be hashed** (so always time-limited): custom theme CSS, portlet/client-extension CSS, files with dynamic tokens like `@base_url@`, translation `all.js`, and JS using `Liferay.Language.get()`.
- **Version gates:** general frontend caching requires **2025.Q4+**; infinite caching for JavaScript requires **2026.Q1+**.

This is the closest thing to "the CacheFilter replacement" and it's genuinely new — worth a slide.

| | |
|---|---|
| **Impact** | High on TTFB-adjacent metrics and origin load. |
| **Effort** | Very low (UI toggles). |
| **Limitation** | Tokenized/localised resources can't be hashed → always revalidate; needs 2025.Q4+/2026.Q1+. |

---

## 5. Service Builder entity cache / finder cache

### 5.1 The three-level model (verbatim from `portal.properties`)

```properties
    #
    # Value objects are cached at three levels. They first level is "entity",
    # the second level is "finder", and the third level is "Hibernate".
    #
    # The entity level cache stores a value object's primary key to the value
    # object itself.
    #
    # The finder level cache stores the many paths that return a value object
    # and the many paths that return a list of value objects. The finder level
    # cache only caches primary keys and is further helped by the entity level
    # cache that caches the value object to the primary key.
    #
    # The Hibernate level cache is provided by the
    # "hibernate.cache.provider_class" property.
    #
```

**The key insight for the talk:** the finder cache stores **primary keys only**, then the entity cache resolves each PK. That's why they must be tuned together — a big finder cache with a small entity cache just moves the miss.

### 5.2 The properties (verbatim, `master`)

```properties
    #
    # Set this to true to enable entity level caching.
    #
    value.object.entity.cache.enabled=true

    #
    # The entity level cache uses a thread local map to store the most
    # frequently accessed items to lower the number of queries to the underlying
    # cache. Set the maximum map size to 0 to disable the thread level cache.
    #
    value.object.entity.thread.local.cache.max.size=100

    #
    # Set this property to true to enable MVCC entity level caching. This
    # feature only applies to entities with that are MVCC enabled. See the
    # attribute "mvcc-enabled" in the Service Builder DTD.
    #
    value.object.mvcc.entity.cache.enabled=true

    #
    # Set this to true to enable finder level caching.
    #
    value.object.finder.cache.enabled=true

    #
    # Set this to configure the list threshold for the maximum number of objects
    # to cache with the same finder path and arguments. Setting this to 0
    # disables finder level caching. Setting this to -1 disables the threshold.
    #
    value.object.finder.cache.list.threshold=10000

    #
    # The finder level cache uses a thread local map to store the most
    # frequently accessed items to lower the number of queries to the underlying
    # cache. Set the maximum map size to 0 to disable the thread level cache.
    #
    value.object.finder.thread.local.cache.max.size=100

##
## Table Mapper
##

    #
    # Set a list of comma delimited mapping table names that will not be using
    # cache in their table mappers.
    #
    table.mapper.cacheless.mapping.table.names=\
        Users_Groups,\
        Users_Orgs,\
        Users_Roles,\
        Users_Teams,\
        Users_UserGroups
```

Notes for the slide:
- **`value.object.finder.cache.list.threshold=10000`** — a finder returning >10,000 rows is *not* cached. If you have a "get all X in site" finder on a big site, it is quietly always hitting the DB. Set to `-1` to remove the cap (memory risk) or fix the query.
- **`table.mapper.cacheless.mapping.table.names`** — Liferay explicitly disables caching on the five user-mapping tables. That is a deliberate correctness-over-speed choice (membership changes must be immediate) and a good example for the "limitations" theme.
- **`value.object.*.thread.local.cache.max.size=100`** — a per-request LRU in front of the PortalCache. Verified in `EntityCacheImpl`/`FinderCacheImpl` as `ThreadLocal<LRUMap<...>>`. Set to `0` when debugging cache-coherency weirdness inside a single request.
- **`value.object.entity.blocking.cache` does not exist in modern Liferay.** It's in old blog posts; `BlockingPortalCache` is not in `com.liferay.portal.cache.api:13.0.1`. So there is **no built-in single-flight / stampede protection** on entity+finder caches (see §9.2).

### 5.3 What's actually stored

`[BIN]` `EntityCacheImpl` exposes `fetchCacheModel(Class<?>, Serializable, Class<T extends CacheModel<?>>)`. Liferay caches the generated **`*CacheModel`** — a flat, Hibernate-free, `Serializable` POJO — not the live entity. This is why:
- entity cache entries are small and safe to ship between nodes;
- you can't accidentally cache a detached Hibernate proxy;
- `<heap>N</heap>` entry counts are meaningful.

`EntityCacheImpl` also stores an `EmptyResult` marker so **negative lookups are cached** — a `fetchX()` that returns null doesn't re-hit the DB each time. Nice detail, and also a gotcha: an entity created out-of-band (raw SQL, another app) stays "not found" until eviction.

Cache names follow a strict convention (matching the aliases in `liferay-multi-vm.xml`):
```
com.liferay.portal.kernel.dao.orm.EntityCache.<fully.qualified.ModelImpl>
com.liferay.portal.kernel.dao.orm.FinderCache.<fully.qualified.ModelImpl>
com.liferay.portal.kernel.dao.orm.FinderCache.<fully.qualified.ModelImpl>.List1
com.liferay.portal.kernel.dao.orm.FinderCache.<fully.qualified.ModelImpl>.List2
```
**This convention is your tuning API** — to size the cache for your own SB entity, add a `<cache alias="com.liferay.portal.kernel.dao.orm.EntityCache.com.acme.model.impl.FooImpl" uses-template="default"><heap>…</heap></cache>` to your multi-VM override.

`[BIN]` `FinderCacheImpl` also has `clearDSLQueryCache(String)` and a `_dslQueryCacheNamesMap` — **Liferay's DSL query API participates in the finder cache**, which raw custom SQL does not. That's a concrete "migrate custom SQL to DSL queries" recommendation.

### 5.4 How custom SQL bypasses everything

`[SRC]` **Proof:** Liferay's own `JournalArticleFinderImpl` (master) — a canonical custom-SQL finder:
```bash
curl -s https://raw.githubusercontent.com/liferay/liferay-portal/master/modules/apps/journal/journal-service/src/main/java/com/liferay/journal/service/persistence/impl/JournalArticleFinderImpl.java \
  | grep -c -i findercache
# -> 0
```
It contains 17 `_customSQL.get(...)` + `session.createSynchronizedSQLQuery(sql)` call sites and **zero** references to `FinderCache`.

**Why this matters:**
1. `*FinderImpl` classes built on `CustomSQLUtil` / `createSynchronizedSQLQuery` have **no cache integration at all** — every call is a DB round trip. Generated `*PersistenceImpl` finders get caching for free; hand-written ones do not.
2. Worse, custom SQL writes **do not invalidate** entity/finder caches. A `DELETE`/`UPDATE` executed via custom SQL or `runSQL()` leaves the caches serving stale data indefinitely.
3. Manual opt-in is possible via `FinderPath` + `finderCache.getResult()/putResult()`, but then you own invalidation, which is where the bugs live.
4. `cacheable.query.limit.LPD-27353=1000`, `cacheable.query.limit.LPD-28122=10000`, `cacheable.query.limit.LPD-38877=10` in `master/portal.properties` are newer per-query caps Liferay added for specific pathological queries — evidence that "unbounded cached query result sets" is a real production failure mode they keep patching.

**Recommendation ladder:** generated finder > DSL query (`FinderCache`-aware) > custom SQL with explicit `FinderPath` > raw custom SQL.

| | |
|---|---|
| **Impact** | Very high — this is where 80% of Liferay's query elimination comes from. |
| **Effort** | Zero to leave on; medium to size per-entity caches; high to retrofit caching onto custom SQL. |
| **Limitation** | PK-only finder storage means two lookups; `list.threshold` silently disables big result sets; **custom SQL is invisible to the cache in both directions (no read hit, no write invalidation)**. |

---

## 6. Hibernate / DB second-level cache and HikariCP

### 6.1 Hibernate L2 is effectively off, and that's intentional

`[SRC]` In `master/portal-impl/src/portal.properties`, `hibernate.cache.provider_class` appears **only inside a comment**. There is no `hibernate.cache.use_second_level_cache`, no `hibernate.cache.use_query_cache`, no `hibernate.cache.region.factory_class`, no `hibernate-clustered.xml`. Grep it yourself:
```bash
grep -n "second_level\|cache.provider_class\|use_query_cache\|region.factory" portal.properties
# only: 5922:    # "hibernate.cache.provider_class" property.
```

`[DOC]` Jorge Ferrer, *Liferay's Architecture: Caching (Part 1)* (2013) already explained why: Liferay's own Entity + Finder caches are "extremely efficient", which "led Liferay 6.2 to disable Hibernate's L2 cache by default." That decision has since hardened into removal.

**Talk point:** if a consultant tells you to "turn on Hibernate second-level cache in Liferay", they are 12+ years out of date. Liferay's L2 *is* `EntityCache` + `FinderCache`. Hibernate L1 (session-scoped, one service-layer invocation) still applies and is free.

The Hibernate settings that *do* matter:
```properties
    hibernate.configs=\
        META-INF/portal-hbm.xml,\
        classpath*:META-INF/ext-hbm.xml

    #hibernate.dialect=

    #
    # Set the JDBC batch size to improve performance.
    #
    hibernate.jdbc.batch_size=2000

    hibernate.jdbc.use_scrollable_resultset=true
    hibernate.bytecode.use_reflection_optimizer=true
    hibernate.schema_name_resolver=com.liferay.portal.spring.hibernate.NullSchemaNameResolver
    hibernate.show_sql=false

    #
    # Set this property to true to enable Hibernate cache monitoring. See
    # LPS-2056 for more information.
    #
    hibernate.generate_statistics=false

    #
    # Set this property to true to enable HBM JAXB cache to speed up startup.
    #
    hibernate.hbm.jaxb.cache=true
```
- `hibernate.show_sql=true` in production is a self-inflicted outage. Keep it false; use the DB's slow query log.
- `hibernate.generate_statistics=true` costs measurable overhead — use it in a load-test environment, not prod.
- `hibernate.hbm.jaxb.cache=true` is a **startup-time** cache — relevant to §7 (restart cost).

### 6.2 HikariCP

Liferay uses HikariCP. Shipped defaults from `master/portal.properties`:
```properties
    #
    # HikariCP recommends to also tune database settings. See
    # https://github.com/brettwooldridge/HikariCP/wiki for additional setting
    # details for database.
    #
    #jdbc.default.autoCommit=true
    #jdbc.default.connectionTestQuery=SELECT releaseId FROM Release_
    jdbc.default.connectionTimeout=30000
    jdbc.default.idleTimeout=600000
    #jdbc.default.initializationFailFast=false
    jdbc.default.maximumPoolSize=180
    jdbc.default.maxLifetime=0
    jdbc.default.minimumIdle=10
    jdbc.default.registerMbeans=true
    jdbc.default.transactionIsolation=2
```

`[DOC]` *Tuning Liferay* guidance:
- Thread pool: "Start with 50 threads and monitor. Consider 250 if page times are 2-3 seconds."
  ```xml
  <Connector maxThreads="75" minSpareThreads="50" ... />
  ```
- **"Configure the pool size slightly larger than the thread pool size."**
- Reduce the **Counter** data source pool if you're near the DB connection limit, since "Counter database transactions are small, fast, and never nested."

**Important tension to surface in the talk:** `maximumPoolSize=180` is a *default*, and HikariCP's own guidance is that pools should be **small** (`connections ≈ cores × 2 + effective_spindles`). Liferay's advice ("slightly larger than the thread pool") is really "don't let threads block waiting for connections", not "180 is right for your DB." A 180-connection pool × 6 nodes = 1080 connections, which most Postgres/MySQL instances will not thank you for. **Caching is what lets you shrink this pool** — that's the connective tissue between §5 and §6 for your narrative: *every cache hit is a connection you didn't need to hold.*

Also: `jdbc.default.registerMbeans=true` means the HikariCP pool is JMX-visible out of the box (`com.zaxxer.hikari:type=Pool (...)`) — free observability, see §8.

| | |
|---|---|
| **Impact** | Medium (pool) / N/A (Hibernate L2, since it's gone). |
| **Effort** | Low. |
| **Limitation** | Oversized pools shift the bottleneck from app to DB and hide it; `hibernate.generate_statistics` costs what it measures. |

---

## 7. Cache warming

### 7.1 The honest headline: Liferay has no native cache warming

There is no supported warm-up API, no startup pre-population, and no cluster bootstrap. Evidence:
- `com.liferay.portal.cache.ehcache.multiple` (which contained `EhcachePortalCacheBootstrapLoaderFactory` and `RMIBootstrapCacheLoaderFactory` — i.e. "pull the cache contents from a peer node on startup") **was last released in August 2018** and is Ehcache-2/RMI-based. It is dead. `[BIN]`
- `com.liferay.portal.cache.api:13.0.1` contains no bootstrap-loader type at all. `[BIN]`
- `global.startup.events` / `application.startup.events` exist but are documented as portal-init hooks, not cache hooks:
  ```properties
  global.startup.events=\
      com.liferay.portal.events.GlobalStartupAction,\
      com.liferay.portal.events.CryptoStartupAction,\
      com.liferay.portal.events.SetupAdminAutoLoginStartupAction

  application.startup.events=\
      com.liferay.portal.events.AppStartupAction
  ```

**So cold cache is the real production problem, and you have to solve it yourself.** This is a strong, honest slide.

### 7.2 Why cold caches hurt more than people expect in Liferay

1. **Invalidation, not replication (§3.4)** means a *new* node joins with an entirely empty cache and there is no mechanism to fill it from peers. Adding a node to a hot cluster temporarily makes things *worse*.
2. `ResourcePermissionImpl` entity cache ships with `<heap>1000000</heap>` — an order of magnitude larger than everything else. That's Liferay telling you permission resolution is the dominant cold-start cost. A cold permission cache means a permission-check storm on the first authenticated page views.
3. JSP compilation, FreeMarker template compilation, `PortalCacheIndexer` rebuilds, OSGi component activation, and Hibernate metadata (`hibernate.hbm.jaxb.cache`) all pile onto the same first minutes.
4. `<expiration-cache>` portlet caches are session-scoped (§4.1) → they are *always* cold for every new session, forever. No warming possible.

### 7.3 Practical warming strategies (all DIY)

**(a) Gate the load balancer on readiness, then synthetically warm.**
```properties
health.check.data.source.enabled=true      # exposes /health_check/data_source
```
`[SRC]` `master` also ships `com.liferay.portal.servlet.filters.healthcheckdatasource.HealthCheckDataSourceFilter`. Pattern: node starts → passes health check → **do not** add to the LB pool yet → run a warm-up crawler against the node directly → then add to pool. On Kubernetes this is exactly the readiness-probe + init-container-curl pattern.

**(b) Synthetic crawl of your top-N URLs.** A simple ordered list from your analytics, hit with `curl`/`k6`/`vegeta` against the node's direct address, as both guest and a warm-up service account (to populate the permission and entity caches, which are the ones that matter). Because the JournalContent cache key includes `languageId`, `viewMode`, `layoutSetId` and `secure`, warm the **exact** variants you serve.

**(c) Script Engine warm-up.** Server Administration → Script (Groovy) can touch services directly and is cluster-node-local:
```groovy
// Illustrative: force-populate the hot entity/finder caches
import com.liferay.portal.kernel.service.*
com.liferay.portal.kernel.service.CompanyLocalServiceUtil.getCompanies().each { company ->
    GroupLocalServiceUtil.getGroups(company.getCompanyId(), 0L, true).each { group ->
        LayoutLocalServiceUtil.getLayouts(group.getGroupId(), false)
    }
}
```
Docs: https://learn.liferay.com/w/dxp/security-and-administration/administration/using-the-script-engine
Caveat: this warms *entity/finder* caches, **not** the JournalContent display cache (that needs a real RENDER_PHASE — see §4.3 condition 2). Only HTTP warming fills the display cache.

**(d) Rolling restarts, one node at a time, sequentially.** `[DOC]` *"When several nodes need to be started it must be done sequentially, not in parallel, to avoid concurrency problems."* Combine with (a) so a cold node never takes production traffic while cold.

**(e) Don't fight the wrong battle: JSP/direct-servlet.** `direct.servlet.context.enabled=true` and `direct.servlet.context.reload=false` (defaults) plus `development=false`/`mappedFile=false` in Tomcat's `conf/web.xml` remove per-request JSP checks. Combine with JSP precompilation at build time if your app server supports it.

**(f) Measure your warm-up, don't guess it.** Instrument the JMX hit ratio (§8) and define "warm" as e.g. `CacheHitPercentage > 90` on `EntityCache.…ResourcePermissionImpl` before joining the LB. That turns warming from folklore into a gate.

| | |
|---|---|
| **Impact** | Very high on deploy/restart/scale-out latency spikes; zero on steady state. |
| **Effort** | Medium — entirely custom; needs a URL list, a runner, and LB integration. |
| **Limitation** | No native support means you own it; the session-scoped portlet cache can never be warmed; warming with a service account can populate caches with *that account's* view if a template is user-sensitive (see §9.1). |

---

## 8. Observability of caches

### 8.1 The MBeans (post-Ehcache-3)

`[BIN]` Disassembling `com.liferay.portal.cache.ehcache.impl:4.0.40` → `ManagementService`:
```
javap -p -c ManagementService.class | grep 'String'
// String org.ehcache:type=
// String ,CacheManager=
// String ,name=
// String CacheManager
// String Cache
// String CacheStatistics
```
So the ObjectNames are:
```
org.ehcache:type=CacheManager,name=<MANAGER_NAME>
org.ehcache:type=Cache,CacheManager=<MANAGER_NAME>,name=<CACHE_NAME>
org.ehcache:type=CacheStatistics,CacheManager=<MANAGER_NAME>,name=<CACHE_NAME>
```
where `<MANAGER_NAME>` is `MULTI_VM_PORTAL_CACHE_MANAGER` or `SINGLE_VM_PORTAL_CACHE_MANAGER`, and `<CACHE_NAME>` is e.g. `com.liferay.portal.kernel.dao.orm.EntityCache.com.liferay.portal.model.impl.ResourcePermissionImpl`.

`[BIN]` `CacheStatisticsMBean` exposes exactly four attributes:
```java
public interface CacheStatisticsMBean {
    getCacheHitPercentage();
    getCacheHits();
    getCacheMisses();
    getCacheMissPercentage();
}
```
plus `CacheStatisticsMBeanImpl` also holds a `Map<String, TierStatistics>` (per heap/offheap/disk tier).

**Before/after for the migration slide** `[BIN]`: on module `4.0.35` and earlier the prefix was `net.sf.ehcache:type=…` with an extra `CacheConfiguration` type. **Any Grafana/Zabbix/Datadog JMX config that matches `net.sf.ehcache:*` silently stops collecting on DXP 2025.Q2.** That is an excellent, concrete "upgrade broke my dashboards" war story.

### 8.2 Turning it on

```properties
    #
    # Set this to true to enable JMX integration in
    # com.liferay.portal.cache.EhcachePortalCacheManager.
    #
    ehcache.portal.cache.manager.jmx.enabled=true     # default: true
```
`[BIN]` In Ehcache 3, `BaseEhcachePortalCacheManager` constructs an `org.ehcache.core.internal.statistics.DefaultStatisticsService` unconditionally — **statistics are always collected**; the property only controls MBean registration. This is a *change*: the old `ehcache.statistics.enabled=true` property (documented in Armin Cyrus Dahncke's 2011 JConsole post) no longer exists and should be removed from your `portal-ext.properties`.

Also useful:
```properties
    cluster.link.jmx.enabled=false    # set true to expose the JGroups protocol stack via JMX
    jdbc.default.registerMbeans=true  # HikariCP pool MBeans, on by default
    hibernate.generate_statistics=false  # LPS-2056; enable only in load test
```

Exposing JMX on Tomcat:
```
CATALINA_OPTS="$CATALINA_OPTS \
-Dcom.sun.management.jmxremote \
-Dcom.sun.management.jmxremote.port=12345 \
-Dcom.sun.management.jmxremote.ssl=false \
-Dcom.sun.management.jmxremote.authenticate=false"
```
(from https://liferay.dev/blogs/-/blogs/monitor-liferay-cache-behaviour-with-jconsole — **do not ship those last two flags to production**.)

### 8.3 What to actually watch

**Cache-layer metrics:**
| Metric | Where | Why |
|---|---|---|
| `CacheHitPercentage` on `EntityCache.…ResourcePermissionImpl` | JMX | Dominant cost. Below ~90% → permission storm. |
| `CacheHitPercentage` on `EntityCache.…UserImpl`, `…LayoutImpl`, `…JournalArticleImpl` | JMX | The hot four. |
| `CacheHitPercentage` on the `FinderCache.….List1/List2` caches | JMX | Low here + high on entity = your finders are thrashing or exceeding `list.threshold`. |
| `CacheHits` **rate**, not just percentage | JMX | A 99% ratio on 3 requests is noise. |
| `TierStatistics` (mappings, evictions, expirations) | JMX | Rising evictions = `<heap>` too small; rising expirations = TTI too short. |

**Cluster-layer:**
| Metric | Where | Why |
|---|---|---|
| JGroups messages sent/received on `liferay-channel-transport-0` | `cluster.link.jmx.enabled=true` | The invalidation-storm detector. |
| `MergeView` / `Accepted view` log lines | Portal log | Split-brain and membership churn. |
| Cluster view size vs expected node count | `ClusterNodesDebugInformation.groovy` | Silent partial cluster = silent stale content. |

**Pressure/consequence:**
| Metric | Where | Why |
|---|---|---|
| HikariCP `ActiveConnections`, `PendingThreads` | `com.zaxxer.hikari:type=Pool (...)` | Pending > 0 sustained = cache misses are saturating the DB. |
| Old-gen occupancy after full GC, GC pause p99 | GC logs / JFR | Oversized `<heap>` shows up here first (§9.3). |
| DB queries/sec | DB side | The *outcome* metric. Cache work that doesn't move this is theatre. |

**Manual inspection:** Control Panel → Server Administration → Resources gives `[DOC]`:
- **Clear content cached by this VM** — "Only local JVM scope Ehcache content."
- **Clear content cached across the cluster** — "the content of the entire clustered Ehcache."
- **Clear the database cache** — persistence-layer results only.
- **Clear the direct servlet cache** — JSP servlets; emergency/dev only.

with the doc's own rule, verbatim:
> "Always clear the cache at the lowest (most granular) layer possible, even if you've already cleared a higher level cache."

| | |
|---|---|
| **Impact** | It *is* the enabler — you can't tune what you can't see. |
| **Effort** | Low: JMX is on by default; ~an hour to wire into Prometheus JMX exporter. |
| **Limitation** | Hit ratio is per-node and per-JVM-lifetime (no reset), so it's biased by startup; Ehcache 3 renamed the domain, breaking existing dashboards. |

---

## 9. Known gotchas (the "limitations imposed" section)

### 9.1 Caching silently breaking personalisation / permissions

This is the highest-severity class, because it fails **correctness**, not performance, and it fails *silently*.

1. **`JournalContent` cache key has no user, role, or segment** `[BIN]` — see §4.3. Any DDM template that branches on the current user leaks one user's render to everyone. The `Cacheable` checkbox is the only defence.
2. **Fragment caching + Segmentation.** `[DOC]` The fragment docs warn that cached fragments show stale mapped-asset content until republish. The unstated corollary: a cached fragment does not vary by segment. Segmentation/personalization must live in *uncached* fragments or in Experiences resolved above the cache.
3. **Portlet `<expiration-cache>` key = `plid + portletId + languageId`** `[BIN]` — safe only because it's session-scoped. Never try to "improve" it by promoting it to a shared cache.
4. **Warming with a privileged account** poisons any user-sensitive cache with an admin-eye view. Warm as the *least*-privileged persona, or only warm caches that are provably user-invariant.
5. `browser.cache.disabled=true` / `browser.cache.signed.in.disabled=true` are both `true` by default, verbatim: *"This is useful to ensure that authenticated users cannot go to the sign in page by clicking on the back button in their browsers."* Flipping these to chase a Lighthouse score is a security regression.
6. **Historical precedent:** even Liferay's own `CacheFilter` had to re-check `isCacheableRequest()` a second time before writing, with the comment *"the user could have been authenticated after the initial test."* If the vendor needed a double-check, so do you.

**Slide heuristic:** *A cache key that doesn't contain the identity axis is a cache that ignores the identity axis.* Write the key on the slide next to the question "who could see this?"

### 9.2 Cache stampede / thundering herd on invalidation

- `[BIN]` **Liferay has no single-flight protection.** `BlockingPortalCache` and `value.object.entity.blocking.cache` do not exist in current releases. On a miss, N concurrent threads all execute the query.
- The invalidation model makes this worse by design: one write → **every other node** drops the key → next request on each node stampedes. With `M` nodes and `C` concurrent requests you get up to `M × C` simultaneous identical queries.
- **Bulk operations are the trigger.** A content import, a mass permission change, or a `RESOURCE_PERMISSION` rewrite generates a flood of `REMOVE` events on `liferay-channel-transport-0`, each causing distributed misses.
- **Mitigations available today:**
  - `usingCoalescedPipe=true` on `PortalCacheClusterConfiguration` — collapses duplicate cache events before they hit the wire `[BIN]`.
  - `ehcache.replicator.properties.<CACHE>=replicatePuts=false` — Liferay's own choice for eight caches; stops put-events entirely for caches that are cheap to recompute locally.
  - Stagger TTI/TTL per cache so entries don't all expire together (`<expiry><tti>600</tti></expiry>` everywhere means synchronised expiry waves — jitter them in your override file).
  - For your own `PortalCache` usage, implement single-flight yourself with a `ConcurrentHashMap<K, CompletableFuture<V>>` in front of the cache.
  - Schedule bulk imports/permission rebuilds off-peak, and consider `ClusterInvokeThreadLocal` suppression around them where safe.
- **Related:** `cacheable.query.limit.LPD-27353=1000`, `LPD-28122=10000`, `LPD-38877=10` are Liferay bounding specific queries whose cached result sets grew pathological — evidence that "cache everything" fails at the tail.

### 9.3 Memory pressure and GC from oversized caches

- **`<heap>N</heap>` counts entries, not bytes.** The shipped multi-VM defaults are `default` = 200,000 entries and `ResourcePermissionImpl` = **1,000,000 entries**. If your `ResourcePermission` rows are ~200 bytes as a `CacheModel`, that's ~200 MB for one cache. If someone "optimises" by 10×-ing every `<heap>`, you get an OOM, not a speedup.
- Ehcache 3 does support byte-sized heap pools (`<heap unit="MB">512</heap>`) — **that's the safer way to bound a cache and Liferay's XML config supports it** because Liferay hands the file to `org.ehcache.xml.XmlConfiguration` `[BIN]`. Consider it for caches holding large variable-size values (rendered markup, DDM data).
- The multi-VM caches hold `Serializable` values, which are long-lived → they get **tenured into old gen**. Bigger caches → bigger old gen → longer G1 mixed/full GC pauses. Cache tuning and GC tuning are the same conversation.
- `[DOC]` *Tuning Your JVM* guidance to pair with cache sizing:
  - `-Xms2560m -Xmx2560m` (min = max), **do not exceed 32 GB** (compressed oops cliff), and "your heap size should be commensurate with the speed and quantity of available CPU resources."
  - `-XX:NewSize=1536m -XX:MaxNewSize=1536m` (~half the heap), `-XX:SurvivorRatio=16 -XX:TargetSurvivorRatio=50 -XX:MaxTenuringThreshold=15`.
  - `-XX:MetaspaceSize=768m -XX:MaxMetaspaceSize=768m`, `-XX:InitialCodeCacheSize=64m -XX:ReservedCodeCacheSize=96m` — "too small a code cache reduces performance, as the JIT isn't able to optimize high frequency methods."
  - Java 11+: CMS is deprecated; use **G1 defaults** first.
- **The session-memory trap (§4.1):** portlet `<expiration-cache>` markup lives in `HttpSession`. 10 KB of markup × 3 portlets × 20,000 sessions = 600 MB of session heap that no cache dashboard will show you.
- **Sizing method for the talk:** don't set `<heap>` from intuition. Take a heap dump under load, measure retained size per cache, divide by entry count to get bytes/entry, then set `<heap>` = (memory budget for that cache) / (bytes per entry). Re-measure after every content-model change.

### 9.4 Upgrade-time landmines (2024–2026)

| Landmine | Effect |
|---|---|
| Ehcache 2 XML files (`<ehcache>`, `maxElementsInMemory`) | **Fail to parse** on 2025.Q2+. Rewrite to Ehcache 3 schema. |
| `<cacheEventListenerFactory>` / `PortalCacheListenerFactory` in XML | Removed (LPD-43563). Use `registerPortalCacheListener()`. |
| Custom XML named `liferay-multi-vm.xml` | `NullPointerException: Configuration path is null` — rename it. |
| JMX monitoring matching `net.sf.ehcache:*` | Silently collects nothing on 2025.Q2+. Change to `org.ehcache:*`. |
| `com.liferay.portal.servlet.filters.cache.CacheFilter=true` in `portal-ext.properties` | Inert since CE 7.4.3.123 (Jun 2024). |
| `ehcache.statistics.enabled=true` | Inert (6.x property). |
| `ehcache.cluster.link.replication.enabled=true` | Inert since DXP 7.0 — `[DOC]` *"Both of these are unnecessary in DXP."* |
| `resourceModificationCheck="0"` in `FreeMarkerEngineConfiguration.config` | Inert since `portal-template-freemarker` 7.0.55 (~2024.Q3). |
| `ehcache.socket.start.port` / `ehcache.socket.so.timeout` | Removed since 7.4 GA1. |
| `value.object.entity.blocking.cache` | Never existed in 7.x; ignore old blog posts. |
| 2025.Q3 Jakarta EE migration | Cache module now bundles `ehcache-3.10.8-jakarta.jar`; any custom cache module compiled against `javax.*` breaks. |

### 9.5 Consistency gotchas

- **Custom SQL writes don't invalidate.** Any `runSQL()`/`createSQLQuery()` `UPDATE`/`DELETE` leaves entity+finder caches stale until eviction. Follow with explicit `EntityCacheUtil.clearCache(Foo.class)` / `FinderCacheUtil.clearCache(Foo.class)` — or don't do it.
- **Negative caching** (`EmptyResult` in `EntityCacheImpl`) means out-of-band inserts stay invisible.
- **Publications / Change Tracking** disable the JournalContent cache (`CTCollectionThreadLocal.isProductionMode()`), and `CTAwarePortalCache` wraps entity caches — expect different performance characteristics inside a publication and don't benchmark there.
- **Split-brain** produces two divergent MultiVM caches that silently reconverge on `MergeView` without reconciling. After any `MergeView` in the log, clear caches across the cluster.
- **`transactional.cache.enable=true`** means cache mutations land at commit. In a rolled-back transaction the cache is correctly unchanged — but code that reads its own uncommitted writes through the cache will behave differently under load than in a unit test.
- **`table.mapper.cacheless.mapping.table.names`** — Liferay deliberately disables caching on `Users_Groups`, `Users_Orgs`, `Users_Roles`, `Users_Teams`, `Users_UserGroups`. Do not "optimise" these back on; membership changes must be immediate for security.

---

## Appendix A — Impact vs Effort summary

| Technique | Impact | Effort | Verdict |
|---|---|---|---|
| Entity + Finder cache sizing per hot entity | **Very High** | Low–Med | **Do this first.** Biggest query-elimination lever on paper. Our lab measured no gain from it: headless by-id stayed at 8 ms, and the gain came from fragment `Cacheable` (`part1-simulations/results/RUNG-RESULTS.md`). |
| Cluster Link enabled + correct discovery (JDBC_PING) | **Very High** (correctness) | Med | Mandatory for clusters. |
| Fragment `Cacheable` flag on static fragments | **High** | Very Low | Best modern page-level win. |
| Web Content template `Cacheable` (audited) | **High** | Low | Audit templates first, or you ship a data leak. |
| Frontend Resource Caching (2025.Q4+/2026.Q1+) | **High** | Very Low | Free win if you're on a recent release. |
| Ehcache 3 migration on 2025.Q2 upgrade | **High** (avoid outage) | Med | Not optional — it's a breaking change. |
| JMX cache observability wiring | **High** (enabler) | Low | Do before any tuning. |
| Cache warming / LB readiness gating | **High** at deploy | Med | Custom build; worth it if you deploy often. |
| Retiring custom SQL for DSL queries / generated finders | **High** | High | Long-term; measure worst offenders first. |
| HikariCP right-sizing (usually *down*) | Med | Low | Do *after* cache tuning, not before. |
| `usingCoalescedPipe=true` | Med | Very Low | Only if you see invalidation storms. |
| `replicate*ViaCopy=true` on selected caches | Low, risky | Low | Almost always the wrong answer. |
| Portlet `<expiration-cache>` | Low | Low | Session-memory cost usually exceeds the benefit. |
| Hibernate second-level cache | **Zero** | — | Doesn't exist. Skip. |
| `CacheFilter` tuning | **Zero** | — | Class deleted in 2024. Skip. |

## Appendix B — Reproduce every `[BIN]` finding in ~2 minutes

```bash
# 1. CacheFilter removal (CE 7.4.3.122 -> .123)
for n in 122 123; do
  printf "7.4.3.%s: " $n
  curl -so /dev/null -w "%{http_code}\n" \
    "https://raw.githubusercontent.com/liferay/liferay-portal/7.4.3.$n-ga$n/portal-impl/src/com/liferay/portal/servlet/filters/cache/CacheFilter.java"
done
curl -s https://releases-cdn.liferay.com/dxp/7.4.13-u123/release.properties | grep -E '^(release.date|git.hash.liferay-portal-ee)'

# 2. Ehcache 2 -> 3
for v in 4.0.35 4.0.36 4.0.40; do
  curl -sO "https://repo1.maven.org/maven2/com/liferay/com.liferay.portal.cache.ehcache.impl/$v/com.liferay.portal.cache.ehcache.impl-$v.jar"
  echo -n "$v -> "; unzip -l com.liferay.portal.cache.ehcache.impl-$v.jar | grep -oE "lib/[a-z.0-9-]*ehcache[^ ]*\.jar"
done
unzip -p com.liferay.portal.cache.ehcache.impl-4.0.40.jar ehcache/liferay-multi-vm.xml | head -30

# 3. Replication defaults + invalidation-on-receive
curl -sO "https://repo1.maven.org/maven2/com/liferay/com.liferay.portal.cache.multiple/5.0.33/com.liferay.portal.cache.multiple-5.0.33.jar"
javap -p -c -cp com.liferay.portal.cache.multiple-5.0.33.jar \
  com.liferay.portal.cache.multiple.internal.ClusterLinkPortalCacheReplicator | head -80
javap -p -c -cp com.liferay.portal.cache.multiple-5.0.33.jar \
  com.liferay.portal.cache.multiple.internal.cluster.link.messaging.ClusterLinkPortalCacheClusterListener

# 4. JMX ObjectNames (old vs new)
unzip -o -q com.liferay.portal.cache.ehcache.impl-4.0.40.jar 'com/liferay/portal/cache/ehcache/internal/management/*'
javap -p -c com/liferay/portal/cache/ehcache/internal/management/ManagementService.class | grep -oE '// String .*' | sort -u

# 5. JournalContent cache key / conditions
curl -sO "https://repo1.maven.org/maven2/com/liferay/com.liferay.journal.service/7.0.172/com.liferay.journal.service-7.0.172.jar"
unzip -o -q com.liferay.journal.service-7.0.172.jar 'com/liferay/journal/internal/util/*'
javap -p 'com/liferay/journal/internal/util/JournalContentImpl$JournalContentKey.class'

# 6. Custom SQL bypasses FinderCache
curl -s https://raw.githubusercontent.com/liferay/liferay-portal/master/modules/apps/journal/journal-service/src/main/java/com/liferay/journal/service/persistence/impl/JournalArticleFinderImpl.java | grep -ci findercache   # -> 0
```

---

## Sources

**Official Liferay documentation (learn.liferay.com / help.liferay.com)**
- https://learn.liferay.com/w/dxp/self-hosted-installation-and-upgrades/setting-up-liferay/clustering-for-high-availability/configuring-cluster-link
- https://learn.liferay.com/dxp/latest/en/installation-and-upgrades/setting-up-liferay/clustering-for-high-availability/configuring-cluster-link.html
- https://learn.liferay.com/kb-article/managing-distributed-cache-in-liferay-dxp
- https://learn.liferay.com/kb-article/ehcache-configuration-for-dxp-7.x
- https://learn.liferay.com/kb-article/ehcache-configuration-for-different-versions-of-the-liferay-platform
- https://learn.liferay.com/kb-article/cache-override
- https://learn.liferay.com/kb-article/liferay-s-clustering-api
- https://learn.liferay.com/kb-article/using-the-ehcache.multi.vm.config.location-property-the-java.lang.nullpointerexception-configuration-path-is-null-error-occured
- https://learn.liferay.com/kb-article/installing-liferay-portal-in-a-clustered-environment
- https://learn.liferay.com/kb-article/overwrite-cache-control-header-settings-for-resources-in-liferay-web.xml-file
- https://learn.liferay.com/w/dxp/self-hosted-installation-and-upgrades/setting-up-liferay/tuning-liferay
- https://learn.liferay.com/w/dxp/self-hosted-installation-and-upgrades/setting-up-liferay/tuning-your-jvm
- https://learn.liferay.com/w/dxp/self-hosted-installation-and-upgrades/setting-up-liferay/clustering-for-high-availability/database-configuration-for-cluster-nodes
- https://learn.liferay.com/w/dxp/security-and-administration/administration/using-the-server-administration-panel/managing-system-resources
- https://learn.liferay.com/w/dxp/security-and-administration/administration/configuring-liferay/virtual-instances/configuring-frontend-resource-caching
- https://learn.liferay.com/w/dxp/security-and-administration/administration/using-the-script-engine
- https://learn.liferay.com/w/dxp/sites/creating-pages/page-fragments-and-widgets/using-fragments/managing-fragments
- https://learn.liferay.com/w/dxp/content-management-system/web-content/web-content-templates/creating-web-content-templates
- https://learn.liferay.com/w/dxp/content-management-system/web-content/web-content-templates/mapping-web-content-templates-to-fragments
- https://learn.liferay.com/w/dxp/content-authoring-and-management/web-content/web-content-articles/using-expiration-and-review-dates-in-web-content
- https://learn.liferay.com/w/dxp/self-hosted-installation-and-upgrades/upgrading-liferay/deprecations-and-breaking-changes-reference/2025-deprecations-and-breaking-changes/2025-q1-breaking-changes
- https://learn.liferay.com/w/dxp/self-hosted-installation-and-upgrades/upgrading-liferay/deprecations-and-breaking-changes-reference/2025-deprecations-and-breaking-changes/2025-q2-breaking-changes
- https://learn.liferay.com/w/dxp/self-hosted-installation-and-upgrades/upgrading-liferay/deprecations-and-breaking-changes-reference/2025-deprecations-and-breaking-changes/2025-q3-breaking-changes
- https://learn.liferay.com/w/dxp/self-hosted-installation-and-upgrades/upgrading-liferay/deprecations-and-breaking-changes-reference/2026-deprecations-and-breaking-changes
- https://learn.liferay.com/w/dxp/self-hosted-installation-and-upgrades/upgrading-liferay/deprecations-and-breaking-changes-reference/2026-deprecations-and-breaking-changes/2026-q1-breaking-changes
- https://learn.liferay.com/w/dxp/self-hosted-installation-and-upgrades/upgrading-liferay/deprecations-and-breaking-changes-reference/2026-deprecations-and-breaking-changes/2026-q2-breaking-changes
- https://learn.liferay.com/w/dxp/self-hosted-installation-and-upgrades/upgrading-liferay/deprecations-and-breaking-changes-reference/2024-deprecations-and-breaking-changes/2024-q3-maintenance-mode-and-deprecations
- https://learn.liferay.com/w/dxp/self-hosted-installation-and-upgrades/upgrading-liferay/deprecations-and-breaking-changes-reference/7-4-deprecations-and-breaking-changes/7-4-breaking-changes
- https://help.liferay.com/hc/en-us/articles/360018175191-Liferay-DXP-Clustering
- https://help.liferay.com/hc/en-us/articles/360018176251-Enabling-Cluster-Link
- https://help.liferay.com/hc/en-us/articles/360017897032-Tuning-Guidelines
- https://help.liferay.com/hc/en-us/articles/360018185291-Server-Administration
- https://help.liferay.com/hc/en-us/articles/360018174651-Server-Administration-Resources
- https://help.liferay.com/hc/en-us/articles/360029131591-System-Settings
- https://help.liferay.com/hc/en-us/articles/360020486752-Servlet-Filters
- https://help.liferay.com/hc/es/articles/4728887170061-Web-Content-Template-caching-Changes-are-displayed-even-though-Resource-modifications-check-is-set

**Reference / API docs**
- https://resources.learn.liferay.com/reference/latest/en/dxp/propertiesdoc/portal.properties.html
- https://resources.learn.liferay.com/reference/latest/en/dxp/javadocs/portal-kernel/com/liferay/portal/kernel/cache/SingleVMPool.html
- https://docs.liferay.com/dxp/portal/7.2-latest/javadocs/portal-kernel/com/liferay/portal/kernel/cache/MultiVMPool.html
- https://docs.liferay.com/dxp/portal/7.2-latest/javadocs/portal-kernel/com/liferay/portal/kernel/cache/PortalCache.html
- https://docs.liferay.com/portal/7.4-latest/javadocs/portal-impl/com/liferay/portal/template/BaseTemplateResourceCache.html
- https://resources.learn.liferay.com/reference/latest/en/dxp/javadocs/portal-impl/index.html?com/liferay/portal/servlet/filters/cache/CacheUtil.html
- https://docs.liferay.com/portal/7.0/javadocs/portal-impl/com/liferay/portal/servlet/filters/cache/CacheFilter.html
- https://docs.liferay.com/ce/apps/web-experience/latest/javadocs/com/liferay/journal/util/JournalContent.html

**Liferay source (github.com/liferay)**
- https://raw.githubusercontent.com/liferay/liferay-portal/master/portal-impl/src/portal.properties
- https://raw.githubusercontent.com/liferay/liferay-portal/7.4.3.4-ga4/portal-impl/src/portal.properties
- https://raw.githubusercontent.com/liferay/liferay-portal/master/portal-web/docroot/WEB-INF/liferay-web.xml
- https://raw.githubusercontent.com/liferay/liferay-portal/7.4.3.122-ga122/portal-web/docroot/WEB-INF/liferay-web.xml
- https://raw.githubusercontent.com/liferay/liferay-portal/7.4.3.122-ga122/portal-impl/src/com/liferay/portal/servlet/filters/cache/CacheFilter.java
- https://raw.githubusercontent.com/liferay/liferay-portal/master/definitions/liferay-portlet-app_7_4_0.dtd
- https://raw.githubusercontent.com/liferay/liferay-portal/master/portal-kernel/src/com/liferay/portal/kernel/cache/PortalCache.java
- https://raw.githubusercontent.com/liferay/liferay-portal/master/portal-kernel/src/com/liferay/portal/kernel/cache/MultiVMPool.java
- https://raw.githubusercontent.com/liferay/liferay-portal/master/portal-kernel/src/com/liferay/portal/kernel/cache/SingleVMPool.java
- https://raw.githubusercontent.com/liferay/liferay-portal/master/portal-kernel/src/com/liferay/portal/kernel/cache/PortalCacheManagerNames.java
- https://raw.githubusercontent.com/liferay/liferay-portal/master/portal-kernel/src/com/liferay/portal/kernel/cache/PortalCacheHelperUtil.java
- https://raw.githubusercontent.com/liferay/liferay-portal/master/portal-impl/src/com/liferay/portal/service/impl/PortletLocalServiceImpl.java
- https://raw.githubusercontent.com/liferay/liferay-portal/master/modules/apps/journal/journal-service/src/main/java/com/liferay/journal/service/impl/JournalArticleLocalServiceImpl.java
- https://raw.githubusercontent.com/liferay/liferay-portal/master/modules/apps/journal/journal-service/src/main/java/com/liferay/journal/service/persistence/impl/JournalArticleFinderImpl.java
- https://github.com/liferay/liferay-portal/blob/master/modules/apps/portal-template/portal-template-freemarker/src/main/java/com/liferay/portal/template/freemarker/configuration/FreeMarkerEngineConfiguration.java
- https://github.com/liferay/liferay-portal/blob/master/modules/apps/portal-template/portal-template-freemarker/src/main/java/com/liferay/portal/template/freemarker/internal/FreeMarkerManager.java
- https://github.com/liferay/liferay-docs/blob/master/en/deployment/articles/02-configuring-liferay/04-liferay-portal-clustering/05-enabling-cluster-link.markdown

**Maven Central artifacts inspected (`[BIN]` evidence)**
- `com.liferay.portal:com.liferay.portal.impl:114.1.0`
- `com.liferay:com.liferay.portal.cache.ehcache.impl:4.0.35 / 4.0.36 / 4.0.40`
- `com.liferay:com.liferay.portal.cache.api:13.0.1`
- `com.liferay:com.liferay.portal.cache.impl:4.0.39`
- `com.liferay:com.liferay.portal.cache.multiple:5.0.33`
- `com.liferay:com.liferay.portal.cache.ehcache.multiple:2.0.3`
- `com.liferay:com.liferay.portal.cache.ehcache.ee.provider:2.0.7`
- `com.liferay:com.liferay.journal.service:7.0.172`, `com.liferay.journal.api:39.1.0`
- `com.liferay:com.liferay.portal.template.freemarker:7.0.52 / 7.0.54 / 7.0.55 / 7.0.62`

**Liferay JIRA**
- https://issues.liferay.com/browse/LPS-108376 (fragment cacheable)
- https://issues.liferay.com/browse/LPS-68125 (CacheFilter user-agent key)
- https://issues.liferay.com/browse/LPS-60638 (CacheFilter hit rate)
- https://issues.liferay.com/browse/LPS-87736 (Cacheable checkbox on WC template)
- https://issues.liferay.com/browse/LPS-70512 (cache stops working when nodes idle)
- https://issues.liferay.com/browse/LPE-676 (improved entity caching)
- LPD-40485 (Ehcache 3.10.8), LPD-43563 (PortalCacheListenerFactory removed) — via 2025.Q2 breaking changes

**Community and partner blogs**
- https://liferay.dev/b/tunning-ehcache-3-x — Daniel Martinez Cisneros, 6 Nov 2025
- https://liferay.dev/b/liferay-s-architecture-caching-part-1- — Jorge Ferrer, 21 Jan 2013
- https://liferay.dev/blogs/-/blogs/a-checkbox-named-cacheable — Javeed Chida, 12 Jun 2017
- https://liferay.dev/en/b/how-to-diagnose-and-recover-liferay-cluster — Mariano Alvaro, 31 Aug 2020
- https://liferay.dev/blogs/-/blogs/monitor-liferay-cache-behaviour-with-jconsole — Armin Cyrus Dahncke, 27 Jul 2011
- https://liferay.dev/b/liferay-caching-service-level-caching-using-webcachepool
- https://liferay.dev/blogs/-/blogs/introducing-liferay-portal-ce-rolling-releases-1 — Jorge Ferrer, 28 Feb 2020
- https://liferay.dev/blogs/-/blogs/connection-pool-gotchas
- https://liferay.dev/b/tomcat-hikaricp
- https://liferay.dev/ask/-/message_boards/message/119087444 (Override liferay-multi-vm.xml)
- https://liferay.dev/ask/-/message_boards/message/122060214 (Liferay 7.4 Ehcache configuration)
- https://liferay.dev/forums/-/message_boards/message/91893718 (disable FreeMarker WC template cache)
- https://gist.github.com/balcsida/fcc9dce2df77c775fcc01045916e20eb (osgi/configs template cache disable)
- https://gist.github.com/slemarchand/2310f7b3104acc2c0f58 (clear all Liferay caches, local + cluster)
- https://www.surekhatech.com/blog/how-to-create-and-manage-cache-configuration-in-liferay-dxp
- https://www.surekhatech.com/blog/liferay-performance-tuning
- https://www.xtivia.com/blog/caching-observations-liferay-6/
- https://www.xtivia.com/blog/tuning-basic-jvm-performance-liferay-dxp-7/
- https://www.xtivia.com/blog/liferay-2026-q1-lts/
- https://blog-es.mimacom.com/redis-como-cache-liferay-dxp/ — Beatriz Estévez, 10 Apr 2018
- https://portalworks.de/en/w/liferay-2026-q2-drei-weichenstellungen-die-mehr-bedeuten-als-ein-quartals-update
- https://www.oreilly.com/library/view/liferay-portal-performance/9781782163688/ch01s06.html (caching architecture, historical)
- https://colab.mpdl.mpg.de/mw010/images/8/8c/Performance_Tuning_Michael_Han.pdf (Michael Han, Liferay Performance Tuning)

**External reference**
- https://www.ehcache.org/documentation/2.8/operations/jmx.html (old JMX naming, for the before/after slide)
- https://www.ehcache.org/schema/ehcache-core-3.10.xsd (Ehcache 3 schema)
- https://github.com/brettwooldridge/HikariCP/wiki (pool sizing, referenced by portal.properties)

---

### Suggested talk arc for this section
1. **Kill the myths** (CacheFilter is deleted; Hibernate L2 is gone; `ehcache.statistics.enabled` does nothing). Establishes credibility fast and gets a laugh.
2. **Show the real stack:** `PortalCache` SPI → Ehcache 3 → two managers → Cluster Link.
3. **The invalidation reveal** — put the bytecode-derived defaults table on screen and explain why "distributed cache" doesn't mean what people think.
4. **Where the wins actually are:** entity/finder sizing, fragment cacheable, WC template cacheable, frontend resource caching.
5. **The limitations slide:** cache key ⇒ identity axis; RENDER_PHASE only; publications; custom SQL blind spot; session-scoped portlet cache.
6. **Cold cache** — the problem nobody budgets for, no native support, here's the DIY pattern.
7. **Close on observability:** you can't claim any of this without `org.ehcache:type=CacheStatistics`.
agentId: a1bf13feac371373e (use SendMessage with to: 'a1bf13feac371373e', summary: '<5-10 word recap>' to continue this agent)
<usage>subagent_tokens: 257212
tool_uses: 186
duration_ms: 2065469</usage>

---


---

# CDN Configuration & Cloudflare Specifics in Front of Liferay
### Research brief for Liferay DevCon 2026 — "Making Liferay Blazing Fast in Production"
*Compiled 2026-08-11. Anchored on Liferay DXP 2025.Q1+ quarterly releases, Liferay PaaS/SaaS, and Cloudflare docs as of Jul 2026.*

---

## 0. Executive summary — the five things to say on stage

1. **Liferay's built-in CDN support is a static-asset URL rewriter, not a page cache.** `cdn.host.http/https` only prefixes theme resources, module JS/CSS, combo requests, ES modules, portal images and portlet dependencies. It does **not** touch Documents & Media, Adaptive Media, portlet resource URLs, or page HTML.
2. **Liferay's default HTML response is deliberately uncacheable** (`browser.cache.disabled=true` → `Cache-Control: private, no-cache, no-store, must-revalidate`) *and* Liferay emits `Set-Cookie: JSESSIONID` on the first request. Either one alone is enough to make Cloudflare return `BYPASS`/`MISS` forever. Edge HTML caching for Liferay is therefore always an explicit, deliberate, slightly dangerous act.
3. **The single highest-leverage Cloudflare config is a two-rule pair**: (a) bypass cache when an authentication cookie is present, (b) cache-everything for guest HTML with an *override* Edge TTL. Rule (b) is what strips `Set-Cookie` — and is also exactly the mechanism that leaks a signed-in user's HTML if rule (a) is wrong.
4. **Liferay PaaS/SaaS is Google Cloud CDN, not Cloudflare.** SaaS is hard-pinned to `USE_ORIGIN_HEADERS` with a 1-hour TTL you cannot change. If you want Cache Rules, cache tags, Workers or Cache Reserve, you bring your own Cloudflare zone in front.
5. **Liferay has announced its own "Integrated CDN"** with auto-purge-on-publish, cache tags, signed links for private DL files and WAF presets — currently marked *Coming Soon*. Worth a slide as "what's landing".

---

## 1. Liferay's own CDN support

### 1.1 The portal properties (verbatim)

From `portal-impl/src/portal.properties` on `master` ([source](https://raw.githubusercontent.com/liferay/liferay-portal/master/portal-impl/src/portal.properties)):

```properties
##
## Content Delivery Network
##

    #
    # Set the hostname that will be used to serve static content via a CDN for
    # requests made over the HTTP protocol. This property can be disabled
    # dynamically at runtime by setting the URL parameter "cdn_enabled" to "0".
    # The value must always include the full protocol.
    #
    # Env: LIFERAY_CDN_PERIOD_HOST_PERIOD_HTTP
    #
    cdn.host.http=

    #
    # Set the hostname that will be used to serve static content via a CDN for
    # requests made over the HTTPS protocol. This property can be disabled
    # dynamically at runtime by setting the URL parameter "cdn_enabled" to "0".
    # The value must always include the full protocol.
    #
    # Env: LIFERAY_CDN_PERIOD_HOST_PERIOD_HTTPS
    #
    cdn.host.https=

    #
    # Set this to true to enable serving dynamically generated CSS, JavaScript,
    # and images via a CDN. Setting this to false allows the usage of CDNs that
    # do not support lazy loading of resources (e.g. Amazon CloudFront).
    #
    # Env: LIFERAY_CDN_PERIOD_DYNAMIC_PERIOD_RESOURCES_PERIOD_ENABLED
    #
    cdn.dynamic.resources.enabled=true
```

Also relevant, from the portlet-dependency section of the same file:

```properties
# {portlet.dependency.css.urn}/scope/version/name.css
# If not specified, CSS dependencies will have the following URL pattern:
#   http://{cdn.host.http}/css/scope/version/name.css   (unsecure)
#   https://{cdn.host.https}/css/scope/version/name.css (secure)
```

**Environment-variable form** (the way you'll actually set these in containers/PaaS):
`LIFERAY_CDN_PERIOD_HOST_PERIOD_HTTP`, `LIFERAY_CDN_PERIOD_HOST_PERIOD_HTTPS`, `LIFERAY_CDN_PERIOD_DYNAMIC_PERIOD_RESOURCES_PERIOD_ENABLED`.

### 1.2 UI location and precedence

Control Panel → Configuration → **Instance Settings** → Virtual Instance Scope → **General**, fields **CDN Host HTTP**, **CDN Host HTTPS**, **Enable CDN Dynamic Resources**. Docs example values: `http://cdnhost1.liferay.com` / `https://cdnhost2.liferay.com`, and *"Make sure to include the protocol and domain when specifying your CDN host(s) URLs."* ([Serving Static Resources via a CDN](https://learn.liferay.com/w/dxp/self-hosted-installation-and-upgrades/setting-up-liferay/using-a-cdn))

**Precedence gotcha:** Instance Settings values are stored in `PortalPreferences` and **override** `portal-ext.properties`. Setting `cdn.dynamic.resources.enabled=false` does **not** disable the CDN — it only stops *dynamically generated* CSS/JS from going to the CDN; `cdn.host.http/https` continue to serve static content. To fully disable, blank/comment both host properties *and* clear the Instance Settings fields. ([Liferay KB: cdn.dynamic.resources.enabled=false is not working](https://learn.liferay.com/kb-article/content-delivery-network-cdn-configuration-cdn.dynamic.resources.enabled-false-is-not-working))

### 1.3 How the rewrite actually works (source-level)

`PortalImpl.getCDNHost(HttpServletRequest)` ([source](https://raw.githubusercontent.com/liferay/liferay-portal/master/portal-impl/src/com/liferay/portal/util/PortalImpl.java)):

```java
public String getCDNHost(HttpServletRequest httpServletRequest)
    throws PortalException {

    boolean cdnEnabled = ParamUtil.getBoolean(
        httpServletRequest, "cdn_enabled", true);
    String portletId = ParamUtil.getString(httpServletRequest, "p_p_id");

    if (!cdnEnabled || portletId.equals(PortletKeys.PORTAL_SETTINGS)) {
        return StringPool.BLANK;
    }
    ...
    if (Validator.isUrl(cdnHost)) {
        return cdnHost;
    }
    return StringPool.BLANK;
}
```

Four operationally useful facts fall out of this:

| Fact | Why you care |
|---|---|
| `?cdn_enabled=0` on any URL disables CDN rewriting for that request | **Best debugging trick in the deck.** Instant A/B of "is the CDN the problem?" without a config change or restart |
| CDN is forcibly disabled inside the Portal Settings portlet | You can always fix a broken CDN hostname through the UI, even if the CDN is down. No lock-out |
| `Validator.isUrl(cdnHost)` must pass | A value missing the scheme silently degrades to blank — no error, just "CDN doesn't work" |
| Values are memoised per-company in `_cdnHostHttpMap`, cleared via `PortalUtil.resetCDNHosts()` which is broadcast cluster-wide (`MethodHandler` + cluster invoke) | Changing the host in Instance Settings does propagate to all nodes; you do not need a rolling restart |

**What gets the CDN prefix.** The authoritative list is `AbsolutePortalURLBuilderImpl` ([source](https://raw.githubusercontent.com/liferay/liferay-portal/master/modules/apps/portal-url-builder/portal-url-builder-impl/src/main/java/com/liferay/portal/url/builder/internal/AbsolutePortalURLBuilderImpl.java)) — every builder that receives `_getCDNHost(_httpServletRequest)`:

| Builder | CDN-prefixed? |
|---|---|
| `forBundleScript` / `forBundleStylesheet` | ✅ |
| `forComboRequest` (`/combo?...`) | ✅ |
| `forESModule` | ✅ |
| `forPortalImage` (`/image/...`) | ✅ |
| `forPortletDependency` | ✅ |
| `forWebContextScript` / `forWebContextStylesheet` | ✅ |
| `forBrowserModule` | ❌ |
| `forPortalMainResource` (`/c/portal/...`) | ❌ |
| `forServlet` | ❌ |

Plus, from `ThemeDisplay.setLookAndFeel(...)` ([source](https://raw.githubusercontent.com/liferay/liferay-portal/master/portal-kernel/src/com/liferay/portal/kernel/theme/ThemeDisplay.java)):

```java
String cdnBaseURL = getCDNBaseURL();
setPathColorSchemeImages(cdnBaseURL + themeStaticResourcePath + colorScheme.getColorSchemeImagesPath());
setPathControlPanelSpritemap(... cdnBaseURL ... "/clay/icons.svg");

String dynamicResourcesHost = getCDNDynamicResourcesHost();
if (Validator.isNull(dynamicResourcesHost)) { dynamicResourcesHost = portalURL; }

setPathThemeCss(dynamicResourcesHost + themeStaticResourcePath + theme.getCssPath());   // <-- dynamic host!
setPathThemeImages(cdnBaseURL + themeStaticResourcePath + theme.getImagesPath());
setPathThemeJavaScript(cdnBaseURL + themeStaticResourcePath + theme.getJavaScriptPath());
setPathThemeSpritemap(... cdnBaseURL ...);
setPathThemeTemplates(cdnBaseURL + themeStaticResourcePath + theme.getTemplatesPath());
```

> ⚠️ **Subtle trap worth a slide.** `$theme_display.getPathThemeCss()` uses the **dynamic** resources host, while images/JS/templates use the **base** CDN host. If you set `cdn.dynamic.resources.enabled=false`, your theme *CSS* silently falls back to the origin while everything else stays on the CDN. That asymmetry is the source of most "half my theme is on the CDN" tickets.

### 1.4 The static-resource query string (cache-key relevance)

`PortalImpl.getStaticResourceURL(...)` appends, in order: `browserId`, `themeId` (for `.css`/`.jsp`), `colorSchemeId` (for `.jsp`), `minifierType` (`css`/`js`, when fast-load is on), any caller query string, `languageId`, and `t=<lastModified>`.

Real example harvested live from `www.liferay.com`:

```
/combo?browserId=other&minifierType=js&languageId=en_US&t=1786457859343&/o/frontend-js-aui-web/aui/aui-min.js&...
```

Consequences for the CDN:
- **`t=` is a content-addressed cache buster** derived from `PortalWebResourcesUtil.getPathLastModified`. Safe to cache these forever at the edge.
- **`browserId` fragments the cache key** into `chrome`/`firefox`/`safari`/`ie`/`other` buckets. On Cloudflare's default cache key (full URL incl. query string) this multiplies your combo-request cache entries. Do **not** blindly strip it with a custom cache key — content genuinely differs for some browsers. Accept the fragmentation; it's small.
- **`languageId` fragments per locale.** Expected and correct.

Modern DXP also emits **hashed filenames** rather than `?t=` for many assets — observed live: `/o/frontend-js-web/Liferay.(HCCC2MUV).js`, `/o/classic-theme/css/clay.(vy9UzUgKpBw).css`. `ThemeDisplay` builds these via `HashedFilesRegistryUtil.getHashedFileURI(...)` and prefixes them with `PortalUtil.getCDNHost(getRequest())`. These carry `Cache-Control: public, max-age=31536000, immutable` (verified live).

### 1.5 Cache headers Liferay actually emits

From `com.liferay.portal.kernel.servlet.HttpHeaders` ([source](https://raw.githubusercontent.com/liferay/liferay-portal/master/portal-kernel/src/com/liferay/portal/kernel/servlet/HttpHeaders.java)):

```java
public static final String CACHE_CONTROL_DEFAULT_VALUE  = "max-age=315360000, public";
public static final String CACHE_CONTROL_NO_CACHE_VALUE = "private, no-cache, no-store, must-revalidate";
public static final String CACHE_CONTROL_PRIVATE_VALUE  = "private";
public static final String CACHE_CONTROL_PUBLIC_VALUE   = "public";
public static final String EXPIRES_DEFAULT_VALUE        = "315360000";
```

And the master switch, from `portal.properties`:

```properties
##
## Browser Cache
##
    # Set this to true if you want the portal to force the browser cache to be
    # disabled. It will only disable the cache for the rendered HTML response.
    # It will not have an impact on static content or other resources.
    browser.cache.disabled=true

    # Set this true if you want to disable the cache for authenticated users.
    # ... useful to ensure that authenticated users cannot go to the sign in
    # page by clicking on the back button in their browsers.
    browser.cache.signed.in.disabled=true
```

> 🔑 **This is the crux of the whole talk.** Out of the box, `browser.cache.disabled=true` means every rendered page carries `private, no-cache, no-store, must-revalidate`. Cloudflare will return `CF-Cache-Status: BYPASS` for `no-store`/`private` **in either Origin Cache Control mode** ([Cache responses](https://developers.cloudflare.com/cache/concepts/cache-responses/)). No amount of Cache Rules "Respect origin" will save you. You must either flip `browser.cache.disabled=false` (and then take responsibility for per-request `Cache-Control`), or override the Edge TTL at Cloudflare — which has its own consequences (§6).

Note also the KB caveat: `browser.cache.disabled` affects **only** HTML from `MainServlet`. CSS/JS/image servlets (e.g. `JSResolveModulesServlet`) set their own, partly hard-coded headers. ([Cache Control header for other content type](https://learn.liferay.com/kb-article/cache-control-header-for-other-content-type))

### 1.6 NEW: Frontend Resource Caching (DXP 2025.Q4+ / 2026.Q1+)

Control Panel → Configuration → Instance Settings → **Platform → Infrastructure → Frontend Caching**. Lets you choose a caching *strategy* (hashed resources enabling **infinite caching** vs. standard), and set explicit TTLs (seconds) for: CSS style sheets, JavaScript files, labels modules (`all.js`), tokenized CSS, and translated JavaScript. Optional no-cache directives force revalidation.

Docs note: *"infinite caching can reduce requests to the web server and increase performance. However, in some environments, changes to import maps significantly increase page size."* Infinite caching and the JavaScript file config require **DXP 2026.Q1+**. ([Configuring Frontend Resource Caching](https://learn.liferay.com/w/dxp/security-and-administration/administration/configuring-liferay/virtual-instances/configuring-frontend-resource-caching))

Files that can *never* be infinitely cached (always bounded TTL): custom theme/portlet CSS, dynamically tokenized CSS, translated JS, custom JS in client extensions.

### 1.7 Limitations table

| Question | Answer |
|---|---|
| Does `cdn.host.*` cover **portlet resource URLs** (`ResourceURL`, `/o/.../serveResource`)? | **No.** These are built by `PortletURL`/`LiferayPortletResponse` against the portal URL. Not in the `AbsolutePortalURLBuilder` CDN list |
| Does it cover **Document Library** files (`/documents/...`)? | **No.** `DLURLHelper` contains zero CDN references |
| Does it cover **Adaptive Media** (`/o/adaptive-media/image/...`)? | **No.** Same — origin host only |
| Does it cover **page HTML**? | **No.** Never. `cdn.host` is a URL prefix for assets only |
| Does it cover **Headless REST / GraphQL**? | **No** |
| CORS considerations | Serving fonts/JS from a different CDN hostname requires `Access-Control-Allow-Origin` on the CDN. Cloudflare's default cache key includes the `Origin` request header for exactly this reason ([Cache keys](https://developers.cloudflare.com/cache/how-to/cache-keys/)) |
| Official warning | *"Don't put anything on the CDN which requires permission checking or complex policy access"* ([Using a CDN](https://learn.liferay.com/w/dxp/self-hosted-installation-and-upgrades/setting-up-liferay/using-a-cdn)) |

**Impact vs effort:** Setting `cdn.host.*` = **low effort, moderate impact**. It offloads the heaviest byte volume (JS/CSS bundles, theme images, spritemaps) and gets you a second hostname for parallelism. But because it does *not* touch HTML, DL, or AM, it is nowhere near sufficient on its own. Realistically: do it in 20 minutes, then spend the rest of your effort on §2 and §4.

---

## 2. Document Library & Adaptive Media on CDN

### 2.1 The historical default: `Cache-Control: private`

*"The CDN cannot cache the documents uploaded to Documents and Media because we make Cache-Control header as private for all Documents and Media files."* — implemented under **LPS-27419**, with feature request **LPS-97027** ("make HTTP Cache-Control dynamic for D&M items") tracking the improvement. ([My CDN cannot cache documents uploaded to Documents and Media](https://learn.liferay.com/kb-article/my-cdn-cannot-cache-documents-uploaded-to-documents-and-media))

The reason is architectural, not incidental: `ServletResponseUtil.setHeaders(...)` defaults to `private` for any file streamed through it —

```java
if (!httpServletResponse.containsHeader(HttpHeaders.CACHE_CONTROL)) {
    httpServletResponse.setHeader(
        HttpHeaders.CACHE_CONTROL,
        HttpHeaders.CACHE_CONTROL_PRIVATE_VALUE);
}
```
([ServletResponseUtil source](https://raw.githubusercontent.com/liferay/liferay-portal/master/portal-kernel/src/com/liferay/portal/kernel/servlet/ServletResponseUtil.java))

**Why `private` is the right default:** DL enforces per-user `VIEW` permission at request time. A shared cache keyed only on URL cannot model that. Cache a permission-checked response once and you've published it to the internet.

### 2.2 The modern fix: Cache Control for Documents and Media

**Global Menu → Control Panel → System/Instance Settings → Documents and Media → Cache Control.**

| Setting | Meaning |
|---|---|
| **Cache Control Policy** | `Private` (browser caching only) or `Public` (proxy/CDN caching allowed) |
| **Max Age** | Seconds a response is considered fresh; `0` = no expiration specified |
| **MIME Type Exclusions** | List of types to exclude from caching, e.g. `application/pdf`, `image/jpeg`, `video/mp4` |

**The critical constraint, verbatim:** *"Caching configurations only apply to documents that are visible to the Guest role."* And: *"By default, Documents and Media files are not cached by browsers or servers. This is because file visibility generally depends on dynamic properties and configurations (e.g., permissions)."*

**Availability:** Liferay 7.3 U23+, 7.4 U21+, GA21+ (so all 2025.Qx quarterly releases have it). ([Configuring Caching for Documents and Media](https://learn.liferay.com/w/dxp/digital-asset-management/devops/configuring-cache-control-for-documents-and-media))

**Live proof it works** — headers observed on `www.liferay.com` (a real Liferay DXP running on Liferay Cloud behind Fastly):

```
$ curl -I 'https://www.liferay.com/documents/10182/0/open_graph_image+(1).png/...?version=1.0&t=1646949040894&imagePreview=1'
content-type: image/png
cache-control: public, max-age=86400
age: 25409
x-cache: HIT IAD
```

So a guest-visible DL asset is being served `public, max-age=86400` and is a CDN HIT. That's the feature in production.

### 2.3 Adaptive Media

URL shape (per [How to view and construct an adaptive media URL](https://learn.liferay.com/kb-article/how-to-view-and-construct-an-adaptive-media-url-for-a-document), DXP 7.2+):

```
/o/adaptive-media/image/{fileEntryId}/{ConfigurationName}/{filename}?t={timestamp}
e.g. http://localhost:8080/o/adaptive-media/image/35150/Thumbnail-300x300/url.png?t=1681903801009
```

Properties for CDN work:
- The path is **fully versioned** — `fileEntryId` + configuration name + `t=` version timestamp. Changing the source image changes `t`. **Immutable-safe.**
- No CDN-host prefix is applied (no CDN references in the AM URL builders).
- It inherits the same permission-check-vs-cache tension as DL.

**Recommended pattern:** Because AM URLs are versioned and typically decorate public content, they are the best DL-family candidate for aggressive edge caching. Scope a Cloudflare Cache Rule to the AM path prefix and *only* for guest-visible content:

```
(starts_with(http.request.uri.path, "/o/adaptive-media/image/")
 and not any(http.request.cookies["COMPANY_ID"][*] != ""))
```
→ Eligible for cache, Edge TTL = override 30 days, Browser TTL = respect origin.

### 2.4 Signed URLs vs public access

Liferay does **not** ship CDN-style signed/expiring URLs for DL out of the box today. Your options:

| Option | Trade-off |
|---|---|
| Public folder + `Cache-Control: public` (built-in setting) | Simple, fast, correct **only** for genuinely public assets. If someone later restricts the folder, cached copies remain until TTL/purge |
| Two hostnames: `cdn.example.com` (public DL only) + `www.example.com` (everything else) | Clean blast-radius separation. Costs a hostname and some content-authoring discipline |
| Cloudflare **Signed Exchanges / token auth** or a Worker that validates a HMAC before `fetch()` | Real signed URLs; the Worker runs *before* cache, so you keep a high hit ratio while enforcing access. Moderate effort, ~$5/mo + $0.30/M requests |
| Never cache DL at the edge | Safest. Costs you the single biggest byte-volume win available |

**Liferay's own roadmap** already names this: the announced Integrated CDN lists *"Edge-ready media policies. Designate public folders as cache-safe"* and *"Signed links for private files."* ([liferay.com/capabilities/content-delivery-network](https://www.liferay.com/capabilities/content-delivery-network))

**Impact vs effort:** Enabling DL Cache Control for guest content = **very low effort, high impact**. It's a UI toggle and it moves your heaviest bytes to the edge. Do this first, before touching HTML caching.

---

## 3. Liferay Cloud (PaaS) and Liferay SaaS

### 3.1 It is Google Cloud, not Cloudflare

The Liferay Cloud infrastructure reference names **Google Cloud Platform** (GKE Ingress, GCS object storage), with traffic routed through *"Google Cloud's global network of Points of Presence (PoPs)"* for DDoS mitigation as part of Premium Security. Nginx is the webserver gateway. ([Liferay Cloud Infrastructure](https://learn.liferay.com/liferay-cloud/latest/en/reference/liferay-cloud-infrastructure.html))

Corroborating evidence:
- The SaaS CDN cache-mode value is `USE_ORIGIN_HEADERS` — a **Google Cloud CDN** cache-mode enum, not a Cloudflare concept.
- A Liferay KB article is literally titled *"How to increase Google cloud CDN caching time."*
- `curl -I https://www.liferay.com/` returns `via: 1.1 google, 1.1 varnish, 1.1 varnish` — GCLB plus Fastly.

> 📌 **Correct a common misconception on stage:** Liferay PaaS/SaaS CDN ≠ Cloudflare. If someone tells you "Liferay Cloud is Cloudflare-backed," they're wrong.

### 3.2 The `cdn` knob in `LCP.json`

CDN is **enabled by default in every environment except `dev`**. Toggle it in the webserver service's `LCP.json`:

```json
"loadBalancer": {
    "cdn": true
}
```
([Load Balancer](https://learn.liferay.com/w/liferay-cloud/configuring-the-cloud-network/load-balancer))

Disabling it (`false`) is the documented workaround for **CORS conflicts** with frontend client extensions. ([Configuring Caching Behavior — client extensions](https://learn.liferay.com/course/mastering-liferay-frontend-client-extensions/mfcx-customizing-liferay-s-look-and-feel/mfcx-configuring-caching-behavior))

Custom SSL certs go in the `certs` array of the same `LCP.json`, Base64-encoded, RSA-2048 or ECDSA P-256, no passphrase.

### 3.3 Cache purge from the console

Liferay Cloud console → **Network** section → clear CDN cache.

- Takes **up to 30 minutes** to complete.
- Documented warning: *"clearing the CDN cache too frequently can negatively impact server performance"* because of the resulting request spike.

> 🚨 **Talk point:** 30 minutes and no tag/prefix granularity. This is the operational gap that pushes serious Liferay Cloud customers to put their own Cloudflare/Fastly zone in front — where purge-by-tag is instant. Liferay's own flagship site does exactly that: `x-served-by: cache-den-...`, `x-fastly-bucket: MAIN`.

### 3.4 SaaS-specific: the cache mode is frozen

*"Cache mode is set to `USE_ORIGIN_HEADERS` and can not be changed."* ([Liferay SaaS CDNs Cache Mode](https://learn.liferay.com/kb-article/liferay-saas-cdns-cache-mode))

Per Google's docs, `USE_ORIGIN_HEADERS` *"requires origins to set valid caching headers to cache content. Responses without these headers aren't cached at Google's edge and require a full trip to the origin on every request."* ([GCP: Change cache modes](https://docs.cloud.google.com/cdn/docs/using-cache-modes))

**Implication:** On Liferay SaaS, *your origin headers are the entire caching contract.* Nothing at the CDN layer will rescue a `private, no-cache, no-store` HTML response. All your leverage is in §1.5, §1.6 and §2.2.

And you cannot lengthen the TTL: *"There is currently no OOTB feature available that modifies the duration of the CDN Cache-Control configuration"* — default `CLIENT_TTL`/`DEFAULT_TTL` of **1 hour**. ([How to increase Google cloud CDN caching time](https://learn.liferay.com/kb-article/how-to-increase-google-cloud-cdn-caching-time))

Client extension defaults: `Cache-Control: public, max-age=3600`, adjustable via the generated `Dockerfile` in `/builder/liferay-client-extension-build`, and cache-bustable via `t=${modifiedTime}` in `client-extension.yaml` URL fields.

### 3.5 WAF on Liferay Cloud

It's **ModSecurity**, not a managed vendor WAF. Enable via `LCP_WEBSERVER_MODSECURITY` in `webserver/LCP.json`; override rules with `webserver/configs/[ENV]/modsec/modsecurity.conf`. Modes: `On` / `Off` / `DetectionOnly`.

Docs are blunt: *"tuning your rule set (including exclusions and anomaly thresholds) is required to prevent major disruptions to your application."* Deploy in `DetectionOnly` first. ([Web Application Firewall](https://learn.liferay.com/w/dxp/cloud/tuning-security-settings/web-application-firewall))

There's also a documented path for an **external WAF (Akamai) in front of PaaS** ([KB](https://learn.liferay.com/kb-article/configuring-an-external-web-application-firewall-akamai-in-paas)) — proof that "bring your own edge" is a supported topology.

### 3.6 What's coming: Liferay Integrated CDN

Marked **Coming Soon** on [liferay.com/capabilities/content-delivery-network](https://www.liferay.com/capabilities/content-delivery-network). Advertised capabilities, verbatim highlights:

- *"Auto-purge on publish. New or updated content is refreshed worldwide within seconds – no tickets, no scripts."*
- *"Precise cache tags. Only modified assets are invalidated."*
- *"Origin shielding. The CDN fetches a requested file once, then shares it across all users."*
- *"Stale-while-revalidate. Users get an immediate cached response while new content refreshes quietly in the background."*
- *"Automatic cache-busting … hashed URLs"* and *"Immutable assets (long-lived caching for speed)."*
- *"Edge-ready media policies. Designate public folders as cache-safe"* / *"Signed links for private files."*
- *"WAF presets … one-click protection for login pages and APIs"*, bot mitigation, per-route rate limits.
- *"In-product visibility. View cache stats, TTLs, and purge logs directly in Liferay"* + *"Analytics deep links. Jump straight into provider dashboards"* (strongly implying a third-party CDN under the hood).
- *"Authoring warnings. Prevent performance issues with real-time alerts for cache-unfriendly components."*

**Impact vs effort:** For a DevCon talk, this is your closing slide — every technique you demo manually is something Liferay intends to productise. Frame the talk as "here's how to do it today, and here's the shape of what's coming."

---

## 4. Cloudflare specifics

### 4.1 Cache Rules — the modern replacement for Page Rules

Cache Rules live in the `http_request_cache_settings` phase of the Ruleset Engine. Available on **all plans**: Free 10 rules, Pro 25, Business 50, Enterprise 300. Page Rules still exist (Free 3 / Pro 20 / Business 50 / Enterprise 125) but Cache Rules are where all new capability lands. ([Cache Rules](https://developers.cloudflare.com/cache/how-to/cache-rules/), [Page Rules](https://developers.cloudflare.com/rules/page-rules/))

**Migration behaviour change you will trip over:** *"When you create a new Cache Rule and select Eligible for cache, the Cache Everything feature is enabled by default. With Page Rules, you had to specifically enable the Cache Everything option."* To reproduce Page Rules semantics you must first create, **in this order**:

1. Rule `bypass everything` — All incoming requests → **Bypass cache**
2. Rule `cache all default cacheable extensions`:

```txt
(http.request.uri.path.extension in {"7z" "avi" "avif" "apk" "bin" "bmp" "bz2" "class" "css" "csv" "doc" "docx" "dmg" "ejs" "eot" "eps" "exe" "flac" "gif" "gz" "ico" "iso" "jar" "jpg" "jpeg" "js" "mid" "midi" "mkv" "mp3" "mp4" "ogg" "otf" "pdf" "pict" "pls" "png" "ppt" "pptx" "ps" "rar" "svg" "svgz" "swf" "tar" "tif" "tiff" "ttf" "webm" "webp" "woff" "woff2" "xls" "xlsx" "zip" "zst"})
```
→ **Eligible for cache**
([Migration from Page Rules](https://developers.cloudflare.com/cache/how-to/cache-rules/page-rules-migration/))

**Available match fields** (Cache Rules expression builder): `http.request.full_uri`, `http.request.uri`, `http.request.uri.path`, `http.request.uri.query`, `http.cookie`, `http.host`, `http.referer`, `ssl`, `http.user_agent`, `http.x_forwarded_for`, `http.request.headers`, `http.request.cookies`, `http.request.uri.path.extension`. The expression *editor* unlocks the full field reference. ([Available settings](https://developers.cloudflare.com/cache/how-to/cache-rules/settings/))

**API skeleton** — action `set_cache_settings`, deployed to the `http_request_cache_settings` phase entry-point ruleset:

```bash
curl "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/rulesets/$RULESET_ID" \
  --request PUT \
  --header "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  --json '{
    "rules": [
      {
        "expression": "(http.host eq \"example.com\")",
        "description": "cache everything for example.com",
        "action": "set_cache_settings",
        "action_parameters": { "cache": true }
      }
    ]
  }'
```
([Create a rule via API](https://developers.cloudflare.com/cache/how-to/cache-rules/create-api/))

### 4.2 Default cache behaviour — the Liferay-relevant bits

*"Cloudflare only caches based on file extension and not by MIME type. The Cloudflare CDN does not cache HTML or JSON by default."*

Cloudflare **does not** cache when ([Default Cache Behavior](https://developers.cloudflare.com/cache/concepts/default-cache-behavior/)):
- `Cache-Control` is `private`, `no-store`, `no-cache`, or `max-age=0`
- **a `Set-Cookie` header exists**
- the method is anything other than `GET`

Default Edge TTLs when no `Cache-Control`/`Expires`: `200/206/301` → 120m; `302/303` → 20m; `404/410` → 3m. All other statuses uncached.

Limits: cacheable file size 512 MB (Free/Pro/Business), 5 GB default (Enterprise). Max upload 100 MB (Free/Pro), 200 MB (Business), 500 MB+ (Enterprise).

**Request collapsing** is on by default: *"Only the first request is forwarded to the origin to fetch the asset. The remaining requests wait for the first request to complete."* This is free thundering-herd protection per data centre — very valuable for a heavy Liferay page render.

### 4.3 Cache Level / Cache Everything

Three caching levels ([Caching levels](https://developers.cloudflare.com/cache/how-to/set-caching-levels/)):

| Dashboard | API | Behaviour |
|---|---|---|
| No Query String | `Basic` | Serve from cache only when there is no query string |
| Ignore Query String | `Simplified` | Same resource regardless of query string (static extensions only) |
| Standard (default) | `Aggressive` | Different resource per query string |

**Cache Everything** (= "Eligible for cache" in Cache Rules) carries this warning verbatim:

> *"This option caches all HTML regardless of the presence of dynamic content. If you use this approach to cache pages containing dynamic content, visitors may receive information not intended for them."*

Suggested mitigations from the same page: check for the presence of a cookie; negative-match known dynamic paths; negative-match dynamic extensions (or lack of extension). ([Cache Level (Cache Everything)](https://developers.cloudflare.com/cache/how-to/cache-rules/examples/cache-everything/))

### 4.4 Edge TTL vs Browser TTL vs Origin Cache Control

**Edge TTL** — three modes ([settings](https://developers.cloudflare.com/cache/how-to/cache-rules/settings/#edge-ttl)):

| API value | Meaning |
|---|---|
| `respect_origin` | Use `Cache-Control` if present, else Cloudflare defaults |
| `override_origin` | **Ignore `Cache-Control`** and use this TTL |
| `bypass_by_default` | Use `Cache-Control` if present, else bypass entirely |

Plus per-status-code TTLs:

```json
"action_parameters": {
    "cache": true,
    "edge_ttl": {
        "status_code_ttl": [
            { "status_code_range": { "to": 299 },            "value": 86400 },
            { "status_code_range": { "from": 300, "to": 499 }, "value": 0  },  // no-cache
            { "status_code_range": { "from": 500 },           "value": -1 }   // no-store
        ],
        "mode": "respect_origin"
    }
}
```

**Browser TTL:**

```json
"action_parameters": {
  "cache": true,
  "browser_ttl": { "mode": "override_origin", "default": 1000 }
}
```

*"Cloudflare respects whichever value is higher: the Browser Cache TTL in Cloudflare or the `max-age` header."* You can split edge vs browser TTL via `s-maxage` and `max-age` — **but see the `s-maxage` trap in §4.7.**

**Origin Cache Control (OCC).** Enabled by default and non-disableable on Free/Pro/Business; Enterprise-only toggle. Key behavioural differences ([Cache-Control directives](https://developers.cloudflare.com/cache/concepts/cache-control/)):

| Directive | OCC **disabled** | OCC **enabled** |
|---|---|---|
| `s-maxage=0` | Will not cache | Caches and always revalidates |
| `max-age=0` | Will not cache | Caches and always revalidates |
| `no-cache` | Will not cache | Caches and always revalidates. Does not serve stale |
| `must-revalidate` | Directive ignored, stale is served | Does not serve stale |
| `proxy-revalidate` | Directive ignored, stale is served | Does not serve stale for CDN, but does for browser |
| `no-transform` | May (un)Gzip, Polish, etc. | Does not transform body |
| `immutable` | Not proxied downstream | Proxied downstream |
| `no-store` | Will not cache | Will not cache |
| **`Authorization` header present** | Content may be cached | Cached **only** if `must-revalidate`, `public`, or `s-maxage` also present |
| **Origin sends `Set-Cookie`, default cache level** | `Set-Cookie` stripped, asset cached | **Not cached, `Set-Cookie` preserved, `BYPASS`** |

> ⚠️ **Enterprise-only footgun for Liferay:** On Enterprise, OCC is *off* by default. That means `Set-Cookie: JSESSIONID` gets **stripped and the page cached** at default cache level. That is silently one of the most dangerous defaults for a portal. Know which side of this line your zone is on.

Also note: *"When the `Cloudflare-Cdn-Cache-Control` header is set, OCC is turned on (regardless of whether OCC is enabled or disabled)."* — a per-response way to force RFC-strict behaviour.

And: *"`max-age`, `s-maxage`, and `stale-while-revalidate` require integer values per RFC 9111. Floating-point values (for example, `max-age=2.5`) are not valid and will be ignored, potentially causing cache bypass."*

### 4.5 The `Set-Cookie` problem — Liferay's #1 edge-caching blocker

Cloudflare's three behaviours ([Head Requests and Set-Cookie Headers](https://developers.cloudflare.com/cache/concepts/cache-behavior/)):

1. `Set-Cookie` + **default cache level**: OCC off → strip cookie, cache. OCC on → **do not cache**, preserve cookie, `BYPASS`.
2. `Set-Cookie` + **Cache Everything / Eligible for cache**: preserve `Set-Cookie`, **do not cache**. `MISS` every single time.
3. `Set-Cookie` + Cache Everything + **explicit Edge TTL** ("Ignore cache-control header and use this TTL" or "Status code TTL"): **`Set-Cookie` is removed and the asset is cached.**

**Why this matters enormously for Liferay.** Verified live against `www.liferay.com` on a cache MISS:

```
$ curl -I https://www.liferay.com/products/dxp
set-cookie: JSESSIONID=DA99194763EEF5AD3BD8B88BB7EF9655; Path=/; Secure; HttpOnly
set-cookie: SERVER_ID=52578f3d66e2be24; path=/; HttpOnly; Secure
cache-control: max-age=3600, public, max-age=3600, stale-while-revalidate=60
```

Liferay/Tomcat mints a `JSESSIONID` for **anonymous** visitors on essentially every uncached page render. So:

- Naïve "Eligible for cache" on Liferay HTML → **permanent `MISS`, zero hit ratio, and you've added a hop for nothing.** This is the single most common failed Liferay-behind-Cloudflare attempt.
- The only thing that makes it cache is behaviour 3 — an **override** Edge TTL, which strips `Set-Cookie`. That is safe *only* if the cookie carried no user identity, i.e. only for genuine guest traffic. Which is exactly why §6 is non-negotiable.

**Three ways to fix it properly, best first:**

1. **Stop Liferay creating sessions for guests.** Don't touch a session on anonymous page renders (avoid `request.getSession()` in guest-rendered code paths; audit custom filters, hooks and client extensions). This is the architecturally right answer and pays off at every layer, not just the CDN.
2. **Strip `Set-Cookie` at the origin edge** for guest-safe paths (nginx `proxy_hide_header Set-Cookie;`, or an Apache `Header unset Set-Cookie`) scoped precisely to routes that carry no auth cookie.
3. **Let Cloudflare strip it** via override Edge TTL — least safe, because the strip is unconditional once the rule matches.

For the record on `Vary`: *"By default, Cloudflare does not consider vary values in caching decisions."* So `Vary: Accept-Language` will **not** protect you from serving the wrong locale. Handle locale in the cache key (`user.lang`) or the path.

### 4.6 Cache Key customisation

**Default cache key** ([Cache keys](https://developers.cloudflare.com/cache/how-to/cache-keys/)):

1. Full URL: scheme, host, URI **with query string**
2. `Origin` header sent by client (CORS)
3. `x-http-method-override`, `x-http-method`, `x-method-override`
4. `x-forwarded-host`, `x-host`, `x-forwarded-scheme` (unless http/https), `x-original-url`, `x-rewrite-url`, `forwarded`

Note what is **absent**: cookies. **The default cache key does not include `JSESSIONID`.** This is worth stating precisely on stage, because the folk wisdom "Liferay's JSESSIONID destroys your cache key" is *not* how Cloudflare behaves — the problem is the *response* `Set-Cookie` (§4.5), not the *request* cookie in the key. Getting this right will differentiate your talk.

Where cookies *do* enter the picture: you deliberately add them, either to **bypass** (§6) or to **fragment** the key.

**Custom cache key components** (all Enterprise except the three noted):

| Component | Options |
|---|---|
| **Query String** | `include: ["*"]` (default), `exclude: ["*"]` (ignore all), or explicit include/exclude lists. Max **100** params |
| **Headers** | Include with value, or `check_presence` (presence only, value excluded). Restricted headers requiring 1–10 explicit values: `accept`, `accept-charset`, `accept-encoding`, `accept-datetime`, `accept-language`, `referer`, `user-agent`. `Origin` is always included unless explicitly excluded. **Cannot** include: `connection`, `content-length`, `cache-control`, `if-match`, `if-modified-since`, `if-none-match`, `if-unmodified-since`, `range`, `upgrade`, `cookie`, `host`, or any `cf-*` |
| **Cookie** | Include value, or check presence. **Cannot** include `__cf*` cookies |
| **Host** | `Use original host` (`resolved: false`) vs `Resolved host` (`resolved: true`) |
| **User features** | `device_type` (mobile/desktop/tablet), `geo` (country), `lang` (first `Accept-Language` code) |
| Free on all plans | Cache deception armor, Cache by device type, Ignore query string, Sort query string |

```json
"action_parameters": {
  "cache": true,
  "cache_key": {
    "ignore_query_strings_order": true,
    "cache_deception_armor": true,
    "custom_key": {
      "query_string": { "include": ["*"] },
      "header": {
        "include": ["header1"],
        "check_presence": ["header_1"],
        "contains": { "accept-encoding": ["br", "zstd"] }
      },
      "cookie": { "include": ["cookieName1"], "check_presence": ["cookie_1"] },
      "user": { "device_type": true, "geo": true, "lang": true },
      "host": { "resolved": false }
    }
  }
}
```

**Two `$scheme` gotchas worth knowing:**
- With the **default** key, `$scheme` = *origin* scheme. Switching SSL mode Flexible→Full **busts your entire cache**.
- With a **custom** key, `$scheme` = *visitor* scheme, so SSL-mode changes are cache-neutral.

**Costs of a custom key:**
- *"they may reduce your cache hit rate and result in cache sharding"*
- **Dashboard single-file purge stops working** if the key includes headers/cookies. You must purge via API with the exact header/cookie values, or fall back to prefix/tag/hostname purge.
- **Prefetch is incompatible** with custom cache keys (Prefetch always uses the default key → key mismatch).
- No explicit key length limit, but total request size must stay under Cloudflare's request limits, and large cookie values add per-request latency.

**Liferay-specific cache key recipe.** For guest HTML on a multi-language Liferay site:

```json
"cache_key": {
  "ignore_query_strings_order": true,
  "cache_deception_armor": true,
  "custom_key": {
    "query_string": { "exclude": ["p_auth", "p_p_auth", "_gl", "gclid", "fbclid", "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"] },
    "cookie":  { "include": ["GUEST_LANGUAGE_ID"] },
    "header":  { "check_presence": [] },
    "host":    { "resolved": false }
  }
}
```

Rationale, item by item:
- **Excluding `p_auth`/`p_p_auth`** collapses the key across CSRF-token variants (see §4.11 — but read the warning there; this only makes sense on *guest* traffic where you also strip the tokens from cached HTML).
- **Excluding UTM/click IDs** is the highest-ROI single change on most marketing-heavy Liferay sites. Every campaign link otherwise creates a distinct cache entry for identical HTML.
- **Including `GUEST_LANGUAGE_ID`** correctly fragments per anonymous locale, which `Vary` will *not* do for you.

**Impact vs effort:** Query-string exclusion of tracking params = **trivial effort, very high impact** on marketing sites. Cookie/header keys = **Enterprise-only, moderate effort, and they cost you dashboard purge** — use sparingly.

### 4.7 stale-while-revalidate, stale-if-error, Always Online

Cloudflare honours both RFC directives from origin ([Revalidation](https://developers.cloudflare.com/cache/concepts/revalidation/), [Cache-Control](https://developers.cloudflare.com/cache/concepts/cache-control/)).

**`stale-while-revalidate=<seconds>`** — *"Revalidation is fully asynchronous. When a cached asset expires and `stale-while-revalidate` is set, the first request that arrives after expiry triggers revalidation in the background. That request immediately receives stale content with an `UPDATING` status instead of blocking."* All requests during revalidation get stale + `UPDATING`; afterwards `HIT`.

**`stale-if-error=<seconds>`** — triggers on origin `5xx` (`500/502/503/504`) only. A `404` is *not* an error for this purpose; it replaces the stale content. No way to customise which codes trigger it.

> 🪤 **The `s-maxage` trap — arguably the best single "gotcha" slide in the deck.**
> Per RFC 9111 §5.2.2.10, `s-maxage` implies `proxy-revalidate`, so **a shared cache must not serve stale content**. With Origin Cache Control enabled, all of these silently kill `stale-while-revalidate`:
> - `must-revalidate`
> - `proxy-revalidate`
> - **`s-maxage`**
> - `no-cache`
>
> You get `EXPIRED` instead of `UPDATING`. And Liferay's own no-cache constant is `private, no-cache, no-store, must-revalidate` — three of the four.
>
> **Cloudflare's documented workaround:** *"If you need `stale-while-revalidate` behavior with a different TTL for Cloudflare than for browsers, do not use `s-maxage`. Instead, configure your origin to send `max-age` with `stale-while-revalidate`, then use Edge Cache TTL in Cache Rules to set a separate TTL for Cloudflare."*

So the correct Liferay guest-HTML origin header is:

```http
Cache-Control: public, max-age=60, stale-while-revalidate=600, stale-if-error=86400
```

…combined with a Cache Rule Edge TTL override if you want the edge to hold it longer than 60s. **Not** `s-maxage=3600`.

**Cache Rules override:** `serve_stale` → `disable_stale_while_updating` (boolean):

```json
"action_parameters": {
  "cache": true,
  "serve_stale": { "disable_stale_while_updating": true }
}
```

**Always Online** — now Internet-Archive-backed. It only fires when Cloudflare **cannot reach** the origin (5xx in the 520–527 range), *not* when the origin is up and returning 500s. Crawl interval: 30 days (Free) / 15 (Pro) / 5 (Business, Enterprise). Available on all plans.

> ⚠️ *"If Always Online is enabled, then the `stale-while-revalidate` and `stale-if-error` directives are ignored."*
> **For a Liferay portal, turn Always Online OFF.** You want `stale-if-error` (which serves *your* real, recently-cached HTML) rather than a Wayback Machine snapshot with a Cloudflare banner on it. Dynamic parts (login, forms, carts) break anyway.

**Impact vs effort:** `stale-while-revalidate` + `stale-if-error` on guest HTML = **low effort, very high impact.** It converts your origin from "on the critical path of every TTL expiry" to "asynchronously refreshed", and turns an origin outage into a degraded-but-serving site. This is the highest-value single header change in the whole talk.

**Cache status values** you'll be reading in the demo ([Cache responses](https://developers.cloudflare.com/cache/concepts/cache-responses/)): `HIT`, `MISS`, `EXPIRED`, `STALE`, `UPDATING`, `REVALIDATED`, `BYPASS`, `DYNAMIC`, `NONE/UNKNOWN`. Key distinction: **`DYNAMIC`** = not eligible for cache at *request* time; **`BYPASS`** = was eligible, but the *response* said no. If you set a Cache Rule to "Eligible for cache" on HTML and Liferay returns `no-store`, you get `BYPASS`, not `DYNAMIC`. The `Age` header appears only on cache-served responses.

### 4.8 Tiered Cache, Smart Tiered Cache, Regional Tiered Cache, Argo

**Tiered Cache** ([docs](https://developers.cloudflare.com/cache/how-to/tiered-cache/)) splits data centres into lower and upper tiers; only upper tiers may contact the origin. *"This practice improves bandwidth efficiency by limiting the number of data centers that can ask the origin for content, which reduces origin load."* It also *"concentrates connections to origin servers so they come from a small number of data centers"* — fewer open connections, which matters a lot for a Tomcat connector pool.

| Topology | Free | Pro | Business | Enterprise |
|---|---|---|---|---|
| Tiered Cache | Yes | Yes | Yes | Yes |
| Smart Topology | Yes | Yes | Yes | Yes |
| Generic Global | No | No | No | Yes |
| Regional Tiered Cache | No | No | No | Yes |
| Custom Topology | No | No | No | Yes |

- **Smart Tiered Cache** picks the single lowest-latency upper tier per origin automatically. **Public-cloud caveat:** origins on AWS/GCP/Azure/OCI use anycast or regional unicast, which defeats latency probing — set a **cloud region hint**. *This applies directly to Liferay PaaS/SaaS, which is on GCP.*
- **Caveat:** changing origin IPs/DNS while Smart Tiered Cache is on can reassign upper tiers and spike `MISS` rates.
- **Regional Tiered Cache** adds a regional hub check before the (possibly distant) upper tier. Beneficial for Smart/Custom topologies with upper tiers concentrated in 1–2 regions; **not** beneficial with Generic Global.
- Smart Tiered Cache and Regional Tiered Cache are now folded into Cloudflare's **Smart Shield** origin-safeguard bundle.

Enable via API:

```bash
curl "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/argo/tiered_caching" \
  --request PATCH \
  --header "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  --json '{"value": "on"}'
```

**Argo Smart Routing** ([docs](https://developers.cloudflare.com/argo-smart-routing/)) is a separate paid add-on: *"detects real-time network issues and routes your web traffic across the most efficient network path, avoiding congestion… These benefits are most apparent for users farthest from your origin server."*

**Impact vs effort:**
- **Tiered Cache: enable it. One toggle, free, no downside for Liferay.** For a single-origin Liferay cluster with a global audience this is the best effort-to-benefit ratio on the entire Cloudflare dashboard.
- **Argo:** worth it only if your Liferay origin is far from a meaningful share of your users. Measure with the built-in Argo analytics before committing. Uncached Liferay page renders (the expensive ones) are exactly what Argo accelerates, so the ROI is better for portals than for static sites.
- **Regional Tiered Cache:** Enterprise-only, narrow applicability. Skip unless you already have Smart topology + a global footprint.

### 4.9 Cache Reserve and origin shield

**Cache Reserve** ([docs](https://developers.cloudflare.com/cache/advanced-configuration/cache-reserve/)) is a persistent R2-backed store acting as *"the ultimate upper-tier cache."* Retention starts at **30 days**, reset on each request.

**Eligibility criteria** — an asset must:
- be cacheable by standard rules
- have a freshness **TTL of at least 10 hours**
- have a `Content-Length` response header
- (image transformation *variants* are ineligible; originals are)

**Pricing:** $0.015/GB-month storage; Class A (writes) $4.50/M; Class B (reads) $0.36/M. A miss ≈ 1 Class A + 1 Class B; a hit ≈ 1 Class B.

**Notable limits:** origin Range requests unsupported; Vary-for-images incompatible; R2-public-bucket requests bypass it; **Cache Reserve requests uncompressed content from origin** (it does not send `Accept-Encoding: gzip`) — which means extra origin bytes and extra Liferay CPU if your origin compresses.

Per-rule control:

```json
"action_parameters": {
  "cache": true,
  "cache_reserve": { "eligible": true, "minimum_file_size": 100000 }
}
```

> ⚠️ **The 10-hour TTL floor makes Cache Reserve a poor fit for Liferay HTML**, which you'll typically cache for 60s–1h. It's a good fit for Documents & Media, Adaptive Media variants' originals, and versioned/hashed JS/CSS. Scope it with a rule; don't enable it zone-wide on a portal.

**Origin shield generally:** Tiered Cache *is* Cloudflare's origin shield. Cache Reserve extends it with durable storage. Liferay's own Integrated CDN marketing names *"Origin shielding. The CDN fetches a requested file once, then shares it across all users, protecting your origin from 'thundering herd' overload"* — same concept, and Cloudflare's request collapsing (§4.2) already gives you a per-datacentre version for free.

**Impact vs effort:** Cache Reserve = **low effort, moderate impact, real ongoing cost.** Only enable it scoped to large, long-lived DL/AM assets. For most Liferay sites, Tiered Cache alone captures ~80% of the origin-offload benefit at zero cost.

### 4.10 Purge APIs

**Availability is now all-plans** — a notable change from the old "cache tags are Enterprise-only" folklore. Verbatim from the docs: purge options are *"URL, Hostname, Tag, Prefix, and Purge Everything"* on **Free, Pro, Business and Enterprise** alike. ([Purge cache](https://developers.cloudflare.com/cache/how-to/purge-cache/))

**Rate limits (per account, token-bucket):**

| | Free | Pro | Business | Enterprise |
|---|---|---|---|---|
| Requests (tag/host/prefix/everything) | 5/min | 5/s | 10/s | 50/s |
| Bucket size | 25 | 25 | 50 | 500 |
| Max ops/request | 100 | 100 | 100 | 100 |
| Single-file URLs | 800/s | 1500/s | 1500/s | 3000/s |
| Single-file max ops/request | 100 | 100 | 100 | **500** |

**Purge by tag** ([docs](https://developers.cloudflare.com/cache/how-to/purge-cache/purge-by-tags/)):
- Origin emits `Cache-Tag: tag1,tag2,tag3`
- Cloudflare **strips `Cache-Tag` before responding** to visitors *and before passing to a Worker*
- Whitespace and repeated/trailing commas normalised; case-insensitive; **no spaces in tags**; printable ASCII only
- Aggregate header ≤ **16 KB** after the field name (≈1,000 unique tags); a single response may carry multiple `Cache-Tag` headers
- Individual tag ≤ 1,024 chars in a purge API call

```bash
curl https://api.cloudflare.com/client/v4/zones/$ZONE_ID/purge_cache \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -d '{"tags": ["a-cache-tag", "another-cache-tag"]}'
```

Other flex-purge bodies:
```json
{"hosts":    ["www.example.com", "images.example.com"]}
{"prefixes": ["www.example.com/foo", "images.example.com/bar/baz"]}
{"files":    ["https://www.example.com/a.css"]}
{"purge_everything": true}
```
Single-file with headers (needed when a custom cache key includes them):
```json
{"files": [{"url": "https://www.example.com/a.css", "headers": {"Origin": "https://example.com"}}]}
```
([Purge API reference](https://developers.cloudflare.com/api/resources/cache/methods/purge/))

**Purge by prefix limits:** ≤31 path separators; ≤30 prefixes per request; **query strings and fragments cannot be used** — but purging `foo.com/bar` *does* clear `foo.com/bar?good=bad`. With Transform Rules modifying paths, use the **post-transform (origin)** URL for prefix purge and the **pre-transform (end-user)** URL for single-file purge. Easy to get backwards.

**Purge by hostname:** ≤30 hostnames per request. Immune to custom cache keys.

**Single-file purge fails when:** the cache key includes headers/cookies (dashboard can't send them); the Cache Rule matches only `GET` (purge uses a different method internally); the object was cached with `Origin`, `X-Forwarded-Host`, `X-Host`, `X-Forwarded-Scheme`, `X-Original-URL`, `X-Rewrite-URL`, or `Forwarded` headers. Documented fix for the method issue:

```
(http.host eq "example.com" and (http.request.method eq "GET" or http.request.method eq "PURGE"))
```

With Tiered Cache, tag/prefix/hostname purges may show `EXPIRED` rather than `MISS`, as the lower tier revalidates against the upper tier.

**Purge Everything performs only a *soft* purge on Cache Reserve** and does not refresh cache-tag metadata.

#### Wiring Liferay publish events → Cloudflare purge

This is the piece nobody has written up, so it's a strong original contribution for the talk. There is no built-in integration; you build it. Design:

**Step 1 — emit `Cache-Tag` from Liferay.** Add a `ServletFilter` (or a `DynamicInclude`/`ServletResponseWrapper` in the theme pipeline) that, for guest-cacheable page responses, sets tags derived from what actually rendered:

```
Cache-Tag: site-{groupId},layout-{plid},jart-{articleResourcePrimKey},ddms-{structureId}
```

Collect the article/asset IDs during render (a `ThreadLocal` populated by an `AssetEntry`/journal render hook is the pragmatic approach). Keep the header well under 16 KB.

**Step 2 — listen for content change.** Two viable hooks:
- **`ModelListener<JournalArticle>`** (`onAfterUpdate`, `onAfterCreate`, `onAfterRemove`) — fires on every persistence event, including workflow-driven publish. ([Creating a Model Listener](https://learn.liferay.com/w/dxp/development/traditional-java-based-development/extending-liferay/creating-a-model-listener))
- **`MessageListener` on the async destination** or a `WorkflowStatusMessageListener` if you only want to purge on *approved* transitions — usually what you actually want, since editors save drafts constantly.

**Step 3 — debounce and batch.** Purge limits are per-account and the docs warn a purge forces a `MISS` that hits your origin. Buffer tags for ~5–10 seconds in a `ScheduledExecutorService`, deduplicate, and send ≤100 tags per API call. Fire the HTTP call **outside** the transaction (use `TransactionCommitCallbackUtil.registerCallback(...)`) so a rolled-back publish never purges.

**Step 4 — handle publication/staging.** For Liferay staging "Publish to Live", hook the publication lifecycle rather than per-article listeners, and purge `site-{liveGroupId}` wholesale. Simpler and far fewer API calls.

**Step 5 — failure mode.** If the purge call fails, log loudly but never block the publish. Your TTL is the backstop — which is another argument for keeping guest-HTML `max-age` short (60s) and leaning on `stale-while-revalidate` for the performance.

**Impact vs effort:** **Moderate-to-high effort, high impact.** This is what lets you raise Edge TTL from 60 seconds to hours without editors complaining. Without it, you're stuck trading freshness against hit ratio. Budget a sprint; it's the difference between a 40% and a 95% hit ratio on HTML.

### 4.11 Bot Management / WAF interactions that break Liferay

Liferay is unusually prone to WAF false positives because of how it encodes state in URLs and forms.

**The `p_auth` CSRF token.** From `portal.properties`:

```properties
##
## Authentication Token
##
    # Set this to false to disable CSRF protection in the portal. Disabling CSRF
    # protection is not recommended since all features become vulnerable to CSRF
    # attacks.
    auth.token.check.enabled=true

    #auth.token.impl=com.liferay.portal.security.auth.SessionAuthToken

    # Set the length of the authentication token.
    auth.token.length=8

    #auth.token.shared.secret=
```

**Two things follow, and they matter enormously:**

1. The default implementation is `SessionAuthToken` — **the token is bound to the HTTP session**. Any HTML containing `p_auth=XXXXXXXX` is therefore **user-specific and must never be shared from a cache.** If you cache a page containing action URLs with `p_auth`, every subsequent visitor gets someone else's token; their form POSTs will fail with `403 User [id] did not provide a valid CSRF token`. This is the "cached HTML looks fine but nothing works" failure mode.
2. `auth.token.length=8` means only 8 characters of entropy — do not treat leakage as harmless.

**Practical rule:** never let a page that contains `p_auth` in its markup into a shared cache. Concretely, your guest cache rule should exclude anything with `p_auth`/`p_p_auth` in the query string, and your guest-facing pages should not render authenticated action URLs at all (they shouldn't, if permissions are right, but audit it).

**Liferay's own guidance on the related 403s** blames the web tier, not the app: check **sticky sessions** on the load balancer, `virtual.hosts.valid.hosts` alignment, and *"inconsistent domain configuration for the `JSESSIONID` cookie between Apache and Liferay, which disrupts token validation across the cluster."* ([User did not provide a valid CSRF token](https://learn.liferay.com/kb-article/user-did-not-provide-a-valid-csrf-token-error))

**Cloudflare-specific breakage patterns and fixes:**

| Symptom | Cause | Fix |
|---|---|---|
| Portlet form POSTs 403 at the edge | OWASP Core Ruleset anomaly score — Liferay namespaced params (`_com_liferay_..._INSTANCE_xyz_fieldName`), serialised portlet state and `multipart/form-data` uploads trip SQLi/XSS heuristics | Add a **WAF exception** scoped to `/c/portal/` and your upload paths; or lower the OWASP paranoia level. Docs: *"If one specific rule causes false positives, disable that specific rule and not the entire ruleset"* |
| Control Panel / admin unusable | Rich-text editors and structure JSON in POST bodies look like injection | Exception pattern from the docs: `http.host eq "example.com" and starts_with(http.request.uri.path, "/admin")` — adapt to `/group/control_panel`, `/c/portal/`, `/o/api-*` |
| Headless REST/GraphQL clients challenged | Bot Management challenges non-browser user agents | Bypass rules for `/o/headless-*`, `/o/graphql`, `/api/jsonws` matched on API token / mTLS / IP list, **not** on user agent |
| `Set-Cookie` disappears, users can't log in | A too-broad Cache Rule with override Edge TTL is stripping `Set-Cookie` (§4.5) on the login POST response | Ensure the guest cache rule excludes `/c/portal/login`, and never matches non-`GET` |
| Sign-in works then randomly logs out | Bot JS Detections / Rocket Loader injecting into pages, or a cached page pinned to a different node's `SERVER_ID` | Configuration Rule to disable JS Detections and Rocket Loader on authenticated paths |
| Uploads over 100 MB fail | Cloudflare max upload size: 100 MB Free/Pro, 200 MB Business, 500 MB+ Enterprise | Route DL uploads through a DNS-only (grey-clouded) hostname, or chunk |

Diagnose with **Security Events** filtered to your zone and time window; rule `...843b323c` / `949110: Inbound Anomaly Score Exceeded` points at the OWASP Core Ruleset. ([Troubleshoot managed rules](https://developers.cloudflare.com/waf/managed-rules/troubleshooting/))

Also note: a WAF custom rule that **blocks** a request produces `CF-Cache-Status: none/unknown`, because the block happens on the global network before cache. Useful when reading logs.

**Impact vs effort:** WAF tuning is **medium effort, and mandatory** if you enable managed rulesets in front of a Liferay Control Panel. Do it in log/DetectionOnly mode for two weeks before enforcing — the same advice Liferay gives for its own ModSecurity.

### 4.12 Automatic Platform Optimization (APO) — is there a Liferay analogue?

**Short answer: no, and there won't be.**

APO is *"the result of using the power of Cloudflare Workers to intelligently cache dynamic content"* for WordPress, and — critically — *"You must use the Cloudflare for WordPress plugin to begin using APO."* ([APO docs](https://developers.cloudflare.com/automatic-platform-optimization/))

APO is not a generic feature; it's a Worker plus a CMS plugin that (a) knows which cookies mean "logged in" for WordPress, and (b) calls the purge API on post save. There is no Cloudflare-authored Liferay equivalent, and Cloudflare has shown no sign of building one.

**But you can build "APO for Liferay" yourself** — and this is a genuinely good talk narrative, because it's exactly the sum of the parts already covered:

| APO component | Liferay equivalent |
|---|---|
| Cookie-based bypass for logged-in users | Cache Rule on `COMPANY_ID`/`ID` cookies (§6) |
| Cache HTML at the edge with a long TTL | Cache Rule, Eligible for cache, Edge TTL override |
| Purge on content save | `ModelListener` → purge-by-tag (§4.10) |
| Cache by device type | Cache key `user.device_type` — free on all plans |
| Serve stale while revalidating | `stale-while-revalidate` from origin (§4.7) |

One APO sub-feature *is* directly reusable: **Cache by Device Type** is documented under the APO namespace but is available as a plain cache-key option on all plans ([cache-device-type](https://developers.cloudflare.com/automatic-platform-optimization/reference/cache-device-type/)). Useful if your Liferay theme does server-side device branching (some legacy themes still do).

**Impact vs effort:** Building the analogue = **high effort, very high impact.** This is the "advanced" half of your talk. Position it honestly: it's a project, not a checkbox.

### 4.13 Workers, KV and Snippets — edge personalisation

**Snippets** ([docs](https://developers.cloudflare.com/rules/snippets/)): short JavaScript on the Cloudflare network, attached to a filter expression.

| | Free | Pro | Business | Enterprise |
|---|---|---|---|---|
| Availability | No | Yes | Yes | Yes |
| Number of snippets | 0 | 25 | 50 | 300 |
| Subrequests | 0 | 2 | 3 | 5 |

Hard limits, **all plans**: max execution **5 ms**, max memory **2 MB**, max package size **32 KB**.

**Workers pricing** ([docs](https://developers.cloudflare.com/workers/platform/pricing/)):

| | Requests | Duration | CPU time |
|---|---|---|---|
| **Free** | 100,000/day | no charge | 10 ms CPU per invocation |
| **Standard** | 10M/mo included, **+$0.30/M** | no charge or limit | 30M CPU-ms/mo included, **+$0.02/M CPU-ms**; max 5 min CPU/invocation (default 30 s) |

Minimum $5/mo account charge on Workers Paid. Subrequests from a Worker are not billed. Worked example from the docs: 15M requests/mo at 7 ms CPU each = $5.00 subscription + $1.50 requests + $1.50 CPU = **$8/mo**.

> ⚠️ **Billing gotcha:** *"When Workers Caching is enabled, requests served from the Worker's cache are billed at the same per-request rate as requests that invoke the Worker."* You pay per request even on cache hits.

**Workers KV pricing** ([docs](https://developers.cloudflare.com/kv/platform/pricing/)):

| | Free | Paid |
|---|---|---|
| Keys read | 100k/day | 10M/mo, +$0.50/M |
| Keys written | 1k/day | 1M/mo, +$5.00/M |
| Keys deleted | 1k/day | 1M/mo, +$5.00/M |
| List requests | 1k/day | 1M/mo, +$5.00/M |
| Stored data | 1 GB | 1 GB, +$0.50/GB-month |

No egress charges. Reads of non-existent keys still bill.

**HTMLRewriter** ([docs](https://developers.cloudflare.com/workers/runtime-apis/html-rewriter/)) — a streaming, jQuery-like HTML parser:

```js
new HTMLRewriter()
  .on("*", new ElementHandler())
  .onDocument(new DocumentHandler());
```

Handlers respond to `element`, `comments`, `text`; inserted `Content` may be a string, `Response` or `ReadableStream`, with `{ html: Boolean }` controlling escaping.

**Liferay-shaped Worker patterns:**

1. **Hole-punching a cached guest page.** Cache the full guest HTML at the edge; use HTMLRewriter to replace a `<div id="user-bar">` placeholder with per-request content (name, cart count) fetched from a Liferay Headless endpoint or read from a signed cookie. This is the single most valuable Worker pattern for a portal, because it lets you cache the 95% of a Liferay page that's identical for everyone.
2. **`p_auth` injection.** Cache the page *without* CSRF tokens; have a Worker inject a fresh token (fetched from a lightweight Liferay endpoint) into forms on the way out. Removes the §4.11 blocker entirely. Non-trivial but powerful.
3. **A/B testing.** Assign a bucket cookie in the Worker, add `bucket` to the cache key via a Cache Rule, `fetch()` the variant. Two cache entries instead of an uncacheable page.
4. **Cache-key normalisation before cache.** Workers run *before* cache, so you can strip tracking params, normalise trailing slashes and lowercase paths — things Liferay friendly-URLs are picky about.
5. **Signed DL URLs.** Validate an HMAC in the Worker, then `fetch()` the DL asset. Keeps permission enforcement at the edge without defeating the cache.

**Important Worker/cache interactions:**
- *"Workers sits in front of cache"* — a Worker's own response is logged `none/unknown`; the `fetch()` subrequest carries the cache status.
- **The Cache API is not compatible with Tiered Cache.** Use `fetch()` if you want tiering.
- Purging Worker-cached assets: purge the URL in the `fetch()` request, *not* the end-user URL.
- Cloudflare **strips `Cache-Tag` before the response reaches a Worker** — so a Worker cannot read tags.

**Impact vs effort:** Snippets = **low effort, low ceiling** (5 ms / 2 MB / 32 KB is genuinely restrictive — header manipulation and simple redirects only). Workers = **high effort, high ceiling.** For a typical Liferay site at, say, 30M req/mo, the Workers bill is roughly $15–25/mo — trivially cheap next to the Liferay licence. **The cost of Workers is engineering time, not money.** Say that explicitly.

### 4.14 Compression, HTTP/2, HTTP/3, Early Hints

**Compression** ([docs](https://developers.cloudflare.com/speed/optimization/content/compression/)).

Visitor-facing defaults, by plan — and this ordering surprises everyone:
- **Free: Zstandard**
- **Pro and Business: Brotli**
- **Enterprise: Gzip**

Yes, Enterprise defaults to the *worst* algorithm. Override with **Compression Rules** (which is also how you enable Zstandard on paid plans).

Minimum sizes: Gzip ≥48 bytes; Brotli and Zstandard ≥50 bytes. Only status `200` is compressed for success; only `403`/`404` among errors.

**Origin-facing:** on all plans Cloudflare requests with `accept-encoding: br, gzip`. End-to-end pass-through is preserved if the origin sets `content-encoding`, the client supports it, and no content-transforming feature is on. **These features force decompress/recompress:** Automatic HTTPS Rewrites, Cloudflare Fonts, Email Address Obfuscation, Polish, Rocket Loader, JavaScript Detections, RUM, Replace Insecure JS Libraries.

`cache-control: no-transform` from origin disables Cloudflare compression **and** preserves `Content-Length`.

> **Liferay-specific advice:** enable compression at Cloudflare and *disable* Tomcat/nginx `compression` on the origin for text types. Compressing twice wastes Liferay CPU (the scarce resource) to produce bytes Cloudflare will decompress anyway if any transform feature is on. Exception: if you use Cache Reserve, note it *"does not include the `Accept-Encoding: gzip` header when sending requests to the origin"* — so Cache Reserve fills always transfer uncompressed. Factor that into egress.

**HTTP/3** ([docs](https://developers.cloudflare.com/speed/optimization/protocol/http3/)): available on **all plans**, requires an edge SSL cert. *"This setting is for connection between the user and Cloudflare. **HTTP/3 connection to the origin is not yet supported.**"* So your Tomcat sees HTTP/1.1 or HTTP/2 regardless. Enable it — QUIC's head-of-line-blocking fix matters most on lossy mobile networks, which is where portal users on phones live.

**Early Hints (`103`)** ([docs](https://developers.cloudflare.com/cache/advanced-configuration/early-hints/)): available on **all plans**; **HTTP/2 and HTTP/3 only**.

Generated and cached only:
- for URIs with `.html`, `.htm`, `.php` extensions, **or no file extension** ← Liferay friendly URLs qualify
- on `200`, `301`, `302`
- when the response contains `Link` headers with `preconnect` or `preload` rel types, e.g. `Link: </img/preloaded.png>; rel=preload`

*"Early Hints cache entries are keyed by request URI and ignore query strings."*

> 🚨 **Serious warning for portals, verbatim:** *"Early Hints responses may be emitted before reaching the origin server or Worker. When Early Hints is enabled and pages on your site require authentication, unauthenticated visitors may receive a 103 response. The 103 response would contain cached Link headers and be sent before a 403 Forbidden response from your origin."*
>
> For a Liferay intranet this is a **minor information disclosure**: an anonymous visitor learns which assets a protected page preloads. Scope Early Hints away from authenticated sections, or accept the (small) leak knowingly.

Also expect benign `504`s with `RequestSource: earlyHintsCache` in Logpush — these are internal subrequests, not real errors.

**How to emit `Link` headers from Liferay:** the natural place is a theme-level `<liferay-util:html-top>` won't do it (that's body markup, not headers). Use a `ServletFilter` or an nginx `add_header Link` on the origin, listing your critical hashed CSS bundle and web font. Because hashed filenames are stable per deploy, this is safe.

**Impact vs effort:**
- Compression Rules (force Brotli/Zstd on Enterprise): **trivial effort, meaningful impact.** Enterprise customers are silently shipping gzip.
- HTTP/3: **one toggle, free.** Do it.
- Early Hints: **low effort, modest but real LCP impact** — but read the auth warning first.

---

## 5. Alternatives, briefly

### 5.1 Fastly — VCL + surrogate keys

This is what **Liferay themselves run in front of `www.liferay.com`** (`x-served-by: cache-den-kden1300041-DEN, cache-iad-khef600082-IAD`, `x-fastly-bucket: MAIN`, `via: 1.1 google, 1.1 varnish, 1.1 varnish`). Worth showing on a slide — it's a strong signal about what Liferay's own performance team chose.

**`Surrogate-Key`** ([docs](https://www.fastly.com/documentation/reference/http/http-headers/Surrogate-Key/)):

```http
Cache-Control: max-age=86400
Surrogate-Key: product-62952 product-1043 product-14534
```

*"This allows changes to a product to automatically purge all the pages on which that product appears, and not just the product page itself."* Space-delimited (vs Cloudflare's comma). Keys ≤1024 bytes each, header ≤16,384 bytes total. Settable in VCL:

```vcl
sub vcl_fetch {
    set beresp.http.Surrogate-Key = "key1 key2 key3";
}
```

Stripped from responses unless `Fastly-Debug: 1` is present — a nice debugging affordance Cloudflare lacks.

**`Surrogate-Control`** ([docs](https://www.fastly.com/documentation/reference/http/http-headers/Surrogate-Control/)) — *"Fastly processes `Surrogate-Control` in a similar way to `Cache-Control`… but will prefer `Surrogate-Control` over `Cache-Control` if both exist."*

```http
Cache-Control: max-age=0
Surrogate-Control: max-age=86400, stale-while-revalidate=60
```

> 💡 **This is Fastly's decisive advantage over Cloudflare for Liferay.** `Surrogate-Control` lets your origin say *"browsers, don't cache this at all; CDN, cache it for a day and serve stale."* One header, no Cache Rules, no override-TTL `Set-Cookie` stripping, no risk of the browser caching a personalised page. You can honestly keep `browser.cache.disabled=true` semantics for the client while getting full edge caching. Cloudflare's `Cloudflare-Cdn-Cache-Control` is the nearest equivalent but is less ergonomic.

Fastly also gives you **full VCL** (real code, not an expression language) and **instant (~150ms) global purge** including soft purge.

### 5.2 Varnish as an on-prem reverse cache

**Liferay-specific VCL guidance exists**, from David Nebinger's article on liferay.dev ([Increasing Capacity and Decreasing Response Times…](https://liferay.dev/b/increasing-capacity-and-decreasing-response-times-using-a-tool-you-re-probably-not-familiar-with)). Measured results: **44% reduction in overall test runtime** (21:20 → 11:58), response times ~14 s → ~6 s for cached content, with measurable Tomcat CPU reduction.

The three URL categories he identifies:

**Always `pass` (never cache):**
- `/c/*` — login, logout, all portal actions
- Control Panel management URLs
- `/api/*` — web service calls

**Cache aggressively:**
- Static assets (CSS, JS, images)
- Theme resources, matched by mime-type
- Document library images below a size threshold

**Dangerous — treat as dynamic:**
- Friendly URLs without query parameters (*"logged-in vs. anonymous states differ"*)
- Pages with role-based content variations

His hard-won lesson, which is the whole point of §6: *"caching friendly URLs broke authentication. The author initially cached user-specific content, which then served to all visitors. The solution required detecting URLs lacking query parameters and treating those as uncacheable dynamic content."*

And on documents: *"Liferay determines permissions based upon who a user is and whether they have view rights or not."* Overriding cache headers bypasses those checks — *"viable only for truly public folders."*

Architecture note: **Varnish supports neither SSL nor AJP.** Production needs Apache/nginx for TLS termination in front, with plain HTTP internally.

A sketch of the Liferay-shaped VCL (synthesised from the above categories — adapt, don't copy blindly):

```vcl
sub vcl_recv {
    # 1. Never cache portal actions, APIs, control panel
    if (req.url ~ "^/c/" ||
        req.url ~ "^/api/" ||
        req.url ~ "^/group/control_panel" ||
        req.url ~ "p_auth=") {
        return (pass);
    }

    # 2. Never cache for authenticated users
    if (req.http.Cookie ~ "COMPANY_ID=" || req.http.Cookie ~ "(^|;\s*)ID=") {
        return (pass);
    }

    # 3. Static + versioned assets: drop all cookies, cache hard
    if (req.url ~ "^/o/" ||
        req.url ~ "^/combo\?" ||
        req.url ~ "^/image/" ||
        req.url ~ "^/o/adaptive-media/image/" ||
        req.url ~ "\.(css|js|png|jpe?g|gif|svg|ico|woff2?|ttf|eot|webp|avif)(\?|$)") {
        unset req.http.Cookie;
        return (hash);
    }

    # 4. Guest HTML: strip non-semantic cookies so the object is shareable
    if (req.http.Cookie) {
        set req.http.Cookie = ";" + req.http.Cookie;
        set req.http.Cookie = regsuball(req.http.Cookie, "; +", ";");
        set req.http.Cookie = regsuball(req.http.Cookie, ";(GUEST_LANGUAGE_ID)=", "; \1=");
        set req.http.Cookie = regsuball(req.http.Cookie, ";[^ ][^;]*", "");
        set req.http.Cookie = regsuball(req.http.Cookie, "^[; ]+|[; ]+$", "");
        if (req.http.Cookie == "") { unset req.http.Cookie; }
    }
}

sub vcl_backend_response {
    # Liferay always mints JSESSIONID; drop it on cacheable guest objects only
    if (bereq.url ~ "^/o/" || bereq.url ~ "\.(css|js|png|jpe?g|gif|svg|woff2?)(\?|$)") {
        unset beresp.http.Set-Cookie;
        set beresp.ttl  = 365d;
        set beresp.http.Cache-Control = "public, max-age=31536000, immutable";
    }
    # Guest HTML: short TTL + generous grace (Varnish's stale-while-revalidate)
    if (beresp.http.Content-Type ~ "text/html" && !bereq.http.Cookie) {
        unset beresp.http.Set-Cookie;
        set beresp.ttl   = 60s;
        set beresp.grace = 24h;
    }
}
```

Note `beresp.grace` is Varnish's `stale-if-error`/`stale-while-revalidate` equivalent. **Varnish Enterprise** adds MSE disk cache, request coalescing, Brotli, ESI with *parallel* subrequests, Edgestash/xbody for session-token-based personalisation, and the **Ykey VMOD for tag-based purging** — the surrogate-key equivalent. ([How to Speed up Liferay Web Portals with Varnish Enterprise](https://info.varnish-software.com/blog/how-to-speed-up-liferay-web-portals-with-varnish-enterprise))

Setup mechanics (Varnish on :80, nginx moved to :8080) are in [Varnish Cache Setup for Liferay on Nginx](https://liferay.dev/b/varnish-cache-setup-for-liferay-on-nginx):

```
ExecStart=/usr/sbin/varnishd -j unix,user=vcache -F -a :80 -T localhost:6082 \
  -f /etc/varnish/default.vcl -S /etc/varnish/secret -s malloc,256m
```

**When Varnish beats a CDN:** intranets (users all in one place, so PoPs don't help), air-gapped/regulated deployments, and when you need ESI. **When it loses:** global audiences, DDoS absorption, TLS at the edge.

### 5.3 AWS CloudFront + Lambda@Edge

Cache behaviour is controlled by **cache policies** (which fields enter the cache key: query strings, headers, cookies — all explicitly allowlisted, none by default) and **origin request policies** (which fields are forwarded but *not* keyed). That split is genuinely cleaner than Cloudflare's model: you can forward `JSESSIONID` to Liferay without it fragmenting the cache key.

Edge compute ([Differences between CloudFront Functions and Lambda@Edge](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/edge-functions-choosing.html)):

| Feature | CloudFront Functions | Lambda@Edge |
|---|---|---|
| Languages | JavaScript (ES5.1) | Node.js, Python |
| Triggers | Viewer request/response only | Viewer **and** origin request/response |
| Scale | Millions req/s | 10,000 req/s per region |
| Duration | Sub-millisecond | Up to 30 s |
| Memory | 2 MB | 128 MB (viewer) / 10 GB (origin) |
| Code size | 10 KB | 50 MB |
| Network access | ❌ | ✅ |
| Request body access | ❌ | ✅ |

**For Liferay:** CloudFront Functions for cache-key normalisation and cookie-based bypass (viewer request); Lambda@Edge when you need to call Liferay Headless or rewrite HTML.

**Weakness:** CloudFront has **no native cache-tag purge.** Invalidations are path-based, eventually consistent (minutes, not milliseconds), and metered beyond a free tier. Tag-style invalidation requires a DIY layer (see e.g. [CloudFront cache tag invalidation with Lambda@Edge](https://monicacolangelo.com/cloudfront-cache-tag-invalidation/)). For a publish-driven CMS like Liferay this is a real disadvantage versus Cloudflare/Fastly/Akamai.

Also note: `cdn.dynamic.resources.enabled=false` exists in `portal.properties` **specifically** for CloudFront — the comment says *"Setting this to false allows the usage of CDNs that do not support lazy loading of resources (e.g. Amazon CloudFront)."* If you're on CloudFront with a pull origin, this is the flag.

### 5.4 Akamai

Cache tags via the **`Edge-Cache-Tag`** response header ([Assign cache tags](https://techdocs.akamai.com/purge-cache/docs/assign-cache-tags)):

```http
Edge-Cache-Tag: casual, knits, fall-sale
```

Limits: up to **128 comma-delimited values** per object; only the **first** `Edge-Cache-Tag` header is respected; **128 characters** max per tag; case-**sensitive** (`tag-abc` ≠ `Tag-Abc`). Allowed characters: alphanumeric, `&`, `'`, `@`, `-`, `:`, `.`, `+`, `~`, `_`, `/`. Notably **disallowed**: spaces, `#`, `=`, `%`, `?`, `;`, quotes, brackets, `*`, `\`, `$`, `!`.

> ⚠️ Cross-CDN portability trap: Akamai forbids `=` and `%` in tags; Cloudflare forbids spaces; Fastly uses spaces as the *delimiter*. If you emit one `Cache-Tag`/`Surrogate-Key`/`Edge-Cache-Tag` from Liferay for multiple CDNs, restrict yourself to `[a-z0-9-]` and you'll be safe everywhere.

Akamai gotcha: *"New or changed tags require a 200 response from origin to update; 304 responses won't refresh tags."* So a revalidated object keeps its old tags.

Akamai also distinguishes **invalidate** (mark stale, revalidate on next request — gentle on origin) from **delete** (remove outright — origin takes the full hit). Cloudflare only offers delete semantics for purge; the closest equivalent is relying on `stale-while-revalidate`.

Liferay documents an [external Akamai WAF in front of PaaS](https://learn.liferay.com/kb-article/configuring-an-external-web-application-firewall-akamai-in-paas), so this is a supported topology.

### 5.5 Quick comparison

| | Cloudflare | Fastly | Akamai | CloudFront | Varnish (self-host) |
|---|---|---|---|---|---|
| Tag purge | ✅ all plans, `Cache-Tag` | ✅ `Surrogate-Key` | ✅ `Edge-Cache-Tag` | ❌ DIY | ✅ Ykey (Enterprise) / ban |
| Separate CDN vs browser TTL from origin | Partial (`Cloudflare-Cdn-Cache-Control`) | ✅ `Surrogate-Control` | ✅ `Edge-Control` | Partial | ✅ VCL |
| Edge compute | Workers/Snippets | Compute / VCL | EdgeWorkers | Functions / Lambda@Edge | VCL + VMODs |
| Purge latency | Instant | ~150 ms | Seconds | Minutes | Instant |
| Free tier usable? | ✅ genuinely | ❌ | ❌ | Limited | n/a |
| Best Liferay fit | Default choice; best price/capability | Best headers model; what Liferay uses | Enterprise/regulated | Already all-in on AWS | Intranet / air-gapped |

---

## 6. The auth boundary — the disaster you must not have

### 6.1 The failure mode

One anonymous visitor requests `/web/guest/home`. The edge has an entry cached from a response that was rendered **for a signed-in user** — complete with their name in the user bar, their `p_auth` token, their personalised dashboard. Every subsequent anonymous visitor gets it. It is not a subtle bug; it is a data breach, and it is trivially reproducible if your bypass rule is wrong by one character.

The Liferay+Varnish write-up hit exactly this: *"The author initially cached user-specific content, which then served to all visitors."* Cloudflare's own Cache Everything doc says the same in different words: *"visitors may receive information not intended for them."*

### 6.2 Which cookies identify a Liferay user

From `com.liferay.portal.kernel.util.CookieKeys` ([source](https://raw.githubusercontent.com/liferay/liferay-portal/master/portal-kernel/src/com/liferay/portal/kernel/util/CookieKeys.java)):

```java
public static final String COMPANY_ID       = "COMPANY_ID";
public static final String COOKIE_SUPPORT   = "COOKIE_SUPPORT";
public static final String GUEST_LANGUAGE_ID= "GUEST_LANGUAGE_ID";
public static final String ID               = "ID";
public static final String JSESSIONID       = "JSESSIONID";
public static final String LOGIN            = "LOGIN";
public static final String PASSWORD         = "PASSWORD";
public static final String REMEMBER_ME      = "REMEMBER_ME";
public static final String USER_UUID        = "USER_UUID";
```

Classify them carefully — this table is the heart of the section:

| Cookie | Set for guests? | Reliable auth signal? |
|---|---|---|
| `JSESSIONID` | **Yes** — Liferay mints one for anonymous visitors (verified live) | ❌ **No. Never use it as a bypass trigger.** It would bypass 100% of your traffic |
| `COOKIE_SUPPORT` | Yes | ❌ No |
| `GUEST_LANGUAGE_ID` | Yes | ❌ No — but *do* put it in the cache key |
| `COMPANY_ID` | No — set on authentication | ✅ **Yes** |
| `ID` | No — set on authentication (encrypted user id) | ✅ **Yes** |
| `USER_UUID` | No | ✅ Yes |
| `PASSWORD` | No — Remember Me | ✅ Yes |
| `LOGIN`, `REMEMBER_ME` | No | ✅ Yes (auto-login) |

> 🔴 **This is the single most important correction to make in the talk.** The widespread advice "bypass cache when `JSESSIONID` is present" is *wrong for Liferay* and produces a 0% hit ratio while giving people a false sense of safety. Liferay issues `JSESSIONID` to everybody. The real auth signal is `COMPANY_ID`/`ID`.

### 6.3 Safe rule patterns for Cloudflare

**Rule 1 — bypass authenticated traffic (must be evaluated FIRST):**

```
(http.cookie contains "COMPANY_ID=")
or (http.cookie contains "USER_UUID=")
or (http.request.cookies["ID"][0] ne "")
or (http.cookie contains "REMEMBER_ME=")
or (http.request.method ne "GET")
or (starts_with(http.request.uri.path, "/c/"))
or (starts_with(http.request.uri.path, "/api/"))
or (starts_with(http.request.uri.path, "/group/control_panel"))
or (starts_with(http.request.uri.path, "/o/api"))
or (http.request.uri.query contains "p_auth=")
or (http.request.uri.query contains "p_p_auth=")
or (http.request.uri.query contains "p_p_lifecycle=1")
or (http.request.uri.query contains "p_p_lifecycle=2")
```
→ **Cache eligibility: Bypass cache**

Notes on each clause:
- `http.request.method ne "GET"` — belt and braces; Cloudflare won't cache non-GET, but stating it makes the rule self-documenting and protects you if a later rule sets an override TTL.
- `p_p_lifecycle=1` is an **action** URL, `=2` is a **resource** URL. Neither should ever be cached; both frequently mutate state.
- `p_auth`/`p_p_auth` present ⇒ session-bound CSRF token in play (§4.11).
- `/o/api` covers Headless; adjust for your API surface.

**Rule 2 — cache guest HTML (evaluated after Rule 1):**

```
(http.host eq "www.example.com"
 and http.request.method eq "GET"
 and not starts_with(http.request.uri.path, "/c/")
 and not starts_with(http.request.uri.path, "/api/")
 and not starts_with(http.request.uri.path, "/o/api")
 and not starts_with(http.request.uri.path, "/group/control_panel")
 and not http.cookie contains "COMPANY_ID="
 and not http.cookie contains "USER_UUID="
 and not http.cookie contains "REMEMBER_ME=")
```
→ **Eligible for cache**
→ **Edge TTL:** *Ignore cache-control header and use this TTL* = **60 s** ← this is what strips `Set-Cookie`
→ **Browser TTL:** *Bypass cache* (see §6.5)
→ **Cache Key:** exclude tracking params, include `GUEST_LANGUAGE_ID`, cache deception armor **on**, sort query string **on**
→ **Cache Reserve:** off

**Rule 3 — versioned static assets, cache hard:**

```
(starts_with(http.request.uri.path, "/o/")
 or starts_with(http.request.uri.path, "/combo")
 or starts_with(http.request.uri.path, "/image/")
 or starts_with(http.request.uri.path, "/o/adaptive-media/image/"))
```
→ Eligible for cache, Edge TTL **respect origin** (Liferay already sends `max-age=31536000, immutable` on hashed files), Browser TTL respect origin, Cache Reserve **on** with `minimum_file_size` ≈ 100 KB.

### 6.4 Defence in depth — do not rely on one rule

A single expression is one typo away from a breach. Layer these:

1. **Bypass rule first, ordered explicitly.** Cache Rules are evaluated in order and *"Multiple matching cache rules can be combined and applied to the same request"* ([Order and priority](https://developers.cloudflare.com/cache/how-to/cache-rules/order/)). Verify order in the dashboard, not in your head.
2. **Make the origin assert the truth.** Have Liferay stamp `Cache-Control: private, no-store` on *every* authenticated response (this is `browser.cache.signed.in.disabled=true`, already the default). Then, even if the edge rule mismatches, an override Edge TTL is the *only* thing that could cache it — which narrows your audit surface to "which rules use `override_origin`".
3. **Add a canary header.** Emit `X-LFR-User: guest|auth` from a Liferay `ServletFilter`. Then synthetically fetch your homepage anonymously every minute and alert if you ever see `X-LFR-User: auth` on a `CF-Cache-Status: HIT`. **This is the single control that would have caught every real-world incident of this class.** Strip the header at the edge before it reaches visitors if you prefer.
4. **Enable Cache Deception Armor.** It verifies that a URL's extension matches the returned `Content-Type`. The canonical attack — luring a signed-in user to `/web/guest/home/foo.jpg`, which Liferay's friendly-URL resolver may happily serve as HTML, whereupon the `.jpg` extension makes Cloudflare cache it — is *exactly* the Liferay-shaped version of Web Cache Deception. Liferay's friendly URL handling makes this more plausible than on most platforms. ([Cache Deception Armor](https://developers.cloudflare.com/cache/cache-security/cache-deception-armor/))
   - Caveat from the docs: *"Cache Deception Armor depends upon Origin Cache Control. A `Cache-Control` header from the origin, or an Edge Cache TTL Cache Rule may override the protection."* So it is **not** sufficient on its own if you use override TTLs — which you do.
5. **Enable URL normalization + "Normalize URLs to origin."** Cloudflare recommends this *"especially if you are setting custom cache keys or using cache by device type… This helps ensure the URL in the cache key matches the URL sent to the origin, preventing cache poisoning."*
6. **Test the matrix before go-live.** From the Liferay/Varnish article: *"You must manually test across all scenarios—logged in/out, different user roles, all portal pages—before production deployment to prevent information leakage."* Automate it: for each of {guest, member, admin} × {home, protected page, DL file, AM image, headless endpoint}, assert the expected `CF-Cache-Status` and the expected `X-LFR-User`.

### 6.5 Why Browser TTL should be *bypass* on guest HTML

If you cache guest HTML at the edge for 60 s, do **not** also let the *browser* cache it. Consider: an anonymous user browses, gets HTML cached in their browser for 60 s, then logs in. For the next 60 s their browser may serve them the guest version from local cache — showing a "Sign In" button to a signed-in user, or worse, a stale `p_auth`. Set **Browser TTL: Bypass cache** on the guest HTML rule and let the edge do all the caching. This is precisely the concern behind `browser.cache.signed.in.disabled=true`.

(This is also where Fastly's `Surrogate-Control` shines: `Cache-Control: private, no-store` + `Surrogate-Control: max-age=60, stale-while-revalidate=600` expresses exactly this in two headers, with no rule engine involved.)

### 6.6 Impact vs effort summary for §6

| Control | Effort | Impact |
|---|---|---|
| Correct cookie-based bypass rule (`COMPANY_ID`, not `JSESSIONID`) | Low | **Critical — nothing else is safe without it** |
| Origin `private, no-store` on authenticated responses | Zero (default) | Critical |
| Canary header + synthetic monitor | Low-medium | **Highest safety-per-hour of anything in this brief** |
| Cache Deception Armor | Trivial (toggle) | High |
| URL normalization to origin | Trivial | Medium |
| Full role × page test matrix | Medium-high | Critical before go-live |

---

## 7. Suggested demo sequence for the talk

A narrative that builds tension and resolves it:

1. **Baseline.** `curl -I` a stock Liferay page. Show `Cache-Control: private, no-cache, no-store, must-revalidate` and `Set-Cookie: JSESSIONID`. Put a naïve "Cache Everything" rule in front. Show `CF-Cache-Status: MISS`, every single time. *"We added a CDN and made the site slower."*
2. **Fix the assets.** `cdn.host.https` + Frontend Caching. Show hashed URLs picking up `public, max-age=31536000, immutable` and going `HIT`. Show `?cdn_enabled=0` toggling it off live.
3. **Fix the documents.** Enable DL Cache Control for guest content. `curl -I` a DL image before/after: `private` → `public, max-age=86400`, `MISS` → `HIT`.
4. **The dangerous bit.** Add the override-TTL guest HTML rule. Show it now caches. Then log in in a second browser **with the bypass rule deliberately keyed on `JSESSIONID`** and show the leak happening live. Fix it to `COMPANY_ID`. Show the canary header catching it.
5. **Make it fast and resilient.** Add `stale-while-revalidate` + `stale-if-error`. Kill the origin. Site stays up. Show `CF-Cache-Status: UPDATING` then `STALE`.
6. **Make it fresh.** `ModelListener` → purge-by-tag. Edit an article, watch the purge fire, watch the page update in under a second while Edge TTL stays at an hour.
7. **Close.** Liferay's Integrated CDN slide — "all of this, but as a product."

---

## Sources

**Liferay — official documentation & KB**
- https://learn.liferay.com/w/dxp/self-hosted-installation-and-upgrades/setting-up-liferay/using-a-cdn
- https://learn.liferay.com/kb-article/content-delivery-network-cdn-configuration-cdn.dynamic.resources.enabled-false-is-not-working
- https://learn.liferay.com/l/36394203
- https://help.liferay.com/hc/en-us/articles/360017897012-Content-Delivery-Network
- https://help.liferay.com/hc/en-us/articles/360017895972-Content-Delivery-Network
- https://resources.learn.liferay.com/reference/latest/en/dxp/propertiesdoc/portal.properties.html
- https://learn.liferay.com/kb-article/my-cdn-cannot-cache-documents-uploaded-to-documents-and-media
- https://learn.liferay.com/w/dxp/digital-asset-management/devops/configuring-cache-control-for-documents-and-media
- https://learn.liferay.com/w/dxp/content-authoring-and-management/documents-and-media/devops/configuring-cache-control-for-documents-and-media
- https://learn.liferay.com/kb-article/how-to-view-and-construct-an-adaptive-media-url-for-a-document
- https://learn.liferay.com/w/dxp/content-authoring-and-management/documents-and-media/publishing-and-sharing/using-adaptive-media
- https://learn.liferay.com/w/dxp/security-and-administration/administration/configuring-liferay/virtual-instances/configuring-frontend-resource-caching
- https://learn.liferay.com/kb-article/cache-control-header-for-other-content-type
- https://learn.liferay.com/kb-article/user-did-not-provide-a-valid-csrf-token-error
- https://learn.liferay.com/kb-article/csrf-p_auth-token-is-not-included-in-portlet-resourceurls
- https://help.liferay.com/hc/en-us/articles/4415214660493-How-to-enable-CSRF-Token-in-Liferay
- https://help.liferay.com/hc/en-us/articles/360036708571-Making-Authenticated-Requests
- https://learn.liferay.com/w/dxp/development/traditional-java-based-development/extending-liferay/creating-a-model-listener

**Liferay Cloud / SaaS**
- https://learn.liferay.com/w/liferay-cloud/configuring-the-cloud-network/load-balancer
- https://learn.liferay.com/w/dxp/cloud/configuring-the-cloud-network/load-balancer
- https://learn.liferay.com/liferay-cloud/latest/en/reference/liferay-cloud-infrastructure.html
- https://learn.liferay.com/kb-article/liferay-saas-cdns-cache-mode
- https://learn.liferay.com/kb-article/how-to-increase-google-cloud-cdn-caching-time
- https://learn.liferay.com/w/dxp/cloud/tuning-security-settings/web-application-firewall
- https://learn.liferay.com/kb-article/configuring-an-external-web-application-firewall-akamai-in-paas
- https://learn.liferay.com/w/liferay-cloud/reference/configuration-via-lcp-json
- https://learn.liferay.com/course/mastering-liferay-frontend-client-extensions/mfcx-customizing-liferay-s-look-and-feel/mfcx-configuring-caching-behavior
- https://www.liferay.com/capabilities/content-delivery-network

**Liferay source (github.com/liferay/liferay-portal, `master`)**
- https://raw.githubusercontent.com/liferay/liferay-portal/master/portal-impl/src/portal.properties
- https://raw.githubusercontent.com/liferay/liferay-portal/master/portal-impl/src/com/liferay/portal/util/PortalImpl.java
- https://raw.githubusercontent.com/liferay/liferay-portal/master/portal-impl/src/com/liferay/portal/events/ServicePreAction.java
- https://raw.githubusercontent.com/liferay/liferay-portal/master/portal-kernel/src/com/liferay/portal/kernel/theme/ThemeDisplay.java
- https://raw.githubusercontent.com/liferay/liferay-portal/master/portal-kernel/src/com/liferay/portal/kernel/util/PortalUtil.java
- https://raw.githubusercontent.com/liferay/liferay-portal/master/portal-kernel/src/com/liferay/portal/kernel/servlet/HttpHeaders.java
- https://raw.githubusercontent.com/liferay/liferay-portal/master/portal-kernel/src/com/liferay/portal/kernel/servlet/ServletResponseUtil.java
- https://raw.githubusercontent.com/liferay/liferay-portal/master/portal-kernel/src/com/liferay/portal/kernel/util/CookieKeys.java
- https://raw.githubusercontent.com/liferay/liferay-portal/master/modules/apps/portal-url-builder/portal-url-builder-impl/src/main/java/com/liferay/portal/url/builder/internal/AbsolutePortalURLBuilderImpl.java
- https://raw.githubusercontent.com/liferay/liferay-portal/master/modules/apps/document-library/document-library-api/src/main/java/com/liferay/document/library/util/DLURLHelper.java

**Cloudflare — Cache**
- https://developers.cloudflare.com/cache/how-to/cache-rules/
- https://developers.cloudflare.com/cache/how-to/cache-rules/settings/
- https://developers.cloudflare.com/cache/how-to/cache-rules/create-api/
- https://developers.cloudflare.com/cache/how-to/cache-rules/page-rules-migration/
- https://developers.cloudflare.com/cache/how-to/cache-rules/order/
- https://developers.cloudflare.com/cache/how-to/cache-rules/examples/cache-everything/
- https://developers.cloudflare.com/cache/how-to/cache-rules/examples/bypass-cache-on-cookie/
- https://developers.cloudflare.com/cache/how-to/cache-rules/examples/custom-cache-key/
- https://developers.cloudflare.com/cache/how-to/cache-rules/examples/edge-ttl/
- https://developers.cloudflare.com/cache/how-to/cache-rules/examples/browser-cache-ttl/
- https://developers.cloudflare.com/cache/how-to/cache-rules/examples/origin-cache-control/
- https://developers.cloudflare.com/cache/how-to/cache-keys/
- https://developers.cloudflare.com/cache/how-to/set-caching-levels/
- https://developers.cloudflare.com/cache/how-to/edge-browser-cache-ttl/
- https://developers.cloudflare.com/cache/how-to/tiered-cache/
- https://developers.cloudflare.com/cache/how-to/always-online/
- https://developers.cloudflare.com/cache/how-to/purge-cache/
- https://developers.cloudflare.com/cache/how-to/purge-cache/purge-by-tags/
- https://developers.cloudflare.com/cache/how-to/purge-cache/purge_by_prefix/
- https://developers.cloudflare.com/cache/how-to/purge-cache/purge-by-hostname/
- https://developers.cloudflare.com/cache/how-to/purge-cache/purge-by-single-file/
- https://developers.cloudflare.com/cache/concepts/default-cache-behavior/
- https://developers.cloudflare.com/cache/concepts/cache-control/
- https://developers.cloudflare.com/cache/concepts/cache-behavior/
- https://developers.cloudflare.com/cache/concepts/cache-responses/
- https://developers.cloudflare.com/cache/concepts/revalidation/
- https://developers.cloudflare.com/cache/concepts/vary/
- https://developers.cloudflare.com/cache/advanced-configuration/cache-reserve/
- https://developers.cloudflare.com/cache/advanced-configuration/early-hints/
- https://developers.cloudflare.com/cache/cache-security/cache-deception-armor/
- https://developers.cloudflare.com/api/resources/cache/methods/purge/

**Cloudflare — Speed, Rules, Workers, Security**
- https://developers.cloudflare.com/speed/optimization/content/compression/
- https://developers.cloudflare.com/speed/optimization/protocol/http3/
- https://developers.cloudflare.com/rules/page-rules/
- https://developers.cloudflare.com/rules/snippets/
- https://developers.cloudflare.com/rules/normalization/
- https://developers.cloudflare.com/argo-smart-routing/
- https://developers.cloudflare.com/smart-shield/
- https://developers.cloudflare.com/automatic-platform-optimization/
- https://developers.cloudflare.com/automatic-platform-optimization/reference/cache-device-type/
- https://developers.cloudflare.com/workers/runtime-apis/html-rewriter/
- https://developers.cloudflare.com/workers/reference/how-the-cache-works/
- https://developers.cloudflare.com/workers/platform/pricing/
- https://developers.cloudflare.com/kv/platform/pricing/
- https://developers.cloudflare.com/waf/managed-rules/troubleshooting/
- https://developers.cloudflare.com/waf/managed-rules/reference/owasp-core-ruleset/
- https://developers.cloudflare.com/bots/concepts/bot/

**Alternatives — Fastly, Akamai, AWS, Varnish, GCP**
- https://www.fastly.com/documentation/reference/http/http-headers/Surrogate-Key/
- https://www.fastly.com/documentation/reference/http/http-headers/Surrogate-Control/
- https://www.fastly.com/documentation/guides/concepts/edge-state/cache/purging/
- https://techdocs.akamai.com/purge-cache/docs/assign-cache-tags
- https://techdocs.akamai.com/purge-cache/docs/cache-tag-use-cases
- https://techdocs.akamai.com/property-mgr/docs/cache-tag
- https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/edge-functions-choosing.html
- https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/cloudfront-limits.html
- https://monicacolangelo.com/cloudfront-cache-tag-invalidation/
- https://info.varnish-software.com/blog/how-to-speed-up-liferay-web-portals-with-varnish-enterprise
- https://liferay.dev/b/increasing-capacity-and-decreasing-response-times-using-a-tool-you-re-probably-not-familiar-with
- https://liferay.dev/b/varnish-cache-setup-for-liferay-on-nginx
- https://www.varnish-software.com/developers/tutorials/example-vcl-template/
- https://docs.cloud.google.com/cdn/docs/using-cache-modes
- https://docs.cloud.google.com/cdn/docs/caching
- https://docs.cloud.google.com/cdn/docs/using-ttl-overrides

**Standards**
- https://www.rfc-editor.org/rfc/rfc9111.html (HTTP Caching; §4.2.4 stale, §5.2.2.10 s-maxage)
- https://httpwg.org/specs/rfc8297.html (103 Early Hints)
- https://datatracker.ietf.org/doc/html/rfc7234 (HTTP/1.1 Caching, referenced by Cloudflare OCC)

**Live header observations** (captured 2026-08-11 against `www.liferay.com`, a production Liferay DXP on Liferay Cloud behind Fastly): guest homepage `cache-control: public, max-age=60` + undocumented `x-lfr-guest-html-cache: 1` + `x-cache: HIT`; uncached page `set-cookie: JSESSIONID=...; SERVER_ID=...`; hashed asset `cache-control: public, max-age=31536000, immutable`; combo servlet `cache-control: max-age=3600, public`; DL asset `cache-control: public, max-age=86400`, `x-cache: HIT`.

---

### Caveats on confidence

- **`x-lfr-guest-html-cache: 1`** is observed on `www.liferay.com` but is **not documented anywhere public**. Treat it as evidence that Liferay runs a guest-HTML caching layer on its own site, not as a shippable DXP feature. Worth asking Liferay staff at DevCon — it would make an excellent audience question.
- The **Liferay Integrated CDN** page is marketing copy marked *Coming Soon*; the underlying vendor is not named (the "Analytics deep links… provider dashboards" phrasing implies a third party). Verify before asserting specifics on stage.
- The **DL Cache Control OSGi PID / `.config` filename** could not be confirmed from public sources; only the UI path and version availability are documented. If you want to ship it as a `.config` file rather than a UI change, confirm the PID against your own instance's `System Settings → export`.
- **Cloudflare plan-gating changes frequently.** Purge-by-tag being available on all plans is current as of the Jul 2026 docs but was Enterprise-only historically — re-verify shortly before the talk.
agentId: a171b855caab7e3a5 (use SendMessage with to: 'a171b855caab7e3a5', summary: '<5-10 word recap>' to continue this agent)
<usage>subagent_tokens: 234403
tool_uses: 122
duration_ms: 1509354</usage>

---

# Aggressively Caching Public / Anonymous Pages in Liferay

**Research brief for Liferay DevCon 2026 — "Making Liferay blazing fast in production"**
Anchored on Liferay DXP 2025.Q1+ quarterly releases (and `master`), with version-agnostic HTTP-caching principles.
All Liferay source references are from `github.com/liferay/liferay-portal` at `master` unless a tag is named. Live header captures were taken 2026-08-11.

---

## 0. Ground truth first: what Liferay actually puts on the wire today

Before any theory, here is real measured evidence. Three probes, same day, all Liferay-operated production sites.

**A. `learn.liferay.com` — an out-of-the-box-ish guest page:**

```http
HTTP/2 200
content-type: text/html;charset=UTF-8
vary: Accept-Encoding
set-cookie: JSESSIONID=06A314952E3229704DB74AD22A9A5975; Path=/; Secure; HttpOnly
set-cookie: COOKIE_SUPPORT=true; Max-Age=31536000; Expires=Wed, 11 Aug 2027 18:46:57 GMT; Path=/; Secure; HttpOnly
set-cookie: SERVER_ID=3d5f4dbe1b0668ed; path=/; HttpOnly; Secure
expires: Thu, 01 Jan 1970 00:00:00 GMT
cache-control: private, no-cache, no-store, must-revalidate
pragma: no-cache
x-liferay-request-guest-user: true
```

**B. `liferay.dev` — identical:**

```http
cache-control: private, no-cache, no-store, must-revalidate
pragma: no-cache
expires: Thu, 01 Jan 1970 00:00:00 GMT
set-cookie: JSESSIONID=6D57812043ADD63E7B75795BFEF12AA6; Path=/; Secure; HttpOnly
set-cookie: COOKIE_SUPPORT=true; Max-Age=31536000; ...
x-liferay-request-guest-user: true
```

**C. `www.liferay.com` — Liferay's own marketing site, which has clearly solved this:**

```http
HTTP/2 200
content-type: text/html;charset=UTF-8
cache-control: public, max-age=60
cache-control-test: public, max-age=3600, stale-while-revalidate=60
x-lfr-guest-html-cache: 1
via: 1.1 google, 1.1 varnish, 1.1 varnish
age: 10654
x-served-by: cache-den-kden1300041-DEN, cache-iad-khef600082-IAD
x-cache: HIT IAD
x-cache-hits: 1, 1
vary: Accept-Encoding
```

Note carefully:
- **No `Set-Cookie` at all** on the cached variant.
- `Age: 10654` (~3 h) with `max-age=60` → the browser TTL and the **edge** TTL are decoupled (classic Fastly `Surrogate-Control`, stripped before delivery). This is exactly the "different TTL for CDN and browser" pattern in §1.
- `cache-control-test: public, max-age=3600, stale-while-revalidate=60` — they're actively A/B-testing SWR.
- `x-lfr-guest-html-cache: 1` is a **bespoke header**, not a documented Liferay product feature. I could find no Liferay documentation or code for it. Honest read: Liferay's own web team built a custom guest-HTML cache layer for liferay.com. **Great slide material: "even Liferay had to build this themselves."**
- Sending a fake `Cookie: JSESSIONID=ABC123` still returned `x-cache: HIT` → they do **not** vary on cookie for that URL.

**D. And a genuine bug worth a slide** — `/o/*` static resources on liferay.dev return **two** `Cache-Control` header lines:

```http
GET /o/frontend-js-web/Liferay.js
etag: NKZ6A2Y2
cache-control: max-age=86400, must-revalidate, public
cache-control: private
```

Per RFC 9110 these combine to `max-age=86400, must-revalidate, public, private` — and `private` wins for shared caches, so **your CDN will refuse to cache the file** even though the origin asked for a day of public caching. The `private` value matches `HttpHeaders.CACHE_CONTROL_PRIVATE_VALUE` exactly, and `ServletResponseUtil.setHeaders()` contains:

```java
if (!httpServletResponse.containsHeader(HttpHeaders.CACHE_CONTROL)) {
    httpServletResponse.setHeader(
        HttpHeaders.CACHE_CONTROL,
        HttpHeaders.CACHE_CONTROL_PRIVATE_VALUE);
}
```

(`portal-kernel/.../servlet/ServletResponseUtil.java`, ~line 440). `containsHeader()` does not always see headers added by an outer filter/proxy, so a second line gets appended. **Action item for the audience: `curl -sSD- -o/dev/null https://yoursite/o/... | grep -i cache-control` and count the lines.**

---

## 1. HTTP caching semantics done right (version-agnostic)

### 1.1 The directive vocabulary

| Directive | Who obeys | Meaning | Liferay-relevant gotcha |
|---|---|---|---|
| `public` | browser + shared | Cacheable by shared caches even if request had `Authorization` | Needed for CDN caching of HTML |
| `private` | browser only | Shared caches **must not** store | Liferay's default on rendered HTML; also silently appended to `/o/*` (see §0D) |
| `max-age=N` | both | Freshness lifetime in seconds | Browser TTL. Keep small (30–120 s) so purges are effective |
| `s-maxage=N` | shared only | Overrides `max-age` for shared caches | The cheapest way to give the CDN a long TTL and the browser a short one, with zero vendor lock-in |
| `no-cache` | both | May store, **must revalidate** before reuse | Not "don't cache". Common misconception |
| `no-store` | both | Must not write to disk/memory at all | This is the real killer. Liferay ships it by default |
| `must-revalidate` | both | Once stale, must not serve stale | Explicitly disables the stale-serving you want |
| `immutable` (RFC 8246) | browser | Don't revalidate on reload | For hashed asset filenames only |
| `stale-while-revalidate=N` (RFC 5861) | mostly shared | Serve stale up to N s past expiry while refreshing in background | **The single highest-leverage directive for a DXP.** Origin sees ~1 req per URL per TTL |
| `stale-if-error=N` (RFC 5861) | shared | Serve stale for N s if origin 5xx/times out | Free availability. Your JVM can GC-pause and users never notice |

**Target header for a Liferay public page:**

```http
Cache-Control: public, max-age=60, s-maxage=600, stale-while-revalidate=86400, stale-if-error=604800
```

Rationale: browsers hold 60 s (back/forward is instant, but a purge is visible within a minute); the CDN holds 10 minutes fresh, will serve stale for a day while refreshing in background, and will serve week-old stale if the origin is down. Combined with active purge on publish (§6), editorial latency is seconds, not TTL.

### 1.2 Header separation: browser TTL ≠ CDN TTL

Three mechanisms, in order of preference:

1. **`s-maxage`** — standard, RFC 9111, understood by literally every shared cache. Zero config. Start here.
2. **`CDN-Cache-Control`** — RFC 9213 "Targeted HTTP Cache Control". A *targeted* field: CDNs that understand it use it **instead of** `Cache-Control`, and it is invisible to the browser. Also standardises `<vendor>-CDN-Cache-Control` (e.g. `Cloudflare-CDN-Cache-Control`). Best when you need genuinely divergent semantics (e.g. `no-store` for browsers, `max-age=3600` for the edge).
3. **`Surrogate-Control` / `Surrogate-Key`** — the Fastly/Akamai/Varnish ESI-spec pair. `Surrogate-Control: max-age=3600, stale-while-revalidate=86400` is consumed and **stripped** by the edge; `Surrogate-Key: wc-12345 page-home site-guest` gives you tag-based purging. This is what `www.liferay.com` is doing (`Age` ≫ `max-age`).

```http
Cache-Control:      public, max-age=60
CDN-Cache-Control:  public, max-age=600, stale-while-revalidate=86400, stale-if-error=604800
Surrogate-Control:  max-age=600, stale-while-revalidate=86400
Surrogate-Key:      site-1234 layout-56789 wc-article-9876 wc-structure-BASIC
```

`Age` is emitted by the shared cache and tells the browser how much of `max-age` is already burned. If you see `Age` growing past `max-age` with `X-Cache: HIT`, the edge is running on a surrogate TTL — that's the tell.

### 1.3 Conditional requests: `ETag` / `Last-Modified`

- Weak vs strong ETags matter: `W/"abc"` is fine for full-body reuse but disables byte-range revalidation.
- Liferay's `ETagFilter` (`etag.response.size.max=1048576`, default 1 MB) **is not mapped to page URLs**. From `portal-web/docroot/WEB-INF/liferay-web.xml`, `ETag Filter` maps only to `/combo/*`, `/image/*`, `/language/*`, `/o/js_bundle_config`, `*.css|gif|ico|jpg|js|png`, and the document-library download paths. **Rendered pages get no ETag out of the box.**
- Practical consequence: a 304 still costs you a full JVM page render unless you compute the ETag cheaply upstream. For Liferay, do **not** try to bolt an ETag onto page HTML at origin — the render is the expensive part, and Liferay pages contain per-request nonces (§4), so the body isn't byte-stable anyway. Cache the *whole response* at the edge instead.
- Where conditional requests *do* pay: the tiny personalization JSON in §5, and static assets.

**Impact/effort: LOW impact, MEDIUM effort for HTML. Skip.**

### 1.4 `Vary` — the silent hit-ratio assassin

The shared cache stores one entry **per distinct combination of the listed request headers**.

- `Vary: Accept-Encoding` — fine, and what Liferay emits. 2–3 variants (br, gzip, identity).
- `Vary: Cookie` — **catastrophic**. Every unique cookie *string* is a separate cache entry. With `JSESSIONID` + `COOKIE_SUPPORT` + `_ga` + `_fbp`, effectively every visitor gets their own entry. Hit ratio → ~0, and your CDN becomes an expensive proxy. Yet `Vary: Cookie` is the "safe" reflex when a framework sets cookies, so it appears constantly.
- `Vary: User-Agent` — thousands of variants. Never do this. If you must serve device-specific markup, normalise to a small enumerated header at the edge (`X-Device: mobile|tablet|desktop`) and `Vary` on that instead.
- `Vary: Accept-Language` — a handful of variants if you normalise to your supported locales at the edge; unbounded if you don't (browsers send `en-GB,en;q=0.9,fr;q=0.8`). Prefer locale-in-URL (§7).
- `Vary: *` — Cloudflare documents this as "always bypasses cache". Never emit it.

**Rule for the talk: the only acceptable `Vary` on a public Liferay page is `Accept-Encoding`.** Everything else must be collapsed into the cache key at the edge, where you control cardinality.

### 1.5 Why `Set-Cookie` alone kills edge caching

This is the mechanical reason Liferay is uncacheable, independent of `Cache-Control`:

- **Fastly**: "Responses from a backend server that include a `Set-Cookie` header are usually not cacheable. By default, Fastly disables caching of such responses." Fastly's boilerplate VCL sets `Fastly-Cachetype = "SETCOOKIE"` and `return(pass)`.
- **Cloudflare**: lists "The origin returned a `Set-Cookie` header" among the reasons a response is not cached.
- **Varnish** `builtin.vcl`: passes on `beresp.http.Set-Cookie`, and also on request `Cookie`/`Authorization` in `vcl_recv`.

So: **removing `Set-Cookie` from anonymous responses is a prerequisite, not an optimisation.** See §3.

---

## 2. What Liferay emits by default for a public page — and exactly why

### 2.1 The `Cache-Control` header: `browser.cache.disabled`

The header comes from `ServicePreAction`, which is a `servlet.service.events.pre` lifecycle action that runs on **every** portal request (`portal.properties`):

```properties
servlet.service.events.pre=\
    com.liferay.portal.events.ServicePreAction,\
    com.liferay.portal.events.ThemeServicePreAction
servlet.service.events.post=com.liferay.portal.events.ServicePostAction
```

`portal-impl/src/com/liferay/portal/events/ServicePreAction.java` (~line 928):

```java
boolean signedIn = !user.isGuestUser();

if (PropsValues.BROWSER_CACHE_DISABLED ||
    (PropsValues.BROWSER_CACHE_SIGNED_IN_DISABLED && signedIn)) {

    httpServletResponse.setDateHeader(HttpHeaders.EXPIRES, 0);
    httpServletResponse.setHeader(
        HttpHeaders.CACHE_CONTROL,
        HttpHeaders.CACHE_CONTROL_NO_CACHE_VALUE);
    httpServletResponse.setHeader(
        HttpHeaders.PRAGMA, HttpHeaders.PRAGMA_NO_CACHE_VALUE);
}
```

And `portal-kernel/.../servlet/HttpHeaders.java`:

```java
public static final String CACHE_CONTROL_DEFAULT_VALUE =
    "max-age=315360000, public";

public static final String CACHE_CONTROL_NO_CACHE_VALUE =
    "private, no-cache, no-store, must-revalidate";

public static final String CACHE_CONTROL_PRIVATE_VALUE = "private";
public static final String CACHE_CONTROL_PUBLIC_VALUE  = "public";
public static final String EXPIRES_DEFAULT_VALUE       = "315360000";
public static final String PRAGMA_NO_CACHE_VALUE       = "no-cache";
```

The controlling properties (`portal.properties`, "Browser Cache" section, verbatim):

```properties
    #
    # Set this to true if you want the portal to force the browser cache to be
    # disabled. It will only disable the cache for the rendered HTML response.
    # It will not have an impact on static content or other resources.
    #
    browser.cache.disabled=true

    #
    # Set this true if you want to disable the cache for authenticated users.
    # This property is not read when the property
    # "browser.cache.signed.in.disabled" is true. This is useful to ensure that
    # authenticated users cannot go to the sign in page by clicking on the back
    # button in their browsers.
    #
    browser.cache.signed.in.disabled=true
```

**Non-obvious and important — the default flipped.** I checked the release tags directly:

| Tag | `browser.cache.disabled` | `browser.cache.signed.in.disabled` |
|---|---|---|
| `7.0.6-ga7` | `false` | `false` |
| `7.2.1-ga2` | **`true`** | `true` |
| `7.3.7-ga8` | `true` | `true` |
| `7.4.3.132-ga132` | `true` | `true` |
| `master` (2025/2026) | `true` | `true` |

So **since 7.2, every Liferay HTML response — guest or not — is stamped `private, no-cache, no-store, must-revalidate` + `Pragma: no-cache` + `Expires: 0`.** That is `no-store`: it forbids even writing the bytes down. Nothing downstream will cache it.

**Step 1 of the whole talk:**

```properties
# portal-ext.properties
browser.cache.disabled=false
browser.cache.signed.in.disabled=true
```

This makes Liferay emit **no** `Cache-Control` on guest pages (it does not set a positive one). You then add the positive header yourself — see §2.4. Keep `signed.in.disabled=true` so authenticated pages remain `no-store` (this is a genuine security/BFCache control: it stops "back button after logout" showing private content).

**Impact: CRITICAL. Effort: trivial. Risk: authenticated pages are unaffected as long as you keep the second property `true`.**

### 2.2 The `Set-Cookie` headers on an anonymous request

| Cookie | Set by | Lifetime | Trigger |
|---|---|---|---|
| `JSESSIONID` | Servlet container, because Liferay calls `request.getSession()` | session | **Every** guest request (see §3) |
| `COOKIE_SUPPORT` | `CookiesManagerUtil.addSupportCookie()` from `ServicePreAction` | `Max-Age=31536000` (1 year) | First guest request; controlled by `session.test.cookie.support=true` |
| `GUEST_LANGUAGE_ID` | `LanguageUtil.updateCookie()` via `PortalImpl.setLocale()` | 1 year | Whenever a locale is resolved and `initialize=true` |
| `LFR_SESSION_STATE_<userId>` | `SessionClicks` / session-state JS | session | Documented by Liferay as authenticated-only, but it is written by JS on the client |
| `SERVER_ID` | Liferay Cloud / nginx sticky-session layer (not core) | session | Observed on `learn.liferay.com` and `liferay.dev` |
| `COMPANY_ID`, `ID`, `PASSWORD`, `LOGIN`, `REMEMBER_ME`, `REMEMBER_ME_TOKEN_ID`, `REMEMBER_ME_TOKEN_VALUE`, `USER_UUID` | login/auto-login | varies | Authenticated only |
| `CONSENT_STATE`, `CONSENT_TYPE_NECESSARY|FUNCTIONAL|PERFORMANCE|PERSONALIZATION`, `USER_CONSENT_CONFIGURED` | Cookie Banner app (7.4+) | 1 year | Guest, if cookie banner enabled |

Canonical list of names: `portal-kernel/src/com/liferay/portal/kernel/cookies/constants/CookiesConstants.java`:

```java
public static final String NAME_COOKIE_SUPPORT     = "COOKIE_SUPPORT";
public static final String NAME_GUEST_LANGUAGE_ID  = "GUEST_LANGUAGE_ID";
public static final String NAME_JSESSIONID         = "JSESSIONID";
public static final String NAME_COMPANY_ID         = "COMPANY_ID";
public static final String NAME_CONSENT_STATE      = "CONSENT_STATE";
public static final String NAME_USER_CONSENT_CONFIGURED = "USER_CONSENT_CONFIGURED";
...
public static final int CONSENT_TYPE_NECESSARY = 2;   // FUNCTIONAL=1, PERFORMANCE=3, PERSONALIZATION=4
```

The `COOKIE_SUPPORT` write path, verbatim from `ServicePreAction`:

```java
// Cookie support
try {
    // LEP-4069
    CookiesManagerUtil.validateSupportCookie(httpServletRequest);
}
catch (Exception exception) {
    if (_log.isDebugEnabled()) { _log.debug(exception); }
    CookiesManagerUtil.addSupportCookie(httpServletRequest, httpServletResponse);
}
```

Relevant properties:

```properties
session.test.cookie.support=true          # drives COOKIE_SUPPORT
session.enable.persistent.cookies=true
session.enable.url.with.session.id=false  # keep false! ;jsessionid= in URLs destroys cache keys
session.cookie.domain=
session.cookie.use.full.hostname=false
session.cookie.use.full.hostname[tomcat]=true
session.enable.phishing.protection=true   # invalidates the guest session on login
session.phishing.protected.attributes=...
session.timeout=15
session.timeout.warning=1
session.timeout.redirect.on.expire=false
session.max.allowed=0
session.tracker.memory.enabled=true       # per-session memory tracking; turn OFF for guest-heavy sites
session.tracker.persistence.enabled=false
```

Two notes:
- `session.enable.phishing.protection=true` means the guest session is thrown away and recreated at login. Good security, and it means the guest session genuinely holds nothing worth keeping — which strengthens the argument for suppressing it entirely at the edge.
- `session.tracker.memory.enabled=true` (default) keeps a live-session registry in memory. On a site with millions of anonymous hits each creating a session, this is real heap. Turn it off.

### 2.3 Why the default page is uncacheable — the full causal chain

1. `ServicePreAction` calls `httpServletRequest.getSession()` unconditionally → container mints a session → `Set-Cookie: JSESSIONID`.
2. `ServicePreAction` sees `browser.cache.disabled=true` → `Cache-Control: private, no-cache, no-store, must-revalidate`, `Pragma: no-cache`, `Expires: 0`.
3. `validateSupportCookie` throws on a cookie-less first request → `Set-Cookie: COOKIE_SUPPORT=true; Max-Age=31536000`.
4. Locale resolution may call `setLocale()` → another `getSession()` **and** `Set-Cookie: GUEST_LANGUAGE_ID`.
5. Rendered HTML embeds `Liferay.authToken` — a session-scoped nonce (§4).

Any **one** of (2), (3) or (5) is sufficient to make the response uncacheable or unsafe to share. You have to fix all of them.

### 2.4 How to emit a positive `Cache-Control` on public pages

Liferay has **no product setting for "set Cache-Control on this page"**. The `HeaderFilter` is only wired to static paths. From `liferay-web.xml`:

```xml
<filter>
    <filter-name>Header Filter</filter-name>
    <filter-class>com.liferay.portal.servlet.filters.header.HeaderFilter</filter-class>
    <init-param>
        <param-name>url-regex-ignore-pattern</param-name>
        <param-value>(.+/-/.+|/adaptive-media/.*)</param-value>
    </init-param>
    <init-param><param-name>Cache-Control</param-name>
        <param-value>max-age=315360000, public</param-value></init-param>
    <init-param><param-name>Expires</param-name>
        <param-value>315360000</param-value></init-param>
</filter>
<filter>
    <filter-name>Header Filter - No Cache</filter-name>
    <filter-class>com.liferay.portal.servlet.filters.header.HeaderFilter</filter-class>
    <init-param><param-name>Cache-Control</param-name><param-value>no-cache</param-value></init-param>
    <init-param><param-name>Expires</param-name><param-value>-1</param-value></init-param>
    <init-param><param-name>Pragma</param-name><param-value>no-cache</param-value></init-param>
</filter>
```

`Header Filter` maps only to `/combo/*`, `/image/*`, `/language/*`, `/o/js_bundle_config`, `*.css`, `*.gif`, `*.ico`, `*.jpg`, `*.js`, `*.png`. `Header Filter - No Cache` maps only to `/c/portal/logout`.

So you write your own. **Two supported extension points:**

**Option A — an OSGi servlet filter** (documented pattern, from Liferay Learn "Using Servlet Filters"):

```java
@Component(
    property = {
        "servlet-context-name=",
        "servlet-filter-name=Public Page Cache Header Filter",
        "url-pattern=/web/*",
        "url-pattern=/group/*",
        "after-filter=Absolute Redirects Filter"
    },
    service = Filter.class
)
public class PublicPageCacheHeaderFilter extends BaseFilter {

    @Override
    protected void processFilter(
            HttpServletRequest request, HttpServletResponse response,
            FilterChain chain)
        throws Exception {

        chain.doFilter(request, response);

        // Only anonymous GETs, no query string, HTML only.
        if (!"GET".equals(request.getMethod())) return;
        if (request.getQueryString() != null) return;
        if (PortalUtil.getUserId(request) > 0) return;      // guest only
        String ct = response.getContentType();
        if (ct == null || !ct.startsWith("text/html")) return;

        response.setHeader("Cache-Control",     "public, max-age=60");
        response.setHeader("CDN-Cache-Control", "public, max-age=600, stale-while-revalidate=86400, stale-if-error=604800");
        response.setHeader("Surrogate-Control", "max-age=600, stale-while-revalidate=86400");
        response.setHeader("Surrogate-Key",     buildSurrogateKeys(request));
        response.setHeader("Vary",              "Accept-Encoding");
        response.setHeader("Pragma",            "");   // clear Liferay's
        response.setDateHeader("Expires",       System.currentTimeMillis() + 60_000L);
    }
}
```

**Option B — a `servlet.service.events.pre` `LifecycleAction`** (runs alongside `ServicePreAction`; useful if you need `ThemeDisplay`):

```java
@Component(
    immediate = true,
    property = "key=" + PropsKeys.SERVLET_SERVICE_EVENTS_PRE,
    service = LifecycleAction.class
)
public class CacheHeaderPreAction implements LifecycleAction {
    @Override
    public void processLifecycleEvent(LifecycleEvent lifecycleEvent)
        throws ActionException { /* ... */ }
}
```

Caveat: `ServicePreAction` may run *after* yours and overwrite the header. Prefer Option A (post-`chain.doFilter`) — last writer wins — or set `browser.cache.disabled=false` so `ServicePreAction` never touches it at all. **Do both.**

**Option C — do it entirely at the reverse proxy / CDN.** Strip `Set-Cookie`, force `Cache-Control` in VCL / a Cloudflare Cache Rule / an nginx `proxy_hide_header` + `add_header`. Pros: no Liferay code, works across upgrades, and you can be surgical per-path. Cons: two places to reason about; origin still does all the cookie/session work.

**Impact: CRITICAL. Effort: LOW–MEDIUM. My recommendation: Option A + `browser.cache.disabled=false`, plus a belt-and-braces `Set-Cookie` strip at the edge.**

### 2.5 The bit Liferay removed: `CacheFilter`

Liferay used to ship a **built-in full-page HTML cache for guests**, enabled by default:

```properties
# 7.3.7-ga8 portal.properties
    #
    # The cache filter caches processed web content. See ehcache.xml to modify
    # the cache expiration time to live.
    #
    com.liferay.portal.servlet.filters.cache.CacheFilter=true
```

Its cache key (from the 5.2 source, logic unchanged in principle through 7.3):

```java
sb.append(HttpUtil.getProtocol(request));
sb.append("://");
sb.append(request.getServletPath());
sb.append(request.getPathInfo());
sb.append(StringPool.QUESTION);
sb.append(request.getQueryString());
sb.append(StringPool.POUND);
sb.append(LanguageUtil.getLanguageId(request));
sb.append(StringPool.POUND);
sb.append(getBrowserType(request));      // IE7 / IE / other
sb.append(StringPool.POUND);
sb.append(BrowserSnifferUtil.acceptsGzip(request));
```

Conditions to cache: guest user only (`userId <= 0` and no `remoteUser`), no `p_p_id` parameter, not a servlet include, valid `p_l_id`, and **every portlet on the layout must declare `<layout-cacheable>true</layout-cacheable>`**.

**I verified with direct HTTP HEADs against the raw GitHub tree: `portal-impl/src/com/liferay/portal/servlet/filters/cache/CacheFilter.java` returns 200 at `7.3.7-ga8`, `7.4.0-ga1`, `7.4.1-ga2`, `7.4.2-ga3`, `7.4.3.4-ga4` and `7.4.3.122-ga122`, and 404 at `7.4.3.123-ga123` and at `master`.** The property is present at `7.4.0-ga1` and gone from `portal.properties` at `7.4.3.123-ga123`.

**This removal is not listed in Liferay's official 7.4 Breaking Changes page.** I searched it; the only cache entry is the unrelated `LPS-174415` "No Cache option for DM file downloads". The one trace is a "Removed property" row on the 2024.Q1 Default Setting page. So: Liferay quietly deleted its only server-side anonymous page cache in June 2024, late in the 7.4 line, and there is no replacement. The `<layout-cacheable>` element still exists in `definitions/liferay-portlet-app_7_4_0.dtd` as a now-vestigial descriptor:

> "Set the layout-cacheable flag to true if the data contained in this portlet can will never change unless the layout or Journal portlet entry is changed."

**Talk framing: "Liferay deleted its own guest page cache in 2024, after finding it never got a hit in their tests. The edge is what's left."**

---

## 3. Killing the session for anonymous traffic — the honest answer

### 3.1 Is there a supported way? **No.**

Liferay's own KB says it flatly:

> "A user always has a session, regardless of whether they are not yet logged in, actually logged in, or have logged out."
> — *Remove extend_session for Guest users*, learn.liferay.com

The mechanism, in `ServicePreAction` (line ~912), unconditional, no guard, no property:

```java
HttpSession httpSession = httpServletRequest.getSession();
```

Also `PortalImpl.setLocale()`:

```java
protected void setLocale(
    HttpServletRequest httpServletRequest,
    HttpServletResponse httpServletResponse, Locale locale) {

    HttpSession httpSession = httpServletRequest.getSession();   // creates it
    httpSession.setAttribute(WebKeys.LOCALE, locale);
    LanguageUtil.updateCookie(httpServletRequest, httpServletResponse, locale);
}
```

and `_rememberVisitedGroupIds()`, and `SessionAuthToken._getSessionAuthenticationToken()` (§4). Session creation is woven through the request lifecycle.

### 3.2 `session.disabled` — it existed, and it's gone

There **was** a property. Verbatim from `6.2.5-ga6` / `7.0.6-ga7` `portal.properties`:

```properties
    # Set this to true to disable sessions. Doing this will use cookies to
    # remember the user across requests. This is useful if you want to scale
    # very large sites where the user may be sent to a different server for each
    # request. The drawback to this approach is that you must not rely on the
    # API for sessions provided by the servlet and portlet specs.
    #
    # This feature is only available for Tomcat and requires that you set
    # Tomcat's Manager class to
    # "com.liferay.support.tomcat.session.SessionLessManagerBase".
    #
    # Setting this to true will forcibly set "layout.ajax.render.enable" to
    # false since ajax rendering requires sessions to be enabled.
    #
    session.disabled=false
```

Presence by tag (verified by grep against raw sources):

| 6.1.2 | 6.2.5 | 7.0.6 | 7.1.3 | 7.2.1 | 7.3.7 | 7.4.1 | master |
|---|---|---|---|---|---|---|---|
| ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |

Mika Koivisto (Liferay) on the community forum:

> "If you run Liferay as stateless it means no session info is stored at all except the cookies required to identify the user."

**So the answer for DXP 2025.Q1+ is: the supported switch was deleted in 7.4 and never replaced.** Say this on stage. It's the single most useful honest fact in the whole deck.

### 3.3 What people actually do — ranked workarounds

**W1 — Strip `Set-Cookie` at the edge for anonymous GETs. (The pragmatic winner.)**

The session still gets created at origin (you pay the memory), but the *client* never receives a cookie, so:
- the CDN will cache the response (no `Set-Cookie` → Fastly/Cloudflare/Varnish all cache it);
- the visitor never gets a session identity, so their *next* request also has no cookie and is also a cache hit;
- signed-in users are unaffected because you only strip on requests that arrived with no session cookie.

Varnish sketch:

```vcl
sub vcl_recv {
    # never cache the portal's action/admin surface
    if (req.url ~ "^/c/" || req.url ~ "^/api/" || req.url ~ "^/o/(?!.*\.(js|css|png|jpg|svg|woff2))"
        || req.url ~ "/control_panel/" || req.url ~ "^/documents/") {
        return (pass);
    }
    if (req.method != "GET" && req.method != "HEAD") { return (pass); }

    # Authenticated? -> bypass entirely.
    if (req.http.Cookie ~ "(^|;\s*)(COMPANY_ID|ID|USER_UUID|REMEMBER_ME)=") {
        return (pass);
    }

    # Anonymous: drop ALL cookies before hashing / before the backend sees them.
    unset req.http.Cookie;
    return (hash);
}

sub vcl_backend_response {
    if (bereq.http.X-Anon == "1") {
        unset beresp.http.Set-Cookie;          # <-- the money line
        unset beresp.http.Pragma;
        set beresp.http.Cache-Control = "public, max-age=60";
        set beresp.ttl        = 600s;
        set beresp.grace      = 86400s;        # stale-while-revalidate / stale-if-error
        set beresp.keep       = 604800s;
    }
}
```

Cloudflare equivalent: a Cache Rule with *Eligible for cache* + *Edge TTL: Ignore cache-control, 600s* + *Browser TTL 60s* + *Bypass cache on cookie: `COMPANY_ID|ID|USER_UUID|REMEMBER_ME`*, plus a Transform Rule removing `Set-Cookie` on the response. Note Cloudflare's documented BYPASS triggers include `Set-Cookie` on the response and `Cache-Control: private|no-store` — so you must override both.

Trade-off: `COOKIE_SUPPORT` never reaches the browser, so `session.test.cookie.support`'s "does this browser take cookies?" probe silently always fails for cached visitors. Set `session.test.cookie.support=false` to stop the pointless work. Also: any guest-facing feature that genuinely needs session continuity (multi-step forms, cart, wizard) must be excluded by path.

**Impact: CRITICAL. Effort: MEDIUM. This is the single highest-leverage change in the entire talk.**

**W2 — A servlet filter that wraps the request so `getSession()` returns a throwaway.**
Wrap `HttpServletRequest` in an `HttpServletRequestWrapper` whose `getSession(boolean)` returns a lightweight non-persisting `HttpSession` for anonymous GETs on cacheable paths. This is what `SessionLessManagerBase` did at the Tomcat level. **Community territory, unsupported, and it will break in interesting ways** — `SessionAuthToken` writes to the session, `SessionClicks` reads it, `SessionMessages`/`SessionErrors` use it, and portlets with `<private-session-attributes>` expect it. Only attempt this if you have narrowly scoped paths and good test coverage.

**W3 — Tomcat-level: set the session timeout for guests very low.**
`session.timeout=15` (default, minutes) × millions of anonymous sessions = heap. If you cannot do W1, cutting `session.timeout` to 2–5 minutes and disabling `session.tracker.memory.enabled` reclaims a lot. Doesn't help cacheability at all, but helps the origin survive.

**W4 — Kill guest session-extension polling.**
Verbatim from the guest HTML of `liferay.dev` (a real, live guest page):

```html
<script type="module">
  import {Session} from '/o/frontend-js-web/__liferay__/legacy.js';
  Liferay.Session = new Session({
      autoExtend: true,
      redirectOnExpire: false,
      redirectUrl: 'https://liferay.dev/web/guest',
      rememberMe: false,
      sessionLength: 900,
      sessionTimeoutOffset: 300,
      warningLength: 60
  })
</script>
```

Every anonymous browser tab is keeping a server-side session alive by polling `/c/portal/extend_session`. On a high-traffic public site this is a meaningful, entirely wasted origin load.

Configuration has moved: `session.timeout.auto.extend`, `session.timeout`, `session.timeout.warning`, `session.timeout.auto.extend.offset` were present in `portal.properties` through `7.3.7-ga8` and are **absent from 7.4+/master** — they were modularized into `com.liferay.frontend.js.web` as `auto-extend` (per Liferay's own error message and their blog "Session Auto-Extend Properties are now in Configuration", from Portal GA104 / DXP 2024.Q1). Configure it in System Settings / Instance Settings / Site Configuration, or via a `.config` file. Liferay's KB on removing it for guests specifically says:

> "Liferay does not recommend to make this change."

…but if you cache guest pages at the edge, the *cached* HTML contains that script and every visitor runs it. **Either turn auto-extend off, or strip the script from the cached variant at the edge.**

**Impact: HIGH (origin load). Effort: LOW.**

---

## 4. CSRF, `p_auth`, and per-request nonces embedded in HTML

### 4.1 Where the nonces are

Real, verbatim, from a live guest page render of `liferay.dev`:

```js
authToken: 'NuPIEFWX',
currentURL: '\x2f',
currentURLEncoded: '\x252F',
```

and elsewhere in the same document, inside the cookie-banner config JSON:

```
..._CookiesBannerConfigurationPortlet_mvcPath=%2Fcookies_banner_configuration%2Fview.jsp&p_p_auth=aEnVkYzK
```

Eight characters each — matching `auth.token.length=8`.

`www.liferay.com`, the **publicly cached** page, contains `authToken: 'BlVenqFr'`. That token belongs to whichever unlucky session populated the cache hours ago. It is served identically to every visitor on Earth for the life of the cache entry.

### 4.2 How the token works

`portal-impl/src/com/liferay/portal/security/auth/SessionAuthToken.java`:

```java
@Override
public void addCSRFToken(
    HttpServletRequest httpServletRequest, LiferayPortletURL liferayPortletURL) {

    if (!PropsValues.AUTH_TOKEN_CHECK_ENABLED) { return; }

    String lifecycle = liferayPortletURL.getLifecycle();

    if (!lifecycle.equals(PortletRequest.ACTION_PHASE) ||
        AuthTokenWhitelistUtil.isPortletURLCSRFWhitelisted(liferayPortletURL)) {
        return;
    }

    liferayPortletURL.setParameter("p_auth", getToken(httpServletRequest));
}
```

Generation and storage:

```java
if (createToken && ((sessionAuthenticationToken == null) ||
                    (sessionAuthenticationToken == _NULL_TOKEN))) {
    sessionAuthenticationToken = PwdGenerator.getPassword(PropsValues.AUTH_TOKEN_LENGTH);
    httpSession.setAttribute(authenticationTokenKey, sessionAuthenticationToken);
}
```

Validation:

```java
String csrfToken = ParamUtil.getString(httpServletRequest, "p_auth");

if (Validator.isNull(csrfToken)) {
    csrfToken = GetterUtil.getString(httpServletRequest.getHeader("X-CSRF-Token"));
}

if (!csrfToken.equals(sessionToken)) {
    throw new PrincipalException.MustHaveValidCSRFToken(
        PortalUtil.getUserId(httpServletRequest), origin);
}
```

Key facts:
- The token is a **random 8-char string stored as an `HttpSession` attribute** keyed `WebKeys.AUTHENTICATION_TOKEN + "#CSRF"`.
- Reading it calls `getSession()` — **generating a page URL is itself a session-creating act.**
- **`p_auth` is only added to `ACTION_PHASE` portlet URLs.** Render URLs and resource URLs never carry it. Liferay's KB "CSRF (p_auth) token is not included in portlet ResourceURLs" confirms this is deliberate: "`serveResource` … should focus on nothing else than serving resources. Actions that may trigger changes on the server side should be implemented in `processAction`."
- **`p_p_auth`** (a *different* token, the portlet-invocation token) is added by `addPortletInvocationToken()` only when `portlet.add.default.resource.check.enabled=true` **and** the portlet is *not already on the layout*. If the portlet is on the page, `_setNullSessionAuthenticationToken()` runs and no token is emitted. That's why the only `p_p_auth` on `liferay.dev`'s homepage belongs to the cookie-banner *configuration* portlet.
- **`X-CSRF-Token` request header is accepted as an alternative to the `p_auth` parameter.** This is the load-bearing fact for the whole mitigation strategy (added in LPS-98655, which extended Liferay's `fetch` utility to set `x-csrf-token` by default).

Relevant properties:

```properties
auth.token.check.enabled=true
#auth.token.impl=com.liferay.portal.security.auth.SessionAuthToken
auth.token.length=8
auth.token.ignore.actions=/asset/rss,/blogs/rss,/document_library/...,/login/create_account,/message_boards/rss,/portal/comment/get_comments
auth.token.ignore.portlets=
#auth.token.ignore.origins=...
#auth.token.shared.secret=
portlet.add.default.resource.check.enabled=true
portlet.add.default.resource.check.whitelist=...
```

### 4.3 Why this makes shared HTML caching dangerous

Three distinct failure modes, in increasing severity:

1. **Broken functionality (common, benign).** A cached page carries a stale `authToken`. A guest clicks something that POSTs with it → `PrincipalException.MustHaveValidCSRFToken` → a 403 / error page. Symptom: "the contact form works when I'm logged in and fails for visitors." This is what `www.liferay.com` is living with; they've evidently designed their public pages to not depend on it.
2. **Session-fixation-flavoured weirdness.** If you *also* cache `Set-Cookie: JSESSIONID`, every visitor shares one session. **Never cache `Set-Cookie`.** This is the reason W1 in §3.3 strips it rather than caching it.
3. **Token leakage.** `p_auth` in a URL leaks via `Referer`, browser history, and access logs. Liferay's own KB "Why is `p_p_auth` token exposed in the URL? Could it be a security risk?" addresses this; it's a pre-existing concern that edge caching amplifies because the token is now long-lived and widely distributed.

### 4.4 Mitigations, ranked

**M1 — Design public pages so no cached markup carries a live token. (Best.)**
Audit: does any guest-reachable widget emit an `ActionURL`? Search, newsletter signup, comments, ratings, "add to favourites". Replace each with either (a) a plain HTML form POSTing to a purpose-built endpoint that does its own CSRF with a freshly minted token, or (b) a JS component that fetches its token at runtime (M2).
**Impact: HIGH. Effort: MEDIUM (per-widget audit).**

**M2 — Lazy token fetch via JS + `X-CSRF-Token`.**
Serve the cacheable page with a placeholder. On load, one tiny uncached request returns the current session's token; JS injects it into `Liferay.authToken` and thereafter all `Liferay.Util.fetch` calls carry `X-CSRF-Token` automatically.

```js
// runs on the cached page
const r = await fetch('/o/site-chrome/v1/context', {credentials: 'include'});
const ctx = await r.json();          // { signedIn, name, authToken }
Liferay.authToken = ctx.authToken;
```

The endpoint must be `Cache-Control: private, no-store` and should be a purpose-built, cheap REST/Object endpoint — *not* a full portlet render. Note that fetching the token is what creates the session, so this reintroduces `JSESSIONID` on the second request. That's fine: the *page* stays cacheable; only the small JSON is personal. Combine with the §5 chrome hydration — one round trip does both jobs.
**Impact: HIGH. Effort: MEDIUM. Trade-off: one extra RTT before interactive; make it non-blocking.**

**M3 — Strip / rewrite the token at the edge.**
A Cloudflare Worker `HTMLRewriter` or Fastly/VCL regex that blanks `authToken: '........'` in the cached copy. Cheap, but it's string surgery on markup you don't control — brittle across upgrades.
**Impact: MEDIUM. Effort: LOW. Fragility: HIGH.**

**M4 — `auth.token.check.enabled=false`. Do not do this.**
`portal.properties` says it plainly: *"Disabling CSRF protection is not recommended since all features become vulnerable to CSRF attacks."* It's a global kill switch for the whole portal, including the admin UI. If you need per-case relief, use the surgical properties instead: `auth.token.ignore.actions`, `auth.token.ignore.portlets`, `auth.token.ignore.origins`, or the `check-auth-token` init-param in `portlet.xml`.
**Impact: HIGH (negatively). Effort: trivial. Recommendation: never.**

**M5 — `auth.token.shared.secret` / `p_auth_secret`.**
Exists for cases where a token can't be generated (WSRP). `AuthTokenWhitelistUtil.isValidSharedSecret(sharedSecret)` short-circuits the check. It's a static secret in your markup if you use it for this purpose — i.e. a permanent CSRF bypass. Mention it for completeness; recommend against.

---

## 5. Personalization vs cache

### 5.1 What Liferay does per request

- **Segments / Experiences**: an evaluated, server-side, per-request decision. Liferay docs: *"When a user meets the criteria for more than one Experience, the Experience listed first is the active one."* And critically for us: *"you can create different experiences for those who log in and for those who browse anonymously"* — an **Anonymous User** segment is a first-class, documented pattern.
- **Sign-in chrome**: `Liferay.ThemeDisplay.isSignedIn()` is baked into the HTML at render time. On the `liferay.dev` guest page: `isSignedIn: () => false`, `getUserId: () => '5'` (the guest user id).
- **Audience Targeting** (the old 7.0/7.1 app, superseded by Segments) similarly branched server-side.

**The structural insight for the talk: every server-side personalization dimension is a dimension of your cache key.** A page with 1 anonymous segment × 1 experience is one cache object. A page with 6 behavioural segments is six objects that will each be cold most of the time — and worse, the *decision* requires session/behaviour state you just spent §3 trying to eliminate.

### 5.2 The five patterns

| Pattern | How | Cacheability | Cost |
|---|---|---|---|
| **P1. Two-tier: "anonymous baseline" + hydrate** | Render the anonymous Experience only; a small uncached JSON call fills in user chrome | **Perfect** — 1 object per URL | 1 extra RTT; CLS/flicker risk |
| **P2. Segment in the cache key** | Edge computes a low-cardinality `X-Segment` from cookie/geo, forwards it, `Vary: X-Segment` | Good if ≤ ~5 values | Hit ratio ÷ N; segment must be edge-derivable |
| **P3. ESI / hole punching** | Page is `<esi:include src="/fragments/user-chrome"/>`; edge assembles | Excellent — outer shell cached long, hole cached 0 s | Needs Varnish/Fastly/Akamai; Liferay emits no ESI natively |
| **P4. Cloudflare Workers `HTMLRewriter`** | Streaming HTML transform at the edge injects personal bits | Excellent | Vendor lock-in; JS at the edge to maintain |
| **P5. No personalization on public pages** | Move the personal surface behind `/my/` | Perfect | Product decision, not a technical one |

### 5.3 P1 in detail — the recommended default

**Server side.** One purpose-built endpoint, guest-accessible, tiny, always uncached. Liferay Learn documents guest access to headless REST via **Service Access Policy** (Global Menu → Control Panel → Security → Service Access Policy → enable **Default** so the policy "appl[ies] to unauthenticated requests as well as authenticated requests", then add the method signature in Advanced Mode, e.g. `com.liferay.headless.admin.user.internal.resource.v1_0.SiteResourceImpl#getSite`).

Measured against `liferay.dev`, the built-in `/o/headless-admin-user/v1.0/my-user-account` already behaves correctly for this purpose:

```http
HTTP/2 200
content-type: application/json
content-length: 2346
cache-control: no-cache, no-store
set-cookie: JSESSIONID=...; Path=/; Secure; HttpOnly
```

2.3 KB, correctly `no-store`. But it's generic; build your own returning exactly `{signedIn, displayName, avatarUrl, notificationCount, authToken}` and nothing else.

**Client side — avoiding CLS.** This is where these implementations go wrong:

```html
<!-- Reserve the exact box. min-height + a skeleton, NOT an empty div. -->
<div id="user-chrome" style="min-height:40px;width:180px" aria-busy="true">
  <span class="skeleton"></span>
</div>
```

- Reserve identical dimensions for both states (signed-out "Sign In" button and signed-in avatar+name).
- Fire the fetch from `<head>` (or a `<link rel="preconnect">` + early inline fetch) so it overlaps with CSS/JS loading rather than starting after.
- Never `display:none` → `display:block`; use `visibility`/opacity within a reserved box.
- Consider `Speculation Rules` / `<link rel="prefetch">` for the hydration endpoint.

**Trade-offs, stated honestly for the audience:**
- **CLS** — solvable with reserved space, but only if design cooperates (variable-length usernames are the enemy).
- **Flicker** — a signed-in user sees "Sign In" for 80–200 ms. Some organisations will not accept this on a portal homepage. Mitigation: write a *non-sensitive* boolean cookie (`lfr_hint=1`) at login and read it with a tiny inline script to pre-set the correct skeleton. The cookie carries no identity, so it needn't bust the cache — but you must ensure the edge doesn't `Vary` on it.
- **Extra RTT** — ~30–80 ms on a warm connection. Against a TTFB improvement of hundreds of ms, this is a clear net win.
- **Accessibility** — announce the change with `aria-busy` / `aria-live="polite"`.

**Impact: HIGH. Effort: MEDIUM. This is the pattern to lead with.**

### 5.4 P3 — ESI

Nobody in the Liferay ecosystem is doing this out of the box: **Liferay does not emit ESI tags.** You must produce them yourself from a theme/fragment, and your edge must process them.

- **Varnish** supports ESI natively (`set beresp.do_esi = true;`). Varnish *Enterprise* additionally processes ESI subrequests **in parallel** rather than serially, which matters a lot for a portal page with several holes.
- **Fastly / Akamai** support ESI 1.0.
- **Cloudflare** has no native ESI; you need a Worker. Cloudflare's own blog "Using Edge Side Includes with Workers for High Availability" and the community `upscalesoftware/cloudflare-esi` Worker are the reference implementations.
- Varnish Enterprise also offers **Edgestash** (mustache templating at the edge fed by a JSON endpoint) and **xbody**, which are effectively a nicer ESI for exactly the "personalized content identified by session tokens" case — Varnish Software markets this specifically for Liferay.

Trade-off: ESI is genuinely powerful (outer shell cached for hours, header hole cached for 0 s, both assembled server-side so **no CLS and no flicker**), but it puts template logic in your CDN, it's hard to test locally, and a slow hole blocks the whole response unless your edge parallelises.

**Impact: HIGH. Effort: HIGH. Best fit: you already run Varnish Enterprise or Fastly and have a platform team.**

---

## 6. Cache invalidation on publish

Liferay has **no built-in CDN purge**. Everything below is something you build. Liferay Cloud's only documented control is a manual, whole-CDN wipe:

> Navigate to Network → "Clear CDN Cache…" → "Request Cache Clearance". "Allow up to 30 minutes for the cache to be cleared."

30 minutes and all-or-nothing is not an editorial workflow. Build one of these.

### 6.1 Hook 1 — `ModelListener` (the workhorse)

Fires inside the persistence layer on create/update/remove of any Liferay model. Register per model class.

```java
@Component(service = ModelListener.class)
public class JournalArticlePurgeModelListener
    extends BaseModelListener<JournalArticle> {

    @Override
    public void onAfterUpdate(JournalArticle original, JournalArticle article) {
        _purge(article);
    }

    @Override
    public void onAfterCreate(JournalArticle article) { _purge(article); }

    @Override
    public void onAfterRemove(JournalArticle article) { _purge(article); }

    private void _purge(JournalArticle article) {
        // Only purge on an approved, live version.
        if (article.getStatus() != WorkflowConstants.STATUS_APPROVED) return;

        // Surrogate keys are far better than URL lists: you rarely know
        // every page that renders this article.
        String key = "wc-" + article.getResourcePrimKey();

        // Run OUT of the transaction, or you will purge a version
        // that has not been committed yet.
        TransactionCommitCallbackUtil.registerCallback(() -> {
            _cdnPurgeClient.purgeBySurrogateKey(key);   // your HTTP client
            return null;
        });
    }

    @Reference private CdnPurgeClient _cdnPurgeClient;
}
```

Models worth listening to: `JournalArticle` (web content), `Layout` (page structure/friendly URL), `LayoutSet` (theme, look-and-feel), `FileEntry`/`DLFileEntry` (D&M), `AssetEntry`, `Fragment*` (page fragments), `SegmentsEntry`, plus your Objects. Liferay Learn's "Creating a Model Listener" covers `BaseModelListener<T>` and the `@Component(service = ModelListener.class)` registration; it demonstrates `onBeforeRemove` and notes `BaseModelListener` "provides default, empty implementation for each of `ModelListener`'s methods".

**Two traps I'd put on a slide:**
1. **Transaction ordering.** `onAfterUpdate` runs inside the transaction. Purge there and the CDN can re-fetch the *old* content and re-cache it before your commit lands — a classic purge/publish race. Always defer with `TransactionCommitCallbackUtil.registerCallback(...)`.
2. **Cluster storms.** A model listener fires on every node. Either purge from one node (use a message-bus destination with a single consumer) or make purge idempotent and accept N× API calls.

**Impact: HIGH. Effort: MEDIUM.**

### 6.2 Hook 2 — Export/Import & Staging lifecycle (for "Publish to Live")

If the site uses Staging, content changes on Live arrive as a *publication*, not as individual model updates in the request thread. The right hook is `ExportImportLifecycleListener`:

```java
public interface ExportImportLifecycleListener {
    public boolean isParallel();
    public void onExportImportLifecycleEvent(ExportImportLifecycleEvent event)
        throws Exception;
}
```

Register as `@Component(service = ExportImportLifecycleListener.class)`, typically extending `BaseExportImportLifecycleListener`, and react to the "layout/portlet import process succeeded" event codes (`ExportImportLifecycleConstants.EVENT_*` / `PROCESS_*`). Liferay's own `LoggerExportImportLifecycleListener` is the reference implementation. There is also a message-bus route:

```java
// portal-kernel/.../messaging/DestinationNames.java
public static final String EXPORT_IMPORT_LIFECYCLE_EVENT_SYNC  = "liferay/export_import_lifecycle_event_sync";
public static final String EXPORT_IMPORT_LIFECYCLE_EVENT_ASYNC = "liferay/export_import_lifecycle_event_async";
public static final String LAYOUTS_LOCAL_PUBLISHER  = "liferay/layouts_local_publisher";
public static final String LAYOUTS_REMOTE_PUBLISHER = "liferay/layouts_remote_publisher";
public static final String BACKGROUND_TASK          = "liferay/background_task";
public static final String BACKGROUND_TASK_STATUS   = "liferay/background_task_status";
```

Purging on "publication succeeded" is the *correct* granularity for staged sites: one purge per publication rather than hundreds per article.

**Honest gap:** for **Publications** (the change-tracking replacement for Staging, `com.liferay.change.tracking`, `CTCollection`/`CTProcess`), I could not find documented public listener API for "publication published". The workaround people use is a `ModelListener` on `CTProcess`, or subscribing to `DestinationNames.BACKGROUND_TASK_STATUS` and filtering. **Say this is undocumented on stage — it's exactly the kind of thing an audience will thank you for.**

**Impact: HIGH for staged sites. Effort: MEDIUM.**

### 6.3 Hook 3 — Workflow

If web content goes through a workflow, hook the transition to `approved`. A `WorkflowStatusManager`/`WorkflowHandler` wrapper or a scripted action in the Kaleo definition can call your purge endpoint directly. This gives you the semantically right trigger ("editorially live"), not the mechanically right one ("row updated").

### 6.4 Hook 4 — Objects, Object Actions & Webhooks (DXP 2025+)

Liferay 7.4+/2025 Objects support **Actions** with trigger conditions (`onAfterAdd`, `onAfterUpdate`, `onAfterDelete`, plus standalone/scheduled) and action types including **Webhook** — a no-code outbound HTTP POST with a configurable URL and shared secret. Liferay's Camunda integration doc uses exactly this: "you can use a form submission to kick off a workflow process."

**The catch, stated plainly:** webhook/Object Actions are **Object-scoped**. There is no low-code webhook for `JournalArticle`, `Layout`, or `DLFileEntry`. Liferay's documentation does not cover triggering webhooks from non-Object entities.

So: if your content model is Objects, you get purge-on-publish with zero Java. If it's classic Web Content, you write the `ModelListener` in §6.1.

**Impact: HIGH (Objects only). Effort: LOW (Objects) / N/A (Web Content).**

### 6.5 Purge mechanics — do it by tag, not by URL

- **Fastly**: `Surrogate-Key` on the response + `POST /service/<sid>/purge/<key>`. Use **soft purge** (`Fastly-Soft-Purge: 1`) so the object is marked stale rather than evicted — combined with `stale-while-revalidate` this means **zero origin thundering herd**: the first request after purge still gets an instant stale response while one background fetch refreshes it. This is the single best invalidation primitive available and worth a slide of its own.
- **Cloudflare**: Cache Tags (Enterprise) or purge-by-URL / purge-by-prefix.
- **Varnish**: `ban` with a regex, or the `ykey` VMOD for tag purging (Enterprise). Varnish Software specifically calls out "Ykey VMOD for tag objects to enable fast purging" and "Hard and Soft Purge" for Liferay deployments.

Emit keys generously from Liferay: `site-<groupId>`, `layout-<plid>`, `wc-<resourcePrimKey>`, `structure-<ddmStructureKey>`, `all-pages`. Then a structure change purges everything derived from it in one call.

---

## 7. Query-string and URL hygiene

### 7.1 Third-party tracking parameters

`?utm_source=…`, `?fbclid=…`, `?gclid=…`, `?msclkid=…`, `?mc_cid=…`, `?_ga=…`, **`?_gl=…`** (Google's cross-domain linker — high-cardinality and very common if you run GA4 across subdomains) each produce a distinct cache object for identical HTML. One well-shared newsletter can produce thousands of cache misses for one page.

**Fix at the edge (not in Liferay):** normalise the cache key by removing these params, while still forwarding the original URL to the client so analytics works.

```vcl
sub vcl_recv {
    set req.url = querystring.regfilter(req.url,
        "^(utm_|fbclid|gclid|msclkid|mc_|_ga|_gl|igshid|ttclid|li_fat_id)");
    set req.url = querystring.sort(req.url);   # ?b=2&a=1 == ?a=1&b=2
    if (req.url ~ "\?$") { set req.url = regsub(req.url, "\?$", ""); }
}
```

Cloudflare: Cache Rules → "Custom cache key" → Query string → **Ignore** the tracking params (or Include only an allow-list — safer, since a new tracker appears every quarter). **Prefer allow-listing.**

**Impact: HIGH (hit ratio). Effort: LOW.** This is the best ratio in the entire brief.

### 7.2 Liferay's own parameters

Observed on a real guest page render: `p_p_id`, `p_p_lifecycle`, `p_p_state`, `p_p_mode`, `p_p_auth`, `p_l_id`, `p_l_mode`. Also in the wild: `p_p_col_id`, `p_p_col_pos`, `p_p_col_count`, `p_p_isolated`, `p_v_l_s_g_id`, `p_r_p_*`, `refererPlid`, `doAsUserId`, `doAsGroupId`, `redirect`, `saveLastPath`, `browserId`, `cdn_enabled`, `themePreview`, `_gl`.

Guidance:
- **Do not cache any URL bearing `p_p_lifecycle=1`** (action phase) or `p_auth`/`p_p_auth`. Bypass.
- `p_p_state=maximized|normal|exclusive|pop_up` legitimately changes output — **include** in the cache key, or just bypass anything with `p_p_id` at all (which is what the old `CacheFilter` did: "no `p_p_id` parameter" was a hard precondition).
- `browserId` — Liferay puts a UA-derived token into combo/asset URLs (`/combo?browserId=other&minifierType=js&languageId=en_US&t=1786325030571&…`). It's part of the *URL*, so it's a normal cache key component and harmless; the point for the talk is that it is Liferay's way of avoiding `Vary: User-Agent`. That's the right pattern — **push variance into the URL, never into `Vary`.**
- The `t=<timestamp>` in combo URLs is a build fingerprint: those URLs are safe to cache with `max-age=31536000, immutable`.
- `cdn_enabled=0` is a documented runtime kill switch for `cdn.host.http`/`cdn.host.https`. Never let it into a cache key.

### 7.3 Friendly URLs, `/web/guest`, and trailing slashes

```properties
layout.friendly.url.private.group.servlet.mapping=/group
layout.friendly.url.private.user.servlet.mapping=/user
layout.friendly.url.public.servlet.mapping=/web
layout.friendly.url.public.servlet.mapping.enabled=true
#layout.friendly.url.page.not.found=/html/portal/404.html
layout.friendly.url.keywords=_vti_*,a,api*,c,combo,delegate,dtd,elqNow,facebook,...
```

Setting `layout.friendly.url.public.servlet.mapping.enabled=false` drops the `/web` prefix from portal-generated URLs (`/guest/home` instead of `/web/guest/home`). Verbatim from `portal.properties`:

> "Set this to false to exclude the value of the property `layout.friendly.url.public.servlet.mapping` from portal-generated friendly URLs for public pages. For example, instead of `http://www.liferay.com/web/guest/home` the URL will be `http://www.liferay.com/guest/home`."

**Caution:** it changes generated URLs; it does **not** stop the old ones from resolving. So you now have two live URLs for the same page — worse for cache, worse for SEO. The community fix (documented in Jörg Wukonig's Liferay SEO writeup) is to actively **404 or 301** `/web/`, `/group/`, `/c/portal/`, and `/control_panel/` at the proxy. He also reports finding `inurl:web site:domain.com` results in Google — i.e. real production sites do have this duplicate-index problem.

**Normalise at the edge, once, in one place:**
1. Force one host (`www` or apex) — 301 the other.
2. Force HTTPS.
3. Force one trailing-slash convention — 301 the other. `/page` and `/page/` are **two cache objects** and two SEO documents.
4. Lowercase the path (Liferay friendly URLs are lowercase by convention).
5. Collapse duplicate slashes.
6. 301 `/web/guest/x` → `/x` if you've enabled the short form.

Then set `<link rel="canonical">`. **Note: I checked the rendered `liferay.dev` homepage and found no `<link rel="canonical">` and no `hreflang` `<link rel="alternate">` tags.** Liferay has site-level "Configuring Friendly URL Redirects", "Configuring XML Sitemaps" and "Configuring Hreflang Meta Data" features — they are opt-in and evidently not on by default.

### 7.4 Locale: cookie vs URL — the single biggest correctness risk

The full server-side precedence, read directly out of `PortalImpl.getLocale()`:

1. `WebKeys.I18N_LANGUAGE_ID` request attribute — set by the I18n servlet from a **URL prefix** (`/en/`, `/zh_CN/`)
2. `doAsUserLanguageId` request parameter
3. `HttpSession` attribute `WebKeys.LOCALE`
4. The authenticated user's locale
5. **The `GUEST_LANGUAGE_ID` cookie**
6. `Accept-Language`, **only if** `locale.default.request=true`
7. The site (Group) `languageId` type setting
8. The company default

Consequences:

- **Level 5 is the killer.** With the default config, `https://site/products` renders **in whatever language the visitor's `GUEST_LANGUAGE_ID` cookie says**, with no change to the URL. Cache that response publicly and you will serve German content to French visitors. This is the #1 way a Liferay edge-cache rollout goes wrong in production.
- **Level 6 is off by default** — `locale.default.request=false`, verbatim: *"Set this to true if unauthenticated users get their preferred language from the `Accept-Language` header. Set this to false if unauthenticated users get their preferred language from their company."* **Leave it false.** If you turn it on you must `Vary: Accept-Language` (unbounded cardinality) or normalise at the edge.
- Level 3 requires a session, which you're removing anyway.

**Fix: make the URL the sole source of truth.**

```properties
locale.prepend.friendly.url.style=2
locale.default.request=false
```

Verbatim from `portal.properties`: *"Set this to 2 if the locale is automatically prepended to every URL. This means that each URL points to just one language."* (The default is `3`: *"the locale is automatically prepended to a URL when the requested locale is not the default user locale. In the case of guest users, the behavior is the same as having a value of 1."*)

Then at the edge: strip `GUEST_LANGUAGE_ID` from anonymous requests (you're stripping all cookies anyway per §3.3-W1), and do locale negotiation as a **301 from `/` to `/en/`** based on `Accept-Language` or GeoIP — a cheap, cacheable redirect, not a varying 200.

**Impact: CRITICAL (correctness, not just speed). Effort: LOW–MEDIUM. Note: `locale.prepend.friendly.url.style=2` changes every URL on the site — plan redirects.**

---

## 8. Static export / snapshotting

**Honest finding: Liferay has no static-export feature, and there is no established community project for it.** I searched specifically and found nothing. What follows is what teams actually build.

**S1 — Crawl-and-freeze.** `wget --mirror` / a headless-Chrome crawler over the sitemap, output to S3/nginx, CDN in front. Liferay's XML sitemap ("Configuring XML Sitemaps") gives you the URL list for free.
- **Breaks:** site search (Liferay's search portlet is a POST/render round trip), all forms, comments/ratings, sign-in, any Object Action, anything with a `p_auth`. The `Liferay.Session` autoExtend script will poll a `/c/portal/extend_session` endpoint that may not exist.
- **Fit:** campaign microsites, a frozen archive, disaster-recovery "read-only mode".
- **Verdict:** a fine DR story ("if Liferay dies, flip to the frozen mirror"), a poor primary architecture.

**S2 — Headless Liferay + SSG.** Consume `/o/headless-delivery/v1.0/...` from Next.js/Astro/Gatsby, build statically, ISR/revalidate on webhook. Liferay's own blog series "A Headless API example using Gatsby" is the reference. Guest API access via **Service Access Policy** with **Default** enabled (§5.3).
- **Breaks:** you lose the entire page-authoring experience — Content Pages, Fragments, drag-and-drop, Experiences, inline editing. Authors get a CMS, not a DXP. That is a very large organisational cost that engineers systematically under-price.
- **Fit:** a marketing site sitting *beside* a Liferay portal, sharing content.
- **Verdict:** great outcomes, wrong tool if the value of Liferay is its authoring UX.

**S3 — "Warm and freeze" reverse proxy.** Long-TTL edge cache + `stale-while-revalidate` + `stale-if-error` + a cron warmer that walks the sitemap after each publish. Functionally 95% of static, but forms/search/personalization still work because uncached paths still reach origin.
- **Verdict: this is the right answer for almost everyone**, and it's just §1 + §3 + §6 done properly. Frame it on stage as "static-*enough*".

**Impact: S3 HIGH / low risk. S1 LOW. S2 HIGH but it's a different product. Effort: S3 MEDIUM, S1 LOW, S2 VERY HIGH.**

---

## 9. Measuring it

### 9.1 The headers to read

| Header | Vendor | Values |
|---|---|---|
| `CF-Cache-Status` | Cloudflare | `HIT`, `MISS`, `EXPIRED`, `STALE`, `BYPASS`, `REVALIDATED`, `UPDATING`, `DYNAMIC`, `NONE/UNKNOWN` |
| `X-Cache` / `X-Cache-Hits` | Fastly, Varnish, CloudFront | `HIT IAD`, `MISS`, hit counts per tier |
| `Age` | any shared cache | seconds since origin fetch — compare against `max-age`/`s-maxage` |
| `X-Served-By`, `X-Timer` | Fastly | POP chain and internal timings |
| `Via` | any | `1.1 varnish`, `1.1 google` — tells you how many proxies you're behind |
| `X-Varnish` | Varnish | XIDs; two IDs = a hit |

`BYPASS`/`DYNAMIC` in Cloudflare are the two you'll actually see at first: `DYNAMIC` means the URL wasn't eligible (no Cache Rule / non-cacheable extension), `BYPASS` means it was eligible but something in the response vetoed it (`Set-Cookie`, `private`, `no-store`). **Diagnosing the difference between those two is 90% of a Liferay caching rollout.**

Reference `curl` for the talk:

```bash
curl -sSD- -o /dev/null -A 'Mozilla/5.0' https://site/page \
 | grep -Ei 'cache-control|set-cookie|vary|age:|x-cache|cf-cache-status|surrogate|etag|via'
```

Run it **twice** — first request is expected to MISS.

### 9.2 Synthetic vs RUM

- **Synthetic** (WebPageTest, Lighthouse CI, k6/JMeter, Catchpoint): the only way to get clean before/after on TTFB, and the only way to test the *cold* path. Always report cold and warm separately, and always report the CDN POP.
- **RUM** (`web-vitals` JS, Cloudflare Web Analytics, Boomerang, Datadog RUM): the only way to see the real cache hit ratio *distribution* — synthetic tests always hit the same warm POP and will flatter you. Use the **Navigation Timing** `responseStart - requestStart` for TTFB, correlate with a custom dimension carrying `CF-Cache-Status` (readable via `performance.getEntriesByType('navigation')[0].serverTiming` if you emit `Server-Timing: cache;desc=HIT`).
- **Emit `Server-Timing`** from the edge — it's the one channel that gets cache status into RUM without an extra request:
  ```http
  Server-Timing: cdn-cache;desc=HIT, origin;dur=0, edge;dur=3
  ```
- **The KPI to put on the slide** is **origin request rate per published URL**, not hit ratio. Hit ratio can look great while a handful of hot-but-uncacheable URLs melt the JVM.

### 9.3 Published numbers — what actually exists

**Be careful here: there is very little published Liferay-specific edge-caching data, and you should say so.**

What I could find:

- **Liferay blog, "Increasing Capacity and Decreasing Response Times…" (Varnish in front of Liferay):** *"The runtime for this test was 11 minutes, 58 seconds, a 44% reduction in test time"*, with response times falling **from ~14 s to ~6 s** under load. Note this was primarily **static-asset** caching plus selective content-type overrides — not full guest-HTML caching. Same post is candid about the problems: Liferay appends dynamic params (`browserId`, `languageId`) so *"normal VCL matching patterns would discard this request as uncacheable"*; and after logging in, *"the page was coming from the cache and the necessary stuff I needed was now gone."* That last quote is the best possible illustration of why §3's "bypass on auth cookie" rule is non-negotiable.
- **Liferay DXP 7.4 Performance Benchmark Study** (origin-only, no CDN — useful as the *baseline* you're improving on): Web Content pages sustained **25,000 concurrent users with "95% of page views remain under 2 seconds"**; Asset Publisher hit its inflection at **11,000 concurrent users, 577 ms mean**; login **400 concurrent users** on the native provider vs **19,000 concurrent, 742 ms mean** when offloaded; 100 KB document download **5.96 ms mean at 11,500 concurrent**. Hardware: *"AMD Epyc Milan, 8 Cores, 16 vCPUs, 64GB memory, 160GB Balanced Storage."* The study contains **no** caching or guest-traffic analysis.
- **Cloudflare's WordPress APO**, as the closest well-documented analogue: full HTML edge caching for anonymous visitors with cookie-based bypass, and **"30 seconds or faster cache invalidation"** with the plugin vs **"up to 30 minutes"** without. No headline benchmark numbers published, but the architecture is exactly what §3 + §6 describe.

**What a realistic before/after looks like — present this as a modelled expectation, not a measured claim:**

| Metric | Typical Liferay guest page, default config | After §2 + §3 + §6 |
|---|---|---|
| TTFB (warm, same region) | 250–900 ms (full JVM render + DB + cache lookups) | 15–40 ms (edge HIT) |
| TTFB (cold / cross-region) | 600–2000 ms | 20–60 ms |
| TTFB p99 under load | seconds (GC pauses, connection pool) | flat — `stale-if-error` absorbs it |
| Origin requests / URL / 10 min | = pageviews | 1 (with `stale-while-revalidate`) |
| Sessions created / hour | = unique anonymous pageviews | ~0 for cached paths |
| Editorial latency | n/a (nothing cached) | seconds (soft purge) |

Derive the origin-request-reduction figure from your own numbers and put it on the slide — it's the most defensible claim: *"we went from N origin renders per minute to ~1 per URL per TTL."*

---

## 10. Impact vs effort — the summary slide

| # | Technique | Impact | Effort | Risk | Do it? |
|---|---|---|---|---|---|
| 1 | `browser.cache.disabled=false` (keep `signed.in.disabled=true`) | 🔴 Critical | Trivial | Low | **Day 1** |
| 2 | Strip `Set-Cookie` + all cookies for anonymous GETs at the edge | 🔴 Critical | Medium | Medium | **Day 1** |
| 3 | Bypass cache on auth cookies (`COMPANY_ID|ID|USER_UUID|REMEMBER_ME`) | 🔴 Critical (safety) | Low | Low | **Day 1** |
| 4 | Normalise query string (allow-list) + drop `utm_*`/`fbclid`/`gclid`/`_gl` | 🟠 High | Low | Low | **Day 1** |
| 5 | `Vary: Accept-Encoding` only — never Cookie/UA | 🟠 High | Low | Low | **Day 1** |
| 6 | `locale.prepend.friendly.url.style=2` + kill cookie-based locale | 🔴 Critical (correctness) | Medium | Medium (URL churn) | **Day 1 if multilingual** |
| 7 | `s-maxage` / `CDN-Cache-Control` / `Surrogate-Control` split | 🟠 High | Low | Low | **Week 1** |
| 8 | `stale-while-revalidate` + `stale-if-error` | 🟠 High | Low | Low | **Week 1** |
| 9 | Custom servlet filter emitting the public-page headers + `Surrogate-Key` | 🟠 High | Medium | Low | **Week 1** |
| 10 | `ModelListener` → soft purge by surrogate key | 🟠 High | Medium | Medium (tx ordering) | **Week 2** |
| 11 | Late hydration of user chrome (P1) | 🟠 High | Medium | Medium (CLS) | **Week 2–3** |
| 12 | Audit & remove `ActionURL`s from guest pages (M1) | 🟠 High | Medium | Low | **Week 2–3** |
| 13 | Turn off session auto-extend for guests | 🟡 Medium (origin load) | Low | Low | **Week 2** |
| 14 | URL canonicalisation (host/scheme/slash/case) at the edge | 🟡 Medium | Low | Low | **Week 2** |
| 15 | Export/Import lifecycle listener purge (staged sites) | 🟠 High | Medium | Medium | If staging |
| 16 | ESI / Edgestash / Worker `HTMLRewriter` (P3/P4) | 🟠 High | High | Medium | If you have a platform team |
| 17 | Fix duplicate `Cache-Control` on `/o/*` | 🟡 Medium | Low | Low | Verify first |
| 18 | Segment-in-cache-key (P2) | 🟡 Medium | Medium | Medium | Only if ≤5 segments |
| 19 | Static export / SSG (S1/S2) | 🟢 Low–High | Very High | High | Rarely |
| 20 | `auth.token.check.enabled=false` | 🔴 Negative | Trivial | **Severe** | **Never** |

---

## 11. Where the community has no answer (say these out loud)

1. **There is no supported way to stop Liferay creating an `HttpSession` for a guest.** `session.disabled` existed through 7.3 and was deleted in 7.4 without a documented replacement. `ServicePreAction` calls `getSession()` unconditionally. Liferay's KB states it as a fact of life: *"A user always has a session."* Everyone strips the cookie at the edge instead.
2. **Liferay removed `CacheFilter` — its only built-in guest full-page HTML cache — in June 2024 (update 123 of the 7.4 line), and it is not in the published Breaking Changes list.** `<layout-cacheable>` remains in the portlet DTD with no consumer.
3. **There is no product feature for "cache this page publicly."** Liferay's own CDN documentation is explicitly about static assets: *"Files included in Liferay and custom plugins"*, dynamically generated CSS/JS, and *"The CDN does not serve resources that are dynamically loaded from external sources."* No mention of HTML anywhere. Liferay Cloud's load balancer offers a boolean `{"loadBalancer": {"cdn": true}}` and a manual 30-minute cache clear, with no TTL, cache-key or cookie configuration.
4. **`x-lfr-guest-html-cache: 1` on `www.liferay.com` is undocumented and unshipped.** Liferay's own web team built a bespoke guest-HTML cache. There is no public code or doc for it. *(Worth a slide, and worth asking a Liferay engineer about at DevCon — that conversation alone might be the best takeaway from your talk.)*
5. **No documented listener API for "Publication published"** (change-tracking / `CTCollection`). Workaround: `ModelListener` on `CTProcess` or subscribe to `DestinationNames.BACKGROUND_TASK_STATUS` and filter.
6. **Webhooks / Object Actions cannot be triggered from `JournalArticle`, `Layout`, or `DLFileEntry`.** Objects only. Classic Web Content needs Java.
7. **Rendered Liferay pages have no `ETag`** — the `ETagFilter` is mapped only to static and document-library paths.
8. **`www.liferay.com` publicly caches HTML containing a live `authToken` (`authToken: 'BlVenqFr'`).** Nobody has published guidance on this. The de-facto answer is "make sure nothing on a public page needs it."
9. **No published Liferay-specific TTFB before/after numbers for full guest-HTML edge caching.** The closest data point is the Liferay community Varnish post's 44% test-time reduction / 14 s → 6 s under load, which was mostly static assets. **Measure your own and publish it — you'll be first.**

---

## Sources

**Liferay source code (github.com/liferay/liferay-portal)**
- https://github.com/liferay/liferay-portal/blob/master/portal-impl/src/portal.properties
- https://raw.githubusercontent.com/liferay/liferay-portal/master/portal-impl/src/portal.properties
- https://raw.githubusercontent.com/liferay/liferay-portal/7.0.6-ga7/portal-impl/src/portal.properties
- https://raw.githubusercontent.com/liferay/liferay-portal/7.1.3-ga4/portal-impl/src/portal.properties
- https://raw.githubusercontent.com/liferay/liferay-portal/7.2.1-ga2/portal-impl/src/portal.properties
- https://raw.githubusercontent.com/liferay/liferay-portal/7.3.7-ga8/portal-impl/src/portal.properties
- https://raw.githubusercontent.com/liferay/liferay-portal/7.4.1-ga1/portal-impl/src/portal.properties
- https://raw.githubusercontent.com/liferay/liferay-portal/6.2.5-ga6/portal-impl/src/portal.properties
- https://raw.githubusercontent.com/liferay/liferay-portal/6.1.2-ga3/portal-impl/src/portal.properties
- https://raw.githubusercontent.com/liferay/liferay-portal/master/portal-kernel/src/com/liferay/portal/kernel/servlet/HttpHeaders.java
- https://raw.githubusercontent.com/liferay/liferay-portal/master/portal-impl/src/com/liferay/portal/events/ServicePreAction.java
- https://github.com/liferay/liferay-portal/blob/master/portal-impl/src/com/liferay/portal/security/auth/SessionAuthToken.java
- https://raw.githubusercontent.com/liferay/liferay-portal/master/portal-web/docroot/WEB-INF/liferay-web.xml
- https://raw.githubusercontent.com/liferay/liferay-portal/master/portal-web/docroot/WEB-INF/web.xml
- https://raw.githubusercontent.com/liferay/liferay-portal/master/portal-kernel/src/com/liferay/portal/kernel/cookies/constants/CookiesConstants.java
- https://raw.githubusercontent.com/liferay/liferay-portal/master/portal-kernel/src/com/liferay/portal/kernel/cookies/CookiesManagerUtil.java
- https://raw.githubusercontent.com/liferay/liferay-portal/master/portal-impl/src/com/liferay/portal/util/PortalImpl.java
- https://raw.githubusercontent.com/liferay/liferay-portal/master/portal-kernel/src/com/liferay/portal/kernel/servlet/ServletResponseUtil.java
- https://raw.githubusercontent.com/liferay/liferay-portal/master/portal-kernel/src/com/liferay/portal/kernel/messaging/DestinationNames.java
- https://raw.githubusercontent.com/liferay/liferay-portal/master/portal-kernel/src/com/liferay/portal/kernel/util/PropsKeys.java
- https://raw.githubusercontent.com/liferay/liferay-portal/master/portal-kernel/src/com/liferay/exportimport/kernel/lifecycle/ExportImportLifecycleListener.java
- https://raw.githubusercontent.com/liferay/liferay-portal/master/definitions/liferay-portlet-app_7_4_0.dtd
- https://raw.githubusercontent.com/liferay/liferay-portal/7.3.7-ga8/portal-impl/src/com/liferay/portal/servlet/filters/cache/CacheFilter.java
- https://docs.liferay.com/portal/5.2/javadocs/portal-impl/com/liferay/portal/servlet/filters/cache/CacheFilter.java.html
- https://docs.liferay.com/portal/7.0/javadocs/portal-impl/com/liferay/portal/servlet/filters/cache/CacheFilter.html

**Liferay documentation & knowledge base**
- https://learn.liferay.com/kb-article/cookies-list-that-could-be-found-in-a-liferay-portal-and-their-usage-
- https://learn.liferay.com/kb-article/session-management-in-liferay
- https://learn.liferay.com/kb-article/remove-extend_session-for-guest-users
- https://learn.liferay.com/kb-article/csrf-p_auth-token-is-not-included-in-portlet-resourceurls
- https://learn.liferay.com/kb-article/change-the-guest_language_id-cookie-to-expire-null
- https://learn.liferay.com/kb-article/property-session.timeout.auto.extend-false-is-configured-but-browser-still-calls-extend_session-
- https://learn.liferay.com/kb-article/-unable-to-extend-the-http-session-warn-logs
- https://learn.liferay.com/l/33773458 (Why is p_p_auth exposed in the URL?)
- https://learn.liferay.com/w/dxp/security-and-administration/administration/configuring-liferay/virtual-instances/configuring-frontend-resource-caching
- https://learn.liferay.com/w/dxp/self-hosted-installation-and-upgrades/setting-up-liferay/using-a-cdn
- https://learn.liferay.com/w/liferay-cloud/configuring-the-cloud-network/load-balancer
- https://learn.liferay.com/w/dxp/digital-asset-management/devops/configuring-cache-control-for-documents-and-media
- https://learn.liferay.com/w/dxp/personalization/experiences/content-page-personalization
- https://learn.liferay.com/w/dxp/personalization/experiences
- https://learn.liferay.com/w/dxp/development/traditional-java-based-development/extending-liferay/using-servlet-filters
- https://learn.liferay.com/w/dxp/development/traditional-java-based-development/extending-liferay/creating-a-model-listener
- https://learn.liferay.com/w/dxp/integration/headless-apis/using-liferay-as-a-headless-platform/consuming-apis/making-unauthenticated-requests
- https://learn.liferay.com/w/dxp/low-code/objects/creating-and-managing-objects/actions
- https://learn.liferay.com/w/dxp/low-code/connecting-liferay-to-camunda/triggering-camunda-events-with-liferay-webhooks
- https://learn.liferay.com/w/dxp/sites/optimizing-sites/seo-and-metadata-configuration-reference
- https://learn.liferay.com/w/dxp/self-hosted-installation-and-upgrades/upgrading-liferay/deprecations-and-breaking-changes-reference/7-4-deprecations-and-breaking-changes/7-4-breaking-changes
- https://learn.liferay.com/w/dxp/self-hosted-installation-and-upgrades/upgrading-liferay/deprecations-and-breaking-changes-reference/2025-deprecations-and-breaking-changes/2025-q1-default-setting-and-feature-flag-changes
- https://help.liferay.com/hc/en-us/articles/360017882372-Using-the-Export-Import-Lifecycle-Listener-Framework
- https://help.liferay.com/hc/en-us/articles/4415214660493-How-to-enable-CSRF-Token-in-Liferay
- https://help.liferay.com/hc/en-us/articles/30667389713421-Error-message-Portal-property-session-timeout-auto-extend-was-modularized-to-com-liferay-frontend-js-web-as-auto-extend
- https://help.liferay.com/hc/en-us/articles/15355457114509-Cache-Control-header-for-other-content-type
- https://issues.liferay.com/browse/LPS-41189

**Liferay community / blogs**
- https://liferay.dev/ask/-/message_boards/message/8483103 (Stateless operation mode — `session.disabled`, `SessionLessManagerBase`)
- https://liferay.dev/en/b/increasing-capacity-and-decreasing-response-times-using-a-tool-you-re-probably-not-familiar-with
- https://liferay.dev/blogs/-/blogs/varnish-cache-setup-for-liferay-on-nginx
- https://liferay.dev/b/session-auto-extend-properties-are-now-in-configuration
- https://liferay.dev/blogs/-/blogs/a-headless-api-example-using-gatsby-part-1-
- https://github.com/chrberndt/liferay-lifecycle-events/blob/master/src/main/java/com/chberndt/liferay/lifecycle/action/ServletServicePreAction.java
- https://github.com/jbalsas/liferay-portal/pull/1833 (LPS-98655 — `x-csrf-token` in `fetch`)
- https://medium.com/@wukonigcom/liferay-seo-cdf82773c8fc
- https://www.liferay.com/documents/10182/3292406/Liferay+DXP+Performance+Benchmark+Study+of+Liferay+DXP+7.4.pdf

**CDN / cache vendor documentation**
- https://developers.cloudflare.com/cache/concepts/cache-responses/
- https://developers.cloudflare.com/cache/troubleshooting/dynamic-content-and-login-issues/
- https://blog.cloudflare.com/building-automatic-platform-optimization-for-wordpress-using-cloudflare-workers/
- https://blog.cloudflare.com/using-edge-side-includes-with-workers-for-high-availability/
- https://github.com/upscalesoftware/cloudflare-esi
- https://www.fastly.com/documentation/reference/http/http-headers/Cookie/
- https://www.fastly.com/documentation/guides/full-site-delivery/purging/working-with-surrogate-keys/
- https://www.fastly.com/documentation/guides/full-site-delivery/purging/purging-with-surrogate-keys/
- https://www.fastly.com/documentation/guides/full-site-delivery/purging/soft-purges/
- https://www.fastly.com/documentation/guides/concepts/edge-state/cache/purging/
- https://www.fastly.com/documentation/guides/full-site-delivery/fastly-vcl/vcl-best-practices/
- https://www.fastly.com/blog/vcl-cookie-monster
- https://www.varnish.org/docs/users-guide/increasing-your-hitrate.html
- https://info.varnish-software.com/blog/how-to-speed-up-liferay-web-portals-with-varnish-enterprise

**Standards / reference**
- https://www.rfc-editor.org/rfc/rfc9111.html (HTTP Caching)
- https://www.rfc-editor.org/rfc/rfc9110.html (HTTP Semantics — `Vary`, field combining)
- https://www.rfc-editor.org/rfc/rfc5861.html (`stale-while-revalidate`, `stale-if-error`)
- https://www.rfc-editor.org/rfc/rfc8246.html (`immutable`)
- https://www.rfc-editor.org/rfc/rfc9213.html (Targeted HTTP Cache Control — `CDN-Cache-Control`)
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Cache-Control
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Vary
- https://web.dev/articles/stale-while-revalidate

**Live header captures (2026-08-11, `curl`)**
- `https://www.liferay.com/` — `cache-control: public, max-age=60`, `x-lfr-guest-html-cache: 1`, `age: 10654`, `x-cache: HIT IAD`, no `Set-Cookie`
- `https://learn.liferay.com/` and `https://liferay.dev/` — `cache-control: private, no-cache, no-store, must-revalidate`, `pragma: no-cache`, `Set-Cookie: JSESSIONID/COOKIE_SUPPORT/SERVER_ID`, `x-liferay-request-guest-user: true`
- `https://liferay.dev/o/frontend-js-web/Liferay.js` — duplicate `cache-control` lines
- `https://liferay.dev/o/headless-admin-user/v1.0/my-user-account` — `cache-control: no-cache, no-store`, 2346 bytes
- Rendered guest HTML of `https://liferay.dev/` — `authToken: 'NuPIEFWX'`, `p_p_auth=aEnVkYzK`, `Liferay.Session({autoExtend: true, sessionLength: 900, ...})`
- Rendered cached HTML of `https://www.liferay.com/` — `authToken: 'BlVenqFr'`
agentId: a1ab0773e71acdcfa (use SendMessage with to: 'a1ab0773e71acdcfa', summary: '<5-10 word recap>' to continue this agent)
<usage>subagent_tokens: 188029
tool_uses: 141
duration_ms: 1820051</usage>

---


---

# Liferay Performance Research Brief
## Front-end delivery, infrastructure tuning, and measurement
*For Liferay DevCon 2026 — "Making Liferay blazing fast in production"*

**Scope note / anchor:** Verified against Liferay DXP 2024.Q2–2025.Q4 quarterly releases and Liferay Portal CE 7.4+. Property defaults below were read directly from `portal-impl/src/portal.properties` on the `master` branch of `liferay/liferay-portal` (12,431 lines, fetched during this research), which is the authoritative source for defaults — Liferay's own docs frequently lag it.

> **Finding:** Several settings from older Liferay tuning advice, and from older editions of Liferay's own *Deployment Checklist*, are now deprecated, defaulted the other way, or *deleted from the product entirely*. The age varies: parallel rendering 2015, GZip 2018, Strip 2019, minifier 2020, CMS 2020, `CacheFilter` 2024. Little current advice still recommends them, and most of what is published on `minifier.enabled` and `GZipFilter` already says to turn them off, so this was dropped as the talk's opening (`docs/slide-3-verification.md`). See §1.1 and §10.

---

## 1. Front-end delivery in Liferay

### 1.1 The three properties everyone tells you to set — and what's actually true now

This is the most talk-worthy finding in the whole brief. Verbatim from current `portal.properties`:

**`minifier.enabled` — DEPRECATED, and now defaults to `false`:**
```properties
    #
    # Set this to true to enable runtime minification of CSS resources by the
    # com.liferay.portal.minifier.MinifierUtil class. Note that even when
    # runtime minification is off, build time minification of CSS assets may
    # still occur.
    #
    # This property is deprecated and will be removed in a future release.
    #
    # Env: LIFERAY_MINIFIER_PERIOD_ENABLED
    #
    minifier.enabled=false
```
- **What it did:** runtime minification of CSS via `MinifierUtil`.
- **Why it changed:** minification moved to *build time* (the OSGi module build / Client Extension build produces already-minified artifacts). Runtime minification was pure CPU burn on every cache miss.
- **Trade-off / limitation:** the work moved earlier in the pipeline. If you inherited a `portal-ext.properties` that sets `minifier.enabled=true`, you are paying runtime CPU for CSS only: LPD-45984 removed the JS path in January 2025 (2025.Q2).
- **Impact vs effort:** *Low impact, zero effort.*

**`javascript.fast.load` — still real, still `true`, but the mechanism changed:**
```properties
    #
    # Set this property to true to load the packed version of files listed in
    # the properties "Liferay-JS-Resources-Top-Head" and/or
    # "Liferay-JS-Resources-Top-Head-Authenticated" of OSGi bundles' manifest
    # files.
    #
    # Set this property to false for easier debugging for development. You can
    # also disable fast loading by setting the URL parameter "js_fast_load" to
    # "0".
    #
    javascript.fast.load=true
```
Note it no longer references `javascript.barebone.files` — it now operates on **BND manifest headers** in OSGi bundles.

**`theme.css.fast.load` — still real, still `true`:**
```properties
    #
    # Set this property to true to load the theme's merged CSS files for faster
    # loading for production.
    #
    # Set this property to false for easier debugging for development. You can
    # also disable fast loading by setting the URL parameter "css_fast_load" to
    # "0" when the property "theme.css.fast.load.check.request.parameter" is
    # also set to true.
    #
    theme.css.fast.load=true
    theme.css.fast.load.check.request.parameter=false
    theme.images.fast.load=true
    theme.images.fast.load.check.request.parameter=false
```

**Practical takeaway:** all three of these are *already correct by default in production*. The real failure mode in the wild is not "forgot to enable them" — it's **`portal-developer.properties` leaking into production**, which flips all of them to `false` at once. Liferay's Tuning page leads with exactly this:
```properties
#include-and-override=portal-developer.properties
```
> "Disable `portal-developer.properties` by commenting out includes in `portal-ext.properties`." — [Tuning Liferay](https://learn.liferay.com/w/dxp/self-hosted-installation-and-upgrades/setting-up-liferay/tuning-liferay)

**Impact vs effort: MASSIVE impact, zero effort.** This is the single highest-ROI check in the whole talk. A production system accidentally running developer properties is serving unminified, unmerged, uncached CSS/JS with JSP recompilation checks on every request. Put a "check this first" slide here.

### 1.2 Barebone vs everything bundles — a vestigial organ

The classic Liferay tuning story: unauthenticated users get a minimal `barebone.jsp` JS bundle; authenticated users get `everything.jsp`. **In current Liferay both lists ship empty**, and the whole mechanism is deprecated. Verbatim:

```properties
    # The need to specify two separate lists of JavaScript files for performance
    # reasons (the "javascript.barebone.files" and "javascript.everything.files"
    # properties) in this file is deprecated because it can be configured via
    # OSGi using BND headers. These properties will be removed in a future
    # release.
    ...
    # As the name suggests, the barebone list is the minimum list of JavaScript
    # files required for most cases. The everything list includes everything
    # else not listed in the barebone list.
    #
    # The two lists of files exist for performance reasons because
    # unauthenticated users usually do not utilize all the JavaScript that is
    # available.

    javascript.barebone.files=
    javascript.everything.files=
```

The barebone/everything *concept* survives, relocated to BND manifest headers:
```properties
    # Set this property to false to always load JavaScript files listed under
    # the property "Liferay-JS-Resources-Top-Head-Authenticated" of OSGi
    # bundles' manifest files.
    #
    # The default logic is coded in com.liferay.portal.events.ServicePreAction
    # in such a way that unauthenticated users get the list of
    # "Liferay-JS-Resources-Top-Head" JavaScript files whereas authenticated
    # users get both the list of "Liferay-JS-Resources-Top-Head" JavaScript
    # files and the list of "Liferay-JS-Resources-Top-Head-Authenticated"
    # JavaScript files.
    #
    javascript.barebone.enabled=true
```
Also deprecated: `javascript.bundle.ids` ("This mechanism is deprecated and will be removed in a future release").

- **How to configure now:** if you ship a custom OSGi module that injects top-head JS, declare it via `Liferay-JS-Resources-Top-Head` (anonymous-safe) vs `Liferay-JS-Resources-Top-Head-Authenticated` (logged-in only) in your `bnd.bnd`. Putting your JS in the *authenticated* header keeps it off the anonymous critical path.
- **Limitation:** the split is coarse (anon vs auth), coded in `ServicePreAction`. It is not per-page or per-role without customizing that logic.
- **Impact vs effort:** *Medium impact, low effort* for public-facing sites where anonymous traffic dominates — which is exactly the LCP-sensitive audience.

### 1.3 The `combo` servlet

```properties
    #
    # A file extension of * will permit all file extensions.
    #
    combo.allowed.file.extensions=\
        .css,\
        .js

    #
    # Set the maximum allowed file size. Set this to 0 or a negative value to
    # disable this limit.
    #
    combo.allowed.file.max.size=0

    #
    # The combo servlet combines multiple JavaScript files into a bundle based
    # on shared dependencies. This makes loading JavaScript files much faster.
    # Set this to false if the combination should refresh when one of its
    # JavaScript files has changed. This property should be set to true during
    # development for easier debugging but set to false during production for
    # faster performance.
    #
    combo.check.timestamp=false
    combo.check.timestamp.interval=1000
```
⚠️ **Doc bug worth a laugh on stage:** that comment is self-contradictory/inverted — it says "set to false if the combination should refresh when a file changed," then says set `true` in dev and `false` in prod. The *behaviour* is: `true` = stat the files and re-combine when changed (dev); `false` = trust the cache forever (prod). The default `false` is correct for production. This is a live documentation defect in `master`.

- **What it does:** `/combo?...` collapses N CSS/JS requests into one response.
- **Limitation:** with `combo.check.timestamp=false`, deploying changed static assets requires a cache bust — Liferay handles this by appending a build/ 	`t=` timestamp param, but hand-rolled theme assets can go stale.
- **HTTP/2 caveat:** see §1.5.

### 1.4 The AMD loader is officially deprecated → native ES modules

This is the biggest *architectural* front-end change and deserves real stage time.

- Liferay's own post ["Moving from AMD to Browser modules in Liferay DXP"](https://liferay.dev/blogs/-/blogs/moving-from-amd-to-browser-modules-in-liferay-dxp) (Aug 2023, targets DXP/Portal 7.4) states the goal is standards alignment: *"things are much simpler and powerful than before because we base everything on standards."*
- ["Say Goodbye to liferay-npm-bundler"](https://liferay.dev/b/say-goodbye-to-liferay-npm-bundler-a-smoother-path-with-standard-js-tooling) confirms **LPD-48372 officially deprecated the AMD loader**, making `liferay-npm-bundler` obsolete. Replacements: **esbuild, webpack, or vite**.

Verbatim migration build script from that post:
```json
"scripts": {
  "build": "esbuild ./src/main/resources/META-INF/resources/js/index.js --bundle --outfile=./build/resources/main/META-INF/resources/js/index.js --loader:.js=jsx --format=esm --external:react --external:react-dom --external:react-dom/client"
}
```
(The `--external:react` flags matter: they reuse **Liferay DXP's provided React**, avoiding a duplicate React payload per widget — a classic Liferay page-weight killer.)

**Performance implications, per Liferay:**
1. **No loader runtime.** The AMD loader itself is JS that must be downloaded, parsed, and executed before *any* of your module code runs. Native ESM moves dependency resolution into the browser's C++ module graph. This is a direct **INP/TBT** win, not just a bytes win.
2. **Browser-native dedup:** *"the browser will not fetch and parse the file again"* if multiple components import the same module.
3. **Import maps** replace the AMD dependency registry.

Import map entry client extension, verbatim:
```yaml
{
  "imports": {
    "moment": "https://my-fancy-hosting.com/moment/index.js"
  }
}
```
Note that import-map targets **can be absolute external URLs** — this is the sanctioned path to serving vendor libs from a CDN.

- **Limitation / trade-off:** this is a *migration*, not a flag. Legacy portlets using `Liferay.Loader`/`define()` keep working (both loaders coexist), so you get a long tail where you're paying for the AMD loader *and* ESM. The win only lands when the last AMD consumer on a given page is gone.
- **Impact vs effort:** *High impact, high effort.* Frame this as the 2026-and-beyond direction, not a quick win.

### 1.5 HTTP/2 changes the bundling advice

Liferay's AMD→ESM post explicitly leans on this: enable HTTP/2 because it gives *"virtually unlimited parallel connections to the same domain,"* eliminating the traditional 6-connections-per-domain bottleneck **"that made bundling necessary."**

**The nuanced, honest version for a DevCon audience** (this is where you can add value beyond the docs, and where I'd flag Liferay's phrasing as an oversimplification):
- HTTP/2 removes the *connection-count* penalty for many files. It does **not** remove per-request overhead entirely (headers, cache-lookup, decompression setup), and it *hurts* compression ratio — gzip/brotli over one 200 KB bundle beats 50 × 4 KB files, because the compression dictionary can't span files.
- It also destroys **request prioritization** discipline: 50 parallel module requests all in flight compete for bandwidth with your LCP image.
- **Practical stance to advocate:** HTTP/2 + *moderate* bundling. Don't ship 1 mega-bundle (kills caching granularity and blocks INP). Don't ship 200 raw ES modules (waterfall depth — ESM resolves dependencies level by level, so a 5-deep import chain is 5 round trips). Bundle to roughly per-widget/per-route chunks. Use `<link rel="modulepreload">` to flatten the ESM waterfall.
- **`combo` servlet in an HTTP/2 world:** still useful, mostly for *compression ratio* and for cutting waterfall depth — not for connection count.

### 1.6 Client Extensions change asset delivery — and give you real perf primitives

Client Extensions (CX) are the 7.4+/DXP-2024+ replacement for many OSGi customizations, and they expose **first-class front-end performance attributes** that OSGi modules never did.

`globalJS` client extension, verbatim from [Using a JavaScript Client Extension](https://learn.liferay.com/w/dxp/development/customizing-liferays-look-and-feel/using-a-javascript-client-extension):
```yaml
liferay-sample-global-js-2:
   name: Liferay Sample Global JS 2
   scriptElementAttributes:
      async: true
      data-attribute: "value"
      data-senna-track: "permanent"
      fetchpriority: "low"
   type: globalJS
   url: global.*.js
```

This is a **big deal for the talk** — `async`, `defer`, and `fetchpriority` are declaratively settable per client extension. You can demote analytics/chat/tag-manager scripts to `fetchpriority: "low"` + `async: true` without touching a theme.

Documented gotcha, verbatim: *"If you set both `async` and `defer` in the client extension, the `async` attribute is applied, and the `defer` attribute is ignored."*

Also: **`scriptLocation: head`** for company-scoped extensions is **Liferay DXP 2025.Q4+** — a very recent addition, worth flagging as "new since you last looked."

`customElement` CX reference, verbatim from [Custom Element YAML Configuration Reference](https://learn.liferay.com/w/dxp/development/integrating-external-applications/creating-a-basic-custom-element/custom-element-yaml-configuration-reference):
```yaml
able-custom-element:
    cssURLs:
        - style.css
    friendlyURLMapping: vanilla-counter
    htmlElementName: vanilla-counter
    instanceable: false
    name: Able Custom Element
    portletCategoryName: category.client-extensions
    type: customElement
    urls:
        - index.js
    useESM: false
```

| Property | Type | Default | Perf relevance |
|---|---|---|---|
| `cssURLs` | String[] | `[]` | *"List of CSS paths added to the HTML head"* — **render-blocking**; keep tiny |
| `urls` | String[] | *(required)* | JS resource paths |
| `useESM` | Boolean | `false` | When `true`, *"the JavaScript is added to the page with the `type="module"` property"* |
| `htmlElementName` | String | — | Custom element tag |
| `instanceable` | Boolean | `false` | Multiple instances per page |
| `properties` | String[] | `[]` | Attributes on the element |

⚠️ **CLS trap to call out:** `customElement` CXs are Web Components that hydrate client-side. Until the JS runs, `<vanilla-counter>` is a zero-height unknown element. **Every custom-element widget above the fold is a guaranteed layout shift** unless you reserve space via CSS (`min-height` / `aspect-ratio`) in the CX's `cssURLs`. This is a concrete, Liferay-specific CLS cause you won't find in generic web.dev advice — strong slide material.

- **`cssURLs` are head-injected and render-blocking**, so a page with 8 custom-element CXs has 8 render-blocking stylesheets. Consolidate.
- **Impact vs effort:** *High impact, low effort* for the `fetchpriority`/`async` attributes; *medium effort* for the CLS space-reservation discipline.

### 1.7 Lazy loading portlets & reducing portlet count

- **`layout.parallel.render.enable` no longer exists.** I grepped the entire current `portal.properties` for "parallel" — the only hits are about *upgrade* processes and a SQL `SELECT COUNT(1)` comment. Server-side parallel portlet rendering was hard-disabled in 2015 over OSGi servlet container thread-safety issues (LPS-58748), and its properties were deleted in March 2020 (LPS-110359, first absent at `7.3.1-ga2`). Any blog telling you to set this is pre-7.x. (Historical context: [LPS-57880 "Parallel rendering seems to be failing"](https://issues.liferay.com/browse/LPS-57880).) **Do not put this on a slide as a live recommendation.**
- **Portlet count is the dominant server-side page cost.** Each portlet on a Liferay page is a synchronous render pass: permission checks, preference lookup, its own JSP/FreeMarker execution, and its own contribution to top-head JS/CSS. Rendering is serial on the server, unless `render-weight` is below 1 with `ajaxable=true`, which is AJAX rendered in parallel.
- **Modern mitigation:** prefer **page fragments** (which are template-rendered, cheap, and cache well) over full portlets for presentational content; reserve portlets/custom elements for genuinely interactive apps. Use Collection Displays with pagination rather than N separate Asset Publishers.
- **Client-side lazy loading:** with `customElement` CXs you can implement `IntersectionObserver`-gated hydration inside the element yourself. Liferay does not ship a built-in "lazy portlet" for the modern stack (the old [Lazy loading Portlet](https://liferay.dev/blogs/-/blogs/lazy-loading-portlet) blog is 2014-era).
- **Impact vs effort:** *Very high impact, medium effort.* "Delete four widgets from the homepage" routinely beats every JVM flag in this brief.

### 1.8 Compression and static-asset filters — check the defaults

From current `portal.properties`:
```properties
    # If the user can unzip compressed HTTP content, the GZip filter will zip up
    # the HTTP content before sending it to the user. This will speed up page
    # rendering for users that are on dial up.
    com.liferay.portal.servlet.filters.gzip.GZipFilter=false

    # The ETag filter is used to generate ETag headers.
    com.liferay.portal.servlet.filters.etag.ETagFilter=true

    # The header filter is used to set request headers.
    com.liferay.portal.servlet.filters.header.HeaderFilter=true

    # The strip filter will remove blank lines from the outputted content. This
    # will significantly speed up page rendering.
    com.liferay.portal.servlet.filters.strip.StripFilter=false

    com.liferay.portal.servlet.filters.dynamiccss.DynamicCSSFilter=true
```
- **`GZipFilter=false` is the default since 7.0 Fix Pack 46 and 7.1 GA1.** The stated reason is security, the BREACH attack over HTTPS (LPE-16413; legacy, non-official [KB](https://learn.liferay.com/kb-article/gzip-filter-disabled-by-default)), with CPU as a second reason. Compression is expected at the reverse proxy / ingress (nginx, Apache, ALB), where you should be using **brotli** anyway. BREACH depends on what gets compressed, not where, so moving compression to the edge doesn't by itself remove the risk for pages carrying a secret (our reading, not Liferay's statement). Note the comment still says *"for users that are on dial up,"* which dates it beautifully.
- **`StripFilter=false`** — the default since 7.2 GA1 (LPS-95552; the commit cites CPU and memory cost against network savings), and matches the 2023 Deployment Checklist recommendation. Its "significantly speed up page rendering" claim is dubious once gzip/brotli is in play (whitespace compresses to almost nothing), and it costs CPU on every response.
- **Takeaway:** terminate compression at the edge; leave both filters off.

### 1.9 CDN offload

```properties
    # Set the hostname that will be used to serve static content via a CDN for
    # requests made over the HTTP protocol. This property can be disabled
    # dynamically at runtime by setting the URL parameter "cdn_enabled" to "0".
    # The value must always include the full protocol.
    cdn.host.http=
    cdn.host.https=

    # Set this to true to enable serving dynamically generated CSS, JavaScript,
    # and images via a CDN. Setting this to false allows the usage of CDNs that
    # do not support lazy loading of resources (e.g. Amazon CloudFront).
    cdn.dynamic.resources.enabled=true
```
- **Limitation (documented):** `cdn.dynamic.resources.enabled=false` is required for **origin-pull CDNs that don't lazily fetch**, which the docs call out CloudFront for. Getting this wrong yields 404s on combo/dynamic CSS URLs — a classic "we turned on the CDN and the site lost all its styling" incident.
- **Impact vs effort:** *High impact, low effort* for geographically distributed audiences.

---

## 2. Core Web Vitals for a Liferay page

### 2.1 The metrics (current definitions)

Per [web.dev/articles/vitals](https://web.dev/articles/vitals):

| Metric | "Good" threshold | Measured at | Lab-measurable? |
|---|---|---|---|
| **LCP** (loading) | **≤ 2.5 s** | 75th percentile of page loads, segmented mobile/desktop | Yes |
| **INP** (interactivity) | **≤ 200 ms** | 75th percentile | **No** — use **TBT** as lab proxy |
| **CLS** (visual stability) | **≤ 0.1** | 75th percentile | Yes |

**INP became a stable Core Web Vital in 2024, replacing FID.** All three are currently "stable." Emphasize on stage: **INP cannot be measured in a lab** — Lighthouse gives you TBT as a proxy. Any Liferay INP claim must come from field/RUM data (CrUX, or your own `web-vitals` JS).

**Why INP hurts Liferay specifically:** FID only measured the *delay before* the first event handler ran. INP measures the **full interaction → next paint** duration, for *all* interactions, and reports near-worst-case. A Liferay page with many portlets/custom elements has a long main-thread task queue and heavy delegated event handling — precisely the profile that looked fine under FID and looks bad under INP. **"Your Liferay site's scores got worse in 2024 and you changed nothing"** is a strong talk hook.

### 2.2 What hurts each metric on a typical Liferay page

**LCP:**
- Theme CSS is render-blocking. `theme.css.fast.load=true` merges it into one file — good for request count, but it's one *large* blocking file. The merged theme CSS (Clay/Atlas-based) is substantial.
- `cssURLs` from every `customElement` client extension — additional head-injected blocking stylesheets (§1.6).
- Web fonts: default `font-display: auto` blocks text paint for up to ~3 s.
- The LCP element on a Liferay page is usually a **Documents & Media hero image** served at full resolution because Adaptive Media wasn't applied (§3).
- Server TTFB: heavy portlet count and uncached permission checks (§6.2).
- The AMD loader on the critical path (pre-ESM).

**INP:**
- Long tasks from the AMD loader + many widget bootstraps competing on the main thread.
- SennaJS / SPA navigation (`data-senna-track`) re-running scripts.
- Custom element hydration storms — N Web Components all upgrading at once.
- Un-debounced handlers in portlet JS.

**CLS:**
- **Custom element widgets with no reserved height** (§1.6) — the top Liferay-specific cause.
- Adaptive Media / DL images rendered without explicit `width`/`height` or `aspect-ratio`.
- Fonts swapping (FOUT) without size-adjust metrics.
- Collection Displays / Asset Publishers that fetch and inject after paint.
- Notification/alert portlets injecting banners above content.

### 2.3 Practical fixes (version-agnostic, applied to Liferay)

**`preconnect`** — for the CDN host (`cdn.host.https`), font origin, and any external import-map host:
```html
<link rel="preconnect" href="https://cdn.example.com" crossorigin>
<link rel="dns-prefetch" href="https://cdn.example.com">
```
Place in the theme's `portal_normal.ftl` head. Budget: **≤ 4 preconnects**; each costs a connection.

**`preload` + `fetchpriority`** for the LCP image:
```html
<link rel="preload" as="image"
      href="/o/adaptive-media/image/12345/Preview-1000x0/hero.jpg"
      imagesrcset="...800w, ...1200w" imagesizes="100vw"
      fetchpriority="high">
```
And on the element itself: `<img fetchpriority="high" loading="eager" decoding="async">`. **Critically: never `loading="lazy"` on the LCP image** — a very common own-goal when someone applies blanket lazy loading to a Liferay theme.

**`fetchpriority` on client extensions** — already covered, and it's declarative:
```yaml
   scriptElementAttributes:
      async: true
      fetchpriority: "low"
```

**`font-display`:**
```css
@font-face {
  font-family: "Brand Sans";
  src: url("/o/brand-theme/fonts/brand.woff2") format("woff2");
  font-display: swap;   /* or optional for zero-CLS */
  size-adjust: 103%;    /* match fallback metrics to kill the swap shift */
}
```
`swap` protects LCP but causes CLS; `optional` gives zero CLS but may drop the font on first visit. `size-adjust` + `ascent-override` on the fallback is the way to get both.

**Critical CSS:** inline above-the-fold rules in `portal_normal.ftl`, load merged theme CSS with a non-blocking pattern:
```html
<style>/* critical, inlined */</style>
<link rel="preload" as="style" href="${theme_css}" onload="this.rel='stylesheet'">
<noscript><link rel="stylesheet" href="${theme_css}"></noscript>
```
- **Limitation:** Liferay themes are highly dynamic (Clay tokens, per-site style books, `DynamicCSSFilter`). Extracting stable critical CSS is genuinely hard and **breaks when editors change a Style Book**. Recommend automating extraction in CI, and be honest on stage that this is the highest-maintenance item in the brief.

**Deferring non-essential JS:** use the CX `scriptElementAttributes` rather than editing theme templates — it survives theme upgrades.

**Reserve space to kill CLS** — ship this in every custom element's CSS:
```css
vanilla-counter:not(:defined) { display: block; min-height: 240px; }
```
The `:not(:defined)` selector targets the pre-hydration state exactly.

- **Impact vs effort:** `fetchpriority`/`preconnect`/`font-display`/CLS-reservation are all **high impact, low effort**. Critical CSS is **medium impact, high effort/maintenance** — recommend it last.

---

## 3. Images and media

### 3.1 How Adaptive Media works

From [Using Adaptive Media](https://learn.liferay.com/w/dxp/digital-asset-management/publishing-and-sharing/using-adaptive-media):
- Generation is **asynchronous and on upload**, not on demand. The system *"listens for when users upload supported media types and begins parallel, asynchronous processes for generating the alternative image sizes."*
- **Two resolutions ship by default:** *"preview (1000px auto) and thumbnail (300px/300px)."* Resolution IDs look like `Preview-1000x0` (the `0` meaning auto/proportional).
- **Consequence to stress:** images uploaded *before* you add a resolution are **not** retroactively adapted. You must explicitly regenerate ("Adding Image Resolutions" / "Managing Image Resolutions" flows). **The #1 real-world Adaptive Media failure is "we configured it and nothing changed"** because nobody ran the regeneration for existing content.

### 3.2 Formats — WebP/AVIF

From the [Adaptive Media Configuration Reference](https://learn.liferay.com/w/dxp/digital-asset-management/publishing-and-sharing/using-adaptive-media/adaptive-media-configuration-reference):
- **Default supported MIME types:** `bmp`, `gif`, `jpeg`, `pjpeg`, `png`, `svg+xml`, `x-citrix-jpeg`, `x-citrix-png`, `x-ms-bmp`, `x-png`
- **With ImageMagick enabled:** `avif`, `gif`, `heic`, `tiff`, `webp` (extensible via config)
- *"To use ImageMagick, you must first install it on your Liferay server."*
- ⚠️ Documented caveat, verbatim: *"adapting formats like webP or AVIF may increase file sizes or convert them to PNG for better browser compatibility."*

**Honest assessment for the talk:** Liferay's AVIF/WebP story is **input-format support via ImageMagick**, not a polished "automatically serve AVIF to browsers that accept it" pipeline. The docs do not describe content-negotiated modern-format output. If next-gen formats are your goal, **a CDN image service is the stronger play** (§3.5). Say this plainly — it's a useful, credible criticism.

### 3.3 Process pool tuning (real, and a real OOM risk)

Defaults: **Max Processes = `5`, Core Processes = `2`.**
> *"Larger values for Max Processes and Core Processes can consume large amounts of memory and result in out of memory errors."*

- **Trade-off:** raising these speeds up bulk ingest/regeneration but each process is an out-of-process ImageMagick/Ghostscript invocation with its own memory. Bulk-uploading 10,000 images with Max Processes cranked up is a documented way to OOM a node.
- **Recommendation:** raise temporarily for a one-off regeneration campaign during a maintenance window, then put it back.

Related, from the 7.4 Deployment Checklist: `dl.file.entry.preview.fork.process.enabled=true` — forks preview generation out of the JVM, protecting the app server from ImageMagick memory spikes. **Keep this on.**

### 3.4 Responsive `srcset` and lazy loading

The docs do **not** state that Adaptive Media auto-emits `srcset`/`<picture>` (I checked both the overview and the config reference; neither documents markup generation). In practice you get variant *URLs* under `/o/adaptive-media/image/...` and it's the **fragment/template author's** job to build responsive markup. Recommended fragment pattern:
```html
<img src="/o/adaptive-media/image/${fileEntryId}/Preview-1000x0/${name}"
     srcset="/o/adaptive-media/image/${fileEntryId}/Thumbnail-300x300/${name} 300w,
             /o/adaptive-media/image/${fileEntryId}/Preview-1000x0/${name} 1000w"
     sizes="(max-width: 600px) 100vw, 50vw"
     width="1000" height="562"
     loading="lazy" decoding="async" alt="...">
```
- **Always set `width`/`height`** (or `aspect-ratio`) — this is the cheapest CLS fix available.
- `loading="lazy"` on everything **except** the LCP image.
- **Impact vs effort:** *Very high impact, low-medium effort.* Image weight is usually the largest single byte contributor to a Liferay page.

### 3.5 CDN image resizing as an alternative

Cloudflare Images / Imgix / Fastly IO / Akamai Image Manager / CloudFront+Lambda@Edge do on-the-fly resize **and** content-negotiated AVIF/WebP (`Accept:` header sniffing) — which Adaptive Media does not.
- **Trade-off:** per-image cost, an external dependency, and you lose Liferay's DL permission checks unless the CDN can honour them (a real problem for **private/permissioned** documents — CDN resizing is generally only safe for public assets).
- **Recommendation for the talk:** Adaptive Media for permissioned DL content; CDN image service for public marketing imagery. Not either/or.

---

## 4. Search / Elasticsearch tuning

### 4.1 Connector settings — verbatim defaults

From [Elasticsearch Connector Configuration Reference](https://learn.liferay.com/w/dxp/search/installing-and-upgrading-a-search-engine/elasticsearch/elasticsearch-connector-configuration-reference):

| Setting | Default | Notes |
|---|---|---|
| `indexNumberOfReplicas` | `"0-all"` | *"Set the number of replicas for each Liferay company and system index"* |
| `indexNumberOfShards` | `"1"` | *"Set the number of shards to use when a Liferay company and system index is created"* |
| `indexNamePrefix` | `"liferay-"` | |
| `indexMaxResultWindow` | `"10000"` | Deep-pagination ceiling |
| `trackTotalHitsLimit` | `"2147483647"` | **Big perf lever — see below** |
| `maxConnections` | `"75"` | |
| `maxConnectionsPerRoute` | `"75"` | |
| `logExceptionsOnly` | `"true"` | *"Only logs exceptions from Elasticsearch, and does not re-throw them"* |
| `retryOnConflict` | `"5"` | *"No longer used as of Liferay 7.1"* |
| `httpSSLEnabled` | `"false"` | |
| `authenticationEnabled` | `"false"` | |
| `networkHostAddresses` | `"[http://localhost:9200]"` | Required in Liferay 7.3+ |

Config file names (deploy to `[Liferay_Home]/osgi/configs`):
```
com.liferay.portal.search.elasticsearch7.configuration.ElasticsearchConfiguration.config
com.liferay.portal.search.elasticsearch7.configuration.ElasticsearchConnectionConfiguration-[connectionId].config
```

**Three tuning insights worth stage time:**
1. **`trackTotalHitsLimit` defaults to `Integer.MAX_VALUE`** — meaning Elasticsearch counts *every* matching document exactly, on every query. Elasticsearch's own default is 10,000 precisely because exact counts past that are expensive. Lowering this to e.g. `10000` is a **cheap, meaningful win on search-heavy pages** — the cost is that result counts display as "10,000+". This is a genuinely under-discussed Liferay setting.
2. **`indexNumberOfReplicas="0-all"`** is an *auto-expand* expression: replicas scale to all available nodes. Great for read throughput and HA; it means **every indexing operation fans out to every node**. On write-heavy systems (bulk imports), a fixed low number is faster.
3. **`indexNumberOfShards="1"`** is right for most Liferay installs. Over-sharding is the classic Elasticsearch mistake — each shard is a full Lucene index with fixed overhead. Only increase when a single index exceeds tens of GB.

### 4.2 `index.on.startup` — verbatim, with an explicit production warning

```properties
    #
    # Set this to true if you want to index your entire library of files on
    # startup. This property is available so that automated test environments
    # index on startup. Do not set this to true on production systems or else
    # your index will be indexed on every startup.
    #
    index.on.startup=false

    #
    # Set this to true to add a delay before indexing on startup. A delay may be
    # necessary if a lot of plugins need to be loaded and reindexed. This
    # property is only valid if "index.on.startup" is set to true.
    #
    index.on.startup.delay=60
```
Liferay's own comment says **"Do not set this to true on production systems."** Default is already `false`. If it's `true` in your prod config, every node restart triggers a full reindex — catastrophic during a rolling deploy, and a genuinely common misconfiguration inherited from dev environments.

### 4.3 Reindexing modes

From [Reindexing Modes](https://learn.liferay.com/w/dxp/search/search-administration-and-tuning/reindexing-modes):

| Mode | Behaviour | HA during reindex | Disk cost |
|---|---|---|---|
| **Full** | Deletes index, then regenerates | ❌ **No** — search is down | Baseline |
| **Concurrent** | *"Creates a new index, leaving the old index in place until the new index is ready"* (blue/green) | ✅ Yes | **Requires additional disk space** |
| **Sync** | Updates existing docs, removes stale entries | ✅ Yes | Lowest |

- **Full** is required for a *new* Elasticsearch cluster and supports all action types (global indexes, spell check, single models).
- **Concurrent** cannot be used for single-model reindexing.
- **Sync** *"does not account for updated index settings or mappings"* — so it's wrong after a field-mapping change; recommended for single-model reindex and when disk is constrained.
- Configured at: Global Menu → Control Panel → System Settings → Platform → Search → Reindex → **"Default Reindex Execution Mode."**
- **Impact vs effort:** *High impact, trivial effort.* Switching the default from Full to Concurrent removes a scheduled outage. The docs give no reindex-duration cost model — you must measure your own (see §8).

### 4.4 Elasticsearch sizing (from the 7.4 Deployment Checklist)

- *"at least eight CPU cores allocated"*
- *"at least 16GB of memory. The preference is for 64GB"*
- *"Liferay recommends deploying Elasticsearch on SSD when possible"*
- Minimum **three nodes** for fault tolerance
- JVM: *"no more than 50 percent of the available system memory...up to a maximum of 30GB"* (the compressed-oops boundary)
- OS: *"at least 65,536 file descriptors"*
- Disk: *"at least 25 percent more disk capacity than the total size of your indices"*
- Bulk thread pool: `thread_pool.bulk.queue_size: 100` (minimum)

### 4.5 Search result caching

Liferay does **not** document a first-class search-result cache. The available layers:
- **Elasticsearch's own shard request cache** and OS page cache (this does most of the work; give ES plenty of *non-heap* RAM).
- Liferay's `PortalCache` for wrapping your own search-backed components.
- **Honest note:** search results are permission-filtered per user, which makes naive caching incorrect. This is why there's no generic cache — and it's exactly why search-heavy pages are hard to make fast. Good, honest talk content.
- **Search-heavy pages as bottleneck:** an Asset Publisher in "Dynamic" mode issues a search query *per widget, per page load*, permission-filtered. Note the benchmark evidence: Asset Publisher pages hit their inflection point at **~11,000 users vs ~25,000 for plain web content** (§9) — **Asset Publisher costs you more than half your capacity.** That is a killer data point.

---

## 5. JVM and app server

### 5.1 Liferay's current documented JVM baseline

From [Tuning Your JVM](https://learn.liferay.com/w/dxp/self-hosted-installation-and-upgrades/setting-up-liferay/tuning-your-jvm):
```
-Xms2560m -Xmx2560m
-XX:NewSize=1536m -XX:MaxNewSize=1536m
-XX:MetaspaceSize=768m -XX:MaxMetaspaceSize=768m
-XX:InitialCodeCacheSize=64m -XX:ReservedCodeCacheSize=96m
```
Survivor space:
```
-XX:SurvivorRatio=16 -XX:TargetSurvivorRatio=50 -XX:MaxTenuringThreshold=15
```
Large pages (optional):
```
-XX:+UseLargePages -XX:LargePageSizeInBytes=256m
```
Key principles, verbatim:
- *"set the minimum (`-Xms`) and maximum (`-Xmx`) heap size to the same value to prevent the JVM from making dynamic adjustments."*
- **"avoid allocating more than 32g to your JVM heap."**

From [JVM Configuration reference](https://learn.liferay.com/w/dxp/self-hosted-installation-and-upgrades/reference/jvm-configuration):
- `-Dfile.encoding=UTF8` (required for i18n)
- `-Duser.timezone=GMT` (*"DXP uses GMT for all dates"*)
- `-Dlog4j2.formatMsgNoLookups=true` (Log4Shell)
- **DXP 2024.Q3+ / Portal GA125+ requires JDK 17 or 21**; earlier versions support 8/11.
- Illegal-access opens for 11/17/21:
```
--add-opens=java.base/java.lang=ALL-UNNAMED
--add-opens=java.base/java.lang.reflect=ALL-UNNAMED
--add-opens=jdk.zipfs/jdk.nio.zipfs=ALL-UNNAMED
```
(the `jdk.zipfs` one is specifically needed for **fragment export** on Liferay PaaS.)

### 5.2 GC choice — where Liferay's docs are weakest, and what to say

**This is a place to be genuinely useful, because the official guidance is thin and partly obsolete.**

- The [Tuning Your JVM](https://learn.liferay.com/w/dxp/self-hosted-installation-and-upgrades/setting-up-liferay/tuning-your-jvm) page gives a **Java 8 CMS block**:
```
-XX:+UseParNewGC -XX:ParallelGCThreads=16
-XX:+UseConcMarkSweepGC
-XX:+CMSParallelRemarkEnabled -XX:+CMSCompactWhenClearAllSoftRefs
-XX:CMSInitiatingOccupancyFraction=85 -XX:+CMSScavengeBeforeRemark
```
  ⚠️ **CMS was removed in JDK 14 (JEP 363); from JDK 15 the flag stops a HotSpot JVM booting.** OpenJ9 ignores it. The full block already fails on JDK 11, because of `-XX:+UseParNewGC`. DXP 2024.Q3+ *requires* JDK 17 or 21. The 2023 edition of the 7.4 Deployment Checklist printed these flags, but it has since been replaced: the current **Go Live Checklist 2026.Q1** recommends G1. CMS remains in the live 7.3 PDF and in the Java 8 section of Tuning Your JVM.
- For **Java 11** the docs say: *"use the Garbage-First (G1) algorithm. It's enabled by default."*
- For **Java 21**, the only Liferay-specific artifact is a KB article, [Garbage Collection on Java 21](https://learn.liferay.com/kb-article/garbage-collection-on-java-21) — and it is explicitly marked **"Legacy"** and **"not official documentation of Liferay."** It advises *"start testing with G1's default settings"* but notes internal testing showed G1 *"does not improve performance"*; it defers to Oracle's tuning guide and gives only:
```
-verbose:gc -Xlog:gc:/tmp/liferaygc1.log
```

**My recommendation to present (clearly labelled as reasoned guidance, not Liferay doctrine):**

| Collector | Fit for Liferay | Notes |
|---|---|---|
| **G1** | ✅ Default choice, heaps 4–16 GB | Default on 17/21. Region-based, predictable. Tune with `-XX:MaxGCPauseMillis=200`. Start here. |
| **Generational ZGC** (JDK 21+, `-XX:+UseZGC -XX:+ZGenerational`) | ✅ Strong for large heaps / p99 latency | Sub-millisecond pauses, heap-size-independent. **Costs ~10-15% throughput and more RAM.** Non-generational ZGC (pre-21) was a poor fit for Liferay's high allocation rate — *generational* ZGC fixed exactly that. Best pick if **INP/TTFB p99** is your KPI. |
| **Shenandoah** | ⚠️ Viable, less common | Similar concurrent-compaction goals; in OpenJDK builds (Red Hat/Temurin), **not in Oracle JDK**. Fine, but fewer Liferay practitioners = less community support. |
| **Parallel** | ❌ | Throughput-only, long STW pauses. Wrong for an interactive portal. |

**Talk framing:** since DXP 2024.Q3+ requires JDK 17 or 21 (21 recommended), and JDK 21 shipped Generational ZGC, **"Liferay on JDK 21 is the first time ZGC is genuinely the right answer for a latency-sensitive portal"** — and Liferay has published nothing about it. That's a legitimately novel angle for DevCon, and an honest "here's an experiment worth running, bring me your numbers" call to action.

**Measured 2026-11-01, this framing did not hold in our lab** (`part1-simulations/results/RUNG-RESULTS.md`, 6 GB pre-touched heap, S3, HTML only, about 600 MB live set). ZGC ties G1 at 400 pages/s (14.0 vs 15.5 ms), costs more CPU at 800 and 1,200 pages/s (11.8 vs 10.8 cores at 1,200) and is clean to 1,200 pages/s where G1 reaches about 1,500. One of five ZGC starts died with `OutOfMemoryError` 43 s after start, with 4.8 GB live after collection; the cause was not found and it did not reproduce. A 6 GB heap with a small live set is not where ZGC is expected to shine, so this is no verdict on large heaps. The talk recommends G1.

**Heap sizing guidance:** note the tension — docs recommend `-Xmx2560m` (Tuning page) while the 7.4 Deployment Checklist recommends `-Xms4096m -Xmx4096m`. Reconcile on stage: **2.5–4 GB is a starting point per node; scale horizontally rather than vertically**, and never cross 32 GB (compressed oops). Liferay's own benchmark ran 8-core/64 GB app nodes — meaning most of that RAM is *not* heap, it's OS page cache and headroom.

### 5.3 Metaspace and OSGi bundle count

- `-XX:MetaspaceSize=768m -XX:MaxMetaspaceSize=768m` — set both equal to avoid resize pauses.
- **Why Liferay needs so much metaspace:** each OSGi bundle has its own classloader; Liferay ships ~1,000+ bundles. Class metadata, not objects, dominates.
- **OSGi bundle count → startup time:** every bundle must be resolved, wired, and activated. This is the dominant term in Liferay startup. Mitigations: remove unused marketplace apps/modules; keep `osgi/state` warm between restarts (a cold state dir forces full re-resolution); avoid `-Dosgi.clean=true` in normal ops.
- **Trade-off:** aggressive module pruning risks breaking capability wiring at runtime rather than at build time. Test in a staging env with an identical `osgi/` tree.
- **Impact vs effort:** *Medium impact (ops agility, rolling-deploy speed), medium effort.* Frame startup time as a **deployment-velocity** metric, not an end-user one.

### 5.4 Tomcat connector / thread tuning

From [Tuning Liferay](https://learn.liferay.com/w/dxp/self-hosted-installation-and-upgrades/setting-up-liferay/tuning-liferay) — *"Use an initial thread pool setting of 50 threads"* with monitoring:
```xml
maxThreads="75"
minSpareThreads="50"
maxConnections="16384"
connectionTimeout="600000"
```
From the 7.4 Deployment Checklist, the fuller connector:
```xml
<Connector maxThreads="75" minSpareThreads="50"
maxConnections="16384" port="8080"
connectionTimeout="600000" redirectPort="8443"
URIEncoding="UTF-8" maxKeepAliveRequests="-1"/>
```
Thread pool guidance, verbatim: initial recommendation is **"50 threads"** with monitoring; consider **"250"** if average page response times are 2–3 seconds.

**Reading these numbers critically (good stage content):**
- **`maxThreads="75"` surprises people** who expect 500. It's correct: Liferay is CPU-bound per request. More threads than cores × (1 + wait/service ratio) just adds context-switching and lock contention. **Queueing beats thrashing.** The "250 if responses are 2–3 s" advice is really "if you're I/O-blocked, add threads; if you're CPU-bound, add nodes."
- **`maxConnections="16384"` vs `maxThreads="75"`** is the NIO connector doing its job: hold many idle keep-alive connections cheaply, service them with a small worker pool.
- **`maxKeepAliveRequests="-1"`** = unlimited keep-alive requests per connection. Correct behind a load balancer; avoids constant TCP/TLS re-handshake.
- **`connectionTimeout="600000"` (10 minutes) is alarmingly high** — that's a slowloris exposure if Tomcat is internet-facing. Fine behind a hardened reverse proxy; call this out as "only acceptable because something else is in front."
- **`acceptCount`** is *not* in Liferay's published config, so it uses Tomcat's default (**100**). It's the OS accept-queue depth once all threads are busy — exceeding it yields connection refused. Worth raising for bursty traffic; mention it as an explicit gap in Liferay's guidance.

**JSP engine (both sources agree)** — in `$CATALINA_HOME/conf/web.xml`:
```xml
<init-param>
    <param-name>development</param-name>
    <param-value>false</param-value>
</init-param>
<init-param>
    <param-name>mappedFile</param-name>
    <param-value>false</param-value>
</init-param>
```
`development=false` stops JSP timestamp-checking on every request; `mappedFile=false` stops generating one `out.write()` per line. **High impact, trivial effort** — and frequently missed because it's in Tomcat's config, not Liferay's.

Related, from the Deployment Checklist: `direct.servlet.context.reload=false`.

### 5.5 Other production portal properties (7.4 Deployment Checklist)

```properties
counter.increment=2000
cluster.link.enabled=true
direct.servlet.context.reload=false
session.tracker.memory.enabled=false
portlet.css.enabled=false
dl.store.impl=com.liferay.portal.store.file.system.AdvancedFileSystemStore
dl.file.entry.preview.fork.process.enabled=true
com.liferay.portal.servlet.filters.strip.StripFilter=false
com.liferay.portal.sharepoint.SharepointFilter=false
```
```xml
<session-config>
 <session-timeout>10</session-timeout>
</session-config>
```

**`counter.increment` deserves a slide.** Current default from `portal.properties`:
```properties
    # Set the number of increments between database updates to the Counter
    # table. Set this value to a higher number for better performance.
    counter.increment=100
```
The Deployment Checklist recommends **2000**. Liferay allocates ID ranges in blocks; a bigger block = fewer round trips to the single, hot `Counter` table — which is a genuine contention point under write load.
- **Trade-off (must state):** larger increments mean **ID gaps** on every restart/crash (you burn the rest of the block). Harmless functionally, ugly if anyone assumes contiguous IDs.
- Note the fine-grained overrides that *stay* at 1 — Liferay explicitly protects these:
```properties
counter.increment.com.liferay.portal.kernel.model.Company=1
counter.increment.com.liferay.portal.kernel.model.Layout=1
counter.increment.object.field.auto.increment=1
```
- **`session.tracker.memory.enabled`** defaults to `true` in `portal.properties` (line 3335) but the Deployment Checklist says set it **`false`** in production — it maintains an in-memory map of all live sessions. Genuine, low-effort win on high-session systems.
- **`session.timeout=15`** is the portal.properties default; the Checklist suggests **10** minutes in `web.xml`. Shorter timeouts = less session memory = more heap for cache.
- **`portlet.css.enabled=false`** — skips per-portlet CSS wrapper output. Only safe *"if no custom portlets"* rely on per-portlet styling.

---

## 6. Database

### 6.1 HikariCP connection pool sizing

Liferay uses **HikariCP**. From [Tuning Liferay](https://learn.liferay.com/w/dxp/self-hosted-installation-and-upgrades/setting-up-liferay/tuning-liferay):
```properties
jdbc.default.connectionTimeout=30000
jdbc.default.idleTimeout=600000
jdbc.default.maximumPoolSize=180
jdbc.default.maxLifetime=0
jdbc.default.minimumIdle=10
jdbc.default.registerMbeans=true
```
> *"Configure the pool size slightly larger than the thread pool size"* — to account for **nested transactions**.

⚠️ **The two official sources flatly contradict each other** — flag this on stage:
- **Tuning Liferay:** pool *"slightly larger than the thread pool size"* → `maximumPoolSize=180`
- **7.4 Deployment Checklist:** pool *"generally sized at roughly 30 to 40 percent of the thread pool size"*, with `minimumIdle="10" maximumPoolSize="85"`

**How to resolve it (this is the useful part):** with `maxThreads=75`, 30–40% would be ~25 connections, which is almost certainly *too small* — a thread holding a request while waiting for a connection is a stalled request. The "slightly larger than thread pool" rule is the sound one, because **Liferay's nested `@Transactional` boundaries can make one request hold two connections simultaneously** — the classic deadlock: all N connections held by N threads each waiting for a second connection. Practical guidance: **`maximumPoolSize` ≈ 2 × `maxThreads`**, i.e. ~150 for a 75-thread connector, and `registerMbeans=true` so you can actually watch pool saturation in JMX (§8.4). Note HikariCP's own doctrine is that *small* pools are faster — so the real answer is "measure `hikaricp_connections_pending`; if it's ever > 0, you're too small; if utilization never approaches max, you're too big."
- `maxLifetime=0` means connections live forever — **check this against your DB/proxy idle-kill timeout** (MySQL `wait_timeout`, RDS Proxy, HAProxy). Mismatch produces intermittent "connection closed" errors that look like app bugs.

MySQL URL from `portal.properties` showing recommended driver flags:
```properties
#jdbc.default.url=jdbc:mysql://localhost/lportal?cachePrepStmts=true&characterEncoding=UTF-8&dontTrackOpenResources=true&holdResultsOpenOverStatementClose=true&useFastDateParsing=false&useUnicode=true
```
`cachePrepStmts=true` is a meaningful, easily-missed win.

### 6.2 Slow queries typical to Liferay

Liferay does not publish a canonical slow-query list, so this section is **practitioner knowledge — label it as such on stage**. [Performance tuning in Liferay - Part 1](https://liferay.dev/b/performance-tuning-in-liferay-part-1) recommends **Glowroot** to find them empirically (its "query section" plus MBean views), which is the honest method.

The recurring offenders:
1. **`ResourcePermission`** — the single most notorious Liferay table. Permission checks run per entity, per portlet, per request. The table grows as *(resources × roles × scopes)* and reaches tens of millions of rows on large installs. Symptoms: high query *count*, each individually fast — invisible in "slow query log" but devastating in aggregate. Mitigation: keep the permission cache warm (`PortalCache`/Ehcache), prefer role-based over per-object permissions, avoid per-item permission grants at scale.
2. **`AssetEntry` + `AssetCategory`/`AssetTag` joins** — Asset Publisher in Dynamic mode. Multi-way joins with `ORDER BY` on non-indexed columns.
3. **`JournalArticle`** — version/status filtering (`status`, `version`, `resourcePrimKey`); the "latest approved article" pattern is expensive.
4. **`Layout` / `LayoutSet`** — hit on every request for navigation.
5. **`DLFileEntry` / `DLFolder`** — recursive folder-tree traversal.
6. **`Counter`** — write contention (§5.5).
7. **`Release_` / `PortletPreferences`** — `PortletPreferences` is read per portlet per page render; large preference blobs on a page with many widgets is a real cost.

### 6.3 Indexes Liferay recommends adding

**Finding to report honestly: I could not locate a published, maintained list of recommended supplementary indexes** for current DXP. Liferay ships indexes via `*-tables.sql`/service.xml `<finder>` definitions, and the general position is that the shipped schema is already indexed for the shipped finders. Custom slowness usually comes from **custom** finders/Dynamic Query.
- **Method to present instead of a list:** enable the DB slow-query log → identify tables → check the execution plan → add covering indexes for *your* access patterns. Add them **outside** Liferay's schema management and re-verify after every upgrade (Liferay's upgrade processes can rebuild tables and drop custom indexes).
- **Caveat to state:** adding indexes to `ResourcePermission` helps reads but slows the permission *writes* that happen on every content publish. Not free.

### 6.4 Read/write split — it exists, and it's officially documented

This is a real, supported feature. From [Database Configuration for Cluster Nodes](https://learn.liferay.com/w/dxp/self-hosted-installation-and-upgrades/setting-up-liferay/clustering-for-high-availability/database-configuration-for-cluster-nodes), verbatim:

```properties
jdbc.read.driverClassName=[driver name]
jdbc.read.url=[read database URL]
jdbc.read.username=[username]
jdbc.read.password=[password]

jdbc.write.driverClassName=[driver name]
jdbc.write.url=[read-write database URL]
jdbc.write.username=[username]
jdbc.write.password=[password]
```
Pool settings apply to both prefixes:
```properties
jdbc.read.connectionTimeout=30000
jdbc.read.idleTimeout=600000
jdbc.read.maximumPoolSize=100
jdbc.read.maxLifetime=0
jdbc.read.minimumIdle=10
jdbc.read.registerMbeans=true
```
Counter must be pinned to the writer — for **DXP 7.4 U69 and below**:
```properties
counter.jdbc.prefix=jdbc.write.
```
Enablement — for **DXP 7.3 U22 / 7.4 U65 and below**, add to `spring.infrastructure.configs`:
```
META-INF/dynamic-data-source-infrastructure-spring.xml
```
**Newer versions enable this automatically.** For JNDI, use `jdbc.read.jndi.name` / `jdbc.write.jndi.name`.

**How it works** (from Liferay's engineering blog, [Liferay Read-Write Database Splitting](https://liferay.dev/b/liferay-read-write-database-splitting)): a Spring `DynamicDataSourceTargetSource` switches datasources at runtime, driven by transactional boundaries — via a custom `@Transactional` annotation, `PortalTransactionAnnotationParser`, and `DynamicDataSourceTransactionInterceptor`. Read-only transactions route to the replica; anything writing routes to the primary.

- **Trade-off (critical, and the blog omits it — say so):** **replication lag**. Routing is by transaction, not by causality. A user publishes content (writer), is redirected, the next request reads (replica) — and the content isn't there yet. Read-your-own-writes breakage. Liferay's blog *"does not discuss replication lag"* and *"offers no guidance on eventual consistency concerns"* despite framing this for deployments expecting *"several millions of users."* That's a fair criticism to make from the stage.
- **Mitigation:** use a replica with sub-second lag, and accept that authoring/admin traffic should bypass the split.
- **Also documented:** *"Clustering will not work with the embedded HSQL database"* — and there's a [KB article](https://help.liferay.com/hc/en-us/articles/360057994172) specifically about the confusing "Hypersonic is in use" warning when configuring read/write split, because the absence of `jdbc.default.*` makes Liferay think it's on HSQL. Nice practical gotcha.
- **Impact vs effort:** *High impact, high effort/risk.* Recommend it only after caching and query tuning are exhausted. Most Liferay DB problems are "too many queries," not "not enough DB servers."

---

## 7. Clustering and horizontal scale

### 7.1 Cluster Link

```properties
    # Set this to true to enable the cluster link. This is required if you want
    # to cluster indexing and other features that depend on the cluster link.
    cluster.link.enabled=false
```
Default is `false`; the Deployment Checklist sets `cluster.link.enabled=true` for clusters. Also relevant: `clusterable.advice.call.master.timeout=10`.

- **What it does:** JGroups-based control channel for cache invalidation, cluster-wide method invocation, and index coordination.
- **Overhead:** every cache eviction becomes a multicast/unicast message. Cost scales with **write rate × node count**. A read-heavy site pays almost nothing; a write-heavy one with 8 nodes pays real network chatter.
- **Important distinction for the talk:** Cluster Link replicates **invalidations**, not cache *contents* (for the default single-VM caches). So each node warms its own cache — meaning **adding nodes doesn't reduce per-node cache-miss cost**, and a cold node after a rolling restart is slow until warm. This argues for connection draining during deploys.
- Liferay's [Clustering for High Availability](https://learn.liferay.com/w/dxp/self-hosted-installation-and-upgrades/setting-up-liferay/clustering-for-high-availability) requires: separate app nodes, **shared database**, **accessible File Store**, **external search engine**, and Cluster Link. Operational note, verbatim: *"start your nodes sequentially"* to avoid concurrency issues and ensure proper master election. Licensing: *"A Liferay DXP Enterprise subscription is required to use more than three nodes in a cluster."*
- Legacy but still-seen properties: `ehcache.cluster.link.replication.enabled=true`, and `-Djava.net.preferIPv4Stack=true` for IPv4/IPv6 conflicts (a very common JGroups failure).

### 7.2 Session replication vs sticky sessions

From [Session Replication with Tomcat](https://learn.liferay.com/w/dxp/self-hosted-installation-and-upgrades/setting-up-liferay/clustering-for-high-availability/session-replication-with-tomcat), verbatim:
```xml
<Cluster className="org.apache.catalina.ha.tcp.SimpleTcpCluster">
    <Manager className="com.liferay.support.tomcat.session.LiferayDeltaManager" />
    <Channel className="org.apache.catalina.tribes.group.GroupChannel">
        <Sender className="org.apache.catalina.tribes.transport.ReplicationTransmitter">
            <Transport className="org.apache.catalina.tribes.transport.nio.PooledParallelSender" timeout="300000" />
        </Sender>
    </Channel>
</Cluster>
```
Note Liferay ships its **own** session manager, `com.liferay.support.tomcat.session.LiferayDeltaManager` (not Tomcat's stock `DeltaManager`) — worth mentioning, it's an under-known artifact.

Documented constraints:
- *"This is recommended for clusters of **five or fewer nodes**"* — an explicit scalability ceiling.
- *"For session replication to work, all session attributes must implement `java.io.Serializable`."*
- *"Session replication only applies to user sessions within the same URL. This is because session state is tracked by a domain-specific cookie."*
- *"For the full benefits of session replication, a load balancer is recommended to direct traffic to the nodes."*

**The "sticky + no replication is fastest" argument (present this as reasoned analysis — Liferay does not state it):** I looked for an official Liferay recommendation against replication and **found none**; the support [Clustering](https://support.liferay.com/w/clustering) page is policy-level only and explicitly says *"Tuning and optimizing the distributed cache for a particular environment is the responsibility of the customer."* So this is your argument to make, and the docs give you the ammunition:

1. `DeltaManager` replicates session deltas to **every node** — O(n²) messaging as nodes grow. Hence the documented **five-node ceiling**.
2. Every session write serializes objects and hits the network **on the request path** — direct TTFB tax.
3. The `Serializable` requirement is a correctness landmine: one non-serializable attribute from any portlet silently breaks replication or throws.
4. Sticky sessions cost **zero** on the request path.
5. **The real question is what you lose:** with sticky + no replication, a node failure logs those users out. For most portals that's an acceptable, rare annoyance — versus a permanent per-request tax on 100% of traffic.
6. **Best of both:** sticky sessions *plus* short session timeouts (§5.5) *plus* keeping little in session. Or externalize sessions (Redis) if you truly need failover without the n² chatter.

**Impact vs effort:** *High impact, low effort* — turning replication **off** is usually a performance improvement. Frame it as "the fastest session replication is none."

### 7.3 Document library store choice

Options and their performance character:

| Store | `dl.store.impl` | Performance notes |
|---|---|---|
| **AdvancedFileSystemStore** | `com.liferay.portal.store.file.system.AdvancedFileSystemStore` | **Liferay's own recommendation in the 7.4 Deployment Checklist.** Fastest reads (local/NFS page cache). Avoids the "too many files in one directory" problem the plain `FileSystemStore` has by hashing into subdirectories. In a cluster requires a **shared** mount (NFS/EFS) — which becomes the bottleneck and a SPOF. |
| **FileSystemStore** | `...store.file.system.FileSystemStore` | Flat layout; degrades badly at high file counts. Use Advanced instead. |
| **DBStore** | `...store.db.DBStore` | Stores blobs in the database. **Worst choice for performance at scale** — bloats the DB, ruins backup/restore times, pollutes the DB buffer pool with binary data that evicts hot index pages. Its one virtue: transactional consistency and no shared filesystem needed. Acceptable only for small installs. |
| **S3Store** | `...store.s3.S3Store` | Best for horizontal scale and cloud; no shared mount, effectively unlimited. **Higher per-object latency** (network round trip, ~tens of ms vs sub-ms) — mitigate with the S3 store's local cache dir and by fronting public assets with a CDN. Now the default posture for Liferay PaaS/SaaS. |

Cluster requirement: **all nodes must point at the identical store config** or you get data corruption/missing files.

**Talk guidance:** DBStore is the one to actively warn against — it's chosen because it's easy in dev, then never revisited, and it silently caps DB performance. **High impact, medium effort** to migrate (Liferay ships a store-migration tool in Control Panel).

---

## 8. Load testing and profiling

### 8.1 What Liferay itself uses

**Notable finding:** Liferay's own DXP 7.4 benchmark used **"Grinder 3 load test client with Liferay customizations"** — *not* JMeter. That's an internal, customized harness; you cannot reproduce their methodology exactly. Worth stating so nobody wastes time trying.

### 8.2 What practitioners actually use

- **JMeter** — most common in the Liferay community; lots of existing material ([Liferay Performance Testing using JMeter](https://www.surekhatech.com/blog/liferay-performance-testing-using-jmeter), [Load Tests with JMeter: Liferay Example](https://thinkinginsoftware.blogspot.com/2011/01/load-tests-with-jmeter-liferay-example.html)). GUI-friendly, huge plugin ecosystem, but thread-per-VU limits load generation.
- **Gatling** — Scala/Java DSL, async, far higher VU density per injector, better reports. Best for CI-integrated performance regression gates.
- **k6** — JS-based, excellent for scripted CI checks and cloud execution, first-class Prometheus/Grafana output. Best DX of the three.
- Liferay also published [Liferay Commerce and Load Testing](https://liferay.dev/b/liferay-commerce-and-load-testing).

### 8.3 What a realistic Liferay test plan looks like

Non-obvious Liferay-specific requirements — this is high-value practical content:
1. **Authentication is stateful.** Script the full login POST to `/c/portal/login`, carry `JSESSIONID`, and handle sticky-session cookies from the LB.
2. **`p_auth` tokens.** Liferay embeds a per-session CSRF token (`p_auth`) in action URLs. You **must** extract it with a regex/CSS extractor from a prior page response and inject it into subsequent action requests, or every write returns an auth error. **This is the #1 reason naive Liferay JMeter scripts silently "pass" while doing nothing.**
3. **`p_p_id` / portlet namespace parameters** must be captured, not hardcoded — they change between environments.
4. **Realistic think time and a Gaussian/Poisson arrival model**, not zero-delay hammering.
5. **Mixed scenario weighting** matching production analytics — Liferay's own benchmark separates web content / Asset Publisher / documents / login precisely because their cost profiles differ by >2×.
6. **Cache warm-up phase** before measurement; discard the first N minutes. Liferay's multi-layer caching means cold numbers are meaningless.
7. **Test data volume must be realistic** — Liferay's own study used 100,000 users, 110,000 documents, 1,000 blog entries, 1,000 web content articles, 1,000 wiki pages. Permission-check cost scales with data volume; testing against an empty DB proves nothing.
8. **Anonymous vs authenticated split** — they hit completely different code paths (barebone vs everything JS, permission caching).
9. Measure **p95/p99, not averages**, and correlate with server-side CPU/GC/pool metrics.

### 8.4 APM and metrics

**JMX is the foundation.** Liferay exposes MBeans; `jdbc.default.registerMbeans=true` and `ehcache.portal.cache.manager.jmx.enabled=true` (default `true`) turn on pool and cache MBeans.

**Prometheus via JMX Exporter** — from [Monitoring Liferay Portal/DXP in Kubernetes](https://liferay.dev/b/monitoring-liferay-portal-dxp-in-kubernetes):
- Attach the JMX Exporter **Java agent** to *"extract the mBeans from the Liferay Portal / DXP JVM,"* exposing `/metrics` on a dedicated port (8081 in their example).
- Deploy via the **`LIFERAY_JVM_OPTS`** environment variable — the sanctioned Liferay-container way to add a `-javaagent`.
- Metrics captured: **Tomcat request counters, session statistics, servlet metrics, thread pool data, HikariCP database connection pools, EhCache statistics.**
- Kubernetes discovery:
```yaml
prometheus.io/scrape: "true"
prometheus.io/port: "8081"
```
- Also: [Viewing Metrics with Prometheus](https://learn.liferay.com/w/dxp/self-hosted-installation-and-upgrades/liferay-cloud-native-provisioning/running-liferay-dxp-in-aws/viewing-metrics-from-kubernetes/viewing-metrics-with-prometheus) is official Liferay docs for the AWS/K8s path.

**Dynatrace** — from [Liferay Digital Performance Management using Dynatrace](https://liferay.dev/b/liferay-digital-performance-management-using-dynatrace):
```
-agentpath:"C:\Program Files\Dynatrace\Dynatrace 7.0\agent\lib64\dtagent.dll"=name=Tomcat_Monitoring,server=sibl15exci:9998
```
appended to `CATALINA_OPTS` in `setenv.sh`/`setenv.bat`. A **Dynatrace Liferay FastPack** plugin provides a Liferay system profile with business transactions for: login/logout metrics, portlet **action** processing (Wiki, Web Content, Blogs, Documents & Media), **portlet render performance (identifies slow portlets)**, and client/server-side CSS and JS load times. Uses PurePath for cross-layer tracing. ⚠️ Caveats: the article targets Dynatrace 7.0 (dated), and contains **no concrete performance numbers**. The FastPack's currency for DXP 2025 is unverified — flag as "check before relying on it."

**New Relic / Elastic APM / OpenTelemetry:** all work via standard Java agents attached through `LIFERAY_JVM_OPTS` / `CATALINA_OPTS`; Tomcat + Spring + JDBC auto-instrumentation covers most of Liferay. **I found no Liferay-specific OpenTelemetry instrumentation library** — this is a genuine gap. OTel gives you HTTP spans and JDBC spans, but **portlet-level render spans require custom instrumentation** you'd write yourself. That's a legitimate "here's an open-source contribution opportunity" call to action for a DevCon audience.

**Glowroot** — recommended by Liferay's own [Performance tuning in Liferay - Part 1](https://liferay.dev/b/performance-tuning-in-liferay-part-1): free, open-source, low-overhead, and specifically good for Liferay because of its **query section** (aggregated slow queries — perfect for the `ResourcePermission` N+1 pattern), MBean views for cache metrics, flame graphs, and thread profiles (*search "blocked" status*). **Best cost/benefit tool in this section for a non-cloud Liferay install.**

**Real User Monitoring for Core Web Vitals:** since INP is field-only (§2.1), add Google's `web-vitals` JS — cleanly deployable as a `globalJS` client extension with `async: true, fetchpriority: "low"` (§1.6), which is a nice callback in the talk.

---

## 9. Published benchmark numbers

**This is the credibility section.** Liferay publishes real benchmark studies; most people don't know they exist.

### 9.1 Liferay DXP 7.4 Performance Benchmark Study (primary source)

[Liferay DXP Performance Benchmark Study of Liferay DXP 7.4 (PDF)](https://www.liferay.com/documents/10182/3292406/Liferay+DXP+Performance+Benchmark+Study+of+Liferay+DXP+7.4.pdf)

**Environment:**
- App server: **AMD Epyc Milan, 8 Cores, 16 vCPUs, 64 GB memory**, 160 GB balanced SSD storage
- Load injectors: AMD Epyc Milan, 4 Cores, 8 vCPUs, 32 GB
- Network: IPv4, 10 Gbps (for document tests)
- Stack: **Liferay DXP 2024.Q2.4**, **Zulu OpenJDK 21.0.2**, **Tomcat 9.0.87**, **Elasticsearch 7.17.18**, **Ubuntu Server 22.04**, **MySQL 8**
- Tool: **Grinder 3 load test client with Liferay customizations**
- ⚠️ **JVM heap settings were not disclosed in the document** — a significant reproducibility gap worth calling out.

**Test data volume:** 100,000 users, 110,000 documents, 1,000 blog entries, 1,000 web content articles, 1,000 wiki pages.

**Results:**

| Scenario | Peak / inflection | Response time | Notes |
|---|---|---|---|
| **Web Content (baseline)** | **25,000 concurrent users** | 95% of page views under 2 s, at **1,674 ms** (2-sigma) | Degraded past 25,500 users |
| **Asset Publisher** | **~11,000 virtual users** | **577 ms** mean, **1,159 ms** p95 | **Less than half of web-content capacity.** The study's summary says 15,000; Table 2 shows 6,164 ms 2σ there, so use its highlighted 11,000 row |
| **Document download** | 11,500 users (18,000 max tested) | **95% of 100 KB downloads in 5.96 ms** | |
| **Document upload** | 12,000 users | **392 ms** for 95% of users | |
| **Native IdP login** | 400 concurrent login attempts | **1,185.4 ms** (2-sigma) at threshold | **27,445 logins/hour** = 457/min |
| **Dedicated IdP** (LDAP/OAuth2 offloaded) | **19,000 virtual users** | **742 ms** mean, **1,106 ms** p95 | **2,070 TPS** |

**CPU utilization:** **93–94%** at peak page-view load; **92%** at peak login load — i.e. the tests were driven to genuine CPU saturation, which is methodologically sound.

**Three findings worth a slide each:**
1. **Asset Publisher costs ~2.3× a plain web content page** (11,000 vs 25,000 users). Directly actionable: convert dynamic Asset Publishers to static/manual selections or cached collections on high-traffic pages.
2. **Offloading identity to a dedicated IdP took login capacity from ~400 concurrent attempts to 19,000 virtual users.** The study simulated the IdP by turning native password encryption off, so read this as the cost of the hashing, not as a test of a real IdP. Native authentication (password hashing is *intentionally* CPU-expensive — bcrypt/PBKDF2) is a massive CPU sink on the app tier. Huge, counterintuitive, easily-actioned finding.
3. **One 8-core node served 25,000 concurrent users** for web content. Useful for right-sizing conversations and for pushing back on over-provisioning.

**Caveats to state honestly:** vendor-published; "concurrent users" is a load-model construct (with think time) not simultaneous requests — treat as relative, not absolute; heap config undisclosed; single-node app tier; the 2-sigma (95.4%) convention differs from the p75 used for Core Web Vitals; and content volume (1,000 articles) is modest versus many real installs.

### 9.2 Liferay Portal EE Reference Architecture

[Reference Architecture & Hardware Requirements](https://www.liferay.com/documents/10182/1645493/Liferay+Portal+EE+Reference+Architecture+&+Hardware+Requirements/7f618f87-ca55-4e39-ba21-b3faadbca206), quoted in the 7.4 Deployment Checklist:
- *"over **47,000 virtual collaboration users**"*
- *"over **79,000 logins per minute** with average login times under **312 milliseconds**"*
- Tier CPU utilization: 40% Web Tier, 95% Application Tier, <5% Database Tier. **Do not use: the fact-check in §6 of the summary could not find this split in either source.** The defensible figure is the 2024.Q2 study's 93–94% app-tier CPU at peak.

**The conclusion stands on the 2024.Q2 study, not on this split:** Tables 1 and 2 show 93–94% CPU on the single app server at saturation. Liferay is overwhelmingly CPU-bound in the application tier. Most teams instinctively blame and upsize the database, which is why §1 (front-end), §5 (JVM/threads) and portlet-count reduction matter far more than §6.4 (read replicas).

Reference hardware (per node, app and DB tiers): 2× Intel Xeon E5-2643 v4 3.40 GHz, 32 GB memory, 2× 300 GB 15K RPM SATA 6 Gbps.

### 9.3 Other published studies

- [Benchmark Study of Liferay DXP 7.3 on DXP Cloud](https://www.liferay.com/documents/10182/282340280/Benchmark+Study+of+Liferay+DXP+7.3+on+DXP+Cloud/37f8801f-6728-1bdb-9896-2e9920a2e46d?download=true)
- [Benchmark Study of Liferay DXP 7.4 on Liferay PaaS](https://www.liferay.com/documents/10182/3292406/Benchmark+Study+of+Liferay+DXP+7.4+on+Liferay+PaaS?download=true) — *blocked by robots.txt during this research; download manually*
- [Liferay DXP Performance Benchmark Study of Liferay DXP 7.3 (PDF)](https://www.liferay.com/documents/10182/3292406/Liferay+DXP+Performance+Benchmark+Study+of+Liferay+DXP+7.3.pdf/87a6985f-48de-df8a-de22-261a1fd7e5af?version=2.0&t=1615590133608&download=true) — *blocked by robots.txt; download manually for a 7.3→7.4 comparison*
- [Liferay DXP Performance: Benchmark Study of Liferay DXP 7.1](https://www.liferay.com/resources/product-info/Liferay+DXP+Performance+-+Benchmark+Study+of+Liferay+DXP+7.1)
- [DXP Cloud Benchmark 7.2 (via Izertis mirror)](https://www.izertis.com/documents/20126/1211706/Liferay+DXP+Cloud+Performance+Benchmark.pdf/d94f0858-dcce-7278-3279-b6e1af9a8d26?t=1616053535723)
- [Liferay 5.1 Performance Whitepaper](https://www.liferay.com/documents/10182/282340280/Liferay+5_1+Performance+Whitepaper.pdf/c312b307-c5be-484b-8dc4-7c61e250b210?t=1596856343663&download=true) — historical only; good for a "how far we've come" slide

**Gap to acknowledge on stage:** I found **no published Liferay Core Web Vitals / TTFB / LCP figures** from Liferay or partners. All published benchmarks are server-side throughput. **This is an opportunity** — if you run CrUX/RUM data on real Liferay sites and present LCP/INP/CLS distributions, that would be genuinely new material for the community.

---

## 10. Suggested talk structure & the "advice graveyard" (cut from the deck)

**Original opening, dropped:** "Half of what the internet tells you about Liferay performance is wrong — and I can prove it from Liferay's own source." The evidence doesn't support "half" (`docs/slide-3-verification.md`). The talk now opens on the ladder and the `curl` of a stock guest page.

**The former advice graveyard slide** — settings verified dead or reversed, kept as reference:
| Setting | Reality |
|---|---|
| `minifier.enabled` | **Deprecated**, defaults `false`, moved to build time. Published advice is mostly to turn it off. |
| `javascript.barebone.files` | **Deprecated + ships empty**; moved to BND manifest headers |
| `layout.parallel.render.*` | **Removed from the product** — hard-disabled 2015 (LPS-58748), properties deleted in 7.3 (LPS-110359). Almost nobody still recommends it. |
| `GZipFilter` | Defaults `false`, for BREACH and CPU; compress at the edge with brotli. Published advice is mostly to turn it off. |
| `StripFilter` | Defaults `false`; near-worthless once compressed |
| CMS GC (`-XX:+UseConcMarkSweepGC`) | **Removed in JDK 14**, fatal on HotSpot from JDK 15 — won't boot on the JDK 17 or 21 that DXP 2024.Q3+ *requires*. Printed in the 2023 Deployment Checklist; the current Go Live Checklist says G1. |
| `retryOnConflict=5` | *"No longer used as of Liferay 7.1"* |

**Then the real ranking — impact vs effort:**

*Tier 1 — do today (high impact, near-zero effort):*
1. Verify `portal-developer.properties` is **not** included in production (§1.1)
2. Tomcat JSP `development=false`, `mappedFile=false` (§5.4)
3. `index.on.startup=false` (§4.2)
4. Set `width`/`height` on all images; `loading="lazy"` except LCP (§3.4)
5. `fetchpriority`/`async` on non-critical client extensions (§1.6)
6. `font-display: swap` + `size-adjust` (§2.3)
7. Switch default reindex mode Full → Concurrent (§4.3)
8. `session.tracker.memory.enabled=false` (§5.5)

*Tier 2 — this quarter (high impact, moderate effort):*
9. **Reduce portlet/widget count on top pages** (§1.7) — usually the single biggest win
10. Adaptive Media configured **and regenerated** for existing content (§3.1)
11. Reserve space for custom-element widgets to kill CLS (§1.6)
12. Sticky sessions, drop session replication (§7.2)
13. HikariCP pool ≈ 2× `maxThreads`, watch pending-connections in JMX (§6.1)
14. Migrate off DBStore (§7.3)
15. CDN for static assets, minding `cdn.dynamic.resources.enabled` (§1.9)
16. Lower `trackTotalHitsLimit` on search-heavy pages (§4.1)
17. Offload authentication to a dedicated IdP — **worth ~47× login capacity** (§9.1)

*Tier 3 — strategic (high impact, high effort):*
18. AMD → ESM / Client Extension migration (§1.4)
19. Critical CSS automation (§2.3)
20. Generational ZGC on JDK 21: evaluated in the lab, no gain at 6 GB (§5.2); larger heaps untested
21. Read/write DB split — last resort, mind replication lag (§6.4)

**Closing data point:** 93–94% app-tier CPU at saturation in Liferay's own 2024.Q2 study. Stop upsizing your database.

---

## Sources

**Liferay official documentation (learn.liferay.com)**
- [Tuning Liferay](https://learn.liferay.com/w/dxp/self-hosted-installation-and-upgrades/setting-up-liferay/tuning-liferay)
- [Tuning Your JVM](https://learn.liferay.com/w/dxp/self-hosted-installation-and-upgrades/setting-up-liferay/tuning-your-jvm)
- [JVM Configuration reference](https://learn.liferay.com/w/dxp/self-hosted-installation-and-upgrades/reference/jvm-configuration)
- [Garbage Collection on Java 21 (KB, marked Legacy/unofficial)](https://learn.liferay.com/kb-article/garbage-collection-on-java-21)
- [Portal Properties (overview)](https://learn.liferay.com/reference/latest/en/dxp/propertiesdoc/portal.properties.html)
- [Clustering for High Availability](https://learn.liferay.com/w/dxp/self-hosted-installation-and-upgrades/setting-up-liferay/clustering-for-high-availability)
- [Database Configuration for Cluster Nodes (read/write split)](https://learn.liferay.com/w/dxp/self-hosted-installation-and-upgrades/setting-up-liferay/clustering-for-high-availability/database-configuration-for-cluster-nodes)
- [Session Replication with Tomcat](https://learn.liferay.com/w/dxp/self-hosted-installation-and-upgrades/setting-up-liferay/clustering-for-high-availability/session-replication-with-tomcat)
- [Installing Liferay Portal in a Clustered Environment (legacy KB)](https://learn.liferay.com/kb-article/installing-liferay-portal-in-a-clustered-environment)
- [Elasticsearch Connector Configuration Reference](https://learn.liferay.com/w/dxp/search/installing-and-upgrading-a-search-engine/elasticsearch/elasticsearch-connector-configuration-reference)
- [Reindexing Modes](https://learn.liferay.com/w/dxp/search/search-administration-and-tuning/reindexing-modes)
- [Elasticsearch Indexes Reference](https://learn.liferay.com/w/dxp/search/search-administration-and-tuning/elasticsearch-indexes-reference)
- [Using Adaptive Media](https://learn.liferay.com/w/dxp/digital-asset-management/publishing-and-sharing/using-adaptive-media)
- [Adaptive Media Configuration Reference](https://learn.liferay.com/w/dxp/digital-asset-management/publishing-and-sharing/using-adaptive-media/adaptive-media-configuration-reference)
- [Using a JavaScript Client Extension](https://learn.liferay.com/w/dxp/development/customizing-liferays-look-and-feel/using-a-javascript-client-extension)
- [Custom Element YAML Configuration Reference](https://learn.liferay.com/w/dxp/development/integrating-external-applications/creating-a-basic-custom-element/custom-element-yaml-configuration-reference)
- [Creating a Basic Custom Element](https://learn.liferay.com/w/dxp/development/integrating-external-applications/creating-a-basic-custom-element)
- [Client Extensions UI Reference](https://learn.liferay.com/w/dxp/development/customizing-liferays-look-and-feel/client-extensions-ui-reference)
- [Viewing Metrics with Prometheus](https://learn.liferay.com/w/dxp/self-hosted-installation-and-upgrades/liferay-cloud-native-provisioning/running-liferay-dxp-in-aws/viewing-metrics-from-kubernetes/viewing-metrics-with-prometheus)
- [Store Types (KB)](https://learn.liferay.com/kb-article/store-types)
- [What happened to barebone and everything.jsp files in Liferay 7.2?](https://learn.liferay.com/l/33783085)
- [Configuring Documents and Media Previews](https://learn.liferay.com/w/dxp/content-authoring-and-management/documents-and-media/devops/configuring-documents-and-media-previews)
- [Displaying Collections](https://learn.liferay.com/w/dxp/sites/displaying-content/collections-and-collection-pages/displaying-collections)
- [Sharing Libraries Between Custom Elements (course)](https://learn.liferay.com/course/building-frontend-applications-with-javascript-in-liferay/bfea-global-libraries-and-dependencies/bfea-sharing-libraries-between-custom-elments)
- [Unminified CSS (KB)](https://learn.liferay.com/kb-article/unminified-css)

**Liferay source code**
- [`portal-impl/src/portal.properties`, `master` branch](https://raw.githubusercontent.com/liferay/liferay-portal/master/portal-impl/src/portal.properties) — primary source for all verbatim property defaults
- [liferay/liferay-amd-loader](https://github.com/liferay/liferay-amd-loader)
- [liferay/liferay-course-frontend-client-extensions](https://github.com/liferay/liferay-course-frontend-client-extensions)
- [Render `<script>` nodes with type="module" (liferay-frontend-projects #858)](https://github.com/liferay/liferay-frontend-projects/issues/858)

**Liferay PDFs / benchmarks**
- [Liferay DXP Performance Benchmark Study of Liferay DXP 7.4](https://www.liferay.com/documents/10182/3292406/Liferay+DXP+Performance+Benchmark+Study+of+Liferay+DXP+7.4.pdf)
- [Liferay DXP 7.4 Deployment Checklist](https://www.liferay.com/documents/10182/3292406/Liferay+DXP+7.4+Deployment+Checklist.pdf/f3464a36-c0f0-6708-37dd-efe7b8270403?t=1643744619710) (this URL now serves the Go Live Checklist 2026.Q1; citations in this dossier refer to the replaced 2023 PDF)
- [Liferay DXP 7.3 Deployment Checklist](https://www.liferay.com/documents/10182/3292406/Liferay+DXP+7.3+Deployment+Checklist.pdf/bf1b2c5d-39df-94ab-41b9-77120f4543a8?t=1616026802771)
- [Liferay Portal EE Reference Architecture & Hardware Requirements](https://www.liferay.com/documents/10182/1645493/Liferay+Portal+EE+Reference+Architecture+&+Hardware+Requirements/7f618f87-ca55-4e39-ba21-b3faadbca206)
- [Benchmark Study of Liferay DXP 7.3 on DXP Cloud](https://www.liferay.com/documents/10182/282340280/Benchmark+Study+of+Liferay+DXP+7.3+on+DXP+Cloud/37f8801f-6728-1bdb-9896-2e9920a2e46d?download=true)
- [Benchmark Study of Liferay DXP 7.4 on Liferay PaaS](https://www.liferay.com/documents/10182/3292406/Benchmark+Study+of+Liferay+DXP+7.4+on+Liferay+PaaS?download=true) *(robots-blocked; manual download)*
- [Liferay DXP 7.3 Performance Benchmark Study](https://www.liferay.com/documents/10182/3292406/Liferay+DXP+Performance+Benchmark+Study+of+Liferay+DXP+7.3.pdf/87a6985f-48de-df8a-de22-261a1fd7e5af?version=2.0&t=1615590133608&download=true) *(robots-blocked; manual download)*
- [Liferay DXP 7.1 Benchmark Study](https://www.liferay.com/resources/product-info/Liferay+DXP+Performance+-+Benchmark+Study+of+Liferay+DXP+7.1)
- [Liferay DXP Cloud Performance Benchmark 7.2 (Izertis mirror)](https://www.izertis.com/documents/20126/1211706/Liferay+DXP+Cloud+Performance+Benchmark.pdf/d94f0858-dcce-7278-3279-b6e1af9a8d26?t=1616053535723)
- [Liferay 5.1 Performance Whitepaper](https://www.liferay.com/documents/10182/282340280/Liferay+5_1+Performance+Whitepaper.pdf/c312b307-c5be-484b-8dc4-7c61e250b210?t=1596856343663&download=true)

**liferay.dev engineering blogs**
- [Moving from AMD to Browser modules in Liferay DXP](https://liferay.dev/blogs/-/blogs/moving-from-amd-to-browser-modules-in-liferay-dxp)
- [Say Goodbye to liferay-npm-bundler: A Smoother Path with Standard JS Tooling](https://liferay.dev/b/say-goodbye-to-liferay-npm-bundler-a-smoother-path-with-standard-js-tooling)
- [Using webpack and ES modules in Liferay DXP](https://liferay.dev/b/using-webpack-and-es-modules-in-liferay-dxp)
- [Sharing Javascript Code and Libraries](https://liferay.dev/b/sharing-javascript-code-and-libraries)
- [Liferay Read-Write Database Splitting](https://liferay.dev/b/liferay-read-write-database-splitting)
- [Performance tuning in Liferay - Part 1](https://liferay.dev/b/performance-tuning-in-liferay-part-1)
- [Monitoring Liferay Portal/DXP in Kubernetes](https://liferay.dev/b/monitoring-liferay-portal-dxp-in-kubernetes)
- [Liferay Digital Performance Management using Dynatrace](https://liferay.dev/b/liferay-digital-performance-management-using-dynatrace)
- [Liferay Commerce and Load Testing](https://liferay.dev/b/liferay-commerce-and-load-testing)
- [Lazy loading Portlet](https://liferay.dev/blogs/-/blogs/lazy-loading-portlet)
- [Page Load Optimization using image lazy loading for Liferay page](https://liferay.dev/blogs/-/blogs/page-load-optimization-using-image-lazy-loading-for-liferay-page)
- [FE Client Extensions: Improving Developer Experience with HMR](https://liferay.dev/b/fe-client-extensions-improving-developer-experience-with-hmr)
- [From React App to React Client Extension in 5 Easy Steps](https://liferay.dev/b/from-react-app-to-react-client-extension-in-5-easy-steps)
- [The Future of Liferay & Java and How It Affects Liferay](https://www.liferay.com/blog/current-experiences/the-future-of-liferay-java-and-how-it-affects-liferay)

**Liferay Help Center / support / issues**
- [Clustering and High Availability (support.liferay.com)](https://support.liferay.com/w/clustering)
- [Read/Write split "Hypersonic is in use" warning](https://help.liferay.com/hc/en-us/articles/360057994172-When-attempting-to-use-a-Read-Write-database-split-configuration-the-Liferay-startup-logging-warns-that-Hypersonic-is-in-use)
- [Fragment UI performance degradation depending on fragment content](https://help.liferay.com/hc/en-us/articles/34200754262413-Fragment-UI-performance-degradation-depending-on-fragment-content)
- [LPS-60638: Improve CacheFilter hit rate for everything.jsp and barebone.jsp](https://issues.liferay.com/browse/LPS-60638)
- [LPS-57880: Parallel rendering seems to be failing](https://issues.liferay.com/browse/LPS-57880)
- [Lazy Load Images (Liferay Marketplace)](https://marketplace.liferay.com/p/lazy-load-images)

**Web performance standards**
- [web.dev — Web Vitals](https://web.dev/articles/vitals)

**Third-party / partner (lower authority — verify before quoting on stage)**
- [Xtivia — Tuning Basic JVM Performance for Liferay DXP 7](https://www.xtivia.com/blog/tuning-basic-jvm-performance-liferay-dxp-7/)
- [Surekha Tech — Liferay Performance Tuning](https://www.surekhatech.com/blog/liferay-performance-tuning)
- [Surekha Tech — Liferay Performance Testing using JMeter](https://www.surekhatech.com/blog/liferay-performance-testing-using-jmeter)
- [Surekha Tech — Minifying JavaScript and CSS to Optimize Liferay Theme Performance](https://www.surekhatech.com/blog/minifying-javascript-to-optimize-liferay-theme-performance)
- [Firelay — How-to: Testing and Tuning Liferay portals](https://firelay.com/learn/how-to-testing-and-tuning-liferay-portals/)
- [Thinking In Software — Load Tests with JMeter: Liferay Example](https://thinkinginsoftware.blogspot.com/2011/01/load-tests-with-jmeter-liferay-example.html)
- [O'Reilly — Liferay Portal Performance Best Practices, Ch.2 Load Balancing and Clustering](https://www.oreilly.com/library/view/liferay-portal-performance/9781782163688/ch02.html)
- [Liferay Savvy — Liferay Portal Monitoring with Prometheus and Grafana](https://www.liferaysavvy.com/2021/07/liferay-portal-monitoring-with_26.html)
- [Fast Forward IT — Liferay 7.4 Adaptive Media](https://www.fast-forward-it.de/en/b/liferay-7-4-adaptive-media-schnell-erklart)
- [foojay — The Ultimate 10 Years Java Garbage Collection Guide (2016–2026)](https://foojay.io/today/the-ultimate-10-years-java-garbage-collection-guide-2016-2026-choosing-the-right-gc-for-every-workload/)
- [OpenJDK ZGC Wiki](https://wiki.openjdk.org/spaces/zgc/pages/34668579/Main)
- [Elastic APM Java agent — Supported technologies](https://www.elastic.co/docs/reference/apm/agents/java/supported-technologies)

---

## Summary of what was done and key findings

I researched all nine assigned areas, prioritizing primary sources. The single most valuable methodological move was **downloading Liferay's actual `portal.properties` from the `master` branch of `liferay/liferay-portal`** rather than trusting docs — that's where the highest-value findings came from, and it let me quote defaults and comments verbatim.

**Highest-value findings for the talk:**

1. **Several once-standard Liferay settings are verifiably dead, though little current advice still recommends them.** `minifier.enabled` is deprecated and defaults `false`; `javascript.barebone.files`/`everything.files` are deprecated *and ship empty* (moved to BND manifest headers); `layout.parallel.render.enable` **no longer exists in the product at all**.

2. **Liferay's 2023 Deployment Checklist recommended CMS GC flags; CMS was removed in JDK 14 and the flag is fatal on HotSpot from JDK 15** — while DXP 2024.Q3+ *requires* JDK 17 or 21. The current Go Live Checklist 2026.Q1 has since moved to G1. Verified against the checklist PDFs and the JVM Configuration reference.

3. **Concrete benchmark numbers exist and are underused.** DXP 7.4 study (DXP 2024.Q2.4, JDK 21, 8-core node): 25,000 concurrent users for web content at 1,674 ms 2-sigma; Asset Publisher inflects at only ~11,000; dedicated IdP took login capacity from ~400 concurrent attempts to 19,000 users / 2,070 TPS. The study's **93–94% app-tier CPU** at saturation reframes the whole talk. (The "95% / <5%" tier split quoted elsewhere could not be verified; do not use it.)

4. **Client Extensions expose `async`/`defer`/`fetchpriority` declaratively in `client-extension.yaml`**, and `scriptLocation: head` is new in **2025.Q4**. This is the most current, actionable front-end lever and connects directly to Core Web Vitals.

5. **A genuinely Liferay-specific CLS cause** that generic web-perf advice misses: `customElement` client extensions are unhydrated zero-height elements until their JS runs, so every above-fold custom-element widget shifts layout unless space is reserved (`:not(:defined)` pattern).

6. **`trackTotalHitsLimit` defaults to `Integer.MAX_VALUE`** in the Elasticsearch connector — forcing exact hit counts on every query. An easy, under-discussed win.

**Where I flagged uncertainty rather than guessing:** Liferay publishes no maintained list of recommended supplementary DB indexes (I substituted a method); there is no Liferay-specific OpenTelemetry instrumentation (portlet-level spans need custom work); Adaptive Media is not documented to emit `srcset`, so responsive markup is the template author's job; no Liferay-published Core Web Vitals/TTFB figures exist anywhere — which I noted as an opportunity for original material. I also flagged a **live documentation defect** (the self-contradictory `combo.check.timestamp` comment in `master`) and a **direct contradiction between two official sources** on HikariCP pool sizing (180 vs 85 / "larger than thread pool" vs "30-40% of it"), with reasoning for which to follow. Two Liferay benchmark PDFs (7.3, and 7.4-on-PaaS) were robots-blocked and are noted for manual download.
agentId: a6634a7d9b6b79ff4 (use SendMessage with to: 'a6634a7d9b6b79ff4', summary: '<5-10 word recap>' to continue this agent)
<usage>subagent_tokens: 114961
tool_uses: 69
duration_ms: 1756730</usage>

---

# Research Brief — "Making Liferay Blazing Fast in Production"
## Part A: Code generators / precompiled static pages · Part B: AI vs. performance & cost

**Compiled:** 2026-08-11 · **Anchor versions:** Liferay DXP quarterly releases 2025.Q1(LTS) → 2026.Q2, Liferay SaaS/PaaS, Liferay CMS (GA April 2026), Liferay AI Hub (launched June 2026)

**How to read the confidence markers:**
- **[DOC]** — stated in official Liferay/framework/vendor documentation, URL captured
- **[3P]** — third-party or community source, credible but not vendor-authoritative
- **[UNVERIFIED]** — I searched and could not confirm this exists; treat as speculation on stage
- **[JUDGEMENT]** — my analysis, not sourced

---

# PART A — Headless Liferay + static / pre-rendered delivery

## A1. Liferay Headless APIs — what you actually get

### What it does
Liferay exposes its content model over REST (OpenAPI-described) and GraphQL. This is the data plane for any static-generation strategy. **[DOC]**

| Surface | Base path | Notes |
|---|---|---|
| Headless Delivery (content) | `/o/headless-delivery/v1.0/...` | structured content, blogs, documents, content sets, navigation menus, comments |
| GraphQL | `/o/graphql` | single endpoint + interactive playground **[DOC]** |
| Batch Engine | `/o/headless-batch-engine/v1.0/...` | bulk import/export |
| Objects (custom entities) | `/o/c/{objectName}` | auto-generated REST per Object |
| Admin/User/Commerce | `/o/headless-admin-user/...`, `/o/headless-commerce-.../...` | |
| MCP (2025.Q4+, beta) | `/o/mcp`, `/o/mcp/sse` | see Part B |

### The single most important performance fact — and it's a footgun

> "Collection and filter queries run against the search index," while "single-entity lookups by ID or external reference code query the database directly."
> — [Consuming APIs, Liferay Learn](https://learn.liferay.com/w/dxp/integration/headless-apis/using-liferay-as-a-headless-platform/consuming-apis) **[DOC]**

**Consequences for a build pipeline:**
1. **Read-after-write is not guaranteed.** A content item published seconds ago may not appear in a `?filter=` query because it isn't indexed yet. Liferay's own guidance: after creating an entity, fetch it "by ID or external reference code instead of using a filtered query," e.g. `/o/headless-commerce-admin-catalog/v1.0/products/by-externalReferenceCode/{erc}`. **[DOC]**
   - **This is the #1 cause of "I published and the static build shows the old content" bugs.** A webhook-triggered rebuild that fires on `onAfterUpdate` can race the reindex. Mitigation: delay the build trigger, or have the build re-poll until the expected version appears.
2. **Your build's throughput is bounded by Elasticsearch/OpenSearch, not the DB.** Collection queries at build time hammer the search cluster.

### Filtering limits (matters for "generate all pages of type X")

> "the Headless Delivery API relies on the information provided by Elastic Search, so only those fields indexable by keyword would be filterable."
> — [Headless Delivery API - Filtering structured content](https://learn.liferay.com/kb-article/headless-delivery-api-filtering-structured-content) **[DOC]**

- To filter on a **user-defined content field**, you must use the structure-scoped endpoint:
  ```
  /content-structures/{contentStructureId}/structured-contents/?filter=contentFields/title eq 'MyTitle'
  ```
- **HTML and Select field types cannot be filtered.** For those, fall back to search:
  ```
  /content-structures/{contentStructureId}/structured-contents/?search='textWeWantToFind'
  ```
- **[JUDGEMENT]** For SSG this means: don't design your "which pages to build" query around a rich-text field. Model a keyword/text field explicitly (e.g. a `slug` or `status` field) so your build query is filterable.

### Batch API — the right tool for full-site builds
[Batch Engine export docs](https://learn.liferay.com/w/dxp/integration/headless-apis/using-liferay-as-a-headless-platform/consuming-apis/batch-engine-api-basics-exporting-data) **[DOC]**

Formats: `json`, `jsonl`, `jsont`, `csv`. Three-step async flow — verbatim:

```bash
# 1. Create the export task
curl \
	"http://localhost:8080/o/headless-batch-engine/v1.0/export-task/com.liferay.headless.admin.user.dto.v1_0.Account/json" \
	--header "Content-Type: application/json" \
	--request "POST" \
	--user "test@liferay.com:learn"

# 2. Poll until executeStatus == COMPLETED  (INITIAL -> COMPLETED | FAILED)
curl \
	"http://localhost:8080/o/headless-batch-engine/v1.0/export-task/1234" \
	--user "test@liferay.com:learn"

# 3. Download the zip
curl \
	"http://localhost:8080/o/headless-batch-engine/v1.0/export-task/1234/content" \
	--output file.zip \
	--user "test@liferay.com:learn"
```

Extras: `?siteId={siteId}`, `?filter=headline%20eq%20%27Able%27`, `?taskItemDelegateName=C_ObjectName` for custom objects, and `&batchNestedFields=permissions` (**Liferay DXP 2025.Q1+**). **[DOC]**

- **`jsont` is required for `*.batch-engine-dat.json` files used with batch client extensions** — i.e. this is the format that makes exports round-trippable into a site initializer. **[DOC]**

**[JUDGEMENT] Talk-ready line:** *For a 10k-page build, don't make 10,000 REST calls. Make one Batch export, download a zip, and generate from the local file. This is the difference between a 40-minute build and a 4-minute build.* (Consistent with the Next.js community finding in A6 that per-page API fetches are the dominant build cost.)

### OAuth2 for API auth
[Using OAuth 2.0](https://learn.liferay.com/w/dxp/integration/headless-apis/using-liferay-as-a-headless-platform/using-oauth2) · [Creating an OAuth2 Application](https://learn.liferay.com/w/dxp/integration/headless-apis/using-liferay-as-a-headless-platform/using-oauth2/creating-oauth2-applications) **[DOC]**

- Two application shapes: **Headless Server** (client credentials, service account, no user) and **User Agent** (authorization code + PKCE, acts as a user).
- **For a build pipeline you want Headless Server / client credentials.** The build is a machine; it should have a scoped service identity, not an admin's Basic auth.
- Token endpoint: `https://<host>/o/oauth2/token` **[DOC — pattern stated, exact path not shown verbatim in the excerpt I retrieved; verify against your instance before putting it on a slide]**
- Permissions needed: *Control Panel → Security → OAuth 2 Administration - Create Token* and *- View*. **[DOC]**
- Liferay's own React tutorial says the quiet part out loud: *"Basic authentication is used here for demonstration purposes. For production, you should authorize users via OAuth 2.0."* — [Remote Applications with Headless APIs](https://learn.liferay.com/w/dxp/liferay-development/building-applications/developing-a-javascript-application/using-react/remote-applications-with-headless-apis) **[DOC]**
- CORS: remote browser apps need the URL pattern (e.g. `/o/c/*`) added to Portal CORS Configuration. **[DOC]**

### Rate / performance characteristics
**[UNVERIFIED]** I could not find any published Liferay figure for headless API rate limits, requests/sec ceilings, or a "max calls before degradation" number. A Liferay Learn Q&A titled *"Is there a maximum number of calls to the headless API before performance degrades?"* exists in search results ([learn.liferay.com/l/33616651](https://learn.liferay.com/l/33616651)) but the page did not render usable content when fetched. **Do not quote a number on stage.** What *is* documented is generic container tuning ([Tuning Liferay](https://learn.liferay.com/w/dxp/self-hosted-installation-and-upgrades/setting-up-liferay/tuning-liferay)) **[DOC]**:
- Start at **50 threads**, up to **250** if average page response is 2–3s; Tomcat example `maxThreads="75" minSpareThreads="50"`
- HikariCP pool slightly larger than the thread pool: `jdbc.default.maximumPoolSize=180`, `jdbc.default.connectionTimeout=30000`, `jdbc.default.idleTimeout=600000`, `jdbc.default.minimumIdle=10`
- Comment out `include-and-override=portal-developer.properties` in production

**[JUDGEMENT]** The honest framing: *Liferay does not publish an API rate limit. That means your build IS your load test. A naive 10k-page SSG build is a self-inflicted DDoS against your own production DXP. Build against a read replica / dedicated delivery node, or use Batch export.*

**Impact vs. effort:** Headless APIs — **high impact, low effort** (they're already there). Getting the *query strategy* right (batch + ID lookups, not filtered per-page fetches) — **high impact, medium effort**, and it's the difference between the idea working and not.

---

## A2. Client Extensions in DXP 2025+ — can they replace portlet rendering?

### What they are
Client extensions let you extend Liferay **without deploying OSGi bundles into the portal JVM**. Frontend CX are static assets (JS/CSS) served from a URL that Liferay references; backend/microservice CX are external services Liferay calls. **[DOC]** — [Client Extensions](https://learn.liferay.com/w/dxp/development/client-extensions), [Client Extension Reference](https://learn.liferay.com/w/dxp/development/client-extensions/client-extension-reference)

### The full type list (from the reference)
**Frontend:** Theme Favicon · CSS · Theme CSS · JavaScript · JavaScript Import Map Entry · Theme Sprite Map · Frontend Data Set Filter · Frontend Data Set Cell Renderer · Editor Config Contributor · Static Content
**Widget-producing:** Custom Element · IFrame
**Configuration:** Instance Settings · OAuth Headless Server · OAuth User Agent
**Microservice:** Object Action · Object Validation · Object Entry Manager · Workflow Action · Notification Type · CAPTCHA
**Batch:** Batch · Site Initializer
**Commerce:** Checkout Step · Payment Integration · Shipping Engine
**[DOC]**

### Real `client-extension.yaml` — verbatim from `liferay/liferay-portal`
`workspaces/liferay-sample-workspace/client-extensions/liferay-sample-custom-element-1/client-extension.yaml`:

```yaml
assemble:
    -   from: assets/index.js
        hashify: index.js
        into: static
    -   from: assets/style.css
        hashify: style.css
        into: static

liferay-sample-custom-element-1:
    cssURLs:
        -   style.*.css
    friendlyURLMapping: vanilla-counter
    htmlElementName: vanilla-counter
    instanceable: false
    name: Liferay Sample Custom Element 1
    portletCategoryName: category.client-extensions
    type: customElement
    urls:
        -   index.*.js
    useESM: false
```
Source: [raw.githubusercontent.com/liferay/liferay-portal/master/workspaces/liferay-sample-workspace/client-extensions/liferay-sample-custom-element-1/client-extension.yaml](https://raw.githubusercontent.com/liferay/liferay-portal/master/workspaces/liferay-sample-workspace/client-extensions/liferay-sample-custom-element-1/client-extension.yaml) **[DOC — retrieved verbatim]**

**Note the `hashify:` key** — Liferay's own sample bakes content-hashed filenames at assemble time, then references them with globs (`index.*.js`). That's build-time work for infinite cacheability. It's the same "precompute" idea in miniature. **[DOC + JUDGEMENT]**

### Custom Element field reference
[Client Extensions UI Reference](https://learn.liferay.com/w/dxp/development/customizing-liferays-look-and-feel/client-extensions-ui-reference) **[DOC]**
- **Custom Element:** HTML Element Name (required), JavaScript URL (required), CSS URL, Use ES Modules, Instanceable, Portlet/Widget Category Name, Friendly URL Mapping, Properties
- **IFrame:** URL (required), Instanceable, Category, Friendly URL Mapping, Properties
- **CSS:** appends to `theme.css` · **JavaScript:** appends to `main.js` · **Theme CSS:** replaces `main.css` and `clay.css` · **Theme Favicon:** URL

### Official sample inventory (mirrored from liferay-portal)
[lgdd/liferay-client-extensions-samples](https://github.com/lgdd/liferay-client-extensions-samples) **[3P mirror of official samples]**
- **Custom elements:** `liferay-sample-custom-element-vanilla-js`, `-react-scripts`, `-angular`, `-react-dom`, `-react-clayui`, `-react-vite`
- **Import map:** `liferay-sample-etc-frontend-shared-import-map`
- **Global CSS:** `liferay-sample-global-css-company`, `-page`
- **Global JS:** `liferay-sample-global-js-page`, `-page-with-attributes`, `-instance`
- **IFrame:** `liferay-sample-iframe-counter`, `liferay-sample-iframe-wikipedia`
- **Theme CSS:** `liferay-sample-theme-css-styled`, `-unstyled`, `-token-definition`, `-unstyled-token-definition`
- **Theme spritemap:** `liferay-sample-theme-spritemap-single-svg`, `-multiple-svg`

Also: [lgdd/liferay-client-extensions-extra-samples](https://github.com/lgdd/liferay-client-extensions-extra-samples) (unofficial), [LiferayCloud/client-extensions-deep-dive-devcon-2023](https://github.com/LiferayCloud/client-extensions-deep-dive-devcon-2023).

### Can they replace portlet rendering?
[Micro Frontends](https://learn.liferay.com/w/dxp/development/customizing-liferays-look-and-feel/micro-frontends) **[DOC]**:
> "Basic custom elements use Liferay's frontend infrastructure to register external, remote applications with the Liferay platform and render them as widgets."
> "Custom element client extensions can use any technology, regardless of how it's built, packaged, or hosted."

**Answer, honestly: functionally yes, performance-wise it's a trade, not a win.** **[JUDGEMENT]**

| | Portlet (MVC/JSP) | Custom Element CX |
|---|---|---|
| Rendering | Server-side, HTML in first response | Client-side; server ships a placeholder tag |
| First paint | Content present | Content absent until JS loads + API round-trip |
| SEO / crawlers | Fine | Depends on crawler JS execution |
| Deploy | OSGi bundle into portal JVM | Static assets on CDN, zero JVM impact |
| Portal render-time cost | Counts toward server render time | ~0 |

- **SSR for custom elements: [UNVERIFIED].** The Micro Frontends doc does not mention SSR, and I found no Liferay documentation for server-rendering a custom element client extension. Liferay's 2020 frontend-infrastructure post mentioned SSR only as "under investigation" (prerender.io, GraalVM/j2v8) — [The State of Frontend Infrastructure](https://liferay.dev/blogs/-/blogs/the-state-of-frontend-infrastructure/1000). **That post is from January 2020 — do not present it as current strategy.**
- **The real perf win from CX is not rendering — it's operational.** Frontend CX assets live on a CDN, so they don't consume portal threads, don't go through Liferay's resource pipeline, and deploy independently. The [Page Audit Tool](https://learn.liferay.com/w/dxp/content-authoring-and-management/page-performance-and-accessibility/about-the-page-audit-tool) measures *server render time* per component — a custom element scores ~0 there while quietly moving the cost to the client. **Be honest on stage: this is cost-shifting, not cost-elimination, unless you also pre-render.** **[JUDGEMENT]**

**Impact vs. effort:** **Medium impact, medium effort** for perf specifically. **High impact** for team velocity / decoupled deploys / avoiding JVM redeploys. Don't sell CX as a page-speed feature; sell it as the *delivery mechanism* that makes a pre-rendered strategy deployable.

---

## A3. Static site generation against Liferay — what actually exists

### The 2026 context that reframes this whole section
- **Liferay CMS went GA as a fully headless CMS on 2026-04-09.** *"Liferay CMS builds on Liferay's decades of DXP leadership to deliver a fully headless offering"* — Julia Molano, Director of Product Management. Capabilities: **Spaces** (org units / asset-library-like repositories with folder-level permissions), stable documented APIs, AI-assisted translation/localization/content review, global content visibility, embedded analytics (views/downloads), multi-site management. — [BusinessWire](https://www.businesswire.com/news/home/20260409808009/en/Liferay-Introduces-Headless-CMS-to-Modernize-Digital-Content-Management) **[DOC — vendor press release]**
- **Feature-flag timeline for Headless CMS** (flag `CMS/LPD-17564`) — [Liferay Headless CMS docs](https://learn.liferay.com/w/dxp/content-management-system/liferay-headless-content-management-system) **[DOC]**:

| Version | Status |
|---|---|
| 2025.Q4 | Beta (feature flag) |
| 2026.Q1 | Release (feature flag) |
| 2026.Q2 | Release (feature flag) |
| 2026.Q3+ | **GA, no flag required** |

  It exposes *"REST and GraphQL APIs for full access and portability."*
- **Liferay DXP 2025.Q4** headline features: **New Liferay Headless CMS**, Composable Account Selector, automated DB repair on upgrade, **Liferay DXP MCP Server**. — [2025.Q4 release page](https://support.liferay.com/w/liferay-dxp-quarterly-release-2025-q4) **[DOC]**
- **2026.Q1 LTS** headlines: New Liferay Headless CMS, HubSpot Lead Capture, **Promote Content Among Environments**. — [2026.Q1 LTS](https://support.liferay.com/w/now-available-liferay-dxp-quarterly-release-2026.q1-lts) **[DOC]**
- **2026.Q2** headlines: Digital Sales Rooms (beta), Liferay Data Platform (private beta), Cloud Native Experience for AWS GA, **"Faster search reindexing"**, Style Books UX, New Global Menu. — [2026.Q2 announcement](https://liferay.dev/b/liferay-dxp-2026-q2-is-now-available-) **[DOC]**

### The hard finding you need to state on stage
**[UNVERIFIED — and I searched hard]** **There is no official Liferay-published Next.js, Astro, Nuxt, or Gatsby starter/sample repository.** Specifically:
- The `liferay/liferay-portal` sample workspace contains **zero** SSG-framework samples. Its custom-element samples are vanilla JS, React (CRA/DOM/ClayUI/Vite), and Angular — all **client-rendered SPAs**, none pre-rendered. (Inventory above.)
- The Liferay CMS GA press release **does not name any frontend framework**. Neither does the Headless CMS documentation. **[DOC — confirmed absence]**
- No `liferay-sample-nextjs`, `liferay-starter-astro`, or equivalent found under github.com/liferay.

**So the honest talk line:** *Liferay ships a headless CMS and tells you to bring your own frontend — but unlike Craft ([craftcms/starter-next](https://github.com/craftcms/starter-next)), Sanity, Strapi, or Contentful, Liferay ships no reference SSG frontend. You are writing the integration yourself. That is the single biggest hidden cost of this architecture.* **[JUDGEMENT, grounded in confirmed absence]**

### What community material does exist
- **[liferayx.com — "Architecting Headless Liferay: Next.js & GraphQL"](https://liferayx.com/blog/headless-liferay-graphql)** **[3P]**. Useful concepts, thin on substance. Confirms `/o/graphql` endpoint + playground; gives a REST↔GraphQL mapping table (`GET /v1.0/structured-contents` ↔ `query { structuredContents { items { id } } }`); recommends OAuth2 headers + CORS profiles; recommends **CDN-caching GraphQL responses with content-update webhooks as the invalidation trigger**. **Caveat for the speaker: it contains no production code, no benchmarks, and no ISR specifics.** Do not cite it as evidence of a working reference architecture.
- [Creating a React Client Extension](https://liferay.dev/b/creating-a-react-client-extension) and [From React App to React Client Extension in 5 Easy Steps](https://liferay.dev/b/from-react-app-to-react-client-extension-in-5-easy-steps) — official liferay.dev blogs, but **CSR only**.
- [fabian-bouche-liferay/sample-react-app](https://github.com/fabian-bouche-liferay/sample-react-app), [pt-liferay-solutions/raylife-d2c-web](https://github.com/pt-liferay-solutions/raylife-d2c-web) (the Raylife insurance demo referenced in the Micro Frontends docs) — **[3P]**, CSR.
- [liferay/liferay-frontend-projects](https://github.com/liferay/liferay-frontend-projects) — the Frontend Infrastructure team monorepo. **[DOC]** Worth citing as "where the frontend direction actually lives."

### Framework fitness for a Liferay source (version-agnostic principles) **[JUDGEMENT]**
| Framework | Fit | Why |
|---|---|---|
| **Next.js (App Router)** | Best | ISR + `revalidateTag`/`revalidatePath` map cleanly onto Liferay publish events; largest hiring pool; self-hostable |
| **Astro** | Best for content sites | Static by default; **server islands** are the exact "static shell + dynamic islands" model (A6); ships near-zero JS |
| **Nuxt** | Good | Nitro `routeRules` gives per-route `prerender`/`isr`/`swr` in one config block |
| **Gatsby** | **Avoid for new work** | Netlify folded Gatsby Cloud into its main platform; community consensus is maintenance-mode. See [Netlify: Evolution of Cloud Platform](https://www.netlify.com/blog/gatsby-cloud-evolution/), [gatsbyjs/gatsby Discussion #39062 "Is GatsbyJS Officially Dead?"](https://github.com/gatsbyjs/gatsby/discussions/39062) **[3P]** |

**Impact vs. effort:** **Very high impact, very high effort.** This is a re-platform of the delivery tier, not an optimization. Only justified when (a) the site is mostly anonymous read traffic, (b) content velocity is moderate, (c) you already have a frontend team.

---

## A4. ISR / on-demand revalidation — wiring a Liferay publish to a rebuild

### Next.js side (verified against current docs, v16.3.0, updated 2026-06-23)
[ISR guide](https://nextjs.org/docs/app/guides/incremental-static-regeneration) · [How revalidation works](https://nextjs.org/docs/app/guides/how-revalidation-works) **[DOC]**

Minimal ISR page — verbatim:
```tsx
// app/blog/[id]/page.tsx
export const revalidate = 60

export async function generateStaticParams() {
  const posts: Post[] = await fetch('https://api.vercel.app/blog').then((res) => res.json())
  return posts.map((post) => ({ id: String(post.id) }))
}

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const post: Post = await fetch(`https://api.vercel.app/blog/${id}`).then((res) => res.json())
  return (<main><h1>{post.title}</h1><p>{post.content}</p></main>)
}
```

Tag-based invalidation (the pattern you want for Liferay):
```tsx
const data = await fetch('https://api.vercel.app/blog', { next: { tags: ['posts'] } })
```
```ts
'use server'
import { revalidateTag } from 'next/cache'
export async function createPost() {
  revalidateTag('posts', 'max')
}
```

**Caveats you must put on a slide — all verbatim from the docs:** **[DOC]**
- "ISR is only supported when using the Node.js runtime (default)."
- **"ISR is not supported when creating a Static Export."** ← kills the "just `next export` to a bucket" plan
- "If any of the `fetch` requests used on a route have a `revalidate` time of `0`, or an explicit `no-store`, the route will be dynamically rendered." ← **one careless fetch silently de-statics the page**
- "When running multiple instances, the default file-system cache is per-instance. On-demand revalidation only invalidates the instance that receives the call." ← **you need a shared `cacheHandler` (Redis/DynamoDB) or your 6 pods disagree**
- "Background regeneration (stale-while-revalidate) runs on the instance that receives the triggering request. On platforms with per-request billing, this background work counts as additional compute." ← **hidden cost**
- "Proxy won't be executed for on-demand ISR requests… Ensure you are revalidating the exact path. For example, `/post/1` instead of a rewritten `/post-1`."
- Observability: `x-nextjs-cache` header → `HIT` | `STALE` | `MISS` | `REVALIDATED`
- Debug: `NEXT_PRIVATE_DEBUG_CACHE=1`
- `revalidatePath` "invalidates the cache entries but regeneration happens on the next request" — not eager. Pages Router `res.revalidate()` is eager; App Router eager regeneration is still "being worked on."

**Soft-tag internals** (useful for a deep-dive slide): route `/blog/hello` auto-generates `_N_T_/layout`, `_N_T_/blog/layout`, `_N_T_/blog/hello/layout`, `_N_T_/blog/hello`. Distributed coordination uses `updateTags()` (write invalidation to Redis) and `refreshTags()` (read before each request; **must catch errors or it becomes a request failure**). **[DOC]**

### Nuxt side
[Nuxt Rendering Modes](https://nuxt.com/docs/4.x/guide/concepts/rendering) **[DOC]** — verbatim:
```ts
export default defineNuxtConfig({
  routeRules: {
    '/': { prerender: true },
    '/products': { swr: true },
    '/products/**': { swr: 3600 },
    '/blog': { isr: 3600 },
    '/blog/**': { isr: true },
    '/admin/**': { ssr: false },
    '/api/**': { cors: true },
    '/old-page': { redirect: '/new-page' },
  },
})
```
Key distinction: `swr` caches on the server/reverse proxy; `isr` additionally pushes into the **CDN** cache on supporting platforms (Netlify/Vercel), persisting until next deploy. **[DOC]**

### Astro side
[Astro on-demand rendering](https://docs.astro.build/en/guides/on-demand-rendering/) and [Server islands](https://docs.astro.build/en/guides/server-islands/) — see A6.

### The Liferay trigger — three options, ranked

**Option 1 — Object Action of type "Webhook" (lowest effort)**
[Understanding Action Types](https://learn.liferay.com/w/dxp/building-applications/objects/creating-and-managing-objects/actions/understanding-action-types) **[DOC]**
Action types: **Notification**, **Add an Object Entry**, **Update an Object Entry**, **Webhook** ("Deliver a payload to a URL"), **Groovy Script** (PaaS and Self-Hosted only — *not available on SaaS*).
- Webhook config: **URL** — *"the destination where the external system listens for incoming POST requests from Liferay"*; **Secret** — *"An optional shared string used to verify the payload's integrity."*
- **Critical limitation, verbatim:** *"If your target endpoint requires OAuth 2.0, you must use an object action client extension instead."* ← Vercel/Netlify deploy hooks are usually secret-URL based, so plain Webhook works; anything OAuth-protected needs the microservice CX.
- **[UNVERIFIED]** The docs page I fetched did **not** enumerate `onAfterAdd`/`onAfterUpdate`/`onAfterDelete` trigger names or the payload schema. Verify on your instance before showing a payload on a slide.
- **Big caveat:** Object Actions are for **Objects**. Web Content / structured content publishing is *not* an Object. **[JUDGEMENT]** For web content you need Option 2 or 3.

**Option 2 — Object Action Client Extension (microservice)**
A `objectAction` type CX receives the event and can do OAuth2-authenticated calls out. **[DOC — type exists in the Client Extension Reference]**. Right answer when the build hook needs real auth.

**Option 3 — Model Listener / OSGi component (self-hosted / PaaS only)**
Classic `ModelListener<JournalArticle>` firing an HTTP POST. **Not available on SaaS** (no custom OSGi deployment). **[JUDGEMENT — consistent with the Groovy-Script-excluded-on-SaaS pattern documented above]**

**Also worth noting:** 2026.Q1 LTS added **"Promote Content Among Environments"** — a content-promotion pipeline. **[DOC]** **[JUDGEMENT]** This is the natural place to hang a build hook: promote-to-prod is a much better rebuild trigger than every-save-in-staging.

### The read-after-write race — say it out loud
Because *"Collection and filter queries run against the search index"* **[DOC]**, a webhook that fires on save and immediately triggers `next build` can generate from a **stale index**. Mitigations: **[JUDGEMENT]**
1. Debounce the webhook (30–120s) — also coalesces bursts of edits into one build.
2. Have the build fetch the changed item **by ID/ERC** (DB-direct, always fresh) and only use filtered queries for the *list* of things to build.
3. Poll-until-consistent: build waits until the expected `dateModified`/version appears in the index.

**Impact vs. effort:** **High impact, medium effort.** ISR is the single best cost/benefit item in Part A because it avoids the 10k-page full-build problem entirely. The Liferay-side trigger is where the effort actually is.

---

## A5. Precompiling Liferay pages themselves — what's real and what's not

Five candidate approaches. **Only two are viable; three are traps.**

### (a) Liferay's own Export/Import ("LAR") — **does NOT produce static HTML**
[Exporting/Importing Site Pages and Content](https://learn.liferay.com/w/dxp/sites/exporting-importing-site-pages-and-content) **[DOC]**
- LAR = Liferay Archive, a **dynamic-data transfer format** (pages, content, apps, themes, logos, permissions, settings).
- *"LARs are version dependent and can be imported into a site on another Liferay server, as long as the Liferay versions on each server are the same."*
- *"Exporting LARs is not a backup solution; it's intended for migrating data between environments."*
- Liferay auto-deletes LAR files after **30 days**.
- **Verdict: irrelevant to static delivery. It is a migration tool, full stop.** Kill this idea on stage before someone in the audience tries it.

### (b) "Publish to Live" / Staging — **also not static**
[Configuring Page Publishing](https://learn.liferay.com/w/dxp/sites/publishing-tools/staging/configuring-page-publishing), [Site Staging UI Reference](https://learn.liferay.com/w/dxp/sites/publishing-tools/staging/site-staging-ui-reference) **[DOC]**
- Staging publishes *data* from staging to live. The live site still renders dynamically on every request.
- **Verdict:** valuable as an **editorial gate and as a rebuild trigger** (see A4 Option 3 / "Promote Content Among Environments"), not as a rendering optimization.

### (c) Crawler-based export (wget / httrack / Crawljax) — **works, and is the classic hack**
**[3P / JUDGEMENT]** No Liferay-official support. General-purpose precedent: [Converting a dynamic site into static HTML documents (Renoir Boulanger)](https://renoirboulanger.com/blog/2015/05/converting-dynamic-site-static-copy/), [Crawljax](https://en.wikipedia.org/wiki/Crawljax) for JS-heavy crawling.
Typical shape:
```bash
wget --mirror --page-requisites --adjust-extension --convert-links \
     --no-parent --reject-regex '(/c/portal/|/group/control_panel|\?p_p_)' \
     https://www.example.com/
```
**What breaks — this is the honest list you asked for:** **[JUDGEMENT]**

| Feature | Breaks? | Why / workaround |
|---|---|---|
| Sign-in / `/c/portal/login` | **Yes** | Session-bound; must be excluded and proxied to live origin |
| Forms (Liferay Forms, Objects) | **Yes** | POST target + CSRF `p_auth` token is per-session |
| CSRF `p_auth` token in URLs | **Yes** | Baked-in tokens go stale → 403s. Must strip/rewrite |
| Search | **Yes** | Needs a live query; replace with a client-side index (Pagefind/Lunr) or a live search endpoint |
| Comments / ratings | **Yes** | Write path; needs an API island |
| Personalization / Segments / A-B | **Yes** | One frozen variant only |
| Language switcher / i18n | Partial | Crawl each locale prefix separately; N× build cost |
| Friendly URLs & redirects | Partial | `--adjust-extension` mangles extensionless URLs; needs rewrite rules |
| Adaptive Media image variants | Partial | Multiple URL variants must be enumerated |
| Analytics / cookie consent | Fine | Client-side |
| Portlet AJAX resource URLs (`p_p_resource_id`) | **Yes** | Live-origin passthrough required |

**Verdict:** viable for a genuinely static marketing/microsite/archive/event site. **Not** viable for a portal. **[JUDGEMENT]**

### (d) Reverse-proxy freeze (Varnish / nginx full-page cache) — **the pragmatic winner**
[Varnish Software: How to Speed up Liferay Web Portals with Varnish Enterprise](https://info.varnish-software.com/blog/how-to-speed-up-liferay-web-portals-with-varnish-enterprise) **[3P — vendor]**, [Varnish Cache Setup for Liferay on Nginx (liferay.dev)](https://liferay.dev/blogs/-/blogs/varnish-cache-setup-for-liferay-on-nginx) **[3P — community, on liferay.dev]**, [Comprehensive Guide to Configuring Liferay Behind a Reverse Proxy](https://liferay.dev/b/comprehensive-guide-to-configuring-liferay-behind-a-reverse-proxy-nginx-apache-) **[3P]**

What Varnish claims for Liferay:
- Caches *"static assets, HTML, images, CSS, JavaScript, APIs and other resources"* plus *"dynamic content that is identified by session IDs."*
- **JWT validation at the edge**: *"Validating JWTs in Varnish Enterprise can eliminate backend application calls and cache pages that were otherwise not cacheable."*
- **Edgestash + Xbody**: inject Mustache placeholders with user-specific data while keeping the template cacheable → **this is server-side "static shell + dynamic islands" without changing Liferay**.
- **ESI**: *"In Varnish Cache… each ESI subrequest is handled sequentially; risking head-of-line blocking. In Varnish Enterprise, ESI sub-requests are handled in parallel."* ← a real, quotable Enterprise-vs-OSS distinction.
- Invalidation menu: TTL, hard/soft purge, **ban** (regex), **Ykey VMOD** (tag-based purge — the Varnish analogue of `revalidateTag`), stale-while-revalidate.
- **[UNVERIFIED]** The Varnish article contains **no quantitative benchmark** — only a customer testimonial. **Do not quote a speedup number from it.**

**[JUDGEMENT] The talk's most defensible practical recommendation:** *Ykey-tagged Varnish + a Liferay Object Action / model listener that issues a tag purge on publish is functionally the same architecture as Next.js `revalidateTag`, costs a fraction of the effort, and requires zero frontend rewrite. If you only take one thing from this talk, take this one.*

### (e) Build-time fragment/theme generation
Liferay's own `hashify:` assemble step (see A2 YAML) is exactly this at the asset level. **[DOC]**
[Configuring Frontend Resource Caching](https://learn.liferay.com/w/dxp/security-and-administration/administration/configuring-liferay/virtual-instances/configuring-frontend-resource-caching) (**DXP 2025.Q4+**) **[DOC]**: Instance Settings expose a *Caching Strategy* — *"one hash per resource file"* for **infinite caching** — plus per-type Max-Age directives for CSS, JavaScript, Labels Modules (`all.js`), Tokenized CSS, Translated JS, and *Send No Cache Directive* toggles. Out-of-box resources already use hashed names, e.g. `clay.(tvERyCVfuRc).css`.
**Verdict:** free, low-risk, do it. Not transformative alone.

### CDN reality check — put this on a slide
- **Self-hosted Liferay CDN config**: `CDN Host HTTP` / `CDN Host HTTPS` + *Enable CDN Dynamic Resources*. — [Serving Static Resources via a CDN](https://learn.liferay.com/w/dxp/self-hosted-installation-and-upgrades/setting-up-liferay/using-a-cdn) **[DOC]**
- **"The CDN does not serve HTML pages."** *"The CDN does not serve resources that are dynamically loaded from external sources."* Also: *"Don't put anything on the CDN which requires permission checking or complex policy access."* **[DOC]**
- **Liferay SaaS CDN**: *"Cache mode is set to USE_ORIGIN_HEADERS and can not be changed."* — [Liferay SaaS CDNs Cache Mode](https://learn.liferay.com/kb-article/liferay-saas-cdns-cache-mode) **[DOC]**. Also confirms the rename: *"Liferay has renamed its Liferay Experience Cloud offerings to Liferay SaaS (formerly LXC) and Liferay PaaS (formerly LXC-SM)."*
  - **[JUDGEMENT] This is a big deal and under-appreciated.** `USE_ORIGIN_HEADERS` + unchangeable means **on Liferay SaaS your HTML caching behaviour is entirely determined by the `Cache-Control` headers Liferay emits.** You cannot force HTML caching from the CDN config panel. If you want static HTML at the edge on SaaS, you must either (a) get Liferay to emit cacheable headers, or (b) put your own CDN/frontend in front. **Verify this against your specific SaaS contract before asserting it on stage** — it's drawn from a short KB article.
- [CDN caching of images and JSON files](https://learn.liferay.com/kb-article/cdn-caching-of-images-and-json-files) **[DOC — not fetched in depth; flagged for the speaker to read]**

**Impact vs. effort table for A5:**
| Approach | Impact | Effort | Verdict |
|---|---|---|---|
| LAR export | None | — | **Not applicable** |
| Publish-to-live | None (perf) | Low | Use as *trigger*, not optimization |
| Crawler freeze | High (narrow scope) | Medium | Marketing sites only |
| **Varnish/nginx + tag purge** | **High** | **Medium** | **Best ROI** |
| Resource hashing / frontend caching | Low-medium | **Very low** | **Free win, do it today** |

---

## A6. The trade-off, honestly stated

### Build times at scale — real numbers
[vercel/next.js Discussion #14122 — "30 min for about 3k SSG-pages normal?"](https://github.com/vercel/next.js/discussions/14122) **[3P — community-reported, treat as directional]**

| Pages | Build time | Notes |
|---|---|---|
| ~2,000 | 30–35 min → 4–10 min after optimization | docs with translations |
| 3,000 | **30–35 min total** — ~8 min build, **12–14 min upload** (frequent S3 timeouts), ~10 min setup/cleanup | original poster, planning 15,000 |
| 12,000 | ~15 min build + **15+ min deployment (fails)** | |

**Bottlenecks identified:** (1) **the upload/deploy phase often exceeds the build phase**; (2) unoptimized per-page `getStaticProps` API calls; (3) re-fetching global header/footer/nav config once per page.
**Workarounds:** pre-fetch global data once and write it to a file; use `CI` env var to branch build-vs-runtime fetching; **selective rebuilds of only changed pages**; local file cache over Redis.

**[JUDGEMENT] Translate this to Liferay:** 10k pages × (1 content fetch + 1 nav fetch + 1 site-config fetch) = 30,000 HTTP round-trips to Liferay per build. At 50ms each with 10-way concurrency that's ~2.5 minutes of pure network — plus Liferay's Elasticsearch doing 10k collection queries. **Use Batch export + local JSON; cache nav/menus once.** This is the concrete engineering advice the talk should give.

**And the conclusion the data supports:** *at 10k+ pages, full SSG is dead. ISR / on-demand revalidation isn't an optimization on top of SSG — it's the only version that works.* Next.js's own doc lists as a headline ISR benefit: *"Handle large amounts of content pages without long `next build` times."* **[DOC]**

### The honest cost ledger

| Cost | Detail |
|---|---|
| **Editorial preview** | Liferay's page editor previews *Liferay's* rendering. If the real site is Next.js, **the preview lies**. You must build a separate draft-mode/preview route in the frontend that reads unpublished content — which needs elevated API auth and bypasses the cache. **This is the #1 reason headless CMS migrations get rolled back.** **[JUDGEMENT]** |
| **Staging** | Liferay Staging + your Git/CI branching are two independent promotion pipelines that must be kept in sync. 2026.Q1's "Promote Content Among Environments" helps but doesn't unify them. **[DOC + JUDGEMENT]** |
| **Time-to-publish** | Goes from ~0s (dynamic) to: webhook debounce + reindex wait + build + deploy + CDN purge. Realistically **1–15 minutes**. Editors *will* notice. Set expectations contractually. **[JUDGEMENT]** |
| **Second rendering stack** | Node runtime, its own CI/CD, its own on-call, its own CVE surface, its own scaling story, plus a **shared cache handler (Redis)** the moment you run >1 instance **[DOC]**. Plus per-request billing on background regeneration **[DOC]**. |
| **Read-after-write races** | See A1/A4. **[DOC]** |
| **Feature loss** | Everything in the A5(c) breakage table has to be rebuilt as an API island. |
| **Preview + search + forms** | Three separate re-implementations, minimum. |

### Hybrid "static shell + dynamic islands" — the recommendation
This is the architecture that survives contact with a real portal. Three concrete implementations, all documented:

**1. Astro server islands** — [docs](https://docs.astro.build/en/guides/server-islands/) **[DOC]**
> allows you to "on-demand render dynamic or personalized 'islands' individually, without sacrificing the performance of the rest of the page."

```astro
<Avatar server:defer />
```
```astro
<Avatar server:defer>
  <GenericAvatar slot="fallback" />
</Avatar>
```
Mechanism: at build, Astro replaces the deferred component with a small script + fallback; the static shell is CDN-cacheable with normal HTTP headers; islands are fetched via `GET` with **encrypted props in the query string**.
**Documented limitation, verbatim:** *"The browser limits URLs to a maximum length of 2048 bytes."* If exceeded, Astro switches to `POST`, **which browsers don't cache**. ← real gotcha for island props carrying user context.
UX note, verbatim: *"users will see the most critical parts of the page instantly. Fallback content will be visible for a short amount of time before the dynamic islands are then loaded."* — i.e. **you are trading a layout-shift/flash for TTFB.**

**2. Varnish Edgestash/Xbody + ESI** — same shape, server-side, no frontend rewrite (A5d). **[3P]**

**3. Liferay-native**: cache the page shell at the reverse proxy; render the personalized widgets as custom-element CX that call `/o/headless-delivery` client-side. **[JUDGEMENT]** — this is the lowest-effort hybrid and requires no new rendering stack at all.

### Impact-vs-effort summary for Part A **[JUDGEMENT]**

| Move | Impact | Effort | Do it? |
|---|---|---|---|
| Frontend resource caching / hashing (2025.Q4+) | Low-Med | **Very low** | **Yes, today** |
| CDN for static resources | Medium | Low | **Yes** |
| Page Audit Tool → fix flagged fragments | Medium | Low | **Yes** |
| Varnish/nginx full-page cache + tag purge on publish | **High** | Medium | **Yes — best ROI** |
| Custom Element CX for heavy widgets | Medium | Medium | Situational |
| Astro/Next static shell for the *marketing* subtree only | **High** | Medium-High | **Yes, scoped** |
| Full headless SSG of the whole portal | High | **Very high** | Only for anonymous-read, moderate-velocity sites |
| Crawler freeze of the whole portal | High | Medium | Microsites/archives only |
| Full SSG at 10k+ pages without ISR | — | — | **No. Don't.** |

---

# PART B — AI and performance / cost

## B7. AI features shipping *in* Liferay — and what they cost you

### The inventory

**Marketed capabilities** — [liferay.com/capabilities/artificial-intelligence](https://www.liferay.com/capabilities/artificial-intelligence) **[DOC — marketing page]**: content generation (ChatGPT integration), AI image creation, translation (Google Cloud Translation / Amazon Translate / Microsoft Translator / DeepL), auto-tagging (text + images), product recommendations, content recommendations, semantic search, chatbot integrations (Zendesk/HubSpot/Tidio/LiveChat/LivePerson), sales forecasting, performance insights. Covers *"Liferay SaaS/PaaS/Self-Hosted."*
**[UNVERIFIED]** The page gives **no pricing, no credit model, no BYO-key statement, and no version requirements.**

**Documented AI features** — [learn.liferay.com/w/dxp/ai](https://learn.liferay.com/w/dxp/ai) **[DOC]**: Generating Text Content Using AI (ChatGPT, your OpenAI key) · Generating Images Using AI (DALL·E) · Third-party translation · Auto-Tagging (assets + images) · AI Tools in Workspace (generate Liferay projects/code) · **Using Liferay as an MCP Server** · Automated live chat.

**Liferay AI Hub** — launched **June 2026**. [learn.liferay.com/w/ai-hub](https://learn.liferay.com/w/ai-hub/index), [liferay.com/capabilities/ai-hub](https://www.liferay.com/capabilities/ai-hub) **[DOC]**
> AI Hub is *"a low-code SaaS environment that brings agentic orchestration to Liferay DXP."*

- **SaaS-only.** No self-hosted option documented. Marketing page says **"Private Beta"** as a standalone SaaS offering. **[DOC]** — note the docs page and the marketing page disagree slightly on GA status; **verify current status before the talk.**
- Agent Builder: *"a drag-and-drop, low-code interface"* with *"a library of prebuilt nodes"* for LLM calls, data retrieval, custom code, API integrations. Guardrails and data sources configurable.
- Triggers: manual, scheduled, API call, or **in response to Liferay DXP events**.
- Models: *"You can add any LLMs you prefer,"* incl. ChatGPT, Gemini, Claude. Integrates MCPs from Microsoft and GitLab plus Liferay's own.
- Security: *"With strict data access policies and fine-grained permissioning"* — agents inherit user-level access.
- Admin surfaces: Agent Builder, Chatbots, Account Management, Configuration (environment URLs + API credentials), **Activity monitoring for token balance tracking**.
- **Pricing: the docs reference "token costs" and "remaining token balance" but disclose no rates, credit amounts, or limits.** **[UNVERIFIED]** — this is a real gap; if the talk claims a cost figure it must come from the audience member's own contract.
- Also: [Dealroom coverage](https://app.dealroom.co/news/feed/liferay-launches-ai-hub-to-help-enterprises-build-and-deploy-ai-agents-with-existing-security-infrastructure), [Manila Times / GlobeNewswire release](https://www.manilatimes.net/2026/06/03/tmt-newswire/globenewswire/liferay-launches-liferay-ai-hub/2357977/amp) (dated 2026-06-03 — I hit a rate limit fetching this; the date and headline are from search metadata) **[3P]**

**Content Site Generator** — [AI Is About to Change How We Build Liferay Sites (liferay.dev)](https://liferay.dev/b/ai-is-about-to-change-how-we-build-liferay-sites) **[DOC — liferay.dev blog]**
Built on AI Hub. Prompt-driven multi-page site generation with navigation and layout decisions; in-editor natural-language edits (*"Add a 3 column grid at the bottom with cards for the latest blogs"*); generates fragments when needed.
> *"The generator uses: Out-of-the-box fragments, Newly generated fragments when needed, Standard page composition, Style book-compatible components"*
> *"AI should accelerate composition, not bypass the platform."*
Targets **Liferay DXP 2026**, *"still evolving."* **No performance or cost data provided.** **[DOC — confirmed absence]**

**[JUDGEMENT] This is your bridge slide between Part A and Part B.** *Liferay's own AI site generator is a code generator. It runs at authoring time and emits standard fragments. That is precompute. It is the good kind of AI — the kind that costs you nothing per pageview.*

### Semantic search — the concrete "AI makes it slower and pricier" case study
[Semantic Search](https://learn.liferay.com/w/dxp/search/liferay-enterprise-search/semantic-search) · [Setting Up a Text Embedding Provider](https://learn.liferay.com/w/dxp/search/liferay-enterprise-search/semantic-search/setting-up-a-text-embedding-provider) · [Creating a Search Blueprint for Semantic Search](https://learn.liferay.com/w/dxp/search/liferay-enterprise-search/semantic-search/creating-a-search-blueprint-for-semantic-search) **[DOC]**

**How it works (two phases):**
- **Index time:** content is indexed normally → text snippets sent to an embedding provider → tokenized per configured model → vector returned → stored as Elasticsearch `dense_vector`.
- **Query time:** initial keyword match → **the search phrase is vectorized by the provider (a live network call on the request path)** → results re-scored by vector similarity within a configurable *window limit*.

**Requirements:** LES subscription. **OpenAI provider GA in Liferay DXP 2026.Q1+.** Beta providers behind flag `LPS-122920`: txtai, Hugging Face Inference Endpoints, Hugging Face Inference Provider. **[DOC]**

**Vector dimension ceilings** **[DOC]**:
| Engine | Max dims |
|---|---|
| Elasticsearch ≤ 8.10 | 2048 |
| Elasticsearch 8.11+ | 4096 |
| OpenSearch 2.12+ | 4096 |
> *"The Embedding Vector Dimensions must match that of the configured model."*

**The cost/perf knobs that matter — quote these:** **[DOC]**
- **Character limit:** *"Set the maximum number of characters to send to the text embedding provider. By default up to 500 characters"*, with truncation strategy Beginning / Middle / End.
  - **[JUDGEMENT] This is the single most consequential and least-discussed setting.** 500 chars is a *cost control*, not a quality setting. Raising it linearly raises your embedding bill and your indexing time — and silently changes retrieval quality. Show this slider on a slide.
- **Text embedding cache timeout: default 604,800 ms** *"to reduce provider requests."*
  - **[FLAG FOR THE SPEAKER]** The Liferay doc's own gloss says "(~10 minutes)" but **604,800,000 ms = 7 days; 604,800 ms = ~10.08 minutes.** The number and the unit are consistent with ~10 minutes; the value 604800 is also famously "7 days in seconds," which strongly suggests a units bug either in the doc or in the product. **Verify empirically before quoting.** Either way: **query-side embedding results are cached**, which is exactly the semantic-caching pattern in B9 — Liferay already does it.
- **13 supported asset types** (blogs, documents, web content, custom objects, …).
- **Latency:** re-scoring adds overhead vs. keyword-only search, bounded by the window limit.

**Search engine support:** Elasticsearch 8 is the default; OpenSearch requires a marketplace connector and **blacklisting** `com.liferay.commerce.elasticsearch7`, `com.liferay.portal.search.elasticsearch8.api`, `com.liferay.portal.search.elasticsearch8.impl`. Reported working combo for 2026.Q1.0-lts: OpenSearch 2.16.0, connector `api v1.1.1` / `impl v1.0.17`. — [Liferay Discuss thread](https://discuss.liferay.com/t/liferay-dxp-2026-q1-lts-opensearch-support/528) **[3P]**. Official: [OpenSearch docs](https://learn.liferay.com/w/dxp/using-search/installing-and-upgrading-a-search-engine/opensearch), [Search Engine Compatibility Matrix](https://support.liferay.com/w/search-engine-compatibility-matrix). **[DOC]**
**[UNVERIFIED]** No published semantic-search-on-OpenSearch guidance from Liferay was found.

### The tension, quantified — the slide the talk is built around **[JUDGEMENT]**

| Metric | Keyword search | Semantic search |
|---|---|---|
| Request-path network calls | 0 external | **1 embedding API call, synchronous** |
| Added p50 latency | — | provider RTT (≈50–300ms) + kNN rescore, **unless cache hit** |
| Added p99 latency | — | **provider timeout ceiling** — a slow OpenAI = a slow search page |
| Cost per query | ~0 | embedding tokens per uncached query |
| Cost per index | ~0 | embedding tokens **per document per reindex** |
| New failure mode | none | **third-party dependency in your search path** |

**Reindex is the sleeper cost.** Every full reindex re-embeds every document. 2026.Q2's *"Faster search reindexing"* **[DOC]** helps wall-clock but not the embedding bill.
**Napkin math** (using OpenAI's published embedding rate, B9): 100,000 documents × 500 chars ≈ 125 tokens each ≈ 12.5M tokens ≈ **$0.25 per full reindex** at `text-embedding-3-small` ($0.02/M). Cheap. **But at a raised character limit of 8,000 chars (~2,000 tokens): 200M tokens ≈ $4.00** — still cheap, but 16×, and the *indexing wall-clock time* scales the same way. **The real risk is latency and rate limits, not dollars.** Say that — it's the counterintuitive, credible point.

**Impact vs. effort:** Semantic search — **high user-value, negative page-speed impact, medium effort, low-but-nonzero cost.** The right framing is "spend the latency where it's earned (a search results page) and never on a landing page."

---

## B8. AI as a performance-engineering tool

This is where the evidence is strongest and the ROI is clearest, because **the cost is per-engineer-hour, not per-pageview.** **[JUDGEMENT]**

### Real, verified tooling

**1. Grafana Flame graph AI** — [docs](https://grafana.com/docs/grafana/latest/visualizations/simplified-exploration/profiles/investigate/flame-graph-ai/) · [Grafana Cloud version](https://grafana.com/docs/grafana-cloud/monitor-applications/profiles/flamegraph-ai/) **[DOC]**
- *"analyzes a flame graph and provides a plain English interpretation of the flame graph"* → bottlenecks, root causes, recommended fixes.
- **The number worth putting on a slide, verbatim:** *"the Flame graph AI's interpreter scored 100%. Beginners scored 25% and flame graph experts scored 83%."*
- Caveat, verbatim: interpretations are *"less detailed/nuanced"* than expert humans.
- Availability: **Grafana Cloud** via Grafana Assistant; **Grafana OSS v11.5+** via the LLM plugin. Requires a Pyroscope data source + Profiles Drilldown app.
- **[JUDGEMENT] This is the strongest single piece of evidence in the whole brief that AI is genuinely good at performance analysis.** It's a vendor-run study, so caveat it, but it's a *measured* claim with a control group — rare in this space.

**2. Chrome DevTools MCP** (Google, public preview Sept 2025) — [Chrome for Developers blog](https://developer.chrome.com/blog/chrome-devtools-mcp) · [Addy Osmani: "Give your AI eyes"](https://addyosmani.com/blog/devtools-mcp/) **[DOC]**
> *"Coding agents face a fundamental problem: they are not able to see what the code they generate actually does when it runs in the browser."*

Setup, verbatim:
```json
{
  "mcpServers": {
    "chrome-devtools": {
      "command": "npx",
      "args": ["chrome-devtools-mcp@latest"]
    }
  }
}
```
Tools include **`performance_start_trace`** (launch Chrome, load a URL, record a performance trace), network inspection, DOM/CSS inspection, console analysis, form automation.
Example prompts, verbatim:
- `"Please check the LCP of web.dev."`
- `"Localhost:8080 is loading slowly. Make it load faster."`
- `"A few images on localhost:8080 are not loading. What's happening?"`

**[JUDGEMENT] This is the single most demo-able thing in the talk.** Point a coding agent at a Liferay page, have it record a real trace, identify the render-blocking `main.css`/`clay.css` or the un-lazy-loaded hero image, and propose the fragment fix. Live. It works today, it's free, and it's Google-official.

**3. Lighthouse MCP server** — [danielsogl/lighthouse-mcp-server](https://github.com/danielsogl/lighthouse-mcp-server) **[3P]** — *"MCP server that enables AI agents to perform comprehensive web audits using Google Lighthouse with 13+ tools for performance, accessibility, SEO, and security analysis."*
Also relevant: Google shipped a **Lighthouse "Agentic Browsing" audit** in PageSpeed Insights — [Lucid Media explainer](https://www.lucidmedia.co.nz/blog/lighthouse-agentic-browsing-llms-txt-webmcp/), [Echovyn](https://www.echovyn.com/blog/pagespeed-insights-agentic-browsing-update) **[3P]** — which ties neatly to Liferay's own `llms.txt` support (below).

**4. Liferay Page Audit Tool** (the non-AI baseline you should show first) — [docs](https://learn.liferay.com/w/dxp/content-authoring-and-management/page-performance-and-accessibility/about-the-page-audit-tool) **[DOC]**
> *"The Page Audit tool displays performance-related information about the server render time, component type, component's origin, and cache status as well as warning messages about potential performance issues."*
- Per-component: **server render time (ms)**, component type (Fragment/Widget/Collection), origin (this page vs. Master page), **Cached / Not Cached**.
- Two built-in warnings: Collection Display fragments with **pagination disabled and >200 items**; large image fragments (→ adaptive media, lazy loading, or shrink the file).
- **Integrates Google PageSpeed Insights recommendations if configured with an API key.**
- **[JUDGEMENT] Best demo pairing in the talk:** Page Audit gives you per-fragment server render time and cache status as *structured data*. Feed that table to an LLM alongside a Chrome DevTools MCP trace and ask for a ranked remediation plan. That's a genuinely novel, Liferay-specific, AI-assisted workflow — and it's built entirely from documented pieces.

**5. Liferay as an MCP Server** — [docs](https://learn.liferay.com/w/dxp/ai/using-liferay-as-an-mcp-server) **[DOC]**
- Endpoints: `http://localhost:8080/o/mcp` (and `/o/mcp/sse` for SSE/debug)
- **Liferay DXP 2025.Q4+, behind beta feature flag `LPD-63311`**
- Clients: GitHub Copilot (VS Code), Cursor, Claude Desktop, Gemini CLI
- Auth: **Basic auth**, encoded into a header — `"Authorization": "Basic [basic auth token]"`. *"configuring the MCP server requires generating an authorization header using valid user credentials."* The AI service **inherits the permissions of that user**.
- **[JUDGEMENT] Say the security part clearly:** Basic auth + inherited user permissions + a beta flag = **do not point this at production with an admin account.** No documented token expiry or scope narrowing. This is a developer-workstation tool.
- **[UNVERIFIED]** The docs do not enumerate which tools/APIs the MCP server exposes.

**6. AI Tasks (community)** — [peerkar/ai-tasks](https://github.com/peerkar/ai-tasks) **[3P — community, LGPL v3]**
- *"A LLM integrated agent orchestration tool for Liferay."* Visual workflow designer, JSON export/import, REST-exposed workflows, standalone chatbots, workflow integration.
- Backend: **LangChain4J**, supports **MCP**.
- Requires **Liferay DXP 7.4 + Java 17**.
- Providers: Anthropic, Vertex AI, OpenAI, **Ollama (local)**, HuggingFace.
- **Cost guidance, verbatim and directly on-topic:** *"Always use quotas when integrating to external LLM service providers."*
- By Petteri Karttunen. Explicitly **not** an official Liferay offering: *"This software is provided 'as is', without warranty of any kind."*
- **[JUDGEMENT]** Great talk material — it's a pre-AI-Hub community answer to the same problem, it supports **Ollama for local/free inference**, and its README independently arrives at "use quotas."

### The specific use cases you asked about — evidence status

| Use case | Evidence | Verdict |
|---|---|---|
| Analyze flame graphs / profiles | **Grafana Flame graph AI, with a measured 100% vs 83%-expert score** **[DOC]** | **Proven** |
| Analyze browser perf traces / CWV | **Chrome DevTools MCP `performance_start_trace`** **[DOC]** | **Proven, and demo-able** |
| Review theme/JS for CWV regressions | Lighthouse MCP + DevTools MCP in a coding agent **[3P/DOC]** | Plausible, works in practice |
| Triage production incidents | LLM observability tooling is mature (Datadog LLM Observability, Langfuse, etc.) **[3P]** | Plausible |
| **Find N+1 queries** | **[UNVERIFIED]** — I found no tool or study specifically demonstrating LLM N+1 detection from APM traces. Static-analysis linters and APM rules already do this deterministically. | **Say it's speculation.** LLMs read a trace and *narrate* an N+1; they don't detect it better than an existing APM rule. |
| **Suggest indexes** | **[UNVERIFIED]** — no source found. Note that DB engines have had cost-based index advisors for 20 years. | **Say it's speculation.** |
| Generate load-test scripts | **[UNVERIFIED]** — no study found, but this is squarely in "LLMs write boilerplate code," which is well-established. | Plausible, low risk |
| **Auto-tune cache TTLs** | **[UNVERIFIED]** — no tooling found. | **Say it's speculation.** And note it's a bad idea: TTL is a *correctness* decision, not an optimization. **[JUDGEMENT]** |

**[JUDGEMENT] The honest editorial line for this section:** *AI is excellent at the interpretive half of performance work — reading a trace, explaining a flame graph, ranking findings, drafting the fix. It is not better than your existing tools at the detection half. Buy the interpreter, keep the detectors.*

**Impact vs. effort:** **High impact, low effort, bounded cost.** This is the best-value AI in the entire talk, precisely because it is used at development time and priced per engineer-hour rather than per pageview.

---

## B9. Cost control — the economics

### Prompt caching (the highest-leverage single lever)
[PromptHub: Prompt Caching with OpenAI, Anthropic, and Google Models](https://www.prompthub.us/blog/prompt-caching-with-openai-anthropic-and-google-models) **[3P — comparison; verify against each vendor's current pricing page before presenting]**

| | OpenAI | Anthropic | Google |
|---|---|---|---|
| Cache **write** cost | No extra cost | **+25% surcharge** | Standard input cost |
| Cache **read** discount | *"Up to 50% discount on cache hits"* | *"90% cheaper than normal token processing"* | *"75% less"* |
| TTL | 5–10 min (extendable to 1 hour off-peak) | 5 min, refreshed on each use | Default 1 hour, customizable |
| Minimum tokens | 1,024 | 1,024 (Sonnet/Opus) / 2,048 (Haiku) | 32,768 |
| Activation | **Automatic** | Manual (`cache_control`) | Manual (`CachedContent.create`) |
| Latency benefit | *"up to 80%"* reduction on cache hits | not specified | not specified |

**[JUDGEMENT] The design implication for a Liferay AI feature:** put your **stable prefix** (system prompt, brand voice, taxonomy, JSON schema, few-shot examples) first and the **variable content** last. That's a code-ordering change worth 50–90% of your input bill for free. Also note Anthropic's 5-minute TTL means caching only pays if your traffic is **continuous** — a bursty internal tool with 20-minute gaps pays the 25% write surcharge repeatedly and saves nothing. Sources for the "cache only pays if context freezes" critique: [Anthropic's 0.1x Cache Read Only Pays If Context Freezes](https://medium.com/kairi-ai/anthropics-0-1x-cache-read-only-pays-if-context-freezes-2094883cb3f7) **[3P]**, [Prompt Caching Economics: Cache-First Agent Design](https://www.digitalapplied.com/blog/prompt-caching-economics-cache-first-agent-architecture-2026) **[3P]**.

### Semantic caching — the measured result
[GPT Semantic Cache: Reducing LLM Costs and Latency via Semantic Embedding Caching (arXiv:2411.05276)](https://arxiv.org/abs/2411.05276) **[DOC — peer-reviewable preprint]**

Method: store **query embeddings in Redis**; on a new query, retrieve semantically similar prior queries and return the cached response without calling the LLM.

**Reported numbers:**
- **API calls reduced by up to 68.8%** across query categories
- **Cache hit rates 61.6%–68.8%**
- **Positive hit rate >97%** — *"confirming reliability of cached responses"*

Related: [GPTCache](https://www.researchgate.net/publication/376404523_GPTCache_An_Open-Source_Semantic_Cache_for_LLM_Applications_Enabling_Faster_Answers_and_Cost_Savings) **[3P]**, [Berkeley Sky Lab vCache](https://sky.cs.berkeley.edu/project/vcache/) **[3P]**, [Spheron: Semantic Caching for LLM Inference (GPTCache, Redis Vector Cache, Prompt Cache setup)](https://www.spheron.network/blog/semantic-cache-llm-inference-gpu-cloud/) **[3P]**.

**[JUDGEMENT] The Liferay-specific angle, and it's a good one:** *Liferay already ships a semantic cache and most people don't know it.* Semantic search's **text embedding cache timeout** setting **[DOC]** is exactly this pattern applied to search queries. And on a public site, the query distribution is brutally Zipfian — a handful of queries are most of your traffic. A 60–70% hit rate on Liferay search-query embeddings is entirely plausible.
**The correctness caveat you must state:** a semantic cache answers a *different but similar* question with a cached answer. That is a **correctness trade, not a free win**. For search-query embeddings it's safe (you're caching a vector, not an answer). For generated *answers* it is not — never semantically cache anything price-, permission-, or entitlement-dependent.

### Model routing / cascades
[Dynamic Model Routing and Cascading for Efficient LLM Inference: A Survey (arXiv 2603.04445v2)](https://arxiv.org/html/2603.04445v2) **[DOC — preprint survey]**

- **FrugalGPT**: router + DistilBERT quality estimator + stop judge; escalate only when the small model's answer fails the quality bar.
- **RouteLLM**: preference-data-trained router choosing between a capable and an economical model.
- **Cascades**: query progressively larger models, accept early when a threshold is met.

**Reported figures — quote these carefully as *paper claims*:**
- **MixLLM: "97.25% of GPT-4's quality at only 24.18% of the cost under time constraints."**
- **R2-Reasoner: "significant cost reductions (84.46% API cost savings) while maintaining competitive reasoning accuracy."**
- **GreenServ: "22% accuracy gain while reducing cumulative energy consumption by 31%"** vs. random routing.

Practitioner framing: [Splunk: How to Reduce Agent Cost by Model Routing](https://www.splunk.com/en_us/blog/artificial-intelligence/reduce-agent-cost-by-model-routing.html) **[3P]**, [NeuralTrust](https://neuraltrust.ai/blog/llm-model-routing) **[3P]**.

**[JUDGEMENT]** For Liferay: content summarization, tone adjustment, and auto-tagging are **small-model jobs**. Only translation-with-brand-voice and complex agentic content requests justify a frontier model. AI Hub's *"You can add any LLMs you prefer"* **[DOC]** is exactly the hook to implement routing — but **[UNVERIFIED]** I found no documentation of a built-in AI Hub router. Assume you build it in the Agent Builder graph yourself.

### Batch / async inference
[OpenAI Batch API FAQ](https://help.openai.com/en/articles/9197833-batch-api-faq) · [Batch API guide](https://developers.openai.com/api/docs/guides/batch) **[DOC]**
- *"Each model will be offered at **50% cost discount** vs. the synchronous APIs."*
- 24-hour turnaround window, **not modifiable**. If a batch exceeds the SLA, completed work is returned **and charged**.
- **Separate rate limits** from the synchronous API — embeddings capped at **1,000,000 enqueued requests**; other endpoints capped by input tokens per tier, not request count.
- Caveats: **no streaming**; **zero-data-retention policies do not apply to Batch**; cancellable, charged only for completed work.
- Anthropic offers a comparable 50% batch discount **[3P — see pecollective, finout links in Sources]**.

**[JUDGEMENT] This is the exact "precompute" move for AI.** Auto-tagging 100k documents, generating 100k meta descriptions, translating a content library, embedding a corpus — **none of these are request-path work.** Run them through Batch at 50% off, overnight, and store the result as a field on the entity. The **Liferay Batch Engine** (A1) is the natural companion: batch-export content → batch-infer → batch-import the enrichment back. **That round-trip is the single best concrete architecture in this talk.**

### Embed once, not per request
- **OpenAI embedding pricing: `text-embedding-3-small` at $0.02 per 1M tokens vs `text-embedding-3-large` at $0.13/M — a 6.5× premium.** — [TokenMix: OpenAI Embedding Pricing 2026](https://tokenmix.ai/blog/openai-embedding-pricing) **[3P]**, corroborated by [EmbeddingCost.com/openai](https://embeddingcost.com/openai) and [CloudZero: OpenAI API Pricing in 2026](https://www.cloudzero.com/blog/openai-pricing/) **[3P]**. **Verify on OpenAI's own pricing page before presenting.**
- **[JUDGEMENT]** Document embeddings are computed **once at index time** and reused forever (that's how Liferay semantic search works **[DOC]**). Query embeddings are computed **per search** — which is why the query-embedding cache exists. The asymmetry is the whole lesson: *embed the corpus once, cache the queries, never embed the same thing twice.*

### Edge inference
[Cloudflare Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/) **[DOC]**
- *"Workers AI is priced at **$0.011 per 1,000 Neurons**."* **10,000 Neurons/day free** on both Free and Paid plans.
- LLMs: `@cf/meta/llama-3.2-1b-instruct` **$0.027/M input, $0.201/M output**; `@cf/meta/llama-3.1-70b-instruct-fp8-fast` **$0.293/M input, $2.253/M output**
- Embeddings: `@cf/baai/bge-small-en-v1.5` **$0.020/M**; `bge-base-en-v1.5` **$0.067/M**; `bge-large-en-v1.5` **$0.204/M**
- Neurons are the unified billing unit across model types; token prices shown for comparison, billing happens in neurons.

**[JUDGEMENT]** Note `bge-small` at $0.020/M is line-ball with OpenAI `text-embedding-3-small` at $0.02/M — but runs **at the edge, next to your cached static shell**, and comes with a free daily allocation. For an Astro-server-island or Worker-based personalization layer in front of Liferay, this is the cheapest place to put a small model. **Liferay does not document Cloudflare Workers AI as a supported embedding provider** — supported providers are OpenAI (GA), txtai / HF Endpoints / HF Inference Provider (beta) **[DOC]**. So edge inference is a *frontend-layer* option, not a Liferay-semantic-search option. Be precise about that.

### How to stop an AI feature becoming unbounded per-pageview cost — the checklist **[JUDGEMENT]**

1. **Never call an LLM in a page render path.** If it's on the critical path, it's a defect.
2. **Precompute at publish.** Summaries, tags, meta descriptions, alt text, translations, embeddings → fields on the entity, generated once by a publish-triggered job.
3. **Batch what you precompute.** 50% off, documented. **[DOC]**
4. **Order prompts cache-friendly.** Stable prefix first. 50–90% off input. **[3P]**
5. **Semantic-cache the query side.** 61–69% hit rates measured. **[DOC]** Never cache entitlement-dependent answers.
6. **Route by difficulty.** Small model by default, escalate on a quality signal. **[DOC — survey]**
7. **Hard quotas per tenant/user/feature.** AI Tasks' own README: *"Always use quotas when integrating to external LLM service providers."* **[3P]** AI Hub exposes *"remaining token balance"* **[DOC]** — alert on it.
8. **Cap the input.** Liferay's 500-char embedding default is the model to copy. **[DOC]**
9. **Circuit-break on provider latency.** A semantic-search page must degrade to keyword search, not to a spinner.
10. **Instrument cost per feature, not per account.** You cannot cut what you cannot attribute.

**Impact vs. effort:** Prompt-ordering — **high impact, trivial effort**. Batch precompute — **high impact, medium effort**. Semantic caching — **high impact, medium effort, correctness risk**. Routing — **medium-high impact, high effort**. Edge inference — **medium impact, high effort**.

---

## B10. Precompute as the unifying idea

**The thesis:** *Static generation and AI cost control are the same engineering move — move expensive, repeatable work off the request path and onto the publish/build path, then cache the result and invalidate it by event.*

### The isomorphism — this is the closing slide

| | Static pages | AI features |
|---|---|---|
| Expensive operation | Render a page (DB + ES + template + portlets) | An inference call |
| Naive placement | Per request | Per request |
| Precomputed placement | Per publish (build/ISR) | Per publish (batch enrich, embed once) |
| Storage | CDN / ISR cache / Varnish | Entity field / vector index / semantic cache |
| Invalidation | `revalidateTag` / Ykey purge / webhook | content-change event re-runs enrichment |
| Staleness knob | `revalidate = 3600`, TTL | embedding cache timeout, re-enrich policy |
| Failure mode | serve stale (SWR) | serve last-good enrichment |
| Escape hatch for the genuinely dynamic | **server islands / ESI** | **live LLM call, rate-limited & circuit-broken** |
| Marginal cost at scale | **≈ 0** | **≈ 0** |

**Every row is the same architecture.** That's the talk.

### Supporting evidence for the claim, from sources already cited
- Next.js lists among ISR's benefits: *"Reduce server load by serving prerendered, static pages for most requests"* and *"Handle large amounts of content pages without long `next build` times."* **[DOC]**
- Astro server islands: *"on-demand render dynamic or personalized 'islands' individually, without sacrificing the performance of the rest of the page."* **[DOC]** — precompute the 95%, pay for the 5%.
- Liferay semantic search: document embeddings computed **at index time**, only the query is embedded live — **and even that is cached**. **[DOC]** Liferay itself already implements the thesis.
- Liferay client extensions `hashify:` at assemble time → infinitely cacheable assets. **[DOC]**
- Liferay Content Site Generator: AI at authoring time emitting **standard fragments**, *"AI should accelerate composition, not bypass the platform."* **[DOC]** — a code generator, zero request-path cost.
- OpenAI Batch API: **50% off** for accepting a 24h window — the market has literally priced the difference between request-time and precompute-time inference. **[DOC]**
- Batch-inference architecture literature: [Google Cloud: What is batch inference?](https://cloud.google.com/discover/what-is-batch-inference), [Model Serving Patterns: From Batch to Real-Time Inference](https://nerdleveltech.com/model-serving-patterns-from-batch-to-real-time-inference), [Best practices for batch inference on GKE](https://docs.cloud.google.com/kubernetes-engine/docs/best-practices/machine-learning/inference/batch-inference) **[3P/DOC]**

### The counter-argument you should pre-empt **[JUDGEMENT]**
Precompute trades **freshness and flexibility** for **latency and cost**. The failure mode is not slowness, it's **staleness and combinatorial explosion**: if content × locale × segment × device = 40 variants per page, precomputing all of them is worse than rendering on demand. **The dividing line is cardinality.** Precompute when the output space is small and the read:write ratio is high. Render live when the output is genuinely per-user. Server islands and ESI exist precisely to let you draw that line *within a single page* instead of *per page*.

---

## Quick-reference: what I could NOT verify

State these as open questions or omit them:

1. **No official Liferay Next.js / Astro / Nuxt / Gatsby starter repo exists.** Confirmed absence across github.com/liferay, the sample workspace, Liferay CMS docs, and the GA press release.
2. **No published Liferay headless API rate limits or throughput figures.** The Liferay Learn Q&A page on this ([learn.liferay.com/l/33616651](https://learn.liferay.com/l/33616651)) did not render content.
3. **No documented SSR support for custom element client extensions.**
4. **AI Hub pricing / token rates / credit amounts are not published.** Docs reference "token costs" and "remaining token balance" only. AI Hub GA-vs-private-beta status is stated inconsistently between the docs and the marketing page.
5. **Object Action webhook trigger names and payload schema** were not shown in the docs page I retrieved.
6. **Liferay's OAuth2 token endpoint path** (`/o/oauth2/token`) was given as a pattern, not verbatim — verify on your instance.
7. **The semantic-search embedding cache timeout of 604,800 ms is glossed in Liferay's docs as "~10 minutes"** — but 604800 is also 7 days in seconds. Possible units bug. Verify empirically.
8. **No evidence found** for LLMs outperforming existing tools at N+1 query detection, index recommendation, or cache-TTL auto-tuning. Present these as speculation.
9. **No quantitative benchmark** in the Varnish-for-Liferay vendor article.
10. **Liferay Micro Frontends docs do not discuss portlet replacement, JS import map details, or shared dependencies** — the comparison table in A2 is my analysis.
11. **No Liferay guidance found for semantic search on OpenSearch** (only Elasticsearch is documented in depth).
12. **Cloudflare Workers AI is not a Liferay-supported embedding provider.**

---

## Sources

**Liferay — Headless APIs & integration**
- https://learn.liferay.com/w/dxp/integration/headless-apis/using-liferay-as-a-headless-platform/consuming-apis
- https://learn.liferay.com/w/dxp/integration/headless-apis/using-liferay-as-a-headless-platform/consuming-apis/consuming-graphql-apis
- https://learn.liferay.com/dxp/latest/en/headless_delivery.html
- https://learn.liferay.com/w/dxp/integration/headless-apis/using-liferay-as-a-headless-platform/consuming-apis/batch-engine-api-basics-exporting-data
- https://learn.liferay.com/w/dxp/integration/headless-apis/using-liferay-as-a-headless-platform/consuming-apis/batch-engine-api-basics-importing-data
- https://learn.liferay.com/w/dxp/integration/headless-apis/using-liferay-as-a-headless-platform/consuming-apis/data-migration-center
- https://learn.liferay.com/kb-article/headless-delivery-api-filtering-structured-content
- https://learn.liferay.com/w/dxp/integration/headless-apis/site-apis/navigation-menu-api-basics
- https://learn.liferay.com/w/dxp/integration/headless-apis/using-liferay-as-a-headless-platform/using-oauth2
- https://learn.liferay.com/w/dxp/integration/headless-apis/using-liferay-as-a-headless-platform/using-oauth2/creating-oauth2-applications
- https://learn.liferay.com/w/dxp/integration/headless-apis/using-liferay-as-a-headless-platform/using-oauth2/using-oauth2-to-authorize-users
- https://learn.liferay.com/course/understanding-liferay-s-headless-apis
- https://learn.liferay.com/course/mastering-consuming-liferay-headless-apis/mclha-consuming-headless-apis/mclha-comparing-frontend-api-approaches
- https://learn.liferay.com/l/33616651 (did not render)
- https://liferay.dev/b/the-api-explorer
- https://liferay.dev/b/effective-liferay-batch
- https://liferay.dev/b/building-headless-apis
- https://learn.liferay.com/w/dxp/liferay-development/building-applications/developing-a-javascript-application/using-react/remote-applications-with-headless-apis

**Liferay — Client Extensions & frontend**
- https://learn.liferay.com/w/dxp/development/client-extensions
- https://learn.liferay.com/w/dxp/development/client-extensions/client-extension-reference
- https://learn.liferay.com/w/dxp/development/client-extensions/working-with-client-extensions
- https://learn.liferay.com/w/dxp/development/customizing-liferays-look-and-feel/client-extensions-ui-reference
- https://learn.liferay.com/w/dxp/development/customizing-liferays-look-and-feel/micro-frontends
- https://learn.liferay.com/course/mastering-liferay-frontend-client-extensions/mfcx-implementing-custom-uis-and-widgets-with-custom-elements/mfcx-understanding-custom-element-client-extensions
- https://learn.liferay.com/course/mastering-liferay-frontend-client-extensions/mfcx-customizing-liferay-s-look-and-feel/mfcx-configuring-caching-behavior
- https://raw.githubusercontent.com/liferay/liferay-portal/master/workspaces/liferay-sample-workspace/client-extensions/liferay-sample-custom-element-1/client-extension.yaml
- https://github.com/liferay/liferay-portal/tree/master/workspaces/liferay-sample-workspace
- https://github.com/lgdd/liferay-client-extensions-samples
- https://github.com/lgdd/liferay-client-extensions-extra-samples
- https://github.com/LiferayCloud/client-extensions-deep-dive-devcon-2023
- https://github.com/liferay/liferay-frontend-projects
- https://github.com/fabian-bouche-liferay/sample-react-app
- https://github.com/pt-liferay-solutions/raylife-d2c-web
- https://liferay.dev/b/creating-a-react-client-extension
- https://liferay.dev/b/from-react-app-to-react-client-extension-in-5-easy-steps
- https://liferay.dev/blogs/-/blogs/the-state-of-frontend-infrastructure/1000 (2020 — dated)

**Liferay — Releases, CMS, staging, caching, tuning**
- https://www.businesswire.com/news/home/20260409808009/en/Liferay-Introduces-Headless-CMS-to-Modernize-Digital-Content-Management
- https://learn.liferay.com/w/dxp/content-management-system/liferay-headless-content-management-system
- https://support.liferay.com/w/liferay-dxp-quarterly-release-2025-q4
- https://support.liferay.com/w/now-available-liferay-dxp-quarterly-release-2026.q1-lts
- https://liferay.dev/b/liferay-dxp-2026-q2-is-now-available-
- https://learn.liferay.com/w/dxp/self-hosted-installation-and-upgrades/upgrading-liferay/deprecations-and-breaking-changes-reference/2025-deprecations-and-breaking-changes
- https://learn.liferay.com/w/dxp/self-hosted-installation-and-upgrades/upgrading-liferay/deprecations-and-breaking-changes-reference/2026-deprecations-and-breaking-changes/2026-q1-default-setting-and-feature-flag-changes
- https://learn.liferay.com/w/dxp/sites/exporting-importing-site-pages-and-content
- https://learn.liferay.com/w/dxp/sites/publishing-tools/staging/configuring-page-publishing
- https://learn.liferay.com/w/dxp/sites/publishing-tools/staging/site-staging-ui-reference
- https://learn.liferay.com/w/dxp/self-hosted-installation-and-upgrades/setting-up-liferay/tuning-liferay
- https://learn.liferay.com/w/dxp/self-hosted-installation-and-upgrades/setting-up-liferay/using-a-cdn
- https://learn.liferay.com/w/dxp/security-and-administration/administration/configuring-liferay/virtual-instances/configuring-frontend-resource-caching
- https://learn.liferay.com/kb-article/liferay-saas-cdns-cache-mode
- https://learn.liferay.com/kb-article/cdn-caching-of-images-and-json-files
- https://learn.liferay.com/kb-article/ehcache-configuration-for-dxp-7.x
- https://www.liferay.com/capabilities/content-delivery-network
- https://learn.liferay.com/w/dxp/sites/optimizing-sites
- https://learn.liferay.com/w/dxp/content-authoring-and-management/page-performance-and-accessibility/about-the-page-audit-tool

**Liferay — Objects / webhooks**
- https://learn.liferay.com/w/dxp/building-applications/objects/creating-and-managing-objects/actions/understanding-action-types
- https://learn.liferay.com/w/dxp/low-code/objects/creating-and-managing-objects/actions/defining-object-actions
- https://learn.liferay.com/w/dxp/low-code/connecting-liferay-to-camunda/triggering-camunda-events-with-liferay-webhooks

**Liferay — AI & search**
- https://learn.liferay.com/w/dxp/ai
- https://learn.liferay.com/w/dxp/ai/using-liferay-as-an-mcp-server
- https://learn.liferay.com/course/using-liferay-as-an-mcp-server
- https://learn.liferay.com/w/ai-hub/index
- https://www.liferay.com/capabilities/ai-hub
- https://www.liferay.com/capabilities/artificial-intelligence
- https://liferay.dev/b/ai-is-about-to-change-how-we-build-liferay-sites
- https://learn.liferay.com/w/dxp/search/liferay-enterprise-search/semantic-search
- https://learn.liferay.com/w/dxp/search/liferay-enterprise-search/semantic-search/setting-up-a-text-embedding-provider
- https://learn.liferay.com/w/dxp/search/liferay-enterprise-search/semantic-search/creating-a-search-blueprint-for-semantic-search
- https://learn.liferay.com/w/dxp/search/liferay-enterprise-search
- https://liferay.dev/b/semantic-search-with-the-elastic-stack-and-liferay-enterprise-search-devcon25
- https://liferay.dev/b/introducing-the-semantic-search-capabilities-beta-in-dxp-7-4
- https://learn.liferay.com/w/dxp/using-search/installing-and-upgrading-a-search-engine/opensearch
- https://learn.liferay.com/w/dxp/search/installing-and-upgrading-a-search-engine/opensearch/opensearch-connector-configuration-reference
- https://support.liferay.com/w/search-engine-compatibility-matrix
- https://discuss.liferay.com/t/liferay-dxp-2026-q1-lts-opensearch-support/528
- https://learn.liferay.com/w/dxp/content-authoring-and-management/web-content/web-content-articles/generating-text-content-using-ai
- https://learn.liferay.com/w/dxp/content-authoring-and-management/documents-and-media/generating-images-using-ai
- https://github.com/peerkar/ai-tasks
- https://app.dealroom.co/news/feed/liferay-launches-ai-hub-to-help-enterprises-build-and-deploy-ai-agents-with-existing-security-infrastructure
- https://www.manilatimes.net/2026/06/03/tmt-newswire/globenewswire/liferay-launches-liferay-ai-hub/2357977/amp

**Frameworks — SSG / ISR / hybrid**
- https://nextjs.org/docs/app/guides/incremental-static-regeneration
- https://nextjs.org/docs/app/guides/how-revalidation-works
- https://nextjs.org/docs/app/api-reference/functions/revalidateTag
- https://nextjs.org/docs/app/api-reference/config/next-config-js/cacheHandlers
- https://nextjs.org/docs/app/guides/cdn-caching
- https://nextjs.org/docs/pages/building-your-application/rendering/static-site-generation
- https://github.com/vercel/next.js/discussions/14122
- https://vercel.com/kb/guide/how-do-i-reduce-my-build-time-with-next-js-on-vercel
- https://docs.astro.build/en/guides/server-islands/
- https://docs.astro.build/en/guides/on-demand-rendering/
- https://astro.build/blog/hybrid-rendering/
- https://nuxt.com/docs/4.x/guide/concepts/rendering
- https://nuxt.com/docs/4.x/getting-started/prerendering
- https://nuxt.com/docs/4.x/guide/best-practices/performance
- https://www.gatsbyjs.com/docs/reference/release-notes/gatsby-version-support/
- https://github.com/gatsbyjs/gatsby/discussions/39062
- https://www.netlify.com/blog/gatsby-cloud-evolution/
- https://github.com/craftcms/starter-next
- https://liferayx.com/blog/headless-liferay-graphql

**Caching / reverse proxy**
- https://info.varnish-software.com/blog/how-to-speed-up-liferay-web-portals-with-varnish-enterprise
- https://liferay.dev/blogs/-/blogs/varnish-cache-setup-for-liferay-on-nginx
- https://liferay.dev/b/comprehensive-guide-to-configuring-liferay-behind-a-reverse-proxy-nginx-apache-
- https://www.xtivia.com/blog/liferay-performance-tips-page-load-caching/
- https://renoirboulanger.com/blog/2015/05/converting-dynamic-site-static-copy/

**AI — perf engineering tooling**
- https://grafana.com/docs/grafana/latest/visualizations/simplified-exploration/profiles/investigate/flame-graph-ai/
- https://grafana.com/docs/grafana-cloud/monitor-applications/profiles/flamegraph-ai/
- https://developer.chrome.com/blog/chrome-devtools-mcp
- https://addyosmani.com/blog/devtools-mcp/
- https://github.com/danielsogl/lighthouse-mcp-server
- https://www.lucidmedia.co.nz/blog/lighthouse-agentic-browsing-llms-txt-webmcp/
- https://www.echovyn.com/blog/pagespeed-insights-agentic-browsing-update
- https://docs.datadoghq.com/llm_observability/
- https://www.langchain.com/resources/llm-observability-tools

**AI — cost economics**
- https://arxiv.org/abs/2411.05276 (GPT Semantic Cache)
- https://arxiv.org/html/2411.05276v1
- https://arxiv.org/html/2603.04445v2 (Dynamic Model Routing & Cascading survey)
- https://sky.cs.berkeley.edu/project/vcache/
- https://www.researchgate.net/publication/376404523_GPTCache_An_Open-Source_Semantic_Cache_for_LLM_Applications_Enabling_Faster_Answers_and_Cost_Savings
- https://www.spheron.network/blog/semantic-cache-llm-inference-gpu-cloud/
- https://www.prompthub.us/blog/prompt-caching-with-openai-anthropic-and-google-models
- https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/prompt-caching
- https://help.openai.com/en/articles/9197833-batch-api-faq
- https://developers.openai.com/api/docs/guides/batch
- https://developers.cloudflare.com/workers-ai/platform/pricing/
- https://blog.cloudflare.com/workers-ai-bigger-better-faster/
- https://www.cloudzero.com/blog/openai-pricing/
- https://tokenmix.ai/blog/openai-embedding-pricing
- https://embeddingcost.com/openai
- https://www.finout.io/blog/anthropic-api-pricing
- https://medium.com/kairi-ai/anthropics-0-1x-cache-read-only-pays-if-context-freezes-2094883cb3f7
- https://www.digitalapplied.com/blog/prompt-caching-economics-cache-first-agent-architecture-2026
- https://openrouter.ai/docs/guides/best-practices/prompt-caching
- https://www.splunk.com/en_us/blog/artificial-intelligence/reduce-agent-cost-by-model-routing.html
- https://neuraltrust.ai/blog/llm-model-routing
- https://cloud.google.com/discover/what-is-batch-inference
- https://docs.cloud.google.com/kubernetes-engine/docs/best-practices/machine-learning/inference/batch-inference
- https://nerdleveltech.com/model-serving-patterns-from-batch-to-real-time-inference
agentId: afcb9415d37d2f5d1 (use SendMessage with to: 'afcb9415d37d2f5d1', summary: '<5-10 word recap>' to continue this agent)
<usage>subagent_tokens: 145024
tool_uses: 104
duration_ms: 1081560</usage>