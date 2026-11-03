#!/usr/bin/env bash
#
# run.sh — Lighthouse against targets behind the TLS + HTTP/2 front (front/docker-compose.yml).
# One run at a time, on a quiet box. Each run gets a fresh Chrome with an empty cache.
#
#   ./run.sh OUT_DIR "edge=9443 static=9444" "/web/proventeq/home ..." "mobile desktop" RUNS
#
# Writes OUT_DIR/<target>/<page>/<preset>-<n>.json. Summarise with report.py.
set -euo pipefail
OUT="${1:?output dir}"; TARGETS="${2:?targets}"; PAGES="${3:?pages}"; PRESETS="${4:?presets}"; RUNS="${5:-5}"
LH_VERSION="${LH_VERSION:-13.6.0}"
export CHROME_PATH="${CHROME_PATH:-/usr/bin/google-chrome-stable}"

for run in $(seq 1 "$RUNS"); do
	for preset in $PRESETS; do
		for page in $PAGES; do
			# take turns between the targets, so that drift over time hits them equally
			for t in $TARGETS; do
				name=${t%%=*} port=${t##*=}
				dir="$OUT/$name/$(basename "$page")"
				mkdir -p "$dir"
				flag=(); [ "$preset" = desktop ] && flag=(--preset=desktop)
				# LH_FLAGS: e.g. --throttling-method=devtools, for real throttling instead of the model
				read -r -a extra <<<"${LH_FLAGS:-}"
				npx --yes "lighthouse@$LH_VERSION" "https://localhost:$port$page" \
					--quiet --only-categories=performance "${flag[@]}" "${extra[@]}" \
					--chrome-flags="--headless=new --ignore-certificate-errors" \
					--output=json --output-path="$dir/$preset-$run.json"
				echo "$(date +%T) run $run $preset $name $page"
			done
		done
	done
done
