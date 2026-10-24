# S3 — Front-end delivery: files vs UI settings

| Change | Where | File / note |
|---|---|---|
| `cdn.host.https`, `cdn.dynamic.resources.enabled` | `portal-ext.properties` (or Instance Settings → General) | `portal-ext.properties` |
| `browser.cache.disabled=false`, keep `browser.cache.signed.in.disabled=true` | `portal-ext.properties` | `portal-ext.properties` |
| **Documents & Media → Cache Control** (Public, max-age) | Control Panel → System/Instance Settings → Documents and Media → Cache Control | `osgi-configs/` has the *shape*; PID marked UNVERIFIED |
| **Adaptive Media** resolutions + regenerate existing | Control Panel → Configuration → Adaptive Media (add resolutions, then *Adapt Remaining Images*) | UI only — Liferay 7.4 docs do not document a `.config` for resolutions |
| **Frontend Resource Caching** (DXP 2025.Q4+/2026.Q1+) | Instance Settings → Platform → Infrastructure → Frontend Caching | UI; enables hashed, infinitely cacheable CSS/JS |
| `loading="lazy"` + `width`/`height` on images (never on the LCP image) | fragment / theme templates | `fragment-image.html` |
| Client extension JS `async` / `fetchpriority` | `client-extension.yaml` | `client-extension.yaml` |
| Brotli/gzip at the proxy | nginx / Varnish / Cloudflare | see `../varnish/default.vcl` (Varnish does not compress; put nginx or the CDN in front for brotli) |

## What to measure

* `guest-browse` with `WITH_ASSETS=1`: the `guest-browse/asset` row should go to
  `edge hit ≈ 100 %`, `cache-control private 0 %` (hashed `/o/...(hash).js` files
  already carry `public, max-age=31536000, immutable`).
* `dl-download`: `cache-control private` 100 % → 0 % once D&M Cache Control is
  Public for guest-visible files; `edge hit` follows at S4.
* HTML rows: `cache-control private` drops from 100 % to 0 % for guests
  (`browser.cache.disabled=false`) — the precondition for S4. `edge hit` stays
  0 % until S4 because nothing is in front of Tomcat yet.
* The login scenario's *signed-in page* must still be `private` (check in `login.js`).
