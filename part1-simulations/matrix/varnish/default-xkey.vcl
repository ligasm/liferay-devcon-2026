vcl 4.1;
#
# S4 — Varnish in front of a self-hosted Liferay DXP 2025+/CE 7.4: guest-HTML cache.
#
# VARIANT: tag-based SOFT purge with vmod_xkey (varnish-modules — included in the
# official `varnish` Docker image). A soft purge marks matching objects as
# expired-but-in-grace: the next visitor still gets the stale page instantly
# while Varnish fetches the fresh one in the background. A BAN (default.vcl)
# is hard: the next visitor waits for Liferay. Select with VCL_FILE=default-xkey.vcl.
#
# The rules, in order:
#   1. PURGE / BAN endpoints, restricted by ACL.
#   2. Only GET/HEAD are cacheable; everything else is passed to Liferay.
#   3. Never cache portal actions, APIs, control panel, CSRF-tokened URLs.
#   4. Bypass when a Liferay AUTH cookie is present — COMPANY_ID, ID, USER_UUID,
#      REMEMBER_ME, LOGIN. NOT JSESSIONID: Liferay mints JSESSIONID for every
#      visitor, keying on it gives a 0 % hit ratio and no safety.
#   5. Anonymous GET: strip Cookie on the way in (keep GUEST_LANGUAGE_ID as a
#      hash key), normalise the query string, hash.
#   6. Backend response for anonymous requests: strip Set-Cookie, TTL from
#      Surrogate-Control / Cache-Control else 60 s, grace 1 h, Vary only on
#      Accept-Encoding, remember tags for BAN.
#   7. Deliver X-Cache: HIT|MISS and Age.
#
# Toggle: environment variable GUEST_HTML_OVERRIDE=1 (read with std.getenv)
# makes Varnish ignore `Cache-Control: private/no-store` on anonymous HTML —
# the Cloudflare "Ignore cache-control header and use this TTL" behaviour.
# Leave it unset if you have set browser.cache.disabled=false (S3): then Liferay
# already stops sending no-store for guests and the origin stays in charge.
#
import std;
import xkey;

# ---------------------------------------------------------------- backend
backend liferay {
    .host = "liferay";            # docker-compose maps this name to LIFERAY_UPSTREAM
    .port = "8080";
    .first_byte_timeout = 90s;    # a cold Liferay page can be slow
    .between_bytes_timeout = 30s;
    .connect_timeout = 5s;
    .max_connections = 300;
    .probe = {
        .request =
            "GET /web/guest HTTP/1.1"
            "Host: localhost"
            "Connection: close"
            "User-Agent: varnish-probe";
        .interval = 10s;
        .timeout = 5s;
        .window = 5;
        .threshold = 3;
        .expected_response = 200;
    }
}

# Who may purge/ban. Add your CI/CD and the Liferay node IPs (S5 ModelListener).
acl purge {
    "localhost";
    "127.0.0.1";
    "::1";
    "10.0.0.0"/8;
    "172.16.0.0"/12;
    "192.168.0.0"/16;
}

# ---------------------------------------------------------------- recv
sub vcl_recv {
    # Liferay needs to know the original scheme/host when Varnish terminates
    # (or sits behind something that terminates) TLS — pair with Tomcat's
    # RemoteIpValve and web.server.protocol=https in portal-ext.properties.
    if (!req.http.X-Forwarded-Proto) {
        set req.http.X-Forwarded-Proto = "http";
    }

    # ---- 1. invalidation endpoints -------------------------------------------
    if (req.method == "PURGE") {
        if (!client.ip ~ purge) {
            return (synth(405, "PURGE not allowed"));
        }
        return (purge);                       # exact URL (+host, +language key)
    }
    if (req.method == "BAN") {
        if (!client.ip ~ purge) {
            return (synth(405, "BAN not allowed"));
        }
        # BAN with header  X-Cache-Tags: layout-123 site-guest   (space-separated, exact match)
        if (req.http.X-Cache-Tags) {
            set req.http.X-Purged = xkey.softpurge(req.http.X-Cache-Tags);
            return (synth(200, "Soft-purged " + req.http.X-Purged + " objects for tags " + req.http.X-Cache-Tags));
        }
        # BAN with header  X-Ban-Url: ^/web/guest/news   (regex on the normalised URL)
        if (req.http.X-Ban-Url) {
            ban("obj.http.X-Url ~ " + req.http.X-Ban-Url +
                " && obj.http.X-Host == " + req.http.host);
            return (synth(200, "Banned url " + req.http.X-Ban-Url));
        }
        return (synth(400, "BAN needs X-Cache-Tags or X-Ban-Url"));
    }

    # ---- 2. method ----------------------------------------------------------------
    if (req.method != "GET" && req.method != "HEAD") {
        return (pass);
    }

    # ---- 3. never cache: actions, APIs, control panel, tokened URLs ----------
    if (req.url ~ "^/c/" ||
        req.url ~ "^/api/" ||
        req.url ~ "^/o/api" ||
        req.url ~ "^/o/headless-" ||
        req.url ~ "^/o/graphql" ||
        req.url ~ "^/group/control_panel" ||
        req.url ~ "^/group/guest/~/control_panel" ||
        req.url ~ "[?&]p_auth=" ||
        req.url ~ "[?&]p_p_auth=" ||
        req.url ~ "[?&]p_p_lifecycle=[12]" ||
        # The sign-in form (/c/portal/login redirects to <page>?p_p_id=…LoginPortlet…,
        # lifecycle 0) carries a session-bound CSRF token: cached and cookie-stripped,
        # every login POST fails with 403. Measured on the local lab (S4, 2026-10-24).
        req.url ~ "[?&]p_p_id=com_liferay_login_web_portlet_" ||
        req.url ~ "[?&]p_l_mode=edit") {
        return (pass);
    }

    # ---- 4. authenticated → bypass ------------------------------------------------
    if (req.http.Authorization ||
        req.http.Cookie ~ "(^|;\s*)(COMPANY_ID|USER_UUID|REMEMBER_ME|LOGIN|PASSWORD)=" ||
        req.http.Cookie ~ "(^|;\s*)ID=") {
        set req.http.X-Bypass = "auth-cookie";
        return (pass);
    }
    # LFR_SESSION_STATE_<userId> is written by Liferay's session JS. UNVERIFIED
    # whether anonymous visitors receive it for the default user id — if they
    # do, keying on it would tank the guest hit ratio. Measure with the
    # guest-browse-sticky scenario before enabling this clause.
    # if (req.http.Cookie ~ "(^|;\s*)LFR_SESSION_STATE_") { return (pass); }

    # ---- 5. anonymous GET: shareable object ---------------------------------------
    # Static, versioned assets: no cookie at all, cache hard.
    if (req.url ~ "^/o/" ||
        req.url ~ "^/combo\?" ||
        req.url ~ "^/image/" ||
        req.url ~ "^/documents/" ||
        req.url ~ "\.(css|js|mjs|map|png|jpe?g|gif|svg|ico|webp|avif|woff2?|ttf|eot|otf|pdf|mp4|webm)(\?|$)") {
        unset req.http.Cookie;
        set req.http.X-Guest = "asset";
    }
    else {
        # Guest HTML: keep only GUEST_LANGUAGE_ID (as a hash key), drop the rest
        # (JSESSIONID, COOKIE_SUPPORT, SERVER_ID, LFR_SESSION_STATE_*, analytics…).
        if (req.http.Cookie ~ "(^|;\s*)GUEST_LANGUAGE_ID=") {
            set req.http.X-Guest-Language = regsub(req.http.Cookie, "^.*?(^|;\s*)GUEST_LANGUAGE_ID=([^;]*).*$", "\2");
        }
        unset req.http.Cookie;
        set req.http.X-Guest = "html";
    }

    # Query-string normalisation: drop tracking params and Liferay's search-bar
    # formDate, sort the rest so ?a=1&b=2 and ?b=2&a=1 share one object.
    if (req.url ~ "\?") {
        set req.url = regsuball(req.url,
            "([?&])(utm_[a-zA-Z]+|fbclid|gclid|dclid|gbraid|wbraid|_gl|_ga|msclkid|mc_cid|mc_eid|yclid|ttclid|_hsenc|_hsmi|hsCtaTracking|_com_liferay_portal_search_web_search_bar_portlet_SearchBarPortlet_INSTANCE_[A-Za-z0-9]+_formDate)=[^&]*&?", "\1");
        set req.url = regsub(req.url, "[?&]+$", "");
        set req.url = regsub(req.url, "\?&", "?");
        set req.url = std.querysort(req.url);
    }

    # Normalise Accept-Encoding so Vary: Accept-Encoding yields ≤ 2 variants
    # (Varnish stores gzip and un-gzips for clients that cannot take it).
    if (req.http.Accept-Encoding) {
        if (req.http.Accept-Encoding ~ "gzip") {
            set req.http.Accept-Encoding = "gzip";
        } else {
            unset req.http.Accept-Encoding;
        }
    }

    return (hash);
}

# ---------------------------------------------------------------- hash
sub vcl_hash {
    hash_data(req.url);
    if (req.http.host) {
        hash_data(req.http.host);
    } else {
        hash_data(server.ip);
    }
    # anonymous locale → separate object per language, without Vary: Cookie
    if (req.http.X-Guest-Language) {
        hash_data(req.http.X-Guest-Language);
    }
    return (lookup);
}

# ---------------------------------------------------------------- backend response
sub vcl_backend_response {
    # For lurker-friendly bans (obj.* only) remember the normalised URL/host and tags.
    set beresp.http.X-Url = bereq.url;
    set beresp.http.X-Host = bereq.http.host;
    # vmod_xkey reads the `xkey` header (space-separated keys). Accept the
    # Fastly (Surrogate-Key, space-separated) and Cloudflare (Cache-Tag,
    # comma-separated) spellings from the origin / S5 ModelListener.
    if (beresp.http.Surrogate-Key) {
        set beresp.http.xkey = beresp.http.Surrogate-Key;
    } elseif (beresp.http.Cache-Tag) {
        set beresp.http.xkey = regsuball(beresp.http.Cache-Tag, ",\s*", " ");
    }
    if (beresp.http.xkey) {
        set beresp.http.X-Cache-Tags = beresp.http.xkey;
    }

    # Requests that were passed (auth cookie, action URL…) stay uncacheable and
    # keep their Set-Cookie. Nothing else to do for them.
    if (!bereq.http.X-Guest) {
        set beresp.uncacheable = true;
        return (deliver);
    }

    # ---- static assets ---------------------------------------------------------------
    if (bereq.http.X-Guest == "asset") {
        unset beresp.http.Set-Cookie;         # Liferay mints JSESSIONID even on /o/
        if (beresp.status == 200) {
            if (beresp.http.Cache-Control ~ "(?i)private|no-store" &&
                bereq.url ~ "^/documents/") {
                # D&M without "Cache Control: Public" (S3) — respect the origin
                set beresp.uncacheable = true;
                set beresp.ttl = 120s;
                return (deliver);
            }
            if (beresp.ttl <= 0s || !beresp.http.Cache-Control) {
                set beresp.ttl = 1d;          # un-hashed theme files: modest TTL
            }
            if (bereq.url ~ "\([A-Za-z0-9$_-]{8,}\)\." || bereq.url ~ "[?&]t=\d{10,}") {
                set beresp.ttl = 365d;        # hashed / timestamped: immutable
            }
            set beresp.grace = 7d;
        }
        # Liferay's GZipFilter and Tomcat compression are off from S1 on: compress text
        # assets here too, or CSS, JS and the icon sprite leave the edge uncompressed.
        if (beresp.http.Content-Type ~ "^(text/|application/(json|javascript|xml)|image/svg\+xml)") {
            set beresp.do_gzip = true;
        }
        return (deliver);
    }

    # ---- guest HTML -------------------------------------------------------------------------
    unset beresp.http.Set-Cookie;              # shareable object: no session for anyone

    # Fastly-style Surrogate-Control wins over Cache-Control (lets the origin say
    # "browser: no-store; edge: 60 s" in two headers), and is never sent downstream.
    if (beresp.http.Surrogate-Control ~ "max-age=\d+") {
        set beresp.ttl = std.duration(regsub(beresp.http.Surrogate-Control, ".*max-age=(\d+).*", "\1s"), 60s);
        if (beresp.http.Surrogate-Control ~ "stale-while-revalidate=\d+") {
            set beresp.grace = std.duration(regsub(beresp.http.Surrogate-Control, ".*stale-while-revalidate=(\d+).*", "\1s"), 3600s);
        } else {
            set beresp.grace = 1h;
        }
        unset beresp.http.Surrogate-Control;
    }
    else {
        if (beresp.http.Cache-Control ~ "(?i)private|no-store|no-cache") {
            if (std.getenv("GUEST_HTML_OVERRIDE") == "1") {
                # Cloudflare "Ignore cache-control header and use this TTL":
                # safe ONLY because auth cookies were bypassed in vcl_recv.
                unset beresp.http.Cache-Control;
                unset beresp.http.Pragma;
                unset beresp.http.Expires;
                set beresp.ttl = 60s;
            } else {
                # Origin says no (stock browser.cache.disabled=true). Respect it —
                # this is what "we added a cache and nothing happened" looks like.
                set beresp.uncacheable = true;
                set beresp.ttl = 120s;
                return (deliver);
            }
        }
        if (beresp.ttl <= 0s) {
            set beresp.ttl = 60s;              # default when origin sends no max-age
        }
        set beresp.grace = 1h;                 # stale-while-revalidate: serve stale, refresh in background
    }

    if (beresp.status != 200 && beresp.status != 301 && beresp.status != 404) {
        set beresp.uncacheable = true;         # 5xx, 302 etc. never cached; 404 briefly
        set beresp.ttl = 30s;
        return (deliver);
    }
    if (beresp.status == 404) {
        set beresp.ttl = 30s;
    }

    # Vary only on Accept-Encoding — never on Cookie/User-Agent (Liferay emits
    # neither, but a proxy in between might).
    set beresp.http.Vary = "Accept-Encoding";
    set beresp.http.X-Vary-Original = beresp.http.Vary;

    # Store HTML gzipped; Varnish serves the right variant per Accept-Encoding.
    if (beresp.http.Content-Type ~ "^(text/|application/(json|javascript|xml))") {
        set beresp.do_gzip = true;
    }

    # Browser TTL: bypass. The edge caches for 60 s; the browser must not, or a
    # user who logs in keeps seeing the guest version from local cache.
    set beresp.http.Cache-Control = "no-cache, must-revalidate, max-age=0";
    set beresp.http.X-Edge-TTL = beresp.ttl;   # for debugging; removed in deliver

    return (deliver);
}

sub vcl_backend_error {
    # Origin down and nothing in grace → a short-lived 503 so we do not hammer Tomcat
    set beresp.ttl = 5s;
    set beresp.http.Content-Type = "text/html; charset=utf-8";
    synthetic({"<!DOCTYPE html><html><body><h1>Temporarily unavailable</h1></body></html>"});
    return (deliver);
}

# ---------------------------------------------------------------- deliver
sub vcl_deliver {
    if (obj.hits > 0) {
        set resp.http.X-Cache = "HIT";
        set resp.http.X-Cache-Hits = obj.hits;
        set resp.http.Server-Timing = "cdn-cache;desc=HIT, edge;dur=1";
    } else {
        set resp.http.X-Cache = "MISS";
        set resp.http.Server-Timing = "cdn-cache;desc=MISS";
    }
    if (req.http.X-Bypass) {
        set resp.http.X-Cache = "BYPASS";
        set resp.http.Server-Timing = "cdn-cache;desc=BYPASS";
    }
    # Age is set by Varnish automatically. Keep X-Cache-Tags (useful when
    # debugging purges); drop internal bookkeeping.
    unset resp.http.xkey;
    unset resp.http.X-Url;
    unset resp.http.X-Host;
    unset resp.http.X-Vary-Original;
    unset resp.http.X-Edge-TTL;
    unset resp.http.Via;
    unset resp.http.X-Varnish;               # keep it if you want the txn ids for varnishlog
    return (deliver);
}

sub vcl_synth {
    set resp.http.Content-Type = "text/plain; charset=utf-8";
    synthetic(resp.reason);
    return (deliver);
}
