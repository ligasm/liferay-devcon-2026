#!/usr/bin/env bash
# Part 2 demo (slides 22-23). Run docs/demos/demo3-regenerate.sh prepare first, and cleanup afterwards:
# this really changes a post in the lab Liferay on :8086 and rebuilds the static site on :8091.
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
WORK=/tmp/devcon-demo3
ID=37565
POST=/web/proventeq/blog/-/blogs/copilot-readiness-five-checks
API=http://127.0.0.1:8086/o/headless-delivery/v1.0/blog-postings/$ID
PORTAL=http://localhost:8086$POST
STATIC=http://localhost:8091$POST
export ENV_FILE=.env.local-proventeq CONTENT_DIR=$WORK/content REPORTS_DIR=$WORK/reports
cd "$REPO/part2-static-prototype"
unset ANTHROPIC_API_KEY

auth() { ( source "$REPO/part2-static-prototype/.env.local-proventeq"; echo "$LIFERAY_USER:$LIFERAY_PASSWORD" ); }
regenerate() { node fidelity/regenerate.mjs "$@" 2>&1 | grep -E 'plan:|done in' | sed 's/ | AI units.*//'; }
change_title() {
	curl -sS -o /dev/null -w 'Liferay answered %{http_code}\n' -u "$(auth)" -X PATCH -H 'Content-Type: application/json' \
		-d "$(python3 -c 'import json,sys; print(json.dumps({"headline": sys.argv[1]}))' "$1")" "$API"
}
title_of() { curl -sSL "$1" | grep -o '<title>[^<]*' | sed 's/<title>//; s/ - Proventeq.*//'; }
stats() { curl -sSL "$1" -o "$WORK/page"; echo "$(wc -c < "$WORK/page") bytes, $(grep -o '<script' "$WORK/page" | wc -l) scripts, $(grep -c authToken "$WORK/page") authToken"; }

clear
say '1. First build, from the APIs of our own Liferay'
run 'regenerate --full'
sleep 5
say '2. Run it again. Nothing changed'
run 'regenerate'
sleep 5
say '3. One post, two deliveries: bytes, script tags, authToken'
run 'stats $PORTAL'
sleep 2
run 'stats $STATIC'
sleep 6
say '4. Change the post in Liferay, then regenerate'
run 'change_title "Six checks to run before switching on Microsoft 365 Copilot"'
run 'regenerate'
sleep 3
run 'cat $WORK/reports/purge.txt | cut -c1-108'
sleep 7
say '5. Both now show the new title'
run 'title_of $PORTAL'
sleep 2
run 'title_of $STATIC'
sleep 6
say '6. Check every internal link'
run 'node tools/check-links.mjs dist-fidelity'
hold 6
