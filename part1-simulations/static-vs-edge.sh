#!/usr/bin/env bash
#
# static-vs-edge.sh — the same guest traffic against the static site and against Varnish,
# for results/STATIC-VS-EDGE.md.
#
#   ./static-vs-edge.sh
#
#   static  part2-static-prototype/fidelity on nginx (:8091), precompressed (gzip_static)
#   edge    Liferay behind Varnish (:6081), the S4 configuration
#
# Two workloads, both LIGHT=1 (k6 checks status and Content-Length, never reads a body):
#   pages     the HTML only, one request per iteration (as the S4-edge-pages-light ladder)
#   pageview  one first visit per iteration: the HTML plus every file a browser fetched with
#             it, captured by capture_pageview.py into k6/data/pageview-<target>.json
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
STATIC=http://127.0.0.1:8091 EDGE=http://127.0.0.1:6081
export LIGHT=1 MAX_VUS=3000 EXTRA_CONTAINERS="liferay-varnish proventeq-fidelity"

HTML_RATES="4000 8000 12000 16000 20000 25000 30000 35000"
STATIC_VIEWS="500 1000 2000 3000 4000 5000 6000 8000 10000 12000 15000 20000"
EDGE_VIEWS="50 100 200 300 400 500 600 800 1000 1200 1500 2000 3000"

python3 capture_pageview.py "$STATIC" k6/data/pageview-static.json
python3 capture_pageview.py "$EDGE" k6/data/pageview-varnish.json

BASE_URL=$STATIC MIN_BYTES=3000 ./stress.sh S6-static-pages pages $HTML_RATES
BASE_URL=$EDGE ./stress.sh S4-edge-pages-r2 pages $HTML_RATES
BASE_URL=$STATIC MIN_BYTES=3000 PAGEVIEW_FILE=k6/data/pageview-static.json ./stress.sh S6-static-pageview pageview $STATIC_VIEWS
BASE_URL=$EDGE PAGEVIEW_FILE=k6/data/pageview-varnish.json ./stress.sh S4-edge-pageview pageview $EDGE_VIEWS
python3 static_vs_edge_report.py
