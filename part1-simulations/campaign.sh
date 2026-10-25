#!/usr/bin/env bash
#
# campaign.sh — one stage of the S0…S6 ladder against the local Proventeq base site.
#
#   ./campaign.sh <STAGE_LABEL> [scenario …]
#
# Sources ../part0-base-site/dist/k6.env (written by `bun build.ts --deploy`), runs an
# unrecorded 30 s warm-up (JIT, Liferay caches) and then the scenarios through run.sh
# with the fixed load shape used for every stage (open model, RATE=10, 60 s).
# Override BASE_URL (e.g. the Varnish edge) or RATE/DURATION from the environment.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$HERE"
STAGE="$1"; shift

_BASE_URL_OVERRIDE="${BASE_URL:-}"
# shellcheck disable=SC1091
source ../part0-base-site/dist/k6.env
[[ -n "$_BASE_URL_OVERRIDE" ]] && export BASE_URL="$_BASE_URL_OVERRIDE"
export RATE="${RATE:-10}" DURATION="${DURATION:-60s}" VUS="${VUS:-10}"

echo "== warm-up ($BASE_URL)"
RATE=5 DURATION=30s ./run.sh "_warmup" guest-browse asset-publisher search >/dev/null 2>&1 || true
rm -rf results/_warmup

./run.sh "$STAGE" "$@"
