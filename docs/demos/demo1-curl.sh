#!/usr/bin/env bash
# Demo 1, slide 8: a stock guest page is uncacheable. Same commands as demo1-curl.md.
#
#   ./demo1-curl.sh prepare    before the talk: start a fresh Liferay, which takes a few minutes
#   ./demo1-curl.sh            on stage: show each command, press Enter to run it
#   ./demo1-curl.sh cleanup    afterwards: remove the container
#
# AUTO=1 runs without waiting for Enter, for a rehearsal.
# LIFERAY=https://your-dxp uses your own Liferay. Skip prepare if you do.
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
VIDEO=demo1-curl
URL="${LIFERAY:-http://localhost:8096}"

demo_prepare() {
	need docker curl
	docker rm -f demo-stock-liferay 2>/dev/null || true
	docker run -d --name demo-stock-liferay -p 8096:8080 liferay/dxp:2026.q1.12-lts
	wait_for "$URL/"
}

demo_run() {
	need curl
	curl -sf -o /dev/null --max-time 20 "$URL/" || die "Liferay isn't answering at $URL. Run: $0 prepare"

	heading 'Stock Liferay DXP 2026.q1.12: the full response headers'
	run "curl -sSD- -o /dev/null $URL/"

	heading 'Only what a CDN looks at'
	run "curl -sSD- -o /dev/null $URL/ | grep -iE --color=always '^(cache-control|pragma|expires):|^set-cookie: [A-Z_]+'"
	finish
}

demo_cleanup() { docker rm -f demo-stock-liferay; }

main "$@"
