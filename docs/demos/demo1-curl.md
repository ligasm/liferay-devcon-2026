# Demo 1: a stock guest page is uncacheable

Slide 8, 30 seconds. Fallback video: `deck/recordings/demo1-curl.mp4`.

To run these commands from a script, one Enter at a time: `docs/demos/demo1-curl.sh prepare`, then
`docs/demos/demo1-curl.sh`, then `docs/demos/demo1-curl.sh cleanup`.

## Before the talk

Start a fresh container with no config. The loop returns when Liferay answers, which takes a few minutes.

```bash
docker rm -f demo-stock-liferay 2>/dev/null
docker run -d --name demo-stock-liferay -p 8096:8080 liferay/dxp:2026.q1.12-lts
until curl -sf -o /dev/null --max-time 20 http://localhost:8096/; do sleep 5; done; echo "Liferay is up"
```

## On stage

To use your own Liferay instead, replace `http://localhost:8096` in both commands.

### 1. Show the full response headers

```bash
curl -sSD- -o /dev/null http://localhost:8096/
```

### 2. Show only what a CDN looks at

```bash
curl -sSD- -o /dev/null http://localhost:8096/ | grep -iE --color=always '^(cache-control|pragma|expires):|^set-cookie: [A-Z_]+'
```

Expect these headers:

- `Cache-Control: private, no-cache, no-store, must-revalidate`
- `Pragma: no-cache`
- `Expires`
- Three `Set-Cookie` lines: `JSESSIONID`, `COOKIE_SUPPORT`, `GUEST_LANGUAGE_ID`

## Afterwards

```bash
docker rm -f demo-stock-liferay
```
