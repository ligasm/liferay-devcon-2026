#!/usr/bin/env bash
#
# s5-publish.sh <ttl|purge> — S5 "publish → fresh at the edge" on the local lab.
#
#   ttl    publish only; the edge serves the old page until its TTL (60 s) runs out.
#   purge  publish, then immediately BAN the page at Varnish — exactly the call the
#          S5 ModelListener (../S5-edge-purge/src) makes after commit. The Java module
#          is a sketch that needs a Liferay workspace build; this emulates its effect.
#
# k6/publish-to-fresh.js polls origin and edge every 250 ms and records
# origin_to_edge_ms; this script performs the publish (PATCH of a News article title
# through Headless Delivery) while k6 is polling.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$HERE/../.."
MODE="${1:?usage: $0 ttl|purge}"
# shellcheck disable=SC1091
source ../part0-base-site/dist/k6.env
ORIGIN=http://127.0.0.1:8086
EDGE=http://127.0.0.1:6081
PAGE="${PAGE:-$AP_PAGE}"
AUTH="$API_USER:$API_PASS"
MARKER="devcon$(date +%s)"

# newest News article (the Asset Publisher on /news lists newest first)
read -r ID TITLE < <(curl -s -u "$AUTH" "$ORIGIN/o/headless-delivery/v1.0/sites/$SITE_ID/structured-contents?flatten=true&pageSize=1&sort=dateCreated:desc&fields=id,title" |
	python3 -c 'import json,sys; i=json.load(sys.stdin)["items"][0]; print(i["id"], i["title"])')
echo "== S5/$MODE: article $ID \"$TITLE\" → marker $MARKER on $PAGE"

# make sure the edge holds a cached copy before the publish
curl -s -o /dev/null "$EDGE$PAGE"; curl -s -o /dev/null "$EDGE$PAGE"

STAGE="S5-edge-$MODE"
BASE_URL=$EDGE ORIGIN_URL=$ORIGIN PAGE=$PAGE FRESH_MARKER=$MARKER POLL_MS=250 MAX_WAIT=120s \
	./run.sh "$STAGE" publish-to-fresh &
K6=$!
sleep 6

echo "== publish $(date +%T.%N | cut -c1-12)"
curl -s -o /dev/null -w "PATCH %{http_code} in %{time_total}s\n" -u "$AUTH" -X PATCH -H 'Content-Type: application/json' \
	-d "{\"title\": \"${TITLE%% devcon*} $MARKER\"}" "$ORIGIN/o/headless-delivery/v1.0/structured-contents/$ID"
if [[ "$MODE" == "purge" ]]; then
	curl -s -o /dev/null -w "BAN %{http_code} in %{time_total}s\n" -X BAN -H "Host: 127.0.0.1:6081" -H "X-Ban-Url: ^$PAGE" "$EDGE/"
fi
wait $K6 || true
