# S4 (hosted alternative) — Cloudflare Cache Rules for Liferay guest HTML

Same policy as `../varnish/default.vcl`, expressed as Cloudflare **Cache Rules**
(`http_request_cache_settings` phase). Cookie and query-string cache keys need Enterprise, a 60 s
Edge TTL needs Business or above, and `http.request.cookies` needs Pro or above. Plans checked
2026-11-02; re-check before relying on them.

**Rule order is the reverse of the VCL.** In VCL the bypass comes first because `return (pass)` ends
evaluation. Cache Rules stack: *"For conflicting settings (for example, bypass cache versus eligible
for cache), the last matching rule wins"*
([Order and priority](https://developers.cloudflare.com/cache/how-to/cache-rules/order/)). So deploy
guest HTML, then assets, then **bypass last**. The guest HTML rule also repeats the exclusions, so an
ordering mistake doesn't become a breach.

**This has never run on a live zone.** It comes from Cloudflare's docs and Liferay's source. Test it
on a throwaway zone first.

> **Not safe on an SSO site as written.** `COMPANY_ID` and `ID` are written only by password-style
> login (`AuthenticatedSessionManagerUtil.login`). `AutoLoginFilter` (OIDC, SAML, token auto-login)
> only sets session attributes, so an SSO user can be signed in with none of the cookies below. Their
> GET of a public page matches the guest HTML rule, Cloudflare forwards their cookies on a miss, and
> the override TTL caches their signed-in page for everyone. The cookies were measured with OIDC, and a
> Varnish model of these rules leaked the page to the next anonymous visitor (`../../oidc-check/`);
> Cloudflare itself is untested. The VCL doesn't leak here, because it removes `Cookie` before the
> backend fetch (also measured); these rules have no such step. Options, all untested here: (a) a marker
> cookie set from `login.events.post`, added to both rules; (b) a Request Header Transform Rule that
> removes `Cookie` on guest-cacheable requests; (c) no override TTL on SSO sites, which gives low hit
> rates.

`browser.cache.signed.in.disabled=true` is worth keeping, but it does not protect you under the guest
HTML rule: *Ignore cache-control header* ignores it. Add a canary to a synthetic monitor: a signed-in
page must contain `isSignedIn: () => true`, and an anonymous fetch of a public page must not. Don't use
`/c/portal/logout`: `test@liferay.com`'s signed-in page in the lab doesn't contain it.

## Rule 1 of 3 — Cache guest HTML

```
(http.host eq "www.example.com"
 and (http.request.method eq "GET" or http.request.method eq "HEAD")
 and not http.cookie contains "COMPANY_ID="
 and coalesce(http.request.cookies["ID"][0], "") eq ""
 and not http.cookie contains "USER_UUID="
 and not http.cookie contains "REMEMBER_ME="
 and not http.cookie contains "LOGIN="
 and not http.cookie contains "PASSWORD="
 and not has_key(http.request.headers, "authorization")
 and not starts_with(http.request.uri.path, "/c/")
 and not starts_with(http.request.uri.path, "/api/")
 and not starts_with(http.request.uri.path, "/group/")
 and not starts_with(http.request.uri.path, "/user/")
 and not starts_with(http.request.uri.path, "/o/")
 and not starts_with(http.request.uri.path, "/combo")
 and not starts_with(http.request.uri.path, "/image/")
 and not starts_with(http.request.uri.path, "/documents/")
 and not http.request.uri.query contains "p_auth="
 and not http.request.uri.query contains "p_p_auth="
 and not http.request.uri.query contains "p_p_lifecycle=1"
 and not http.request.uri.query contains "p_p_lifecycle=2"
 and not http.request.uri.query contains "p_p_id=com_liferay_login_web_portlet_"
 and not http.request.uri.query contains "p_l_mode=edit")
```

Settings:

| Setting | Value | Why |
|---|---|---|
| Cache eligibility | **Eligible for cache** | |
| Edge TTL | **Ignore cache-control header and use this TTL: 60 s** | Stock Liferay sends `private, no-store`; only an override caches it. This is also what strips `Set-Cookie`, which is why the exclusions have to be right |
| Browser TTL | **Bypass cache** | a visitor who signs in must not keep seeing the guest page from local cache |
| Cache key → Query string | **Exclude** `utm_source, utm_medium, utm_campaign, utm_term, utm_content, fbclid, gclid, dclid, _gl, _ga, msclkid, mc_cid, mc_eid` (Enterprise) | every campaign link otherwise creates a separate object |
| Cache key → Cookie | Include `GUEST_LANGUAGE_ID` (Enterprise); otherwise keep the locale in the URL | per-locale guest objects without `Vary: Cookie` |
| Cache key → Headers | none | never `User-Agent` |
| Cache key → Sort query string | **On** | |
| Cache deception armor | **On** | the Edge TTL may override it |
| Cache reserve | Off | HTML is small and short-lived |

Never test for `ID` with `http.cookie contains "ID="`: that also matches `JSESSIONID=` and would
bypass every guest. A plain `http.request.cookies["ID"][0] ne ""` is also wrong: it is true when the
cookie is absent, so it matches every request. Use `coalesce` as above, or drop `ID` from both rules,
since it is written together with `COMPANY_ID`.

Do **not** key anything on `JSESSIONID`. Liferay sets it for every visitor, so a bypass on it is safe
but gives a zero hit ratio.

`Vary`: Cloudflare ignores `Vary` except for `Accept` on images and `Accept-Encoding`; it never
varies on `Cookie`, which is why the exclusions have to be right.

Serving stale needs the origin's `stale-while-revalidate` or `stale-if-error`, and the interaction
with an override Edge TTL is untested. Don't combine them with `s-maxage`, which cancels both.

## Rule 2 of 3 — Static assets and documents

```
(starts_with(http.request.uri.path, "/o/")
 or starts_with(http.request.uri.path, "/combo")
 or starts_with(http.request.uri.path, "/image/")
 or starts_with(http.request.uri.path, "/documents/"))
```

Eligible for cache, Edge TTL **Use cache-control header if present, bypass cache if not** (hashed
files carry `max-age=31536000, immutable`; D&M carries `public, max-age=…` only after S3's Cache
Control setting), Browser TTL respect origin, Cache Reserve on with minimum file size ≈ 100 KB.

`/o/` also holds Headless, GraphQL and OSGi servlets. This rule has no cookie conditions, so it depends
on the bypass rule being last. Vulcan endpoints send `no-cache, no-store`; non-Vulcan `/o/` servlets
were not checked.

## Rule 3 of 3 — Bypass authenticated and dynamic traffic (must be LAST)

```
(http.cookie contains "COMPANY_ID=")
or (coalesce(http.request.cookies["ID"][0], "") ne "")
or (http.cookie contains "USER_UUID=")
or (http.cookie contains "REMEMBER_ME=")
or (http.cookie contains "LOGIN=")
or (http.cookie contains "PASSWORD=")
or (has_key(http.request.headers, "authorization"))
or (http.request.method ne "GET" and http.request.method ne "HEAD")
or (starts_with(http.request.uri.path, "/c/"))
or (starts_with(http.request.uri.path, "/api/"))
or (starts_with(http.request.uri.path, "/group/"))
or (starts_with(http.request.uri.path, "/user/"))
or (starts_with(http.request.uri.path, "/o/api"))
or (starts_with(http.request.uri.path, "/o/headless-"))
or (starts_with(http.request.uri.path, "/o/c/"))
or (starts_with(http.request.uri.path, "/o/graphql"))
or (http.request.uri.query contains "p_auth=")
or (http.request.uri.query contains "p_p_auth=")
or (http.request.uri.query contains "p_p_lifecycle=1")
or (http.request.uri.query contains "p_p_lifecycle=2")
or (http.request.uri.query contains "p_p_id=com_liferay_login_web_portlet_")
or (http.request.uri.query contains "p_l_mode=edit")
```

Cache eligibility: **Bypass cache**. `p_p_id=com_liferay_login_web_portlet_` is the sign-in form: in
the lab, caching it through Varnish made every login POST fail with 403 (`LAB-RESULTS.md`).

`[UNVERIFIED]` Locale-prefixed paths such as `/es/c/portal/login` don't match these `starts_with`
clauses. Test `/es/c/portal/login` and `/es/group/control_panel` through the edge.

## API equivalent (rule 1, for versioning it in Git)

```json
{
  "description": "Liferay guest HTML",
  "expression": "<the rule 1 expression above, on one line>",
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
with `{"rules":[ <guest HTML>, <assets>, <bypass> ]}`. The last matching rule wins, so the array
order matters.

## Purge by tag (S5)

Origin adds `Cache-Tag: layout-123,site-guest,article-456` on each page. Purge by tag is on all
plans (checked 2026-11-02).

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

Verify with a GET, not `curl -I`, which sends HEAD:
`curl -s -D - -o /dev/null https://www.example.com/web/guest/news | grep -iE "cf-cache-status|age|set-cookie|cache-control"`.
Expect `HIT`, `Age: n` and no `Set-Cookie` for a guest, and `DYNAMIC` with `Cookie: COMPANY_ID=…`
(Cloudflare documents that a matching Bypass rule may return `DYNAMIC`).
