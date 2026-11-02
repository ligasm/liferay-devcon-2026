#!/usr/bin/env bash
#
# edge-compare.sh — what does each visitor get from the origin, the repo VCL and the cookie-forwarding
# model? Reads the Cookie headers browser-flow.js wrote to $OIDC_OUT. See README.md.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT="${OIDC_OUT:-/tmp/oidc-check}"
ORIGIN=http://127.0.0.1:8086 VARNISH=http://127.0.0.1:6081 MODEL=http://127.0.0.1:6082
PAGE=/web/proventeq/home RUN=$(date +%s)
for f in sso-varnish password; do
	[[ -s "$OUT/$f.cookie" ]] || { echo "!! $OUT/$f.cookie missing: run browser-flow.cjs first" >&2; exit 1; }
done
SSO="$(cat "$OUT/sso-varnish.cookie")" PWD_USER="$(cat "$OUT/password.cookie")" LANG_ONLY=GUEST_LANGUAGE_ID=en_US
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT

probe() {
	local label=$1 url=$2 ck=${3:-} a=(-s -D "$T/h" -o "$T/b" --max-time 60)
	[[ -n "$ck" ]] && a+=(-H "Cookie: $ck")
	curl "${a[@]}" "$url"
	echo "--- $label"
	echo "    $url"
	echo "    $(grep -iE '^(HTTP/|cache-control|x-cache:|x-bypass)' "$T/h" | tr -d '\r' | tr '\n' '|')"
	echo "    set-cookie: $(grep -iE '^set-cookie' "$T/h" | sed -E 's/^[^:]+: ([^=]+)=.*/\1/' | tr -d '\r' | tr '\n' ' ')"
	echo "    $(python3 -I "$HERE/measure.py" "$T/b")"
}

echo "##### A. Origin"
probe "guest" "$ORIGIN$PAGE"
probe "SSO user" "$ORIGIN$PAGE" "$SSO"
probe "password user (control)" "$ORIGIN$PAGE" "$PWD_USER"

echo; echo "##### B. Repo VCL (matrix/varnish/default.vcl), URL not yet in cache"
U="$VARNISH$PAGE?oidc=b$RUN"
probe "SSO user, first request" "$U" "$SSO"
probe "guest with the same GUEST_LANGUAGE_ID" "$U" "$LANG_ONLY"
probe "guest without cookies" "$U"
probe "password user (control)" "$U" "$PWD_USER"
echo "--- Cookie sent to the origin on those cache misses (varnishlog; no BereqHeader line means none)"
docker exec liferay-varnish varnishlog -d -g request -q "ReqURL ~ \"oidc=b$RUN\"" -I 'BereqHeader:^Cookie' -i BereqURL 2>/dev/null |
	grep -E 'BereqURL|BereqHeader' | sed -E 's/=[^;]*/=…/g'

echo; echo "##### C. /group through the repo VCL"
probe "SSO user" "$VARNISH/group/guest/~/control_panel/manage" "$SSO"
probe "SSO user again" "$VARNISH/group/guest/~/control_panel/manage" "$SSO"
probe "guest" "$VARNISH/group/guest/~/control_panel/manage"

echo; echo "##### D. MODEL (model-cookie-forwarding.vcl): cookies forwarded, override TTL, same bypass list. NOT Cloudflare."
U="$MODEL$PAGE?oidc=d$RUN"
probe "SSO user, first request" "$U" "$SSO"
probe "guest without cookies, same URL" "$U"
curl -s -H "Cookie: $SSO" "$ORIGIN$PAGE" -o "$T/origin"; curl -s "$U" -o "$T/leak"; curl -s "$ORIGIN$PAGE" -o "$T/guest"
tok() { grep -oE "authToken: '[^']+'" "$1" | head -1 | sha256sum | cut -c1-10; }
echo "    authToken hash: SSO session at origin=$(tok "$T/origin"), page served to guest=$(tok "$T/leak"), a real guest session=$(tok "$T/guest")"
U="$MODEL$PAGE?oidc=e$RUN"
probe "password user (control), first request" "$U" "$PWD_USER"
probe "guest without cookies, same URL" "$U"
