# Dossier review, 2 November 2026

A full fact-check of `docs/liferay-performance-dossier.md`, section by section. Fixes were applied to the dossier, `docs/talk-outline-45min.md`, the deck and the repo. This file records the follow-up changes to the deck and repo, the crash investigation, tests only a person or a live system can do, and what nobody checked.

**Evidence used:** Liferay `master` from GitHub (commit `2dd40813f`, 2026-11-01), GitHub tags for older versions, the shipped `liferay/dxp:2026.q1.12-lts` image, current vendor docs, plain GETs to live sites, and the raw lab data. Local source under `/data/git/liferay/` was not used because it is outdated.

**Limits:** a claim marked "read from source" was not run. Nothing ran against a live Cloudflare zone, a Liferay instance or an SSO login. Prices and vendor plans are as of 2026-11-02.

## Changes made after the review

**Deck (Version 63, `deck/project/`, `deck/index.html`).** On screen: `wire` shows `GUEST_LANGUAGE_ID`; `cost` says "page renders"; `benchmark` says "Check the app tier's CPU first"; `s5purge` describes a BAN sent by script; `staticvsedge` states the box and k6 limits; `ask` asks "What is it, and can we have it?"; `rig` names Hypersonic; `s4rules` is labelled "in Varnish". The speaker notes on those slides and on `agenda`, `breach`, `close`, `isomorphism`, `ladder`, `s1`, `s2`, `s3`, `searchhl` and `wall` are corrected. These layouts have not been looked at rendered.

**Repo.** `cache-rules.md` rewritten with the bypass last, the `ID` clause fixed, a GET for verification and the SSO warning. S1 snippet uses `mappedfile`. S2 files use `ThreadsAwaitingConnection`, and `cluster.link.jmx.enabled` is gone. `MATRIX.md`, the k6 comments and the mock use `GUEST_LANGUAGE_ID`. Both VCL files compile on Varnish 7.6. `webhook.mjs` accepts `x-api-key` (202 with the right secret, 401 otherwise, tested locally). The webhook debounce default is now 30 s, and deltas look back 5 minutes (`DELTA_OVERLAP_MS`; syntax-checked, not run against Liferay). The `/navigation-menus` deprecation is noted in a comment, and the endpoint is unchanged.

**Found while fixing:** `matrix/local/apply-stage.sh` never touches `conf/web.xml`, so the JSP settings were never in the measured S1 runs. The dossier, outline and `s1` note now say so.

## The out-of-memory crash

Re-run on 2026-11-02 (`zgc-repeat.sh`, `cold-burst.sh`); full finding in `part1-simulations/results/RUNG-RESULTS.md` finding 5, evidence in `results/zgc-oom-2026-11-02/`.

| Heap | JVM starts | Crashed |
|---|---:|---:|
| Stock flags, 2.5 GB | 13 | 3 |
| ZGC, 6 GB | 40 | 2 |
| G1, 6 GB | 49 | 0 |

The crash is a runaway fragment render: one 2,047 MB `byte[]` built by jsoup's `outerHtml` in `FragmentEntryProcessorRegistryImpl.processFragmentEntryLinkHTML`, a link's text repeated four times followed by an endless `<a><a><a></a>` run. All five stock errors have the same stack. **The trigger is unknown:** cold-start bursts (6 G1, 6 ZGC) did not reproduce it, and 2 of 40 against 0 of 49, on different loads, does not show G1 is immune. It may be worth reporting to Liferay. Of the earlier ZGC stops, one was killed by a session restart and one by a bug in `stress.sh`.

## Still open in the repo

- `part1-simulations/matrix/S5-edge-purge/`: the Java purge module is an unbuilt sketch, and it tags by site and layout only.
- `part2-static-prototype/pipeline/fetch.mjs`: still calls the deprecated `/navigation-menus`, which Learn says keeps working.

## Tests to run before the talk

1. The Cloudflare rule set on a throwaway zone. The order, the expressions and the demo all come from docs.
2. An OIDC user through the edge. The SSO gap is the biggest safety claim in the talk and it comes from reading source.
3. The curl on a stock container, recorded, so the cookies read out match the screen.
4. The `www.liferay.com` curl the day before. The result changed between August and November.
5. The purge demo only if the module gets built; it is an unbuilt sketch.

## Not checked

Items each validator could not check, as listed in its report. Do not treat them as verified, and not all are marked in the dossier's text.

### v01: Part 00 synthesis (lines 1-200)

- L84, L133: judgement statements (cost framing, what works for SSG); nothing to check against.
- L129: entity/finder, fragment and Cluster Link detail; left to Part 01 validators.
- L130-132: `cdn.host.*`, duplicate `Cache-Control`, five personalization patterns; left to Part 02 and 03 validators.
- L134: AI cost and p99 ceiling; left to Part 05 validators.
- L146, L147, L149: demos need a live zone, which the brief excludes.
- L164: the first DXP quarterly without CacheFilter; DXP tags are not on GitHub.
- L176, L184: "no documented workaround" and "no published Core Web Vitals" are negatives; I ran no exhaustive search.
- L183: "Nobody has published guidance": negative, not searched.
- L183: whether the cached `authToken` is accepted; would need a POST, and the brief allows only GET.
- L163: Ehcache quote; the 2025.Q2 Breaking Changes page was not opened.
- L190-193: title options; not factual.
- Cloudflare request-cookie forwarding on a miss (used in the L98 reasoning): not confirmed from a doc.
- SAML: the cookies `BaseProfile` adds at line 634 were not named or traced.
- 2026.q3.1 binary: not scanned for the header; master was used as the newer source.

### v02: Part 01 headline findings, §1 Cache Filter, §2 Ehcache (lines 203-713)

- L230, "every release up to 7.4.3.122": only 7.4.0-ga1, 7.4.3.4 and 7.4.3.122 fetched; the commit history is consistent.
- L217, `[DOC]` half of the tag: no Liferay documentation page opened for this claim.
- L668, `eternal="false"` "implied": Ehcache 3 default expiry not confirmed from a primary source. Note a cache without `uses-template` does not inherit the template's `tti`.
- L685, whether `/ehcache/...` with a leading slash resolves at runtime: same form as the shipped default, not run.
- L695, whether clearing `osgi/state`, `work`, `temp` is required: KB says so; not tested.
- L702, "does not document off-heap": no exhaustive learn.liferay.com search.
- L703, mimacom article content, author and date: source unreachable.
- L406, usage advice ("cheap to recompute"): judgement, not checkable.
- L420, "echo storms": interpretation of intent; the calls exist.
- All cache sizing and override behaviour at runtime: nothing was started, per the brief.

### v03: Part 01 §3 Cluster Link and cache replication, §4 fragment, portlet, web content and template caching (lines 714-1156)

- L1116 "`loopCountThreshold` default `0` = unlimited": default confirmed; zero handling at `FreeMarkerManager.java:568` not traced into the loop limiter.
- L1037 "much slower page renders": no measurement found; not attempted, no load tests allowed.
- L1051 "Very high" impact, L1086 "High": no measurement in `part1-simulations/results/` mentions JournalContent; left as judgement.
- L1041 UI path "System Settings → Content & Data → Web Content": `category = "web-content"` and company scope seen; the rendered menu labels not viewed.

### v04: Part 01 §5 Service Builder caches, §6 Hibernate and HikariCP, §7 warming, §8 observability, §9 gotchas, Appendices A and B, Sources (lines 1157-1813)

- L1302: Hibernate L1 scope and cost; not traced through `SessionFactoryImpl`.
- L1333-1334: "self-inflicted outage", "costs measurable overhead"; opinion, no measurement looked for.
- L1542: "~an hour to wire into Prometheus JMX exporter"; opinion.
- L1565-1566: M × C bound and REMOVE flood; reasoning, no cluster run (no load tests allowed).
- L1579, L1586: tenuring and heap-dump sizing method; reasoning, not tested.
- L1609: split-brain behaviour at runtime and the advice to clear caches; I only checked for absence of merge code.
- L1618-1633 rows owned by other sections (Frontend Resource Caching, Cluster Link, fragment and template Cacheable); left to those validators.
- L1756-1761: ticket titles, not read (only LPS-49427 was fetched).
- L1683-1713, L1767-1787: page contents of most sources; only HTTP status and titles were checked, apart from those cited above.
- L1778-1792: gists and Ehcache 2.8 page content not read.
- L1796-1803: talk arc; it inherits the problems above, not checked on its own.

### v05: Part 02 executive summary, §1 Liferay's CDN support, §2 Document Library and Adaptive Media, §3 Liferay Cloud and SaaS (lines 1814-2186)

- L1824 "single highest-leverage" and L2024 "20 minutes": judgement, no evidence possible.
- L2097 "does **not** ship CDN-style signed/expiring URLs": only a narrow search (`presign|getSignedUrl|signedUrl|expiringUrl` in D&M and portal-store modules, no hits), not a full check.
- L2155 "All your leverage is in §1.5": the SaaS compatibility matrix (seen in a search result only) rates `portal-ext.properties` "Limited Compatibility", so `browser.cache.disabled` on SaaS is unconfirmed.
- L2021 whether classic `<script>` tags need CORS: not tested.
- L2061 "running on Liferay Cloud": only `via: 1.1 google` seen; no direct evidence.

### v06: Part 02 §4 Cloudflare specifics and §5 alternatives (lines 2187-2962)

- L2524 Liferay Integrated CDN quote: liferay.com/capabilities/content-delivery-network returned a client challenge to my plain GET
- L2478 "Liferay PaaS/SaaS, which is on GCP": outside what vendor docs show; KB shows only an "Ingress Load Balancer IP: 34.x.x.x"
- L2496 Argo ROI reasoning: no measurement available
- L2587-2593 filter plus ThreadLocal tag collection: not tested; response commit timing is a risk to check
- L2601 staging publication hook: no class named, nothing to verify
- L2645 Bot Management challenging non-browser user agents: not found in the pages I read
- L2662 what APO does internally (cookies, purge on save): only the plugin requirement is confirmed
- L2907 where Varnish beats a CDN, including ESI: opinion, not researched
- L2946 Akamai invalidate vs delete semantics: docs page exists by title and API section; content not read
- L2957 CloudFront "Minutes" and L2928 "eventually consistent": not stated on the AWS pages I read
- L2955 CloudFront "Partial": not researched
- L2959 best-fit row: opinion

### v07: Part 02 §6 auth boundary, §7 demo sequence, Sources (lines 2963-3239)

- L3056 "`max-age=31536000, immutable` on hashed files": no hashed URL retrieved; left to other validators and `S3-frontend/`.
- L3223 other observations (uncached page, hashed asset, combo, DL asset): not re-fetched.
- MFA login path (`multi-factor-authentication-web` `LoginMVCActionCommand:101-123`): did not trace whether it ends in `AuthenticatedSessionManagerUtil.login`, so `COMPANY_ID`/`ID` under MFA are unknown.
- Live behaviour of all rules on a real Cloudflare zone: no zone, and credentials are out of scope.
- End-to-end OIDC or SAML login against the lab: no containers may be started.
- L3099 Integrated CDN slide wording and L3094 "Frontend Caching" toggle: not checked.
- Non-Vulcan `/o/` servlets' `Cache-Control` values.
- Content of Sources beyond sampled pages: a 200 is not proof the page still says what the dossier cites.
- L3098 under-a-second claim and ModelListener wiring: not measured, only doc support for "Instant Purge".

### v08: Part 03 §0-§3, guest headers, HTTP semantics, why, killing the session (lines 3240-3840)

- L3299: fake `Cookie: JSESSIONID=ABC123` still HIT. The brief limits me to plain GETs, so I did not send a cookie.
- L3337: RFC 8246 `immutable`: text not read.
- L3355, L3360: Akamai/Varnish use of `Surrogate-Control`/`Surrogate-Key`, Fastly stripping: not read; left to v05.
- L3368: strong and weak ETag byte-range claim: RFC 9110 section not read.
- L3381-3382: `Vary: User-Agent`/`Accept-Language` cardinality: reasoning only, no source.
- L3793-3794: `beresp.grace`/`beresp.keep` as SWR and stale-if-error. Varnish doc fetch failed. From memory `keep` serves conditional refetches rather than stale delivery, so "week-old stale" is doubtful: worth a check.
- L3806: W2 claim that `SessionLessManagerBase` did this "at the Tomcat level": class existence confirmed through 7.4.0-ga1, class body not read.
- L3665: 5.2 cache-key source: 5.2 tree not read.

### v09: Part 03 §4 to §11 and Sources (lines 3841-4479)

- L3937, KB "Why is p_p_auth exposed": redirect page body not read
- L3977, Audience Targeting history: out of budget
- L4033, `beresp.do_esi` syntax: not opened
- L4034, Akamai ESI: not opened
- L4035, Cloudflare ESI blog content and upscalesoftware repo content: URLs return 200, content not read
- L4133, Kaleo script transaction timing: not traced
- L4177, full observed parameter list: not traced parameter by parameter
- L4182, "Liferay's way of avoiding `Vary: User-Agent`": inference, no source sought
- L4201, Wukonig article: 403
- L4211, "Configuring Friendly URL Redirects" and sitemap pages: not opened
- L4256, Gatsby blog content: URL returns 200, not read
- L4275, CloudFront and other `X-Cache` value formats; L4277-4279: not opened
- L4295, Boomerang, Datadog RUM, Catchpoint mentions: not opened
- L4336-4348, summary rows beyond those above: their backing claims are in other ranges
- L4356, "without a documented replacement": not searched
- L4392-4461, standards and vendor URLs: status 200 only, content not compared
- Any live portal behaviour: no container started, so listener firing and CSRF 403s are from source reading only

### v10: Part 04 §1 front-end delivery, §2 Core Web Vitals, §3 images and media, §4 search and Elasticsearch (lines 4480-5017)

- L4486 years: minifier 2020 (only that 7.3.4-ga5 is `true` and 7.4.0-ga1 is `false`), CMS 2020, `CacheFilter` 2024 (absent on master and q1.12; year not checked). Left to the §10 validator.
- L4758 "CPU as a second reason": `slide-3-verification.md:124` cites a frontend guidelines file; I did not open it.
- L4733 fragments "cache well", Collection Displays vs Asset Publishers: no evidence looked for.
- L4734 "does not ship a built-in lazy portlet": no negative search done.
- L4808-4819 INP and CLS cause lists other than those above: general reasoning, no check.
- L4923 vendor feature list for Cloudflare Images, Imgix, Fastly IO, Akamai, CloudFront: not fetched.
- L4959 "tens of GB" shard guidance: not fetched from Elastic.
- L5010, L5012 no first-class search cache: no cache class seen in `portal-search`, but not an exhaustive search.
- L4558 historical `barebone.jsp`/`everything.jsp` naming: not checked.

### v11: Part 04 §5 JVM, §6 database, §7 clustering, §8 load testing, §9 benchmarks, §10 graveyard, Sources, leftover summary (lines 5018-5610)

- L5079: Parallel GC "wrong for an interactive portal". Opinion, not tested in the lab, and no source read.
- L5207, L5209-5212: practitioner list, labelled as such; row counts not checkable without a real install.
- L5219: index write cost on ResourcePermission. Reasoned, no source.
- L5321: DBStore performance character. No source read beyond the class existing.
- L5338-5340: JMeter, Gatling, k6 characterisations. Generic; not opened.
- L5341, L5540, L5441 content: Commerce load-testing blog, 5.1 whitepaper; links only.
- L5349, L5351, L5354: test-plan advice. Reasonable practice with no checkable fact.
- L5353: barebone vs everything code paths. Property verified, runtime path not traced.
- L5367: k6-style annotations in the monitoring blog are images; only port 8081 verified in text.
- L5443: no published Liferay CWV figures. No TTFB, LCP or Web Vitals in the 7.3 and PaaS studies (grep), but a broader search wasn't run.
- L5597: `scriptLocation: head` new in 2025.Q4. Field exists on master (`GlobalJSCET.java`), version not traced; section is to be deleted anyway.
- L5599, L5603 (AM srcset, combo.check.timestamp): section to be deleted.
- L5022 onward, `cl74` provenance: copy from an earlier pass, not re-downloadable from Liferay; 7.3 PDF is live and has the same key passages.

### v12: Part 05 Part A, A1-A6: headless APIs, client extensions, static generation, ISR, precompiling, trade-offs (lines 5611-6087)

- L5707: Q&A `learn.liferay.com/l/33616651` still only redirects via script; title unconfirmed.
- L5825: Sanity, Strapi, Contentful starters, not looked up.
- L5919: Vercel and Netlify deploy hooks being secret-URL based, not looked up.
- L5947: LAR content list, not compared item by item.
- L5955: Staging behaviour; both doc pages return 200 but were not read.
- L5962: wget command, not run (no target allowed).
- L5968-5980: crawler breakage table except CSRF; [JUDGEMENT], no crawl run.
- L5985: two liferay.dev reverse-proxy posts, reachable but not read.
- L6032: "selective rebuilds" and "local file cache over Redis" seen only as fragments in replies.
- L5614: "AI Hub launched June 2026", belongs to Part B; only 2026.Q3 "Generally Available" seen.

### v13: Part 05 Part B, B7-B10, "what I could NOT verify", Sources (lines 6088-6545)

- L6236 "DB engines have had cost-based index advisors for 20 years": no source opened. Likely overbroad for MySQL and PostgreSQL core, not verified.
- L6235-6237 LLM N+1 and index evidence: one search found rule-based APM detection and no LLM evaluation for N+1. Index recommendation and load-test script literature not searched.
- L6295, L6296 "not modifiable", L6298 "charged only for completed work" on cancel, "no streaming": Batch FAQ 403; guide doesn't state these in those words.
- L6372 rate limits: `/l/33616651` shows only "Redirecting…". No wider search for published limits.
- L6260 Medium article (403); digitalapplied page exists, dated 2026-07-16, content not reviewed.
- L6272 GPTCache on ResearchGate (403); vCache and Spheron returned 200, content not read.
- L6289 Splunk, NeuralTrust: 200, content not read.
- L6360 Google Cloud and GKE links: 200, content not read; nerdleveltech 429.
- L6109 Dealroom link: 403.
- Sources, businesswire, liferayx.com and echovyn.com: curl gave no response; not concluded dead.
- L6117, L6161, L6167, L6240, L6242, L6291, L6329, L6363 judgement statements: opinion, not fact-checked beyond the items above. "Per engineer-hour" (L6167, L6242) has no pricing source.
- SXP degradation at L6326 and failure path at L6159: read on master, not run; same paths not traced in q1.12 beyond the classes named.
- Whether `gpt-image-2` (master default) has its own OpenAI retirement date: not looked up.
- Sources entries with 200 status: existence only, content not compared with the sections outside my range that cite them.

### v14: cross-cutting audit of lab numbers, consistency, references, sources, loose ends (whole dossier, lines 1-6544)

- PR #151255 "always 0" wording (L271): Part 01 validator's scope.
- `<layout-cacheable>` no consumer (L34): Part 01 validator's scope.
- `session.disabled`, `getSession()` (L40): Part 03 validator's scope.
- Finding 2 behaviour under a running stock DXP: not allowed to start containers.
- 18,656 hits and 16 misses: taken from `LAB-RESULTS.md` only; no raw Varnish counter file found.
- 55.7 s and 17-19 ms: taken from `LAB-RESULTS.md`; raw `S5-*` not recomputed.
- Sign-in 650 ms to 1.1 s and search CPU per unit: from `STRESS-RESULTS.md` tables, not recomputed; the p90 cores in `steps.csv` are consistent.
- Part 2 demo numbers (132 pages, 11 kB, 120 kB, $0.03): against `liferay.dev`, no stored run checked.
- `/o/*` duplicate header still live: not retested.
- AI Hub, OpenSearch, MCP tool list: see table.
- Content of 200-status URLs: only reachability checked, one fetch each. Soft 404s beyond redirects are not detected.
- `k6/publish-to-fresh.js` full poll loop: header and key lines only.
- Why ZGC part 1 and part 3 stopped.
- Chart PNG fallbacks in `deck/`: not opened. `charts.js` values checked.
- `README.md` at repo root and `part1-simulations/README.md`: not reviewed.
- `DELTAS.md`, `SUMMARY.md`: not reviewed beyond grep.
- PDF rows other than those listed.
- L6237, L6291 evidence.
- Liferay Learn current wording for any `[DOC]`.
