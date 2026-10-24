#!/usr/bin/env sh
# Example PURGE_CMD: purge by Cache-Tag (Enterprise) or by URL list (any plan).
# regenerate.mjs exports PURGE_URLS (space separated), PURGE_TAGS, PURGE_ALL.
set -eu
: "${CF_ZONE:?}" "${CF_TOKEN:?}"
api="https://api.cloudflare.com/client/v4/zones/$CF_ZONE/purge_cache"
if [ "${PURGE_ALL:-false}" = "true" ]; then
  curl -sS -X POST "$api" -H "Authorization: Bearer $CF_TOKEN" -H 'Content-Type: application/json' --data '{"purge_everything":true}'
else
  files=$(printf '%s\n' $PURGE_URLS | sed 's/.*/"&"/' | paste -sd, -)
  curl -sS -X POST "$api" -H "Authorization: Bearer $CF_TOKEN" -H 'Content-Type: application/json' --data "{\"files\":[$files]}"
fi
