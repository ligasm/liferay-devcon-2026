# S4 (hosted alternative) — Cloudflare Cache Rules for Liferay guest HTML

Same policy as `../varnish/default.vcl`, expressed as Cloudflare **Cache Rules**
(`http_request_cache_settings` phase; available on all plans). Rules are
evaluated in order — **the bypass rule must come first**, because rule 2
overrides the origin's `Cache-Control` and strips `Set-Cookie`, which is exactly
what makes a wrong rule 1 a data breach.

Defence in depth: keep `browser.cache.signed.in.disabled=true` so signed-in
responses stay `private` even if a rule is mis-ordered, and add a canary
(`X-LFR-User` response header from a custom filter, or just check that a
signed-in page contains `/c/portal/logout`) to a synthetic monitor.

## Rule 1 — Bypass authenticated & dynamic traffic

```
(http.cookie contains "COMPANY_ID=")
or (http.cookie contains "USER_UUID=")
or (http.cookie contains "REMEMBER_ME=")
or (http.cookie contains "LOGIN=")
or (http.request.cookies["ID"][0] ne "")
or (http.request.method ne "GET")
or (starts_with(http.request.uri.path, "/c/"))
or (starts_with(http.request.uri.path, "/api/"))
or (starts_with(http.request.uri.path, "/o/api"))
or (starts_with(http.request.uri.path, "/o/headless-"))
or (starts_with(http.request.uri.path, "/o/graphql"))
or (starts_with(http.request.uri.path, "/group/control_panel"))
or (http.request.uri.query contains "p_auth=")
or (http.request.uri.query contains "p_p_auth=")
or (http.request.uri.query contains "p_p_lifecycle=1")
or (http.request.uri.query contains "p_p_lifecycle=2")
```

Cache eligibility: **Bypass cache**.

Do **not** add `JSESSIONID` here. Liferay sets it for every visitor; keying on it
yields `cf-cache-status: BYPASS` for everyone and protects nothing.

## Rule 2 — Cache guest HTML

```
(http.host eq "www.example.com"
 and http.request.method eq "GET"
 and not starts_with(http.request.uri.path, "/c/")
 and not starts_with(http.request.uri.path, "/api/")
 and not starts_with(http.request.uri.path, "/o/api")
 and not starts_with(http.request.uri.path, "/o/headless-")
 and not starts_with(http.request.uri.path, "/group/control_panel")
 and not http.cookie contains "COMPANY_ID="
 and not http.cookie contains "USER_UUID="
 and not http.cookie contains "REMEMBER_ME=")
```

Settings:

| Setting | Value | Why |
|---|---|---|
| Cache eligibility | **Eligible for cache** | (Cache Everything is implied for Cache Rules) |
| Edge TTL | **Ignore cache-control header and use this TTL: 60 s** | Stock Liferay sends `private, no-store`; only an override caches it. Once `browser.cache.disabled=false` (S3) you may switch to *Use cache-control header if present, bypass if not* |
| Browser TTL | **Bypass cache** | a visitor who logs in must not keep seeing the guest page from local cache (same reason as `browser.cache.signed.in.disabled`) |
| Cache key → Query string | **Custom: Ignore** `utm_source, utm_medium, utm_campaign, utm_term, utm_content, fbclid, gclid, dclid, _gl, _ga, msclkid, mc_cid, mc_eid` | every campaign link otherwise creates a separate object; `p_auth`/`p_p_auth` are already bypassed by rule 1 |
| Cache key → Cookie | Include `GUEST_LANGUAGE_ID` (Enterprise) — otherwise leave empty | per-locale guest objects without `Vary: Cookie` |
| Cache key → Headers | none | never `User-Agent` (Liferay's `browserId` fragmentation lives in the URL, that is fine) |
| Cache key → Sort query string | **On** | |
| Cache deception armor | **On** | |
| Cache reserve | Off | HTML is small and short-lived |
| Serve stale | origin `stale-while-revalidate=3600, stale-if-error=86400` | Cloudflare honours both from the origin `Cache-Control` (only when Edge TTL respects origin) |

`Vary`: Cloudflare ignores `Vary` except for `Accept` on images and `Accept-Encoding`; it never
varies on `Cookie` — which is why rule 1 has to be right.

## Rule 3 — Static assets

```
(starts_with(http.request.uri.path, "/o/")
 or starts_with(http.request.uri.path, "/combo")
 or starts_with(http.request.uri.path, "/image/")
 or starts_with(http.request.uri.path, "/documents/")
 or starts_with(http.request.uri.path, "/o/adaptive-media/image/"))
and not http.cookie contains "COMPANY_ID="
```

Eligible for cache, Edge TTL **Use cache-control header if present** (hashed
`/o/...(hash).js` files carry `public, max-age=31536000, immutable`; D&M carries
`public, max-age=…` only after S3's Cache Control setting), Browser TTL respect
origin, Cache Reserve on with minimum file size ≈ 100 KB.

## API equivalent (rule 2, for versioning it in Git)

```json
{
  "description": "Liferay guest HTML",
  "expression": "(http.host eq \"www.example.com\" and http.request.method eq \"GET\" and not starts_with(http.request.uri.path, \"/c/\") and not starts_with(http.request.uri.path, \"/api/\") and not starts_with(http.request.uri.path, \"/o/api\") and not starts_with(http.request.uri.path, \"/o/headless-\") and not starts_with(http.request.uri.path, \"/group/control_panel\") and not http.cookie contains \"COMPANY_ID=\" and not http.cookie contains \"USER_UUID=\" and not http.cookie contains \"REMEMBER_ME=\")",
  "action": "set_cache_settings",
  "action_parameters": {
    "cache": true,
    "edge_ttl": { "mode": "override_origin", "default": 60 },
    "browser_ttl": { "mode": "bypass" },
    "cache_key": {
      "ignore_query_strings_order": true,
      "cache_deception_armor": true,
      "custom_key": {
        "query_string": { "exclude": ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "fbclid", "gclid", "dclid", "_gl", "_ga", "msclkid", "mc_cid", "mc_eid"] },
        "cookie": { "include": ["GUEST_LANGUAGE_ID"] }
      }
    }
  }
}
```

`PUT https://api.cloudflare.com/client/v4/zones/{zone_id}/rulesets/phases/http_request_cache_settings/entrypoint`
with `{"rules":[ <rule 1>, <rule 2>, <rule 3> ]}` — the array order is the evaluation order.

## Purge by tag (S5)

Origin adds `Cache-Tag: layout-123,site-guest,article-456` on each page
(Enterprise: tag purge; Free/Pro/Business: purge by URL or prefix instead).

```bash
curl -X POST "https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/purge_cache" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json" \
  --data '{"tags":["article-456"]}'

# by URL (all plans) — must be the exact cache-key URL (host + path + allowed query)
curl -X POST "https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/purge_cache" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" -H "Content-Type: application/json" \
  --data '{"files":["https://www.example.com/web/guest/news"]}'
```

Verify on stage with `curl -sI https://www.example.com/web/guest/news | grep -iE "cf-cache-status|age|set-cookie|cache-control"`:
`HIT`/`Age: n`/no `Set-Cookie` for a guest; `BYPASS` with `Cookie: COMPANY_ID=…`.
