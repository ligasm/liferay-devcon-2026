#!/usr/bin/env bash
# run-stage.sh <STAGE_LABEL> — the two measured passes for one stage of the local ladder:
#   1. every scenario at the standard shape (RATE=10, 60 s)       → results/<STAGE>/
#   2. the mixed workload under load (RATE=80, 90 s)               → results/<STAGE>-load/
# CPU/memory of the Liferay container are sampled into results/<STAGE>-load/docker-stats.txt.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
STAGE="$1"
C="${CONTAINER:-liferay26112}"
./campaign.sh "$STAGE"
mkdir -p "results/$STAGE-load"
( while sleep 10; do docker stats --no-stream --format '{{.CPUPerc}} {{.MemUsage}}' "$C" 2>/dev/null | sed "s/^/$(date +%T) /"; done ) > "results/$STAGE-load/docker-stats.txt" &
STATS=$!
RATE=80 DURATION=90s VUS=20 ./campaign.sh "$STAGE-load" mix
kill $STATS
