#!/usr/bin/env bash
#
# stress.sh — capacity ladder: step the request rate up until the target saturates.
#
#   ./stress.sh <LABEL> <WORKLOAD> <rate> [rate …]
#   ./stress.sh S3-origin pages 50 100 200 400 800
#   BASE_URL=http://127.0.0.1:6081 ./stress.sh S4-edge pages 500 1000 2000
#
# Each step is one k6 run of k6/stress.js (open model, no think time) for
# STEP_DURATION, with stress_sampler.py recording host / container / k6 CPU and the
# Liferay heap. After every step one line goes to results/stress/<LABEL>/steps.csv.
# The ladder stops after the first step that is saturated:
#   errors > 5 %  or  dropped iterations > 10 % of the target  or  p95 > 5 s
# (STOP_ON_SATURATION=0 runs every step regardless).
#
# Env: BASE_URL (from k6.env), STEP_DURATION (60s), COOLDOWN (20), MAX_VUS (1500),
#      CONTAINER (liferay26112), EXTRA_CONTAINERS ("liferay-varnish proventeq-static").
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$HERE"
LABEL="$1"; WORKLOAD="$2"; shift 2

_BASE_URL_OVERRIDE="${BASE_URL:-}"
# shellcheck disable=SC1091
source ../part0-base-site/dist/k6.env
[[ -n "$_BASE_URL_OVERRIDE" ]] && export BASE_URL="$_BASE_URL_OVERRIDE"
K6="${K6:-$HERE/bin/k6}"
C="${CONTAINER:-liferay26112}"
EXTRA="${EXTRA_CONTAINERS:-liferay-varnish proventeq-static}"
OUT="results/stress/$LABEL"
mkdir -p "$OUT"
STEPS="$OUT/steps.csv"
[[ -f "$STEPS" ]] || echo "label,workload,target_rate,achieved_iter_s,req_s,dropped_pct,error_pct,p50_ms,p95_ms,p99_ms,max_vus,liferay_cores_p90,host_cores_p90,k6_cores_p90,heap_old_mb_max,full_gc,saturated" > "$STEPS"

echo "== stress $LABEL / $WORKLOAD → $BASE_URL   steps: $*   ($(date +%T))"
for RATE in "$@"; do
	python3 stress_sampler.py "$OUT/step-$RATE.stats.csv" "$C" $EXTRA &
	SAMPLER=$!
	STAGE_LABEL="stress/$LABEL" RESULTS_DIR=results STEP_NAME="step-$RATE" WORKLOAD="$WORKLOAD" \
		RATE="$RATE" DURATION="${STEP_DURATION:-60s}" MAX_VUS="${MAX_VUS:-1500}" THINK_MIN=0 THINK_MAX=0 \
		"$K6" run k6/stress.js --quiet --no-color --tag "stage=stress-$LABEL" > "$OUT/step-$RATE.log" 2>&1 || true
	kill "$SAMPLER" 2>/dev/null; wait "$SAMPLER" 2>/dev/null || true

	VERDICT=$(python3 - "$OUT" "$RATE" "$LABEL" "$WORKLOAD" "$C" "${STEP_DURATION:-60s}" 2>&1 >> "$STEPS" <<'EOF'
import csv, json, sys
out, rate, label, workload, c, dur = sys.argv[1], int(sys.argv[2]), *sys.argv[3:]
secs = float(dur.rstrip("s"))
m = json.load(open(f"{out}/step-{rate}.summary.json"))["metrics"]
v = lambda k, f, d=0: m.get(k, {}).get("values", {}).get(f, d)
it, dropped = v("iterations", "count"), v("dropped_iterations", "count")
achieved = it / secs
drop_pct = 100 * dropped / max(1, it + dropped)
err = 100 * v("http_req_failed", "rate")
p50, p95, p99 = v("http_req_duration", "med"), v("http_req_duration", "p(95)"), v("http_req_duration", "p(99)")
rows = list(csv.DictReader(open(f"{out}/step-{rate}.stats.csv")))
def p90(col):
    xs = sorted(float(r[col]) for r in rows if r.get(col))
    return xs[max(0, int(len(xs) * 0.9) - 1)] if xs else 0
heap = max([float(r["heap_old_mb"]) for r in rows if r.get("heap_old_mb")] or [0])
fgc = max([int(r["full_gc"]) for r in rows if r.get("full_gc")] or [0])
sat = err > 5 or drop_pct > 10 or p95 > 5000
print(",".join(str(x) for x in [label, workload, rate, f"{achieved:.1f}", f"{v('http_reqs', 'rate'):.1f}", f"{drop_pct:.1f}", f"{err:.2f}",
      f"{p50:.1f}", f"{p95:.1f}", f"{p99:.1f}", int(v("vus_max", "max", v("vus_max", "value"))), f"{p90(c + '_cores'):.1f}",
      f"{p90('host_cores'):.1f}", f"{p90('k6_cores'):.1f}", f"{heap:.0f}", fgc, int(sat)]))
print(f"   rate {rate:>5}/s → {achieved:7.1f} it/s  drop {drop_pct:5.1f}%  err {err:5.2f}%  p95 {p95:7.0f} ms  liferay {p90(c + '_cores'):4.1f} cores  k6 {p90('k6_cores'):4.1f}  heap {heap:5.0f} MB  {'SATURATED' if sat else 'ok'}", file=sys.stderr)
EOF
	)
	echo "$VERDICT"
	if [[ "${STOP_ON_SATURATION:-1}" == "1" && "$VERDICT" == *SATURATED* ]]; then
		echo "== saturated at $RATE/s — ladder stops"; break
	fi
	sleep "${COOLDOWN:-20}"
	until curl -sf -o /dev/null --max-time 10 "$BASE_URL$HOME_PATH"; do sleep 5; done
done
echo "== done $LABEL ($(date +%T))"
