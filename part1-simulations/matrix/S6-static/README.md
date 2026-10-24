# S6 — Static / precomputed (pointer only — Part 2 of the talk)

The end of the ladder: the guest page is not rendered by Liferay at request time
at all. A build step (Headless Delivery `…/site-pages/{friendlyUrlPath}/rendered-page`
or a static-site generator) writes HTML files; the same Varnish/CDN from S4 serves
them, and dynamic islands (search, login state, personalised fragments) are
fetched client-side or via ESI.

What changes for the measurements in this package:

* `guest-browse`, `asset-publisher`, `search` (results page shell) → served as
  files: p95 ≈ S4 numbers *cold*, i.e. no MISS penalty on first request per URL
  and no dependence on the edge TTL.
* `login`, `headless-api` → unchanged; they are the "islands".
* `publish-to-fresh` → the number becomes "build + deploy time" (seconds to
  minutes) unless the build is incremental and tag-triggered — which is the S5
  purge listener again, pointed at a build hook instead of a purge endpoint.

Nothing to configure here; see Part 2 (static shell + dynamic islands,
embed-at-index-time) for the how.
