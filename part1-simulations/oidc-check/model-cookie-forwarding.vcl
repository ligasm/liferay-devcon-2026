vcl 4.1;
# NOT Cloudflare and NOT a config to deploy. A model of what matters in matrix/cloudflare/cache-rules.md
# rule 1 + rule 3: the same bypass cookie list, cookies forwarded to the origin on a miss, and an
# override TTL that ignores Cache-Control and drops Set-Cookie. Used only to see what happens when a
# signed-in user carries none of the bypass cookies. Compare ../matrix/varnish/default.vcl, which
# removes Cookie before the origin fetch.
backend default { .host = "liferay"; .port = "8080"; }

sub vcl_recv {
	if (req.method != "GET" && req.method != "HEAD") { return (pass); }
	if (req.http.Cookie ~ "(^|;\s*)(COMPANY_ID|USER_UUID|REMEMBER_ME|LOGIN|PASSWORD)=" ||
	    req.http.Cookie ~ "(^|;\s*)ID=") {
		set req.http.X-Bypass = "auth-cookie";
		return (pass);
	}
	if (req.url ~ "^/(c|api|group|user|o|combo|image|documents)/") { return (pass); }
	# Keep Cookie. The built-in vcl_recv would pass here; the override rule does not.
	return (hash);
}

sub vcl_backend_response {
	if (bereq.uncacheable) { return (deliver); }
	unset beresp.http.Set-Cookie;
	unset beresp.http.Cache-Control;
	unset beresp.http.Expires;
	unset beresp.http.Pragma;
	set beresp.uncacheable = false;
	set beresp.ttl = 60s;
	set beresp.grace = 0s;
	return (deliver);
}

sub vcl_deliver {
	if (obj.hits > 0) { set resp.http.X-Cache = "HIT"; } else { set resp.http.X-Cache = "MISS"; }
	if (req.http.X-Bypass) { set resp.http.X-Bypass = req.http.X-Bypass; }
}
