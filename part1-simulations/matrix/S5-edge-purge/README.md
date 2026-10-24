# S5 — Edge + purge on publish

Everything S4 caches for 60 s becomes "fresh within a second of publishing"
when the origin tells the edge what changed.

| Piece | File |
|---|---|
| Tags on every guest page (`Cache-Tag` / `Surrogate-Key`) | `src/…/CacheTagFilter.java` |
| Purge after commit on `JournalArticle` (+ `Layout`, `BlogsEntry` variants in comments) | `src/…/EdgePurgeModelListener.java` |
| Varnish purger (`BAN` + `X-Cache-Tags`, or `PURGE` by URL) | `src/…/VarnishEdgePurger.java` |
| Cloudflare purger (`purge_cache` by tag / by file) | `src/…/CloudflareEdgePurger.java` |
| Measuring publish → fresh at the edge | `../../k6/publish-to-fresh.js` |

The Java is a **sketch** (it compiles against the 7.4 kernel API in spirit;
package names for Jakarta, DS annotations and the Liferay workspace build are
yours to fill in). The load-bearing decisions are commented in the code:
after-commit, by tag, approved versions only, every Varnish node.

## Measure it

```bash
# with Varnish (S4) running on :6081 and BASE_URL pointing at it:
BASE_URL=http://localhost:6081 PAGE=/web/guest/news \
  ./run.sh S5-edge-purge publish-to-fresh
```

The script snapshots the page at the edge, waits for you to publish (or does it
through the Headless API when `PUBLISH_VIA_API=1`), then polls until the body
changes and records `publish_to_fresh_ms`. Expected: **≤ 1–2 s** with the purge
listener, **up to the edge TTL (60 s)** without it, **up to TTL + grace** if
you soft-purge and nobody requests the page (the first visitor after a soft
purge still gets the stale copy while the refetch runs).

Manual check:

```bash
curl -s -X BAN -H 'X-Cache-Tags: site-20117' http://localhost:6081/
curl -sI http://localhost:6081/web/guest/news | grep -iE "x-cache|age"     # MISS (BAN) or HIT with Age reset after refetch (xkey soft purge)
```
