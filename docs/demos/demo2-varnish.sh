#!/usr/bin/env bash
# Demo 2, slide 12: Varnish in front of the same Liferay. Same commands as demo2-varnish.md.
#
#   ./demo2-varnish.sh prepare    before the talk: start Liferay, make a working copy, warm for 1 minute
#   ./demo2-varnish.sh            on stage: show each command, press Enter to run it
#   ./demo2-varnish.sh cleanup    afterwards: stop Varnish and Liferay
#
# AUTO=1 runs without waiting for Enter, for a rehearsal.
# Each rehearsal needs a new prepare, because the demo starts with a cold cache and Varnish stopped.
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
VIDEO=demo2-varnish
WORK=/tmp/devcon-demo2

load_env() {
	# shellcheck disable=SC1091
	source "$REPO/part0-base-site/dist/k6.env"
	LIFERAY_UPSTREAM=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' liferay26112)
	export LIFERAY_UPSTREAM
}

demo_prepare() {
	need docker curl rsync python3
	docker rm -f liferay-varnish 2>/dev/null || true
	docker start liferay26112
	wait_for http://127.0.0.1:8086/web/proventeq/home
	rm -rf "$WORK"
	rsync -a --exclude results "$REPO/part1-simulations/" "$WORK/"
	mkdir -p "$WORK/results"
	cp -r "$REPO/part1-simulations/results/S0-baseline-load" "$REPO/part1-simulations/results/S3-frontend-load" "$WORK/results/"
	load_env
	echo 'Warming Liferay for one minute, directly and not through Varnish'
	cd "$WORK"
	RATE=20 VUS=10 DURATION=60s ./run.sh _warmup mix
	rm -rf results/_warmup
}

demo_run() {
	need docker curl python3
	[ -d "$WORK/results/S3-frontend-load" ] || die "$WORK isn't ready. Run: $0 prepare"
	curl -sf -o /dev/null --max-time 20 http://127.0.0.1:8086/web/proventeq/home || die "Liferay isn't answering on :8086. Run: $0 prepare"
	if [ -n "$(docker ps -q -f name=^liferay-varnish$)" ]; then
		die "Varnish is already running, so the first request won't be a MISS. Run: $0 prepare"
	fi
	load_env

	heading 'Same Liferay, S3 config, now with Varnish in front'
	cd "$REPO/part1-simulations/matrix/varnish"
	run 'docker compose -f docker-compose.yml -f docker-compose.local.yml up -d'
	cd "$WORK"
	sleep 2

	heading 'The first guest request fills the cache, the second is served by Varnish'
	run "curl -sSD- -o /dev/null localhost:6081/web/proventeq/home | grep -iE '^(x-cache|age):'"
	run "curl -sSD- -o /dev/null localhost:6081/web/proventeq/home | grep -iE '^(x-cache|age):'"

	heading 'The mix through the edge for 30 seconds: guests, search, Asset Publisher, sign-ins'
	export BASE_URL=http://localhost:6081
	run 'RATE=80 VUS=20 DURATION=30s QUIET=0 ./run.sh S4-edge-varnish-load mix'

	heading 'Varnish counters for this run'
	run 'docker exec liferay-varnish varnishstat -1 -f MAIN.cache_hit -f MAIN.cache_miss -f MAIN.s_pass | cut -c1-40'

	heading 'p95 in ms. S0 and S3 are the measured 90 s campaign, S4 is this 30 s run'
	run "python3 summarize.py --no-charts >/dev/null; sed -n '/^## p95/,/^## throughput/p' results/SUMMARY.md | grep '^|'"

	heading 'Sign-in stays at 0% edge hit: scenario, p95 in ms, edge hit'
	run "grep '^| S4.*mix/login' results/SUMMARY.md | cut -d'|' -f3,6,10"
	finish
}

demo_cleanup() { docker stop liferay-varnish liferay26112; }

main "$@"
