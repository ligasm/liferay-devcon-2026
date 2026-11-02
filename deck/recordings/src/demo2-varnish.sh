#!/usr/bin/env bash
# Demo 2 (slide 12). Liferay is up on :8086 with S3 applied and warmed; Varnish is stopped.
# Run from a copy of part1-simulations, so results/ in the repo is not overwritten.
# Env: REPO (repo root), BASE_URL etc. from part0-base-site/dist/k6.env.
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
clear
SAY_PAUSE=1
say 'Same Liferay, S3 config, now with Varnish in front'
typed 'docker compose up -d'
( cd "$REPO/part1-simulations/matrix/varnish" && docker compose -f docker-compose.yml -f docker-compose.local.yml up -d )
sleep 2
say 'First guest request fills the cache, the second is served by Varnish'
H="grep -iE '^(x-cache|age):'"
run "curl -sSD- -o /dev/null localhost:6081/web/proventeq/home | $H"
sleep 1
run "curl -sSD- -o /dev/null localhost:6081/web/proventeq/home | $H"
sleep 3
say 'The mix through the edge: guests, search, Asset Publisher, sign-ins'
export BASE_URL=http://localhost:6081
run 'RATE=80 VUS=20 DURATION=30s QUIET=0 ./run.sh S4-edge-varnish-load mix'
sleep 2
say 'Varnish counters for this run'
run 'docker exec liferay-varnish varnishstat -1 -f MAIN.cache_hit -f MAIN.cache_miss -f MAIN.s_pass | cut -c1-40'
sleep 3
say 'p95 ms. S0 and S3 are the measured 90 s campaign, S4 is this 30 s run'
run "python3 summarize.py --no-charts >/dev/null; sed -n '/^## p95/,/^## throughput/p' results/SUMMARY.md | grep '^|'"
sleep 4
say 'Sign-in stays at 0 % edge hit: scenario, p95 ms, edge hit'
run "grep '^| S4.*mix/login' results/SUMMARY.md | cut -d'|' -f3,6,10"
hold 7
