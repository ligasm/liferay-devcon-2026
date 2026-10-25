#!/usr/bin/env bash
#
# stress-campaign.sh — every capacity ladder used for results/STRESS-RESULTS.md.
#
#   ./stress-campaign.sh [S3|S4|S0|R|L …]  # default: S3 S4 S0
#
#   S3  tuned origin (matrix S1+S2+S3 applied):  pages, search, login, mix
#   S4  the same origin behind Varnish (:6081):  pages, mix
#   S0  stock origin (container defaults):       pages, mix   — then S3 is re-applied
#   R   refinement steps between the last clean and the first saturated step of the S3 ladders
#   L   S4 edge, guest pages with LIGHT=1 (k6 skips the body) to push past the k6-bound limit
#
# Before every origin ladder Liferay is restarted (so guest sessions and heap from the
# previous ladder do not carry over) and warmed up for 60 s at a low rate.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
C="${CONTAINER:-liferay26112}"
ORIGIN=http://127.0.0.1:8086 EDGE=http://127.0.0.1:6081

PAGES="50 100 200 300 400 600 800 1000 1200 1500 2000 2500 3000 4000"
SEARCH="10 20 40 60 80 100 150 200 300 400"
LOGIN="2 5 10 20 40 60 80 120 160 200 300"
MIX="50 100 200 300 400 600 800 1000 1200 1500 2000"
EDGE_PAGES="500 1000 2000 4000 6000 8000 12000 16000 20000 25000"

fresh() {  # restart Liferay and warm it up
	echo "== restart $C ($(date +%T))"; docker restart "$C" >/dev/null
	until curl -sf -o /dev/null --max-time 20 "$ORIGIN/web/proventeq/home"; do sleep 5; done
	BASE_URL=$ORIGIN STEP_DURATION=60s COOLDOWN=1 ./stress.sh _warmup mix 20 >/dev/null 2>&1 || true
	rm -rf results/stress/_warmup
}

for S in "${@:-S3 S4 S0}"; do for s in $S; do case $s in
	S3)
		for w in pages search login mix; do
			fresh
			eval "rates=\$${w^^}"
			BASE_URL=$ORIGIN ./stress.sh S3-origin-$w $w $rates
		done ;;
	S4)
		fresh
		curl -sf -o /dev/null --max-time 20 "$EDGE/web/proventeq/home" || { echo "!! Varnish cannot reach Liferay (container IP changed?)"; exit 1; }
		BASE_URL=$EDGE MAX_VUS=3000 ./stress.sh S4-edge-pages pages $EDGE_PAGES
		fresh
		BASE_URL=$EDGE ./stress.sh S4-edge-mix mix $MIX ;;
	S0)
		matrix/local/apply-stage.sh S0
		for w in pages mix; do
			fresh
			eval "rates=\$${w^^}"
			BASE_URL=$ORIGIN ./stress.sh S0-origin-$w $w $rates
		done
		matrix/local/apply-stage.sh S3 ;;
	R)
		for spec in "search:25 30 35" "login:12 15" "mix:125 150 175"; do
			w=${spec%%:*}; fresh
			BASE_URL=$ORIGIN STOP_ON_SATURATION=0 ./stress.sh S3-origin-$w $w ${spec#*:}
		done ;;
	L)
		fresh
		BASE_URL=$EDGE MAX_VUS=3000 LIGHT=1 ./stress.sh S4-edge-pages-light pages 4000 6000 8000 12000 16000 20000 25000 30000 ;;
esac; done; done
echo "== campaign done ($(date +%T))"
