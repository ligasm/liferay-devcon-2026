# Shared helpers for demo1-curl.sh, demo2-varnish.sh and demo3-regenerate.sh.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
FAILED=0

heading() { printf '\n\033[1;36m# %s\033[0m\n' "$*"; }
die() { printf '\033[1;31m%s\033[0m\n' "$*" >&2; exit 1; }
need() { local c; for c in "$@"; do command -v "$c" >/dev/null || die "Missing command: $c"; done; }
pause() { [ -n "${AUTO:-}" ] || { printf '\033[2m%s\033[0m' "$1"; read -r _ || true; }; }

# Show a command, wait for Enter, run it. A failure is reported but doesn't stop the demo.
run() {
	printf '\033[1;32m$\033[0m %s\n' "$1"
	pause '[Enter to run] '
	local rc=0
	eval "$1" || rc=$?
	if [ "$rc" -ne 0 ]; then
		FAILED=$((FAILED + 1))
		printf '\033[1;31mThat command failed (exit %s). Fallback video: deck/recordings/%s.mp4\033[0m\n' "$rc" "$VIDEO"
	fi
}

# Wait for a URL to answer, for up to 10 minutes. With a container name, give up if it stops.
wait_for() {
	local i
	echo "Waiting for $1"
	for i in $(seq 1 120); do
		curl -sf -o /dev/null --max-time 20 "$1" && { echo "Up: $1"; return 0; }
		if [ -n "${2:-}" ] && [ -z "$(docker ps -q -f "name=^$2$")" ]; then
			die "Container $2 isn't running: $(docker inspect -f '{{.State.Error}}' "$2" 2>/dev/null)"
		fi
		sleep 5
	done
	die "No answer from $1 after 10 minutes"
}

finish() {
	if [ "$FAILED" -gt 0 ]; then
		printf '\n\033[1;31m%s command(s) failed.\033[0m\n' "$FAILED"
		return 1
	fi
	printf '\n\033[1;32mDemo finished.\033[0m\n'
}

# Each demo script defines demo_prepare, demo_run and demo_cleanup, then calls this.
main() {
	case "${1:-run}" in
		prepare) demo_prepare ;;
		run) demo_run ;;
		cleanup) demo_cleanup ;;
		*) sed -n '/^#!/d; /^#/!q; s/^# \{0,1\}//p' "$0" >&2; exit 2 ;;
	esac
}
