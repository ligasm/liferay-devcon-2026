# S4 — Edge guest-HTML cache (self-hosted: Varnish; hosted: Cloudflare)

Files:

* `../varnish/default.vcl` — the policy (BAN-based tag purge, stock Varnish).
* `../varnish/default-xkey.vcl` — same policy with vmod_xkey soft purge.
* `../varnish/docker-compose.yml` — runs Varnish on :6081 in front of your Liferay.
* `../cloudflare/cache-rules.md` — the same policy as Cloudflare Cache Rules + purge API.
* `portal-ext.properties`, `server.xml.snippet` — Liferay behind a proxy.

## Demo flow

```bash
# origin, as before
BASE_URL=http://localhost:8080 ./run.sh S3-frontend mix

# start the edge (Liferay stays on :8080)
cd matrix/varnish && LIFERAY_UPSTREAM=host-gateway docker compose up -d && cd -
curl -sI http://localhost:6081/web/guest/home | grep -iE "x-cache|age|set-cookie|cache-control"
curl -sI http://localhost:6081/web/guest/home | grep -iE "x-cache|age"          # second call → HIT

# same workload through the edge
BASE_URL=http://localhost:6081 ./run.sh S4-edge-varnish mix
python3 summarize.py
```

## What must flip (and what must not)

| Row | S3 | S4 |
|---|---|---|
| guest-browse `edge hit` | 0 % | → ~100 % (after the first request per URL/language) |
| guest-browse `set-cookie on guest` | 100 % | → 0 % |
| guest-browse `cache-control private` | 0 % (S3) / 100 % (S0) | → 0 % |
| guest-browse-sticky `edge hit` | 0 % | → ~100 % — if it stays low your rule keys on JSESSIONID |
| login `edge hit` | 0 % | **must stay 0 %** (signed-in page check in `login.js`) |
| headless-api | private | unchanged (passed) |
| asset-publisher `ap_page` vs `content_page` p95 | 2–3× | → identical |
| search | origin | HIT per distinct term after the first request (search-bar `formDate` stripped) |

The p95 numbers you get at S4 are a property of the edge, not of Liferay — say so
on stage. The Liferay-side win is on the *origin request rate*: watch Tomcat's
request count (JMX `Catalina:type=GlobalRequestProcessor`) or `varnishstat`
`MAIN.backend_req` vs `MAIN.client_req` during the run.
