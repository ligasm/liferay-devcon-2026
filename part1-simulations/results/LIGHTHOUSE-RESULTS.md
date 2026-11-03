# Lighthouse: what a browser sees, tuned Liferay vs static (2026-11-03)

The rest of the results come from k6, which doesn't run JavaScript or paint a page. This run asks
what the difference looks like in a browser. It compares the same pair as
[STATIC-VS-EDGE.md](STATIC-VS-EDGE.md):

* **edge**: Liferay DXP 2026.q1.12 (S3 tuning) behind Varnish, the S4 configuration, warmed first.
  Over the whole session Varnish counted 4,700 hits, 142 misses and 0 passes.
* **static**: the fidelity build of the same site on nginx.

## Headline numbers

Mobile preset with real throttling (`--throttling-method=devtools`: 1.6 Mbps, 150 ms RTT, 4× CPU).
Median of 5 runs.

| | home: edge | home: static | blog: edge | blog: static |
|---|---:|---:|---:|---:|
| Performance score | 82 | 90 | 82 | 92 |
| FCP | 2.4 s | 2.0 s | 2.4 s | 2.0 s |
| **LCP** | **4.1 s** | **3.3 s** | **4.2 s** | **3.0 s** |
| Total Blocking Time | 0 ms | 0 ms | 19 ms | 0 ms |
| CLS | 0.027 | 0.027 | 0.001 | 0.001 |
| Main-thread work | 0.4 s | 0.2 s | 0.5 s | 0.2 s |
| Requests | 57 | 8 | 80 | 9 |
| Bytes on the wire | 583 KB | 182 KB | 740 KB | 145 KB |
| of which scripts | 286 KB | 0 | 370 KB | 0 |

Requests and bytes include Google Fonts (3 requests, 73 KB of font files), which both sites load.
[STATIC-VS-EDGE.md](STATIC-VS-EDGE.md) leaves them out.

## Findings

### 1. Static is about a second faster on a slow connection, not ten times

The server-side gaps are 5 to 12 times. In the browser the static LCP is 0.8 s (home) and 1.2 s
(blog) earlier, on a page with 7 to 9 times fewer requests and 3 to 5 times fewer bytes. On a
fast connection the gap nearly closes: the desktop preset gives 0.8 s against 0.5 s.

### 2. The method changes the size of the gap

Lighthouse's default mode models the throttling instead of applying it. This is the mode
PageSpeed Insights uses, so it's what someone in the audience will get. It shows a much larger gap:

| Mobile, median of 5 | home LCP | services LCP | blog LCP | home score | services score | blog score |
|---|---:|---:|---:|---:|---:|---:|
| modelled: edge | 3.8 s | 3.3 s | 4.4 s | 88 | 91 | 84 |
| modelled: static | 1.8 s | 1.8 s | 1.7 s | 99 | 99 | 99 |

We quote the real-throttling figures, because they're measured and they're the smaller claim.

### 3. Liferay's JavaScript doesn't block the main thread here

Total Blocking Time is 0 to 19 ms at 4× CPU. Liferay's 286 to 370 KB of scripts cost bytes and
requests, not long tasks. This box is fast (Lighthouse benchmark index about 4,000), so 4× may
understate a real phone. At 8× (3 runs), TBT reached 9 ms on home and 133 ms on blog, against
0 ms on static. That is well under the 200 ms Lighthouse counts as good. The test pages have
little interactive content, so a page with heavier widgets could behave differently.

### 4. Google Fonts cost both sites more than the choice of stack does on the home page

Blocking the font requests, on the home page with real throttling (3 runs):

| Mobile, home | edge | edge, fonts blocked | static | static, fonts blocked |
|---|---:|---:|---:|---:|
| LCP | 4.1 s | **3.4 s** | 3.3 s | **2.3 s** |
| FCP | 2.4 s | 2.3 s | 2.0 s | 1.4 s |
| Score | 82 | 88 | 90 | 98 |

Only the static site with fonts blocked gets under Lighthouse's 2.5 s line for a good LCP. Blocking
is an upper bound on the gain: self-hosted fonts would still cost some bytes.

### 5. The worst desktop result is the same on both, and it's the web font

On the desktop preset the home page has a CLS of 0.657 on both sites (0.25 is already "poor"),
and both score 77. Lighthouse names the Red Hat Display web font as the cause, shifting the hero
section. With the fonts blocked, CLS is 0.000 and both score 100 (3 runs, modelled throttling).

Static delivery doesn't fix this, because the fidelity build reproduces the same CSS and fonts.

| Desktop, modelled, median of 5 | home score | services score | blog score | home LCP | services LCP | blog LCP |
|---|---:|---:|---:|---:|---:|---:|
| edge | 77 | 85 | 85 | 0.8 s | 0.8 s | 0.9 s |
| static | 77 | 86 | 86 | 0.5 s | 0.5 s | 0.5 s |

## Setup

* **The same front for both.** nginx with TLS 1.3 and HTTP/2 forwards to Varnish and to the static
  nginx, adding no compression or caching (`lighthouse/front/`). Without it a browser reaches both
  over HTTP/1.1, which penalises a 56-request page more than a real CDN would. Every same-origin
  request in the full runs was served over HTTP/2.
* **Liferay needs to write https links.** It writes absolute links to some of its CSS, and a
  browser blocks those on an https page if they say http. `lighthouse/valve.sh` adds Tomcat's
  RemoteIpValve, as in the S4 recipe, for this test only. Check for this if you repeat the run: in
  an early trial four of Liferay's stylesheets were silently blocked, so that run was discarded.
* **Tools.** Lighthouse 13.6.0, Chrome 156 headless, a fresh browser with an empty cache per run.
  The targets took turns, on an otherwise idle box.
* **Runs.** `runs.csv` in each folder under `lighthouse/2026-11-03/` has every run:

| Folder | Throttling | Preset | Pages | Runs |
|---|---|---|---|---:|
| `simulated` | modelled | mobile, desktop | home, services, blog | 5 |
| `devtools` | real | mobile | home, blog | 5 |
| `devtools-cpu8` | real, 8× CPU | mobile | home, blog | 3 |
| `devtools-no-google-fonts` | real | mobile | home | 3 |
| `simulated-no-google-fonts` | modelled | desktop | home | 3 |

The full JSON reports are 65 MB and aren't committed. Running this again regenerates them.

## Reproduce

```sh
# Lab running as in STATIC-VS-EDGE.md, with S3, a warm Liferay and Varnish against its current IP
cd part1-simulations
mkdir -p lighthouse/front/certs
openssl req -x509 -newkey rsa:2048 -nodes -days 30 -subj '/CN=localhost' \
  -addext 'subjectAltName=DNS:localhost,IP:127.0.0.1' \
  -keyout lighthouse/front/certs/lab.key -out lighthouse/front/certs/lab.crt
chmod 644 lighthouse/front/certs/lab.key
lighthouse/valve.sh                   # restarts Liferay: warm it again and recreate Varnish
docker compose -f lighthouse/front/docker-compose.yml up -d
LH_FLAGS="--throttling-method=devtools" lighthouse/run.sh out/devtools \
  "edge=9443 static=9444" "/web/proventeq/home /web/proventeq/blog" mobile 5
python3 lighthouse/report.py out/devtools
matrix/local/apply-stage.sh S3        # removes the valve again
```

## Caveats

* **Lab numbers, not field data.** Lighthouse can't measure INP, and these aren't Core Web Vitals
  as Google reports them. TBT stands in for INP.
* **The static page is lighter by design.** It doesn't have Liferay's sign-in, forms or portlets.
  Part of the gap is features removed, not only faster delivery.
* **First visit, empty cache.** Returning visitors have Liferay's hashed assets cached, which
  narrows the gap.
* **One box and a loopback origin.** The throttling adds latency, but no real CDN is involved.
  Google Fonts is reached over the real internet in every run.
* **A small site.** Seven pages from the Proventeq base site, three of them measured here. Your
  own theme and widgets will give different numbers.
* **A few runs.** The ranges are narrow in the real-throttling runs, at most 0.4 s of LCP within
  any one case. The side checks are 3 runs each.
* **The static build has no favicon.** It returns a 404, which has no visible effect on these
  numbers.
