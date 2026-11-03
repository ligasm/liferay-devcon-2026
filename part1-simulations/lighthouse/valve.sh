#!/usr/bin/env bash
#
# valve.sh — add Tomcat's RemoteIpValve (matrix/S4-edge-varnish/server.xml.snippet) to the lab's
# Liferay and restart it, so that it writes https:// links behind the front. It changes URLs, not
# performance settings. To remove it, run matrix/local/apply-stage.sh again.
set -euo pipefail
C="${CONTAINER:-liferay26112}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
XML=$(docker exec "$C" sh -c 'ls /opt/liferay/tomcat*/conf/server.xml | head -1')
docker cp "$C:$XML" "$TMP/server.xml"
python3 - "$TMP/server.xml" <<'EOF'
import re, sys
path = sys.argv[1]
xml = open(path).read()
valve = r'''
      <Valve className="org.apache.catalina.valves.RemoteIpValve"
             remoteIpHeader="X-Forwarded-For"
             protocolHeader="X-Forwarded-Proto"
             protocolHeaderHttpsValue="https"
             portHeader="X-Forwarded-Port"
             internalProxies="127\.0\.0\.1|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}" />'''
# server.xml has commented-out examples, including another <Engine>, so skip the comments
comments = [m.span() for m in re.finditer(r'<!--.*?-->', xml, re.S)]
live = lambda m: not any(a < m.start() < b for a, b in comments)
if any(live(m) for m in re.finditer(r'RemoteIpValve', xml)):
    sys.exit(0)
engines = [m for m in re.finditer(r'<Engine\b[^>]*>', xml) if live(m)]
if len(engines) != 1:
    sys.exit(f"expected one live <Engine> in server.xml, found {len(engines)}")
end = engines[0].end()
open(path, "w").write(xml[:end] + valve + xml[end:])
EOF
docker cp "$TMP/server.xml" "$C:$XML"
docker restart "$C" >/dev/null
echo "valve added to $XML; $C restarted"
