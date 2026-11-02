#!/usr/bin/env bash
# Demo 1 (slide 5). Needs a fresh, unmodified container:
#   docker run -d --name demo-stock-liferay -p 8096:8080 liferay/dxp:2026.q1.12-lts
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
clear
say 'Stock Liferay DXP 2026.q1.12: no portal-ext.properties, nothing changed'
run 'curl -sSD- -o /dev/null http://localhost:8096/'
sleep 9
say 'What a CDN looks at'
run "curl -sSD- -o /dev/null http://localhost:8096/ | grep -iE --color=always '^(cache-control|pragma|expires):|^set-cookie: [A-Z_]+'"
hold 10
