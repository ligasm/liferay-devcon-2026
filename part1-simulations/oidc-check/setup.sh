#!/usr/bin/env bash
#
# setup.sh — start Keycloak and the model edge and point the lab Liferay at Keycloak. Secrets come from
# .env (see .env.example). Liferay has to be stopped first, so it takes 10.200.0.3, which liferay-varnish
# has hard-coded. Changes the lab; README.md says how to undo it.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$HERE/.env" C=liferay26112 L=/opt/liferay ORIGIN=http://127.0.0.1:8086
[[ -f "$ENV_FILE" ]] || { echo "!! $ENV_FILE missing: copy .env.example and set the values" >&2; exit 1; }
set -a; . "$ENV_FILE"; set +a
[[ "$(docker inspect -f '{{.State.Running}}' "$C")" == false ]] || { echo "!! stop $C first" >&2; exit 1; }
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
ip() { docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "$1"; }

# Without these, a new SSO user stops at the terms-of-use and reminder-question pages.
docker cp -a "$C:$L/portal-ext.properties" "$T/portal-ext.properties" 2>/dev/null
grep -q '^terms.of.use.required=false' "$T/portal-ext.properties" ||
	printf '\n## temporary: oidc-check\nterms.of.use.required=false\nusers.reminder.queries.enabled=false\n' >> "$T/portal-ext.properties"
docker cp -a "$T/portal-ext.properties" "$C:$L/portal-ext.properties" 2>/dev/null

docker start "$C" >/dev/null
docker start liferay-varnish >/dev/null
docker run -d --name oidc-keycloak --env-file "$ENV_FILE" \
	-v "$HERE/realm.json:/opt/keycloak/data/import/realm.json:ro" \
	quay.io/keycloak/keycloak:26.0 start-dev --import-realm --hostname-strict=false >/dev/null
docker run -d --name oidc-model-edge --add-host "liferay:$(ip "$C")" -p 127.0.0.1:6082:80 \
	-v "$HERE/model-cookie-forwarding.vcl:/etc/varnish/default.vcl:ro" varnish:7.6 >/dev/null
KC="$(ip oidc-keycloak)"
echo "liferay=$(ip "$C") varnish=$(ip liferay-varnish) keycloak=$KC"

until curl -sf -o /dev/null --max-time 5 "$ORIGIN/c/portal/robots" && curl -sf -o /dev/null --max-time 20 "$ORIGIN/web/proventeq/home"; do sleep 5; done
until curl -sf -o /dev/null --max-time 5 "http://$KC:8080/realms/lab/.well-known/openid-configuration"; do sleep 3; done

P=com.liferay.portal.security.sso.openid.connect
docker cp "$HERE/$P.configuration.OpenIdConnectConfiguration.config" "$C:$L/osgi/configs/" 2>/dev/null
PROVIDER="$P.internal.configuration.OpenIdConnectProviderConfiguration-keycloak.config"
OIDC_CLIENT_SECRET="$OIDC_CLIENT_SECRET" KEYCLOAK_IP="$KC" python3 -I -c '
import os, sys
s = open(sys.argv[1]).read()
for k in ("OIDC_CLIENT_SECRET", "KEYCLOAK_IP"):
    s = s.replace("@" + k + "@", os.environ[k])
open(sys.argv[2], "w").write(s)' "$HERE/$PROVIDER.template" "$T/$PROVIDER"
docker cp "$T/$PROVIDER" "$C:$L/osgi/configs/" 2>/dev/null

for _ in $(seq 1 24); do
	curl -s -L -o "$T/login.html" "$ORIGIN/c/portal/login"
	grep -q openid_connect_request "$T/login.html" && { echo "ready: OIDC is on the login page"; exit 0; }
	sleep 5
done
echo "!! OIDC link did not appear on the login page" >&2; exit 1
