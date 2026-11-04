#!/usr/bin/env bash
# Demo 3, slides 22 and 23: generate a static site from local Liferay, change a post, regenerate. Same commands as demo3-regenerate.md.
#
#   ./demo3-regenerate.sh                    run the demo in stages, press Enter to start each one:
#                                              1 prepare, 2 first generation, 3 generate again with nothing changed,
#                                              4 change the post and make your own changes in Liferay, 5 generate again
#   ./demo3-regenerate.sh prepare            only stage 1, to start Liferay and :8091 before the talk
#   ./demo3-regenerate.sh change "A title"   retitle the post in Liferay and regenerate, as often as you like
#   ./demo3-regenerate.sh restore            put the original title back and regenerate
#   ./demo3-regenerate.sh cleanup            restore, then remove the build state
#
# AUTO=1 runs without waiting for Enter, for a rehearsal.
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
	echo 'Ready.'
}

stage() { heading "Stage $1 of 5: $2"; pause '[Enter to start] '; }
# Run a command without its own Enter: within a stage, the commands follow each other.
step() { AUTO=1 run "$1"; }

# Generate, then show what changed. Without a change there is no build, so there is nothing to purge.
generate_and_show() {
	rm -f "$WORK/reports/purge.txt"
	step "regenerate ${1:-}"
	if [ -s "$WORK/reports/purge.txt" ]; then
		step 'cat $WORK/reports/purge.txt'
	else
		echo 'No pages to purge.'
	fi
	step 'title_of $PORTAL'
	step 'title_of $STATIC'
}

demo_run() {
	need docker curl node python3

	stage 1 'Prepare: start Liferay and the static site, clear the last build'
	demo_prepare

	stage 2 'First generation, from the APIs of our own Liferay'
	step 'regenerate --full'
	links

	stage 3 'Generate again. Nothing changed'
	step 'regenerate'
	heading 'One post, two deliveries: bytes, script tags, authToken'
	step 'stats $PORTAL'
	step 'stats $STATIC'

	stage 4 'Change the post in Liferay'
	step 'change_title "Six checks to run before switching on Microsoft 365 Copilot"'
	heading 'Now make your own changes in Liferay'
	echo "Picked up: edits to published blog posts, web content, documents and pages."
	echo "Use [f] at the end of stage 5 for anything else: fragment templates, the theme, menus, or something you deleted."
	echo "Sign in: http://localhost:8086/c/portal/login"
	links
	pause '[Enter when you have finished] '

	stage 5 'Generate again'
	generate_and_show

	while [ -z "${AUTO:-}" ]; do
		links
		printf '\033[2m%s\033[0m' '[Enter] generate again   [f] rebuild everything   [q] finish: '
		local choice=q
		read -r choice || choice=q
		case "$choice" in
			q*) break ;;
			f*) generate_and_show --full ;;
			*) generate_and_show ;;
		esac
	done

	heading 'Check every internal link'
	step 'node tools/check-links.mjs dist-fidelity'

	links
	echo "When you've finished showing it: $0 cleanup"
	echo "That puts back this post's title only. Undo your own changes in Liferay yourself."
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
