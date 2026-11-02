#!/usr/bin/env bash
#
# zgc-repeat.sh — does the ZGC OutOfMemoryError from the 2026-11-01 campaign come back?
#
# That campaign had four ZGC starts, and only two of them say anything about ZGC: one died with
# OutOfMemoryError 43 s after start, and one ran the full ladder. (One was killed by a session
# restart, one by a bug in stress.sh.) This repeats the same sequence N times: apply S3 with ZGC,
# restart, warm for 60 s, then 60 s at 200 pages/s and 60 s at 1,200 pages/s, recording whether
# Liferay survived and the highest ZGC live-set reading. A failed start keeps its GC log and any
# heap dump, outside the repo. S3 with G1 is re-applied and Liferay stopped at the end.
#
#   ./zgc-repeat.sh [N=8] [KEEP_DIR]
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
N="${1:-8}"; KEEP="${2:-/tmp/zgc-repeat}"; mkdir -p "$KEEP"
C=liferay26112 ORIGIN=http://127.0.0.1:8086 L=/opt/liferay
export LIGHT=1 MAX_VUS=3000 EXTRA_CONTAINERS="liferay-varnish proventeq-fidelity" BASE_URL=$ORIGIN
OUT=results/zgc-repeat.csv
[[ -f "$OUT" ]] || echo "start,time,survived,exit_code,oom_in_logs,max_live_mb,step_200_p95_ms,step_1200_p95_ms,note" > "$OUT"

running() { [[ "$(docker inspect -f '{{.State.Running}}' "$C" 2>/dev/null)" == true ]]; }
p95() { python3 - "$1" <<'EOF'
import csv, sys
try:
    r = list(csv.DictReader(open(sys.argv[1])))
    print(" ".join(f"{float(x['p95_ms']):.0f}" for x in r))
except Exception:
    print("")
EOF
}

for i in $(seq 1 "$N"); do
	t=$(date +%T); note=""; since=$(date +%s)
	echo "== start $i/$N ($t)"
	running || docker start "$C" >/dev/null 2>&1
	docker exec "$C" sh -c "rm -f $L/logs/*.hprof" 2>/dev/null
	GC=zgc matrix/local/apply-stage.sh S3 >/dev/null 2>&1 || note="apply-stage failed;"
	running || note="$note died on the apply-stage start;"
	docker restart "$C" >/dev/null 2>&1
	up=$(date +%s)
	until curl -sf -o /dev/null --max-time 20 "$ORIGIN/web/proventeq/home"; do
		sleep 5
		running || break
		(( $(date +%s) - up > 600 )) && { note="$note not up after 10 min;"; break; }
	done
	label="zgc-repeat-$(printf %02d "$i")"
	if running; then
		STEP_DURATION=60s COOLDOWN=1 ./stress.sh _warmup pages 20 >/dev/null 2>&1 || true
		rm -rf results/stress/_warmup
	fi
	if running; then
		./stress.sh "$label" pages 200 1200 >/dev/null 2>&1 || note="$note stress rc=$?;"
		sleep 2
	fi
	surv=no; running && surv=yes
	code=$(docker inspect -f '{{.State.ExitCode}}' "$C" 2>/dev/null)
	oom=$(docker logs --since "$since" "$C" 2>&1 | grep -c -E 'OutOfMemoryError|Out Of Memory')
	work="$KEEP/$label"; rm -rf "$work"; mkdir -p "$work"
	docker cp "$C:$L/logs/gc-zgc.log" "$work/gc-zgc.log" >/dev/null 2>&1
	live=$(python3 -c '
import re, sys
m = [int(x) for l in open(sys.argv[1], errors="replace") if "Live:" in l for x in re.findall(r"Live:\s+-\s+(\d+)M", l)]
print(max(m) if m else "")' "$work/gc-zgc.log" 2>/dev/null)
	read -r a b < <(p95 "results/stress/$label/steps.csv"; echo)
	echo "$i,$t,$surv,$code,$oom,$live,${a:-},${b:-},$note" >> "$OUT"
	tail -1 "$OUT"
	if [[ $surv == yes && "$oom" == 0 ]]; then rm -rf "$work"; else
		docker logs --since "$since" "$C" > "$work/container.log" 2>&1
		docker cp "$C:$L/logs/." "$work/logs/" >/dev/null 2>&1
	fi
done

echo "== re-apply S3 with G1 ($(date +%T))"
matrix/local/apply-stage.sh S3 >/dev/null 2>&1
docker stop "$C" >/dev/null 2>&1
echo "== done ($(date +%T))"; cat "$OUT"
