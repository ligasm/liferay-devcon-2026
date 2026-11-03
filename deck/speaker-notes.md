# Making Liferay Blazing Fast — speaker notes

## 1. Making Liferay blazing fast

[0:00–0:30 · 0:30]  
* Introduce yourself and Proventeq.  UK partner  
* importance of speed and size for AGI  


## 2. Two halves

[0:30–1:00 · 0:30]  
* Shape of the talk:  
   first we squeeze the portal the traditional way and measure every step; then we walk around the wall with a static site that regenerates itself from Liferay.  
* Part 1,  
   hygiene, JVM caches, front-end delivery, guest HTML at the edge, purge on publish. It ends at a ceiling tuning can't lift.  
* Part 2  
   for content-heavy sites, editors keep Liferay but visitors get plain HTML generated from the Headless API, rebuilt on change, and looking the same as the original. Demo.

## 3. The ladder

[1:00–2:15 · 1:15]  
* The frame for the whole talk: five rungs, one test  
   200 first visits a second, the HTML plus every file. Left: p95 for the whole page view. Right: CPU of the servers.  
* Rung 1, stock Liferay: 344 ms, 13 of 20 cores  
   Close to falling over.  
* Rung 2, fragments Cacheable: 37 ms, 8 cores  
   Nine times faster. The price: anything user-specific leaks.  
* Rung 3, assets at the edge: 8 cores down to 2  
   That surprised us. Most of a first visit was never rendering; it was Liferay serving 55 static files.  
* Rung 4, guest HTML as well: 8 ms, under one core  
   As long as auth stays out of the cache.  
* Rung 5, pre-rendered files: 3 ms, a tenth of a core  
   At the price of staleness and cardinality.  
* One box, no network: add your CDN's round trip to the top three  
   Then 8 against 3 stops mattering. What differs is what stands behind them: the edge needs Liferay for every miss and purge; a static page needs it only at build time.  
* Part 1 climbs to rung 4. Part 2 is rung 5.  
  
IF ASKED (not spoken)  
* Test. k6 open model, 60 s per rate, same weighted pages, Liferay restarted and warmed before each origin ladder. CPU is the mean of the serving containers; k6 is excluded. One 20-core box, k6 included, so the top rungs are bounded by k6. Hypersonic and sidecar Elasticsearch on a small site, so read these as ratios, not capacity. All numbers: RUNG-RESULTS.md.  
* Clean capacity, whole page views: 200, 200, 600, 1,200, about 10,000 a second. HTML alone: 400, 1,200 to 1,500, then 24,800 for both edge and static, where k6 is the limit.  
* CPU per page view: 66 ms, 41, 9.5, 4, 0.6.  
* Rung 1, S0. Every guest request enters the JVM, gets a session and is assembled from scratch. browser.cache.disabled=true sends private, no-store. This is close to the knee, so read 344 as about 300: an earlier run gave 269. At 600 pages a second stock also crashed, out of memory in a fragment render.  
* Rung 2, S2. Thread dumps at the 600 a second step: 179 of 261 runnable threads, 69 percent, parsing fragment FreeMarker. FragmentEntryFragmentRenderer returns cached output before any processor runs, keyed by link, locale and experience. No user in the key, hence the leak. S2 also changed heap, Ehcache, Hikari and connector. A stock run with Cacheable left on by accident matched it up to 200 pages a second and was then stopped; above that we rest on the thread dumps. Gains appear only under load: 30 against 29 ms at 20 page views a second, 30 against 25 at 80, HTML 17 against 17 ms at 100 pages a second. At 400 pages a second, HTML: 90 to 13 ms, 12.4 to 2.1 cores. Single node, so cluster invalidation is untested.  
* Rung 3. S3 plus Varnish with guest HTML passed to Liferay. Liferay falls to 1.3 cores, what HTML alone costs. The 6.9 cores it saved, 84 percent, were static files. This is the worst case, an empty browser cache; repeat visitors fetch fewer. Page weight drops from 2 MB to 625 KB because the VCL compresses assets, Liferay's GZipFilter is off.  
* Rung 4, S3 plus S4. browser.cache.disabled=false removes no-store for guests. Set-Cookie stays, so the VCL strips Cookie in and Set-Cookie out, bypasses on auth cookies, TTL 60 s, grace 1 h. Liferay idles at 0.05 cores.  
* Rung 5, S6. The fidelity build on nginx. A lighter page by design: 4.6 requests and 96 KB against 56 and 533. Sign-in and forms still need the portal.  
* Tried, no gain. S3 alone ties S2 for HTML. Generational ZGC ties G1 to 800 pages a second, uses a core more at 1,200, and both are clean to 1,200. Crashes: stock 3 of 13 starts, ZGC 2 of 40, G1 0 of 49, from a runaway fragment render (one 2 GB string), trigger unknown, not a GC verdict. Same config varied 2.1 to 3.0 cores between runs at 400 pages a second, so we ignore gaps smaller than that.  
* One that paid: search highlighting off, slide 17.

## 4. Stages stack, one layer at a time

[2:15–3:15 · 1:00]  
* Here's how we got those numbers.  
   One self-hosted DXP 2026.q1.12 on Tomcat, on a single 20-core box, with Varnish as the local edge and k6 as the load.  
* The stages stack.  
   Each one keeps everything before it and changes one layer. S4 is the core of Part 1, and S6 is Part 2.  
* S0 to S4 ran the same two passes  
   One near idle, and one under a mixed load of about 120 requests a second.  
* Every rung of the ladder also got a harder test  
   A first visit with an empty browser cache, the HTML and every file, at rising rates.  
* There are two exceptions.  
   S5 measures how fast a publish reaches the edge, and S6 has no sign-in, because static files have no server behind them.  
* A difference only counts if it's bigger than the noise between runs  
   So 1 against 2 milliseconds is a tie.  
  
IF ASKED (not spoken)  
* What's in the mix?  
   70% guest browsing, 15% search, 10% Asset Publisher and 5% sign-in, counted in journeys, not requests.  
* Why about 120 requests a second?  
   We asked for more, but k6's VU limit held it there. The shape was the same at every stage, so the comparison holds, but it's a light load.  
* Can I compare the ladder's p95 with the mix's?  
   No. The ladder times a whole page view, and the mix times each request.  
* Is S6's 2-millisecond search real?  
   No. That's only the static page shell, so it doesn't run a search.  
* Is the S5 purge time from the real module?  
   No. The test script sent the purge, because the Java listener is only a sketch, so it measures Varnish rather than the module.  
* Which scenarios?  
   Guest browse, a sticky-session variant, Asset Publisher versus plain page, search, real form login, document download, Headless list versus get-by-id.  
* Which metrics matter more than latency?  
   Edge hit ratio, set-cookie on guest requests, cache-control private, TTFB, publish-to-fresh.  
* Doesn't k6 share the box?  
   Yes, so its CPU is reported separately and it bounds the top rates.  
* What database?  
   The image defaults, Hypersonic and sidecar Elasticsearch, on a small site: 10 fragment pages, 14 posts, 323 search documents. DB-bound costs are optimistic, so read these as ratios, not capacity.

## 5. A stock guest page is uncacheable. Twice.

[3:15–4:15 · 1:00]  
* DEMO, 30 seconds: curl your own Liferay  
   Commands: docs/demos/demo1-curl.md. Fallback video: deck/recordings/demo1-curl.mp4.  
* The headers say no-store  
   It comes from browser.cache.disabled=true, which is the default; ServicePreAction emits it on every guest page, along with Pragma and Expires.  
* The cookies, independently, are the second reason  
   ServicePreAction calls getSession() unconditionally, so the first anonymous request gets three cookies: JSESSIONID, COOKIE_SUPPORT and GUEST_LANGUAGE_ID.  
* Either one stops a CDN that follows them  
   Unless you override it. session.disabled was last present in 7.4.0-ga1, with no replacement. The usual workaround is stripping the cookie at the edge.  
* Liferay deleted its own page cache in 2024  
   In their tests its hit ratio was "always 0, since none of our test URLs are cacheable", and the commit calls it "really useless". The edge is what's left. (CacheFilter, gone at 7.4.3.123; brianchandotcom/liferay-portal PRs 151255 and 151316.)  
* Our lab shows the same  
   100 percent of guest responses at S0 to S2 carried Set-Cookie and private, no-store, and every cookie-less guest request created a server session with a 15-minute timeout.  
* Bridge to the next slide  
   So a stock page can't be cached. How much can the portal take without a cache? Liferay's own benchmark says CPU runs out first.  
  
IF ASKED (not spoken)  
* What about SERVER_ID?  
   Liferay-hosted sites send it, stock does not, and it is not in the portal source.

## 6. Check the app tier's CPU first

[4:15–5:15 · 1:00 · if behind: cut the login and IdP numbers]  
* Liferay's own benchmark, one node  
   AMD Epyc, 8 cores, 16 vCPU, 64 GB.  
* 25,000 users on web content, 11,000 on Asset Publisher  
   Concurrent users, 93 to 94 percent CPU at the inflection, on a one-server test.  
* Native login degrades past about 400 concurrent attempts  
   With native password encryption turned off, which is how the study simulates a dedicated IdP, it reached 19,000, because password hashing is CPU by design.  
* Caveats  
   Vendor-published, the PDF says 7.4 but tested DXP 2024.Q2, and these are simulated users holding an open HTTP session, with no transaction rate given for page views.  
* Our lab agrees  
   On one 20-core box the tuned origin saturated on CPU at 1,200 guest pages a second, and sign-in topped out at 15 a second with 100 percent of busy threads in PBKDF2 password hashing.  
* Takeaway: check app-tier CPU before you upsize your database  
  
IF ASKED (not spoken)  
* Which server do those CPU columns mean?  
   The study doesn't name the server in those columns and gives no database CPU; the app server is the natural reading.  
* Doesn't the PDF say 15,000?  
   Its summary does, but its own Table 2 marks 11,000 as the inflection point and shows a 6.2 second 2-sigma response at 15,000, so we use the table.

## 7. Remove the noise first

[5:15–7:00 · 1:45]  
* Small, honest gains  
   S1 exists so every later stage measures the real thing.  
* index.on.startup=false  
   Don't reindex the whole search index on every restart. Already the default, but old checklists still list it.  
* session.tracker.memory.enabled=false  
   Otherwise every click of every live session stays in heap, purely to fill the Live Sessions admin screen.  
* Tomcat JSP development=false  
   Stops re-checking ROOT's JSPs every 4 seconds. This is Liferay's advice, and our measured runs did not apply it.  
* GZipFilter left off  
   Compression belongs at the proxy or edge, not in the JVM.  
* JDK 21 with G1  
   Remove old CMS flags: a JVM given them refuses to start. We tested ZGC as well, and it gave no gain.  
* No portal-developer.properties in production  
   It flips theme.css.fast.load, javascript.fast.load and the minifier to debug values all at once.  
* Measured: 49 to 35 ms at best  
   At 10 requests a second S1 changed nothing measurable. Under load the four-page guest browse p95 went from 49 to 35 milliseconds, but that includes a clean restart and the heap going from 2.5 to 4 GB, so treat it as an upper bound.  
* Guest pages are still not cacheable  
   Edge hit still zero, Set-Cookie and no-store on 100 percent of guest pages. Files in matrix/S1-hygiene.  
  
IF ASKED (not spoken)  
* What about ZGC?  
   We tested Generational ZGC against G1 and it gave no gain. It tied up to 800 pages a second and used about a core more at 1,200. Two of 40 ZGC starts crashed, but on a runaway fragment render, not on GC: one 2 GB string from jsoup. Stock hit the same stack, G1 at 6 GB has not in 49 starts, and we don't know the trigger.

## 8. Cache the fragments, not the pages

[7:00–10:30 · 3:30 · if behind: cut the Cluster Link internals]  
* Entity and finder cache sizing per hot entity  
   The usual advice, and on paper the biggest query-elimination lever. Our lab could not test it fairly, on in-process Hypersonic and not isolated: headless by-id stayed at 8 milliseconds, and the Asset Publisher page stayed about 30 at idle, though it went from 55 to 34 under load.  
* On 2025.Q2, rewrite your Ehcache XML  
   DXP 2025.Q2 moved from Ehcache 2.10.6 to 3.10.8, LPD-40485: your 7.4 liferay-multi-vm.xml must be rewritten for the 3.x schema.  
* Cluster Link: leave replication off  
   replicatePutsViaCopy is false by default; a PUT carries a null value and the receiver removes the entry. Turning replication on is almost always wrong. Use JDBC_PING for cloud discovery.  
* Cacheable checkboxes: audit first  
   Fragment and Web Content template checkboxes are high impact, but a cacheable template that renders anything user-specific leaks it to every viewer who passes the article's VIEW check. The fragment flag is what we measured; the template flag we did not.  
* HikariCP: size it from monitoring, not by a multiple  
   The shipped pool of 180 is already above the deadlock floor of maxThreads plus one.  
* Skip Hibernate L2 cache  
   It does not exist in Liferay.  
* Measured: a tie at low load, a big gap under load  
   17 against 17 milliseconds at 100 pages a second. At 400 pages a second, HTML p95 from 90 to 13 milliseconds and Liferay from 12.4 cores to 2.1. Clean capacity from 400 to 1,200 pages a second.  
* Why it works  
   Thread dumps of stock Liferay at its saturated 600 a second step showed 69 percent of busy request threads re-parsing fragment FreeMarker templates.  
* Cacheable is the single biggest lever we found for rendering pages  
   But every request still reaches the JVM.

## 9. Assets aren't slow, but they eat the CPU

[10:30–12:45 · 2:15]  
* cdn.host.https plus cdn.dynamic.resources.enabled  
   Covers theme and module JS and CSS, the combo servlet, ES modules and portal images. We did not measure cdn.host itself: there is no CDN in the lab, and rung 3 is Varnish on the same hostname.  
* It does not touch everything  
   Not Documents and Media, Adaptive Media, portlet resource URLs, or page HTML.  
* Documents and Media: its own Cache Control setting  
   Gotcha found on 2026.Q1: the PID is com.liferay.document.library.web.internal.configuration.CacheControlConfiguration; the old PID silently does nothing.  
* browser.cache.disabled=false  
   The first change that makes a guest page describable as cacheable.  
* browser.cache.signed.in.disabled=true, keep it  
   Signed-in pages keep sending private, no-cache, no-store.  
* Regenerate Adaptive Media for existing content  
* Lazy-load everything except the LCP image  
* Measured: S3 changes headers, not milliseconds  
   TTFB stayed flat, but guest HTML went from 100 percent private, no-store to zero, and the brochure PDF to public, max-age 86400.  
* Where assets do matter is CPU  
   On a first visit static files were 84 percent of Liferay's CPU until the edge cached them, which is rung 3.  
* Set-Cookie is still there  
   Which is why the edge must strip it.

## 10. Two rules, bypass first

[12:45–14:15 · 1:30]  
* The core of Part 1  
   Show the VCL in matrix/varnish/default.vcl.  
* Rule 1: bypass on any auth signal  
   COMPANY_ID, ID, USER_UUID, REMEMBER_ME, LOGIN, PASSWORD or an Authorization header, or the method is not GET or HEAD.  
* Rule 2: anonymous GETs get cached  
   Strip Cookie on the way in and Set-Cookie on the way out, drop utm, fbclid, gclid and _gl and sort the query, Vary on Accept-Encoding only, TTL from origin with a one-hour grace for stale-while-revalidate, browser TTL bypass.  
* Bypass comes first in Varnish  
   Because return pass ends evaluation.  
* Cloudflare is the reverse  
   The last matching rule wins, so the bypass goes last and the cache rule repeats the cookie exclusions; matrix/cloudflare/cache-rules.md, from the docs, never run on a live zone.  
* SSO warning  
   An SSO login sets none of these cookies, read from source, not run. Our VCL strips Cookie before the origin, so that user just looks signed out; a Cloudflare override has no such protection.

## 11. Get rule 1 wrong and it's a data breach.

[14:15–15:30 · 1:15 · do not skip this]  
* What goes wrong  
   One anonymous visitor gets a page cached from a signed-in render: a name in the user bar, a live p_auth token, somebody's dashboard. Every visitor after them gets it too.  
* We reproduced the mechanism in the lab  
   An OIDC user holds none of the bypass cookies, and on a Varnish model of these rules the next anonymous visitor got their name, email and authToken. Our own VCL stayed clean because it strips Cookie before the origin.  
* Password logins are covered; SSO logins are not  
* Cloudflare warns about it too  
   Its own Cache Everything docs say visitors may receive information not intended for them.  
* Defence in depth  
   Origin keeps Cache-Control private on signed-in responses, though a Cloudflare override TTL ignores it, browser TTL stays bypass even when edge TTL is long, and nothing on a public page may need authToken.  
* Optional 45-second demo  
   On a throwaway zone with a fake user.

## 12. S4 result: guest traffic at the edge

[15:30–17:30 · 2:00, including the 90-second demo]  
* DEMO: Varnish in front of the same Liferay  
   Commands: docs/demos/demo2-varnish.md. Fallback video: deck/recordings/demo2-varnish.mp4. The demo runs the mix for only 30 seconds, so its numbers differ: the video shows 8 milliseconds for the mix, 3 for guest browse and 96 requests a second. The slide's numbers are the full campaign, the same mix at about 120 requests a second.  
* Guest browse: 49 to 21 to 2 milliseconds  
   Measured, not mocked: the four-page journey's p95 at S0, S3 and behind Varnish, minus 96 percent overall. The whole mix went from 521 to 6 milliseconds.  
* Varnish counted 18,656 hits and 16 misses  
   Across the whole S4 campaign. The 4,902 passes are sign-in, the APIs and /c/ URLs.  
* The number that matters most: sign-in stays at 0 percent edge hit  
   Its signed-in page stays private, no-cache, no-store. A signed-in flow that still reaches the origin every time is the proof that rule 1 holds.  
* Never cache the login portlet's pages  
   The real run found a bug the mock never could: the login redirect page was cached with its Set-Cookie stripped, so every login through the edge failed with 403.

## 13. The edge is the step that counts

[17:30–18:15 · 0:45]  
* How to read the chart  
   Same mix at every stage, about 120 requests a second, p95 per flow on a log scale.  
* S0 to S3, traditional tuning: real, but linear  
   The four-page guest browse gains 2.3 times, and search goes from about a second to 650 milliseconds.  
* S4: every guest flow drops to 2 milliseconds  
   Guest browse, Asset Publisher and search alike, because the VCL caches the normalised query string.  
* Fourth panel: sign-in gets faster only because the origin has spare CPU  
   Liferay went from about 10 cores to 1.9 under the same load.

## 14. How far each stage goes

[18:15–19:15 · 1:00]  
* We stepped the rate up until each configuration broke  
   Clean capacity means under one percent dropped, under one percent errors, every flow's p95 under two seconds.  
* Stock Liferay: 400 guest pages a second  
   At 600 it has fallen over, and the thread dumps there say why: 69 percent of busy request threads were re-parsing fragment FreeMarker templates.  
* Fragments Cacheable plus the rest tuned: 1,200 a second  
   Limited by the host's CPU. That held in all four runs; 1,500 stayed clean in two of the four, so 1,200 is the number we trust.  
* Varnish in front: 24,800 a second, the lab's limit, not Varnish's  
   k6 needed 14 of the 20 cores, Varnish used 2.8, and Liferay sat at 0.2 cores creating no sessions. Raising our 2,000-thread limit on Varnish to 5,000 changed nothing, and static nginx stopped at the same number, so the limit is k6.  
* Twenty times the tuned origin, sixty times stock

## 15. Purge by tag, not by URL

[19:15–20:15 · 1:00]  
* The design: a ModelListener purges after commit  
   On JournalArticle, Layout and BlogsEntry it fires a purge by Surrogate-Key after the transaction commits, via TransactionCommitCallbackUtil, so the edge never re-caches the old version.  
* It is only a design  
   The module in matrix/S5-edge-purge is an unbuilt sketch, with Varnish and Cloudflare purgers.  
* Also purge when content stops being approved  
   Or takedowns stay cached until the TTL.  
* How we measured  
   k6/publish-to-fresh.js measures publish to fresh-at-edge in milliseconds: PATCH a News title while polling origin and edge every 250 milliseconds.  
* TTL alone, 60 seconds: old title for 55.7 seconds  
* A BAN right after the publish: fresh within one poll  
   Sent by script, which is what the listener would send: fresh within one 250 millisecond poll, with a 17 to 19 millisecond gap between the origin and edge requests, over three runs.  
* Say what is missing: classic web content still needs Java  
   Publications has a public SPI, CTEventListener.onAfterPublish, but no Learn page that we found, and Object Actions and webhooks cannot fire from JournalArticle or Layout, only from Objects.

## 16. One sign-in costs a hundred page renders

[20:15–21:15 · 1:00 · if behind: skip this slide and say its one line on the wall slide]  
* The price list  
   Divide the container's CPU by the rate.  
* Guest page: about 9 milliseconds of CPU  
   From the tuned origin; from Varnish about a tenth of a millisecond.  
* Search: about fifty HTML pages  
   It costs 350 to 500 milliseconds, and 90 percent of it is Elasticsearch.  
* Sign-in: about a hundred HTML pages  
   The four requests from form to signed-in page cost 650 milliseconds to over a second; against a whole first visit, the ladder's page view, about twenty. The thread dumps show 100 percent of busy threads in PBKDF2 password hashing, which is slow on purpose.  
* Three percent sign-ins eat the origin  
   That is why the mixed workload behind Varnish tops out at 400 journeys a second while guest pages alone reach 24,800. The tuned origin peaks at 25 searches and 15 sign-ins a second.  
* Bridge to the next slide  
   The edge cannot touch sign-ins, but one setting moves search a lot.

## 17. One setting, twelve times the search

[21:15–22:15 · 1:00 · if behind: skip this slide and say over the cost slide "turn off search highlighting: twelve times the capacity, same results"]  
* Turn highlighting off on the Search Results widget  
   One setting. The thread dumps showed highlighting among the hottest work in Elasticsearch: working out which words to put in bold.  
* Clean capacity went from 25 to 300 searches a second  
   Same ladder, rerun. At 20 a second, p95 went from 687 to 38 milliseconds and CPU from 9.5 cores to 0.8.  
* What did we lose? Nothing  
   Same result counts, same titles, same order, 180 bytes off the page, because our compact display template never showed a snippet. We were paying for highlights nobody could see.  
* Look at your template  
   If it shows no snippets, turn this off today. If it does, you lose the bold terms and, from reading the source, probably the text around the match too, so test it.  
* Bridge to the next slide  
   That fixes search. Sign-in we can't fix, and the edge can't touch it.  
  
IF ASKED (not spoken)  
* Which preference?  
   highlightEnabled.  
* How did you compare?  
   Three search terms. Single requests at idle, on, off, on again: 210, 78, 295 milliseconds. At 400 searches a second 1.5 percent were dropped, so 300 is the clean figure. Numbers in RUNG-RESULTS.md.  
* Will I get twelve times?  
   This is the sidecar Elasticsearch on a small index, so your factor will differ. Caching popular search URLs at the edge still applies on top.

## 18. The edge makes the fast path fast.

[22:15–24:15 · 2:00]  
* The wall: be blunt about the limits we just imposed  
* Locale must be in the URL  
   Or the cache serves the wrong language.  
* Personalisation moves to late hydration  
* Forms and action URLs must leave guest pages  
* Every publish needs a purge  
* A cold or purged page still costs a full JVM render  
   In our lab 15 to 50 milliseconds for a simple page and about a second for search under load, with a stampede on the popular ones.  
* Sign-in never leaves the origin  
   It capped the edge mix at 400 journeys a second.  
* Search reaches the origin for every query the edge has not seen  
* The origin still runs 24/7 at full size  
   For the misses.  
* The honest question: why is there a JVM in the request path at all?  
   For marketing, docs, community and catalogue sites.

## 19. Don't render it at all.

[24:15–24:45 · 0:30]  
* Pivot: for content-heavy, mostly anonymous sites  
   Keep authoring in Liferay, serve plain HTML generated from Liferay's data, regenerated automatically, that looks the same as the original.  
* The backdrop is the idea  
   A wall of pages rendered once, ahead of time.

## 20. Draw the line by cardinality

[24:45–25:45 · 1:00]  
* Scope first  
   Or this sounds like "throw away your portal".  
* Precompute when the output space is small and the read-to-write ratio is high  
* Render live when output is genuinely per user  
* Islands and late hydration  
   They let you draw that line inside a page instead of per page.  
* What leaves is the request path  
   Everything editors love stays in Liferay: page editor, workflow, permissions, Objects, translations.

## 21. Authored in Liferay, served as files

[25:45–27:15 · 1:30]  
* One command, plain JavaScript on Node  
   node fidelity/regenerate.mjs.  
* Fetch  
   Pulls a delta from Headless Delivery with filter dateModified gt lastRun.  
* Plan  
   Diffs content hashes. Nothing changed means exit, with no build.  
* Build  
   Liferay as a headless CMS: page definitions, fragment templates, theme CSS and content, all from its APIs, rendered to the same markup and CSS as static HTML. That's why it looks the same.  
* Diff  
   It compares the old and new HTML, so the purge list is exactly the pages that changed.  
* Trigger  
   A webhook or a timer runs that command.  
  
IF ASKED (not spoken)  
* Is the purge wired to a CDN?  
   Not in the demo: it writes the list. The lab has no CDN.  
* Is the webhook wired up?  
   The repo's receiver, pipeline/webhook.mjs, runs the Astro pipeline, so it needs pointing at this command. Not tested with this one.

## 22. Regenerated from our own Liferay

[27:15–31:15 · 4:00]  
* PLAY THE VIDEO, 1:31  
   deck/recordings/demo3-regenerate.mp4. Commands: docs/demos/demo3-regenerate.md.  
* Step 1, first build: 76 pages in about 13 seconds  
   From the APIs of our own Liferay, and about half of that is fetching.  
* Step 2, run it again: about 3 seconds, no build  
   Nothing changed, so nothing is built.  
* Step 3, one post both ways: 123 kB against 28 kB  
   Liferay's HTML has 25 scripts and an authToken; the static page has 1 script and none. The next slide shows the two pages.  
* Step 4, change the post in Liferay: 7 URLs to purge  
   A real edit through Liferay's API. About 9 seconds. The list is the post, its two neighbours that link to it, its list page, its two tag pages and search.  
* Step 5, both show the new title  
* Step 6, link checker: zero broken  
   Of 2,043 internal links.  
* OPTIONAL, live change  
   With docs/demos/lab.sh up running: docs/demos/demo3-regenerate.sh change "Your title", then refresh both tabs. Finish with demo3-regenerate.sh restore.

## 23. Same post, two deliveries

[31:15–32:15 · 1:00]  
* The point: you can't tell them apart  
   The same post, after the edit, from Liferay and from a file. Same page height, 4,887 pixels at this width.  
* Liferay: 123 kB, 25 script tags  
   And an authToken in the body. The browser fetches about 100 files.  
* Static: 28 kB, one script  
   No authToken. The browser fetches about 7 files.  
* The one difference you can see: the date  
   Liferay prints "17 seconds ago", which a static file can't keep true, so it prints the date.  
  
IF ASKED (not spoken)  
* How closely did you compare?  
   On the 8 fragment pages, every element: position, size, font, colour, margins, padding and display, with 0 differences across 1,782 elements. On News and Blog, the widget elements selector by selector. Details: part2-static-prototype/fidelity/README.md.  
* Which Liferay config?  
   S3, the same lab as the load tests.

## 24. tokens

[32:15–35:15 · 3:00]  
* Where AI fits  
   The build you just saw called no model, because the structure comes from Liferay's APIs. AI is for what's left: missing descriptions, tags and a review. We measured this with the repo's Astro pipeline on liferay.dev's public posts.  
* The token-efficiency story: six mechanisms  
* 1. Plan before model  
   No change means no model and no build.  
* 2. Hash only the fields that matter  
   A comment counter ticking is not a change.  
* 3. Extraction rules asked once per page layout  
   And cached forever. Only the Astro pipeline needs them.  
* 4. Enrichment keyed by content hash  
* 5. Batching  
   Eight posts per call on a cheap model with prompt caching on the system block. Gotcha: minimum cacheable prompt is 4,096 tokens on the cheap model, so short prompts silently don't cache.  
* 6. A hard budget  
   With a ledger of every call's tokens and cost. Lower AI_BUDGET_TOKENS and the batches are skipped, deterministic fallbacks used, and the report flags it.  
* A dry run: roughly three cents, once  
   About 12 to 16 thousand tokens for 80 posts.

## 25. Static wins on the page, not the HTML

[35:15–37:15 · 2:00 · if behind: skip this slide and say "HTML is a tie, the page is twelve times the requests" before the next slide]  
* The question: is static worth it, if the edge already caches the HTML?  
   Part 1 ended with Varnish in front of Liferay. We ran the same guests against both, on the same box, on the same day.  
* HTML alone is a tie  
   Both about 25,000 requests a second at a p95 around 70 milliseconds, and in both cases the limit was the load generator. nginx used 1.1 cores, Varnish 2.6, because Liferay's HTML is four times bigger.  
* The difference is the page around the HTML  
   A first visit to a Liferay page is 56 requests: on the home page 41 JavaScript files and 8 stylesheets. The static page is four or five: the HTML, one stylesheet, the images.  
* At 1,000 page views a second: 12 times the requests  
   Five and a half times the bytes, ten times the edge CPU, and a p95 of 13 against 2 milliseconds for the whole page view, on loopback, before a single network round trip.  
* Pushed until it breaks: 1,200 against 10,000 page views a second  
   The Varnish setup is clean at 1,200 and fails at 1,500, with the box out of CPU: k6 on 10 cores, Varnish on 4.4. Static stayed clean to 10,000, and there the limit was k6 again.  
* Neither figure is a server limit  
   Varnish was serving 67,000 requests a second and nginx 46,000. The eightfold gap is page size on a shared box.  
* Check that your edge compresses the assets, not just the HTML  
   A finding on the way: our VCL stored CSS and JS uncompressed, 1.9 MB per page view, because Liferay's GZip filter was off and the asset branch never set do_gzip.

## 26. What you give up

[37:15–40:15 · 3:00]  
* The honest ledger  
* Search relevance and facets  
   Become a static index searched in the browser. Same layout; result counts equal or within 2 on six terms, but the ranking differs.  
* Comments, forms and ratings  
   The generator leaves them out: the contact form is only markup. The design is islands posting to Objects or the Headless API; we did not build that.  
* Sign-in state  
   Here Sign in just links back to the portal. The design is a late-hydration island calling my-user-account, which needs same-origin or CORS with SameSite None cookies; also not built.  
* Preview and workflow stay in the portal  
   The static site only sees published content, live within the timer interval or instantly via webhook.  
* Same look only for what it supports  
   The Classic theme, and the FreeMarker and widgets this site uses. Anything else fails the build and names what it hit, rather than rendering wrongly. That is why we built it on our own site.  
* Yes, it's a second stack  
   But it's a timer, a script and a folder of files.  
* Your pipeline will meet a broken API; design for it  
   Real story, from testing on liferay.dev: the site-pages listing returned HTTP 500 on liferay.dev all day while per-page fetches worked; the fetcher fell back to a seed list.

## 27. Pages and AI: the same move

[40:15–41:15 · 1:00]  
* The closing idea: static generation and AI cost control are the same engineering move  
   Take expensive, repeatable work off the request path, do it at publish time, cache the result, invalidate by event, serve stale on failure.  
* Keep an escape hatch for the genuinely dynamic  
   Islands for pages, a rate-limited live call for AI.  
* Liferay already does this internally for semantic search  
   Documents are embedded at index time, only the query is embedded live, and exact repeats of it are cached per node for about 10 minutes.  
* The market prices it too  
   Batch inference is half price for accepting a 24-hour window.  
* The counter-argument: precompute trades freshness for cost, and fails on cardinality  
   Content times locale times segment times device can explode.

## 28. What is it, and can we have it?

[41:15–42:00 · 0:45]  
* Before the talk: re-run the curl the day before  
   It has changed once already.  
* Curl www.liferay.com  
   It returns cache-control public max-age 60, an Age of hours, via Varnish, and this undocumented header.  
* It looks site-wide  
   On 2 November guest pages across the site did too, while /c/portal/login returned private, no-store.  
* The edge keeps pages far longer than the header says  
   The Age runs to many hours against that max-age of 60.  
* We don't know what it is  
   The header is in neither master nor shipped 2026.q1.12, and we don't know what sets it or who built it.  
* Ask 1, to the room and to Liferay: what is it, and can customers have it?  
* Ask 2: publish Core Web Vitals data for Liferay sites  
   Nobody has, so anyone in this room could be first.

## 29. Thank you

[42:00–45:00 · thanks until 42:15, then Q&amp;A]  
* Thank you, then questions  
  
PREPARED ANSWERS  
* Why not a Cloudflare APO equivalent?  
   There is no Liferay analogue; Liferay PaaS is Google Cloud CDN, which a KB article says is limited to one hour by default with no out-of-the-box way to change it, and SaaS is fixed to USE_ORIGIN_HEADERS, so origin headers are the only lever.  
* Why not Astro?  
   It's in the repo too, as pipeline/. It runs on any site but uses its own layout, so it does not look like the original. It's also where the AI step lives.  
* Structured content?  
   Wired by contentStructureId; test it on your own DXP.  
* Model cost if AI is on everywhere?  
   Show the ledger; the budget caps it.
