#!/usr/bin/env bash
#
# run.sh — run one or more k6 scenarios for a matrix stage.
#
#   ./run.sh <STAGE_LABEL> [scenario ...]
#
#   ./run.sh S0-baseline                     # runs every scenario
#   ./run.sh S4-edge mix                     # just the mixed workload
#   ./run.sh S2-jvm guest-browse search      # a subset
#
# Results land in results/<STAGE_LABEL>/:
#   <scenario>.summary.json   written by handleSummary() (k6 data + meta block)
#   <scenario>.json           k6 --summary-export (same numbers, flat legacy format)
#   <scenario>.ndjson         every metric sample — only with RAW=1 (large!)
#   <scenario>.log            console output of the run
#
# Environment (see k6/lib/config.js for the full list): BASE_URL, SITE_PATH,
# HOME_PATH, CONTENT_PAGES, AP_PAGE, BLOG_PATH, SEARCH_PATH, SEARCH_TERMS, DL_URL,
# SITE_ID, LOGIN_USER, LOGIN_PASS, VUS, RATE, DURATION, THINK_MIN, THINK_MAX,
# WITH_ASSETS, RAW, K6 (path to the k6 binary).
#
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$HERE"

K6="${K6:-$HERE/bin/k6}"
if [[ ! -x "$K6" ]]; then
  if command -v k6 >/dev/null 2>&1; then K6="$(command -v k6)"; else
    echo "k6 not found. Put the binary at $HERE/bin/k6 (see README) or set K6=/path/to/k6" >&2; exit 1
  fi
fi

if [[ $# -lt 1 ]]; then
  echo "usage: $0 <STAGE_LABEL> [scenario ...]" >&2
  echo "scenarios: $(ls k6/*.js | xargs -n1 basename | sed 's/\.js$//' | tr '\n' ' ')" >&2
  exit 1
fi

STAGE_LABEL="$1"; shift
ALL_SCENARIOS=(guest-browse guest-browse-sticky asset-publisher search login dl-download headless-api mix)
SCENARIOS=("$@")
[[ ${#SCENARIOS[@]} -eq 0 ]] && SCENARIOS=("${ALL_SCENARIOS[@]}")

OUT="results/$STAGE_LABEL"
mkdir -p "$OUT"

export STAGE_LABEL RESULTS_DIR=results
export BASE_URL="${BASE_URL:-http://localhost:8080}"

echo "== stage: $STAGE_LABEL   target: $BASE_URL   k6: $("$K6" version | head -1)"
echo "== scenarios: ${SCENARIOS[*]}"
echo "== VUS=${VUS:-10} RATE=${RATE:-<closed model>} DURATION=${DURATION:-30s} WITH_ASSETS=${WITH_ASSETS:-0} RAW=${RAW:-0}"
echo

FAILED=0
for s in "${SCENARIOS[@]}"; do
  s="${s%.js}"
  script="k6/$s.js"
  if [[ ! -f "$script" ]]; then echo "!! no such scenario: $script" >&2; FAILED=1; continue; fi

  args=(run "$script"
        --tag "stage=$STAGE_LABEL"
        --summary-export "$OUT/$s.json"
        --no-color)
  if [[ "${RAW:-0}" == "1" ]]; then
    args+=(--out "json=$OUT/$s.ndjson")
  fi
  # Quiet mode hides the live progress bar (nice when projecting); the console
  # summary printed by handleSummary() still shows up.
  [[ "${QUIET:-1}" == "1" ]] && args+=(--quiet)

  echo "── $s ─────────────────────────────────────────────────────"
  start=$(date +%s)
  if "$K6" "${args[@]}" 2>&1 | tee "$OUT/$s.log"; then
    :
  else
    # k6 exits 99 when a threshold fails — keep going, the numbers are still useful
    rc=${PIPESTATUS[0]}
    echo "!! k6 exited with $rc for $s (threshold failure = 99; see $OUT/$s.log)"
    [[ $rc -ne 99 ]] && FAILED=1
  fi
  echo "   took $(( $(date +%s) - start ))s → $OUT/$s.summary.json"
  echo
done

echo "== done. Summarise with:  python3 summarize.py"
exit $FAILED
