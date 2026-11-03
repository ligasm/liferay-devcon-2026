#!/usr/bin/env bash
# Demo 3, slides 22 and 23: regenerate a static site from liferay.dev. Same commands as demo3-regenerate.md.
#
#   ./demo3-regenerate.sh prepare    before the talk: make a clean working copy
#   ./demo3-regenerate.sh            on stage: show each command, press Enter to run it
#   ./demo3-regenerate.sh cleanup    afterwards: stop the static site
#
# AUTO=1 runs without waiting for Enter, for a rehearsal.
# Each rehearsal needs a new prepare, because the demo starts from a clean build.
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
VIDEO=demo3-regenerate
WORK=/tmp/devcon-demo3
SERVE=

stats() { curl -sSL "$1" -o /tmp/devcon-demo3-page; echo "$(wc -c < /tmp/devcon-demo3-page) bytes, $(grep -o '<script' /tmp/devcon-demo3-page | wc -l) scripts, $(grep -c authToken /tmp/devcon-demo3-page) authToken"; }

# Anchored, so that it can't match a shell whose command line merely mentions this server.
stop_static_site() { pkill -f '^node tools/serve.mjs dist' 2>/dev/null || true; }

demo_prepare() {
	need node rsync curl
	stop_static_site
	rm -rf "$WORK"
	rsync -a --exclude '/dist*' --exclude '/content-proventeq' --exclude '/reports-proventeq' --exclude '/.env' "$REPO/part2-static-prototype/" "$WORK/"
	cd "$WORK"
	rm -rf content/raw content/build content/state.json content/plan.json content/build-info.json content/build-result.json content/ai-log.json reports/*.md
	curl -sf -o /dev/null --max-time 20 https://liferay.dev/ || die "Can't reach liferay.dev. Use the fallback video."
	echo "Ready in $WORK"
}

demo_run() {
	need node curl
	[ -d "$WORK/pipeline" ] || die "$WORK isn't ready. Run: $0 prepare"
	[ ! -e "$WORK/content/state.json" ] || die "$WORK has already been built. Run: $0 prepare"
	if curl -s -o /dev/null --max-time 2 http://localhost:4321/; then
		die "Something is already answering on :4321. Run: $0 cleanup"
	fi
	cd "$WORK"
	unset ANTHROPIC_API_KEY
	trap '[ -z "$SERVE" ] || kill "$SERVE" 2>/dev/null || true' EXIT
	POST=setting-up-glowroot-as-central-collector-liferay
	ID=121975600

	heading '1. First build, from the public Headless API on liferay.dev'
	run 'node pipeline/regenerate.mjs --full --no-ai --max-items 80'

	# The mirror keeps the 80 most recently modified posts, so this post can drop out.
	if [ ! -e "content/raw/blog/$ID.json" ]; then
		ID=$(node -e "const fs=require('fs');const p=fs.readdirSync('content/raw/blog').map(f=>JSON.parse(fs.readFileSync('content/raw/blog/'+f)));p.sort((a,b)=>a.dateModified>b.dateModified?-1:1);console.log(p[0].id)")
		POST=$(node -e "console.log(JSON.parse(require('fs').readFileSync('content/raw/blog/$ID.json')).friendlyUrlPath)")
		printf '\033[33mThe usual post has left the mirror. Using %s, so the sizes will differ.\033[0m\n' "$POST"
	fi

	heading '2. Run it again. Nothing changed'
	run 'node pipeline/regenerate.mjs'

	heading '3. One post, two deliveries: bytes, script tags, authToken'
	run 'node tools/serve.mjs dist >/dev/null 2>&1 & SERVE=$!; sleep 1'
	run "stats https://liferay.dev/b/$POST"
	run "stats http://localhost:4321/blog/$POST/"
	run "curl -sSD- -o /dev/null http://localhost:4321/blog/$POST/ | grep -iE '^(cache-control|cache-tag):'"

	heading '4. Edit one post in the local mirror and rerun'
	run "sed -i -E '0,/\"headline\": *\"/s//&[EDITED] /' content/raw/blog/$ID.json"
	run 'node pipeline/regenerate.mjs --offline --no-ai 2>&1 | grep -E "plan:|build:|done in"'
	run "sed -n '/CDN purge/,\$p' \"\$(ls -t reports/*.md | head -1)\""

	heading '5. What would the model cost for the whole catalogue? No key, no calls'
	run 'node pipeline/regenerate.mjs --dry-run --full --offline 2>&1 | grep -E "plan:|orchestrated"'
	run "grep -E 'calls:' \"\$(ls -t reports/*.md | head -1)\""

	heading '6. Check every internal link'
	run 'node tools/check-links.mjs dist'

	rm -f /tmp/devcon-demo3-page
	pause '[Enter to stop the static site on :4321 and finish] '
	finish
}

demo_cleanup() {
	stop_static_site
	rm -f /tmp/devcon-demo3-page
}

main "$@"
