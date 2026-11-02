# Helpers for the demo recordings: comments and typed commands are for the viewer; every command really runs.
say() { printf '\n\033[1;36m# %s\033[0m\n' "$*"; sleep "${SAY_PAUSE:-1.5}"; }
typed() { printf '\033[1;32m$\033[0m '; local s="$1" i; for ((i = 0; i < ${#s}; i++)); do printf '%s' "${s:i:1}"; sleep 0.025; done; sleep 0.5; printf '\n'; }
run() { typed "$1"; eval "$1"; }
hold() { sleep "$1"; printf "\n\033[1;32m\$\033[0m "; }
