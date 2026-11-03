#!/usr/bin/env bash
# Demo 3, slides 22 and 23: generate a static site from local Liferay, change a post, regenerate. Same commands as demo3-regenerate.md.
#
#   ./demo3-regenerate.sh prepare            before the talk: start Liferay and :8091, clear the build state
#   ./demo3-regenerate.sh                    show each command, press Enter to run it
#   ./demo3-regenerate.sh change "A title"   retitle the post in Liferay and regenerate, as often as you like
#   ./demo3-regenerate.sh restore            put the original title back and regenerate
#   ./demo3-regenerate.sh cleanup            restore, then remove the build state
#
# AUTO=1 runs without waiting for Enter, for a rehearsal.
# Each rehearsal needs a new prepare, because the demo starts from a clean build.
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
VIDEO=demo3-regenerate
WORK=/tmp/devcon-demo3
P2="$REPO/part2-static-prototype"
ID=37565
POST=/web/proventeq/blog/-/blogs/copilot-readiness-five-checks
API=http://127.0.0.1:8086/o/headless-delivery/v1.0/blog-postings/$ID
PORTAL=http://localhost:8086$POST
STATIC=http://localhost:8091$POST

export ENV_FILE=.env.local-proventeq CONTENT_DIR=$WORK/content REPORTS_DIR=$WORK/reports
cd "$P2"
unset ANTHROPIC_API_KEY

auth() { ( source "$P2/.env.local-proventeq"; echo "$LIFERAY_USER:$LIFERAY_PASSWORD" ); }
regenerate() { node fidelity/regenerate.mjs "$@" 2>&1 | grep -E 'plan:|done in' | sed 's/ | AI units.*//'; }
current_title() { curl -sS -u "$(auth)" "$API?fields=headline" | python3 -c 'import json,sys; print(json.load(sys.stdin)["headline"])'; }
change_title() {
	curl -sS -o /dev/null -w 'Liferay answered %{http_code}\n' -u "$(auth)" -X PATCH -H 'Content-Type: application/json' \
		-d "$(python3 -c 'import json,sys; print(json.dumps({"headline": sys.argv[1]}))' "$1")" "$API"
}
title_of() { curl -sSL "$1" | grep -o '<title>[^<]*' | sed 's/<title>//; s/ - Proventeq.*//'; }
stats() { curl -sSL "$1" -o "$WORK/page"; echo "$(wc -c < "$WORK/page") bytes, $(grep -o '<script' "$WORK/page" | wc -l) scripts, $(grep -c authToken "$WORK/page") authToken"; }
links() { printf 'Liferay: %s\nStatic:  %s\n' "$PORTAL" "$STATIC"; }

demo_prepare() {
	need docker curl node python3
	docker start liferay26112 >/dev/null
	wait_for http://localhost:8086/web/proventeq/home
	[ -z "$(docker ps -q -f name=^proventeq-fidelity$)" ] && docker rm -f proventeq-fidelity >/dev/null 2>&1
	docker compose -f fidelity/docker-compose.yml up -d --quiet-pull
	wait_for http://localhost:8091/web/proventeq/home proventeq-fidelity
	# Keep the original title across rehearsals, so that restore always goes back to it.
	local original=""
	[ ! -f "$WORK/original-title" ] || original=$(cat "$WORK/original-title")
	rm -rf "$WORK"
	mkdir -p "$WORK"
	[ -n "$original" ] || original=$(current_title)
	echo "$original" > "$WORK/original-title"
	change_title "$original"
	echo 'Ready. Now run this script with no arguments.'
}

demo_run() {
	[ ! -f "$WORK/content/state.json" ] || die "A build already exists in $WORK. Run: $0 prepare"
	[ -f "$WORK/original-title" ] || die "Not prepared. Run: $0 prepare"
	need curl node python3

	heading 'First build, from the APIs of our own Liferay'
	run 'regenerate --full'

	heading 'Run it again. Nothing changed'
	run 'regenerate'

	heading 'One post, two deliveries: bytes, script tags, authToken'
	run 'stats $PORTAL'
	run 'stats $STATIC'

	heading 'Change the post in Liferay, then regenerate'
	run 'change_title "Six checks to run before switching on Microsoft 365 Copilot"'
	run 'regenerate'
	run 'cat $WORK/reports/purge.txt'

	heading 'Both now show the new title'
	run 'title_of $PORTAL'
	run 'title_of $STATIC'

	heading 'Check every internal link'
	run 'node tools/check-links.mjs dist-fidelity'

	links
	echo "When you've finished showing it: $0 restore"
	finish
}

demo_change() {
	[ -n "${1:-}" ] || die 'Give the new title, in quotes.'
	mkdir -p "$WORK"
	[ -f "$WORK/original-title" ] || current_title > "$WORK/original-title"
	[ -f "$WORK/content/state.json" ] || regenerate --full
	change_title "$1"
	regenerate
	echo 'Pages to purge:'
	cat "$WORK/reports/purge.txt"
	links
}

demo_restore() {
	[ -f "$WORK/original-title" ] || die 'Nothing to restore: no saved title.'
	change_title "$(cat "$WORK/original-title")"
	[ ! -f "$WORK/content/state.json" ] || regenerate
}

demo_cleanup() {
	demo_restore
	rm -rf "$WORK"
}

case "${1:-run}" in
	change) demo_change "${2:-}" ;;
	restore) demo_restore ;;
	*) main "$@" ;;
esac
