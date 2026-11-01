#!/usr/bin/env bash
#
# rungs-campaign.sh — one comparable test across all five rungs of the ladder, for
# results/RUNG-RESULTS.md. Same day, same k6 settings (LIGHT=1), same rates, and each rung is
# a real configuration:
#
#   R1 stock origin (S0)          R2 Cacheable origin (S2)
#   R3 S3 origin + Varnish with GUEST_HTML_CACHE=0: assets at the edge, HTML from the origin
#   R4 S3 origin + Varnish (S4)   R5 fidelity static site on nginx (:8091)
#   ZGC the S3 origin with Generational ZGC instead of G1 (HTML only)
#
# Two workloads: pages (HTML only) and pageview (a first visit: HTML + every file a browser
# fetched). Varnish runs with its default thread_pool_max (5000) so that our config is not the
# limit. The origin is restarted and warmed before every origin ladder.
#
#   ./rungs-campaign.sh [R1 R2 R3 R4 R5 ZGC]
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
C=liferay26112 ORIGIN=http://127.0.0.1:8086 EDGE=http://127.0.0.1:6081 STATIC=http://127.0.0.1:8091
export LIGHT=1 MAX_VUS=3000 EXTRA_CONTAINERS="liferay-varnish proventeq-fidelity"
PF=k6/data/pageview-varnish.json SF=k6/data/pageview-static.json

ORIGIN_HTML="50 100 200 300 400 600 800 1000 1200 1500 2000"
EDGE_HTML="100 200 400 800 1200 2000 4000 8000 16000 25000 30000"
VIEWS="5 10 20 40 80 120 160 200 300 400 600 800 1000 1500 2000 3000 4000"
STATIC_VIEWS="5 10 20 40 80 200 400 1000 2000 4000 8000 10000 12000 15000"

warm() {  # restart Liferay, wait, warm the JVM for 60 s
	echo "== restart $C ($(date +%T))"; docker restart "$C" >/dev/null
	until curl -sf -o /dev/null --max-time 20 "$ORIGIN/web/proventeq/home"; do sleep 5; done
	BASE_URL=$ORIGIN STEP_DURATION=60s COOLDOWN=1 LIGHT=1 ./stress.sh _warmup pages 20 >/dev/null 2>&1 || true
	rm -rf results/stress/_warmup
}
varnish() {  # (re)create Varnish against the current container IP
	local ip; ip=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "$C")
	( cd matrix/varnish; LIFERAY_UPSTREAM=$ip GUEST_HTML_CACHE=$1 docker compose -f docker-compose.yml -f docker-compose.local.yml up -d --force-recreate >/dev/null 2>&1 )
	until curl -sf -o /dev/null --max-time 20 "$EDGE/web/proventeq/home"; do sleep 2; done
}
for s in "${@:-R1 R2 R3 R4 R5 ZGC}"; do for r in $s; do case $r in
	R1)
		matrix/local/apply-stage.sh S0
		warm; BASE_URL=$ORIGIN ./stress.sh R1-S0-pages pages $ORIGIN_HTML
		warm; BASE_URL=$ORIGIN PAGEVIEW_FILE=$PF ./stress.sh R1-S0-pageview pageview $VIEWS ;;
	R2)
		matrix/local/apply-stage.sh S2
		warm; BASE_URL=$ORIGIN ./stress.sh R2-S2-pages pages $ORIGIN_HTML
		warm; BASE_URL=$ORIGIN PAGEVIEW_FILE=$PF ./stress.sh R2-S2-pageview pageview $VIEWS ;;
	R3)
		matrix/local/apply-stage.sh S3
		warm; varnish 0; BASE_URL=$EDGE PAGEVIEW_FILE=$PF ./stress.sh R3-edge-assets-pageview pageview $VIEWS ;;
	R4)
		matrix/local/apply-stage.sh S3
		warm; varnish 1; BASE_URL=$EDGE ./stress.sh R4-edge-html-pages pages $EDGE_HTML
		warm; varnish 1; BASE_URL=$EDGE PAGEVIEW_FILE=$PF ./stress.sh R4-edge-html-pageview pageview $VIEWS ;;
	R5)
		docker compose -f ../part2-static-prototype/fidelity/docker-compose.yml up -d >/dev/null
		until curl -sf -o /dev/null --max-time 5 "$STATIC/"; do sleep 1; done
		BASE_URL=$STATIC MIN_BYTES=3000 ./stress.sh R5-static-pages pages $EDGE_HTML
		BASE_URL=$STATIC MIN_BYTES=3000 PAGEVIEW_FILE=$SF ./stress.sh R5-static-pageview pageview $STATIC_VIEWS ;;
	S3G1)
		matrix/local/apply-stage.sh S3
		warm; BASE_URL=$ORIGIN ./stress.sh S3-G1-pages pages $ORIGIN_HTML ;;
	ZGC)
		GC=zgc matrix/local/apply-stage.sh S3
		warm; BASE_URL=$ORIGIN ./stress.sh S3-ZGC-pages pages $ORIGIN_HTML
		matrix/local/apply-stage.sh S3 ;;
esac; done; done
echo "== campaign done ($(date +%T))"
