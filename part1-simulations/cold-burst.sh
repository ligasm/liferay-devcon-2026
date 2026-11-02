#!/usr/bin/env bash
#
# cold-burst.sh — is the fragment-render out-of-memory crash tied to the garbage collector?
#
# zgc-repeat.sh saw `OutOfMemoryError: Requested array size exceeds VM limit` from jsoup inside
# FragmentEntryProcessorRegistryImpl.processFragmentEntryLinkHTML, with one link fragment rendered
# as an endless <a><a><a></a> run. Stock Liferay's earlier crashes have the same stack. This test
# alternates G1 and ZGC on the same S3 config and sends 200 pages/s straight after each start, with
# no warm-up, so that many threads render fragments on empty caches.
#
#   ./cold-burst.sh [PAIRS=6]
#
# Each start is counted as a crash if the JVM exits or logs an OutOfMemoryError. Writes
# results/cold-burst.csv. Leaves S3 with G1 applied and Liferay stopped.
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
PAIRS="${1:-6}"
C=liferay26112 ORIGIN=http://127.0.0.1:8086 L=/opt/liferay
export LIGHT=1 MAX_VUS=3000 EXTRA_CONTAINERS="liferay-varnish proventeq-fidelity" BASE_URL=$ORIGIN
OUT=results/cold-burst.csv
[[ -f "$OUT" ]] || echo "start,gc,time,survived,oom_errors,oom_kind,jsoup_in_stack,p95_ms,errors_pct" > "$OUT"

running() { [[ "$(docker inspect -f '{{.State.Running}}' "$C" 2>/dev/null)" == true ]]; }

n=0
for i in $(seq 1 "$PAIRS"); do
	for gc in g1 zgc; do
		n=$((n + 1)); t=$(date +%T)
		running || docker start "$C" >/dev/null 2>&1
		docker exec "$C" sh -c "rm -f $L/logs/*.hprof" 2>/dev/null
		GC=$gc matrix/local/apply-stage.sh S3 >/dev/null 2>&1
		since=$(date +%s)
		docker restart "$C" >/dev/null 2>&1
		up=$(date +%s)
		until curl -sf -o /dev/null --max-time 5 "$ORIGIN/c/portal/robots"; do
			sleep 1
			running || break
			(( $(date +%s) - up > 300 )) && break
		done
		label="cold-burst-$(printf %02d "$n")-$gc"
		STEP_DURATION=40s COOLDOWN=1 STOP_ON_SATURATION=0 ./stress.sh "$label" pages 200 >/dev/null 2>&1 || true
		sleep 5
		surv=no; running && surv=yes
		log=$(docker logs --since "$since" "$C" 2>&1)
		oom=$(grep -c '^java.lang.OutOfMemoryError' <<<"$log")
		kind=$(grep -m1 -oE 'OutOfMemoryError: [A-Za-z ]+' <<<"$log" | cut -d' ' -f2-)
		jsoup=$(grep -A14 -m1 '^java.lang.OutOfMemoryError' <<<"$log" | grep -c 'org.jsoup')
		[[ "$kind" == "Requested array size exceeds VM limit" ]] && jsoup="stack not logged; see heap dump"
		read -r p95 err < <(python3 - "results/stress/$label/steps.csv" <<'EOF'
import csv, sys
try:
    r = list(csv.DictReader(open(sys.argv[1])))[-1]
    print(f"{float(r['p95_ms']):.0f} {float(r['error_pct']):.2f}")
except Exception:
    print("- -")
EOF
)
		echo "$n,$gc,$t,$surv,$oom,$kind,$jsoup,$p95,$err" >> "$OUT"
		tail -1 "$OUT"
		rm -rf "results/stress/$label"
		running || docker start "$C" >/dev/null 2>&1
	done
done

matrix/local/apply-stage.sh S3 >/dev/null 2>&1
docker stop "$C" >/dev/null 2>&1
echo "== done ($(date +%T))"; cat "$OUT"
