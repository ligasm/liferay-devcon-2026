# Demo 2: Varnish in front of the same Liferay

Slide 12, 90 seconds. Fallback video: `deck/recordings/demo2-varnish.mp4`.

To run these commands from a script, one Enter at a time: `docs/demos/demo2-varnish.sh prepare`, then
`docs/demos/demo2-varnish.sh`, then `docs/demos/demo2-varnish.sh cleanup`. Each rehearsal needs a new `prepare`, because
the demo needs a cold cache and Varnish stopped.

The demo runs from a copy of `part1-simulations`, so the committed results aren't overwritten. Run everything in
one terminal, because the steps share the variables set in the preparation.

## Before the talk

### 1. Start Liferay and prepare the copy

This uses the lab container `liferay26112`, which has S3 and G1 applied. It removes any old Varnish container, so
the cache starts cold and points at Liferay's current IP.

```bash
cd /data/git/mir333/liferay-devcon-2026
docker rm -f liferay-varnish 2>/dev/null
docker start liferay26112
until curl -sf -o /dev/null --max-time 20 http://127.0.0.1:8086/web/proventeq/home; do sleep 5; done; echo "Liferay is up"
rm -rf /tmp/devcon-demo2
rsync -a --exclude results part1-simulations/ /tmp/devcon-demo2/
mkdir -p /tmp/devcon-demo2/results
cp -r part1-simulations/results/S0-baseline-load part1-simulations/results/S3-frontend-load /tmp/devcon-demo2/results/
source part0-base-site/dist/k6.env
export LIFERAY_UPSTREAM=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' liferay26112)
```

### 2. Warm Liferay for one minute

This goes straight to Liferay, not through Varnish.

```bash
cd /tmp/devcon-demo2
RATE=20 VUS=10 DURATION=60s ./run.sh _warmup mix
rm -rf results/_warmup
```

## On stage

### 1. Start Varnish

```bash
cd /data/git/mir333/liferay-devcon-2026/part1-simulations/matrix/varnish
docker compose -f docker-compose.yml -f docker-compose.local.yml up -d
cd /tmp/devcon-demo2
sleep 2
```

### 2. Fill the cache, then hit it

```bash
curl -sSD- -o /dev/null localhost:6081/web/proventeq/home | grep -iE '^(x-cache|age):'
```

```bash
curl -sSD- -o /dev/null localhost:6081/web/proventeq/home | grep -iE '^(x-cache|age):'
```

Expect `X-Cache: MISS`, then `X-Cache: HIT`.

### 3. Run the mix through the edge for 30 seconds

```bash
export BASE_URL=http://localhost:6081
RATE=80 VUS=20 DURATION=30s QUIET=0 ./run.sh S4-edge-varnish-load mix
```

### 4. Show the Varnish counters

```bash
docker exec liferay-varnish varnishstat -1 -f MAIN.cache_hit -f MAIN.cache_miss -f MAIN.s_pass | cut -c1-40
```

### 5. Show the p95 table

The S0 and S3 columns are the committed 90-second campaign. The S4 column is the run you just did.

```bash
python3 summarize.py --no-charts >/dev/null; sed -n '/^## p95/,/^## throughput/p' results/SUMMARY.md | grep '^|'
```

### 6. Show that sign-in stays at 0% edge hit

The columns are scenario, p95 in ms and edge hit.

```bash
grep '^| S4.*mix/login' results/SUMMARY.md | cut -d'|' -f3,6,10
```

## What to expect

A 30-second run won't match the slide exactly. The slide's numbers come from the full campaign.

| Measure | Slide (full campaign) | Recording (30 s) |
|---|---|---|
| Whole mix, p95 | 6 ms | 8 ms |
| Guest browse, p95 | 2 ms | 3 ms |
| Sign-in, edge hit | 0% | 0% |
| Sign-in, p95 | not on the slide | 547 ms |
| Load | about 120 req/s | 96 req/s |
| Varnish hits / misses / passes | 18,656 / 16 / 4,902 | 3,649 / 15 / 365 |

## Afterwards

```bash
docker stop liferay-varnish liferay26112
```
