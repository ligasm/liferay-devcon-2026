#!/usr/bin/env bash
# Start everything the tests and demos use, and print where to connect.
#
#   ./lab.sh up                start the lab and the demo sites, then show the links
#   ./lab.sh status            show the links and whether each one answers
#   ./lab.sh down              stop everything, including the Lighthouse front
#   ./lab.sh lighthouse        add the TLS + HTTP/2 front: restarts Liferay to add the https valve
#   ./lab.sh lighthouse-off    remove the front and the valve: restarts Liferay at S3
#
# The demo scripts need some of this stopped first. Their prepare steps do that: demo 1
# recreates the stock Liferay, demo 2 removes Varnish, demo 3 rebuilds the site on :8091.
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

P1="$REPO/part1-simulations"
P2="$REPO/part2-static-prototype"
VARNISH="$P1/matrix/varnish"
FRONT="$P1/lighthouse/front"
POST=/web/proventeq/blog/-/blogs/copilot-readiness-five-checks

warn() { printf '\033[33m%s\033[0m\n' "$*" >&2; }
exists() { docker inspect "$1" >/dev/null 2>&1; }
valve_on() { docker exec liferay26112 sh -c 'cat /opt/liferay/tomcat*/conf/server.xml' 2>/dev/null | grep -q 'className="org.apache.catalina.valves.RemoteIpValve"'; }

start_lab_liferay() {
	exists liferay26112 || die 'The lab container liferay26112 is missing. See part1-simulations/results/LAB-RESULTS.md'
	docker start liferay26112 >/dev/null
	wait_for http://localhost:8086/web/proventeq/home
}

# Compose recreates the container only if Liferay's IP has changed.
start_varnish() {
	LIFERAY_UPSTREAM=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' liferay26112)
	export LIFERAY_UPSTREAM
	docker compose --project-directory "$VARNISH" -f "$VARNISH/docker-compose.yml" -f "$VARNISH/docker-compose.local.yml" up -d --quiet-pull
	wait_for http://localhost:6081/web/proventeq/home
}

# A stopped nginx holds nothing, and it can point at a Docker network that no longer exists,
# so replace it rather than restart it.
start_static() {
	local container=$1 dist=$2 compose=$3 url=$4
	[ -d "$P2/$dist" ] || die "$P2/$dist is missing, so $url can't start. Its build steps are in part1-simulations/results/."
	if [ -z "$(docker ps -q -f "name=^$container$")" ]; then
		docker rm -f "$container" >/dev/null 2>&1 || true
	fi
	docker compose -f "$compose" up -d --quiet-pull
	wait_for "$url" "$container"
}

start_stock_liferay() {
	if exists demo-stock-liferay; then
		docker start demo-stock-liferay >/dev/null
	else
		docker run -d --name demo-stock-liferay -p 8096:8080 liferay/dxp:2026.q1.12-lts >/dev/null
	fi
	wait_for http://localhost:8096/
}

# Prints one line per link. A line that isn't 200 is the one to look at.
check() {
	local code
	code=$(curl -sk -o /dev/null -w '%{http_code}' --max-time 20 "$2" 2>/dev/null) || true
	if [ "$code" = 200 ]; then
		printf '  \033[32m%-4s\033[0m %-34s %s\n' "$code" "$1" "$2"
	else
		printf '  \033[31m%-4s\033[0m %-34s %s\n' "${code:-000}" "$1" "$2"
	fi
}

status() {
	printf '\n\033[1;36mLoad tests and Lighthouse: the local Proventeq site\033[0m\n'
	check 'Liferay, directly' http://localhost:8086/web/proventeq/home
	check 'Liferay behind Varnish' http://localhost:6081/web/proventeq/home
	check 'Static site, fidelity build' http://localhost:8091/web/proventeq/home
	check 'Static site, Astro build (S6)' http://localhost:8090/
	if [ -n "$(docker ps -q -f name=^lighthouse-front$)" ]; then
		check 'Varnish over TLS + HTTP/2' https://localhost:9443/web/proventeq/home
		check 'Fidelity over TLS + HTTP/2' https://localhost:9444/web/proventeq/home
	fi

	printf '\n\033[1;36mDemos\033[0m\n'
	check 'Demo 1: stock Liferay' http://localhost:8096/
	check 'Demo 3: Liferay version' "http://localhost:8086$POST"
	check 'Demo 3: static version' "http://localhost:8091$POST"

	local stage
	stage=$(docker exec liferay26112 sh -c 'head -1 /opt/liferay/portal-ext.properties' 2>/dev/null | grep -oE 'apply-stage.sh S[0-9]' | cut -d' ' -f2) || true
	printf '\nLab Liferay config: %s, https valve: %s\n' "${stage:-unknown}" "$(valve_on && echo on || echo off)"
	echo 'Sign-in details for the lab Liferay: part0-base-site/dist/k6.env'
}

up() {
	need docker curl
	local f failed=0
	for f in start_lab_liferay start_varnish \
		"start_static proventeq-fidelity dist-fidelity $P2/fidelity/docker-compose.yml http://localhost:8091/web/proventeq/home" \
		"start_static proventeq-static dist-proventeq $P1/matrix/S6-static/local/docker-compose.yml http://localhost:8090/" \
		start_stock_liferay; do
		# A resource that won't start shouldn't hold back the others.
		( $f ) || { warn "Failed: $f"; failed=1; }
	done
	status
	return "$failed"
}

down() {
	[ -z "$(docker ps -aq -f name=^lighthouse-front$)" ] || docker rm -f lighthouse-front >/dev/null
	local c
	for c in liferay-varnish proventeq-fidelity proventeq-static demo-stock-liferay liferay26112; do
		if [ -n "$(docker ps -q -f name=^$c$)" ]; then docker stop "$c" >/dev/null && echo "Stopped $c"; fi
	done
	if valve_on 2>/dev/null; then warn 'The https valve is still in Liferay. Start it and run: ./lab.sh lighthouse-off'; fi
	return 0
}

lighthouse() {
	need docker openssl python3
	start_lab_liferay
	if [ ! -e "$FRONT/certs/lab.crt" ]; then
		mkdir -p "$FRONT/certs"
		openssl req -x509 -newkey rsa:2048 -nodes -days 30 -subj '/CN=localhost' \
			-addext 'subjectAltName=DNS:localhost,IP:127.0.0.1' \
			-keyout "$FRONT/certs/lab.key" -out "$FRONT/certs/lab.crt" 2>/dev/null
		chmod 644 "$FRONT/certs/lab.key"
	fi
	if ! valve_on; then
		"$P1/lighthouse/valve.sh"
		start_lab_liferay
	fi
	start_varnish
	docker compose -f "$FRONT/docker-compose.yml" up -d --quiet-pull
	status
	echo 'The certificate is self-signed, so the browser will warn. Liferay is cold: warm it before measuring.'
}

lighthouse_off() {
	[ -z "$(docker ps -aq -f name=^lighthouse-front$)" ] || docker rm -f lighthouse-front >/dev/null
	start_lab_liferay
	if valve_on; then
		"$P1/matrix/local/apply-stage.sh" S3
		start_lab_liferay
	fi
	start_varnish
	status
}

case "${1:-up}" in
	up) up ;;
	status) status ;;
	down) down ;;
	lighthouse) lighthouse ;;
	lighthouse-off) lighthouse_off ;;
	*) sed -n '/^#!/d; /^#/!q; s/^# \{0,1\}//p' "$0" >&2; exit 2 ;;
esac
