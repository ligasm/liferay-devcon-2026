#!/usr/bin/env bash
# Part 2 demo (slides 22-23). Run from a copy of part2-static-prototype with no .env and clean state:
# content/raw, content/build, content/state.json, content/plan.json and dist/ removed.
# Needs network for liferay.dev. The edit in step 4 touches the local mirror, because liferay.dev isn't ours to edit.
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
unset ANTHROPIC_API_KEY
POST=setting-up-glowroot-as-central-collector-liferay
ID=121975600
clear
say '1. First build, from the public Headless API on liferay.dev'
run 'node pipeline/regenerate.mjs --full --no-ai --max-items 80 2>&1 | grep -vE "├─|directory:" | cut -c1-108'
sleep 6
say '2. Run it again. Nothing changed'
run 'node pipeline/regenerate.mjs 2>&1 | cut -c1-108'
sleep 6
node tools/serve.mjs dist >/dev/null 2>&1 &
SERVE=$!
sleep 1
say '3. One post, two deliveries: bytes, script tags, authToken'
stats() { curl -sSL "$1" -o /tmp/demo3-page.$$; echo "$(wc -c < /tmp/demo3-page.$$) bytes, $(grep -o '<script' /tmp/demo3-page.$$ | wc -l) scripts, $(grep -c authToken /tmp/demo3-page.$$) authToken"; rm -f /tmp/demo3-page.$$; }
run "stats https://liferay.dev/b/$POST"
sleep 2
run "stats http://localhost:4321/blog/$POST/"
sleep 2
run "curl -sSD- -o /dev/null http://localhost:4321/blog/$POST/ | grep -iE '^(cache-control|cache-tag):'"
sleep 8
say '4. Edit one post in the local mirror and rerun'
run "sed -i -E '0,/\"headline\": *\"/s//&[EDITED] /' content/raw/blog/$ID.json"
run 'node pipeline/regenerate.mjs --offline --no-ai 2>&1 | grep -E "plan:|build:|done in" | cut -c1-108'
sleep 3
run "sed -n '/CDN purge/,\$p' \"\$(ls -t reports/*.md | head -1)\" | cut -c1-108"
sleep 8
say '5. What would the model cost for the whole catalogue? No key, no calls'
run 'node pipeline/regenerate.mjs --dry-run --full --offline 2>&1 | grep -E "plan:|orchestrated" | cut -c1-108'
run "grep -E 'calls:' \"\$(ls -t reports/*.md | head -1)\""
sleep 7
say '6. Check every internal link'
run 'node tools/check-links.mjs dist'
hold 6
kill $SERVE 2>/dev/null
