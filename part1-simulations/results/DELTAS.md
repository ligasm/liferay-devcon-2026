# Change vs S0 baseline

Percent change of each metric relative to the S0 row of the same scenario (negative is better for latency/error/cookie columns, positive is better for req/s and edge hit). Rows are skipped when the baseline has no matching scenario.

## S0-baseline-load vs S0-baseline

| scenario | req/s | p50 | p95 | p99 | TTFB p95 | errors | edge hit | set-cookie | cc private |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| mix (all) | +529% ✓ | +104% | +201% | +108% | +161% | +0 pp | +0 pp | -0 pp | +0 pp |
| mix/ap_page | +689% ✓ | +104% | +183% | +301% | +179% | +0 pp | +0 pp | +0 pp | +0 pp |
| mix/guest_browse | +503% ✓ | +99% | +204% | +281% | +198% | +0 pp | +0 pp | +0 pp | +0 pp |
| mix/login | +649% ✓ | +45% | +119% | +153% | +135% | +0 pp | +0 pp | +0 pp | +0 pp |
| mix/search | +681% ✓ | +112% | +209% | +269% | +209% | +0 pp | +0 pp | +0 pp | +0 pp |

## S1-hygiene vs S0-baseline

| scenario | req/s | p50 | p95 | p99 | TTFB p95 | errors | edge hit | set-cookie | cc private |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| asset-publisher (all) | +0% | +4% | +6% | +1% | +6% | +0 pp | +0 pp | +0 pp | +0 pp |
| asset-publisher/ap_page | +0% | +3% | +3% | +0% | +3% | +0 pp | +0 pp | +0 pp | +0 pp |
| asset-publisher/content_page | +0% | +1% | +1% | +1% | +3% | +0 pp | +0 pp | +0 pp | +0 pp |
| dl-download | +0% | +18% | +17% | +15% | +25% | +0 pp | +0 pp | +0 pp | +0 pp |
| guest-browse | +0% | +1% | +1% | +2% | +0% | +0 pp | +0 pp | +0 pp | +0 pp |
| guest-browse-sticky | +1% | +1% | +1% | -1% | +2% | +0 pp | +0 pp | – | +0 pp |
| headless-api (all) | -4% | +9% | +5% | +11% | +5% | +0 pp | +0 pp | +0 pp | +0 pp |
| headless-api/headless_by_id | -4% | +2% | +4% | +18% | +4% | +0 pp | +0 pp | +0 pp | +0 pp |
| headless-api/headless_list | -4% | +2% | +8% | +11% | +8% | +0 pp | +0 pp | +0 pp | +0 pp |
| login | -1% | +12% | +2% | +7% | +3% | +0 pp | +0 pp | +0 pp | +0 pp |
| mix (all) | +2% | +3% | +18% | +0% | +1% | +0 pp | +0 pp | +0 pp | +0 pp |
| mix/ap_page | +2% | +4% | -4% | +7% | -6% ✓ | +0 pp | +0 pp | +0 pp | +0 pp |
| mix/guest_browse | +2% | +3% | -1% | -1% | +0% | +0 pp | +0 pp | +0 pp | +0 pp |
| mix/login | +2% | -4% | +1% | +3% | +2% | +0 pp | +0 pp | +0 pp | +0 pp |
| mix/search | +2% | -4% | -1% | -4% | -2% | +0 pp | +0 pp | +0 pp | +0 pp |
| search | +0% | -9% ✓ | -8% ✓ | -11% ✓ | -8% ✓ | +0 pp | +0 pp | +0 pp | +0 pp |

## S1-hygiene-load vs S0-baseline

| scenario | req/s | p50 | p95 | p99 | TTFB p95 | errors | edge hit | set-cookie | cc private |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| mix (all) | +537% ✓ | +70% | +145% | +80% | +114% | +0 pp | +0 pp | -0 pp | +0 pp |
| mix/ap_page | +699% ✓ | +77% | +103% | +202% | +99% | +0 pp | +0 pp | +0 pp | +0 pp |
| mix/guest_browse | +510% ✓ | +67% | +116% | +197% | +113% | +0 pp | +0 pp | +0 pp | +0 pp |
| mix/login | +661% ✓ | +21% | +96% | +128% | +105% | +0 pp | +0 pp | +0 pp | +0 pp |
| mix/search | +690% ✓ | +71% | +146% | +176% | +146% | +0 pp | +0 pp | +0 pp | +0 pp |

## S2-jvm-caches vs S0-baseline

| scenario | req/s | p50 | p95 | p99 | TTFB p95 | errors | edge hit | set-cookie | cc private |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| asset-publisher (all) | +0% | -25% ✓ | +2% | -1% | +2% | +0 pp | +0 pp | +0 pp | +0 pp |
| asset-publisher/ap_page | +0% | +1% | +0% | -1% | -1% | +0 pp | +0 pp | +0 pp | +0 pp |
| asset-publisher/content_page | +0% | -30% ✓ | -35% ✓ | -38% ✓ | -40% ✓ | +0 pp | +0 pp | +0 pp | +0 pp |
| dl-download | +0% | +18% | +19% | +14% | +25% | +0 pp | +0 pp | +0 pp | +0 pp |
| guest-browse | -1% | -20% ✓ | -10% ✓ | -10% ✓ | -12% ✓ | +0 pp | +0 pp | +0 pp | +0 pp |
| guest-browse-sticky | +1% | -21% ✓ | -6% ✓ | -8% ✓ | -6% ✓ | +0 pp | +0 pp | – | +0 pp |
| headless-api (all) | -4% | +8% | +1% | +3% | +1% | +0 pp | +0 pp | +0 pp | +0 pp |
| headless-api/headless_by_id | -4% | +1% | +2% | +15% | +2% | +0 pp | +0 pp | +0 pp | +0 pp |
| headless-api/headless_list | -4% | +0% | +1% | +5% | +1% | +0 pp | +0 pp | +0 pp | +0 pp |
| login | +0% | +16% | +1% | +0% | +0% | +0 pp | +0 pp | +0 pp | +0 pp |
| mix (all) | +3% | -22% ✓ | +20% | +0% | +6% | +0 pp | +0 pp | +0 pp | +0 pp |
| mix/ap_page | +1% | +3% | -15% ✓ | -13% ✓ | -13% ✓ | +0 pp | +0 pp | +0 pp | +0 pp |
| mix/guest_browse | +3% | -23% ✓ | -9% ✓ | -10% ✓ | -10% ✓ | +0 pp | +0 pp | +0 pp | +0 pp |
| mix/login | +3% | +2% | +1% | +2% | +1% | +0 pp | +0 pp | +0 pp | +0 pp |
| mix/search | +3% | +5% | -3% | -1% | -3% | +0 pp | +0 pp | +0 pp | +0 pp |
| search | +0% | -9% ✓ | -10% ✓ | -11% ✓ | -10% ✓ | +0 pp | +0 pp | +0 pp | +0 pp |

## S2-jvm-caches-load vs S0-baseline

| scenario | req/s | p50 | p95 | p99 | TTFB p95 | errors | edge hit | set-cookie | cc private |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| mix (all) | +531% ✓ | -6% ✓ | +119% | +65% | +93% | +0 pp | +0 pp | -0 pp | +0 pp |
| mix/ap_page | +684% ✓ | +37% | +28% | +39% | +24% | +0 pp | +0 pp | +0 pp | +0 pp |
| mix/guest_browse | +505% ✓ | -24% ✓ | +29% | +24% | +22% | +0 pp | +0 pp | +0 pp | +0 pp |
| mix/login | +646% ✓ | +18% | +76% | +92% | +81% | +0 pp | +0 pp | +0 pp | +0 pp |
| mix/search | +682% ✓ | +54% | +99% | +110% | +98% | +0 pp | +0 pp | +0 pp | +0 pp |

## S3-frontend vs S0-baseline

| scenario | req/s | p50 | p95 | p99 | TTFB p95 | errors | edge hit | set-cookie | cc private |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| asset-publisher (all) | +0% | -5% ✓ | +0% | -8% ✓ | +0% | +0 pp | +0 pp | +0 pp | -100 pp |
| asset-publisher/ap_page | +0% | +0% | -4% | -6% ✓ | -4% | +0 pp | +0 pp | +0 pp | -100 pp |
| asset-publisher/content_page | +0% | -30% ✓ | -35% ✓ | -37% ✓ | -40% ✓ | +0 pp | +0 pp | +0 pp | -100 pp |
| dl-download | +0% | +18% | +22% | +18% | +23% | +0 pp | +0 pp | +0 pp | +0 pp |
| guest-browse | -1% | -28% ✓ | -11% ✓ | -8% ✓ | -12% ✓ | +0 pp | +0 pp | +0 pp | -100 pp |
| guest-browse-sticky | +0% | -28% ✓ | -7% ✓ | -9% ✓ | -7% ✓ | +0 pp | +0 pp | – | -100 pp |
| headless-api (all) | -4% | +14% | +4% | +5% | +4% | +0 pp | +0 pp | +0 pp | +0 pp |
| headless-api/headless_by_id | -4% | +3% | +7% | +19% | +7% | +0 pp | +0 pp | +0 pp | +0 pp |
| headless-api/headless_list | -5% | +2% | +5% | +5% | +5% | +0 pp | +0 pp | +0 pp | +0 pp |
| login | +0% | -20% ✓ | -5% | -8% ✓ | -5% | +0 pp | +0 pp | +0 pp | -67 pp |
| mix (all) | -2% | -27% ✓ | -9% ✓ | +0% | -4% | +0 pp | +0 pp | -0 pp | -100 pp |
| mix/ap_page | -2% | +9% | +4% | +11% | +4% | +0 pp | +0 pp | +0 pp | -100 pp |
| mix/guest_browse | +1% | -29% ✓ | -16% ✓ | -12% ✓ | -17% ✓ | +0 pp | +0 pp | +0 pp | -100 pp |
| mix/login | -36% | +10% | +2% | +4% | +3% | +0 pp | +0 pp | +0 pp | -100 pp |
| mix/search | +1% | -13% ✓ | -1% | -4% | -1% | +0 pp | +0 pp | +0 pp | -100 pp |
| search | +1% | -6% ✓ | -5% ✓ | -8% ✓ | -5% ✓ | +0 pp | +0 pp | +0 pp | -100 pp |

## S3-frontend-gb80 vs S0-baseline

| scenario | req/s | p50 | p95 | p99 | TTFB p95 | errors | edge hit | set-cookie | cc private |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| guest-browse | +111% ✓ | -39% ✓ | -22% ✓ | -21% ✓ | -22% ✓ | +0 pp | +0 pp | +0 pp | -100 pp |

## S3-frontend-load vs S0-baseline

| scenario | req/s | p50 | p95 | p99 | TTFB p95 | errors | edge hit | set-cookie | cc private |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| mix (all) | +510% ✓ | -35% ✓ | +144% | +67% | +109% | +0 pp | +0 pp | -1 pp | -100 pp |
| mix/ap_page | +688% ✓ | +39% | +34% | +55% | +31% | +0 pp | +0 pp | +0 pp | -100 pp |
| mix/guest_browse | +503% ✓ | -36% ✓ | +28% | +22% | +21% | +0 pp | +0 pp | +0 pp | -100 pp |
| mix/login | +406% ✓ | +23% | +82% | +99% | +86% | +0 pp | +0 pp | +0 pp | -100 pp |
| mix/search | +684% ✓ | +59% | +103% | +114% | +103% | +0 pp | +0 pp | +0 pp | -100 pp |

## S4-edge-varnish vs S0-baseline

| scenario | req/s | p50 | p95 | p99 | TTFB p95 | errors | edge hit | set-cookie | cc private |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| asset-publisher (all) | +0% | -84% ✓ | -88% ✓ | -89% ✓ | -95% ✓ | +0 pp | +100 pp | -100 pp | -100 pp |
| asset-publisher/ap_page | +0% | -88% ✓ | -89% ✓ | -89% ✓ | -95% ✓ | +0 pp | +100 pp | -100 pp | -100 pp |
| asset-publisher/content_page | +0% | -77% ✓ | -78% ✓ | -78% ✓ | -89% ✓ | +0 pp | +100 pp | -100 pp | -100 pp |
| dl-download | +0% | -56% ✓ | -56% ✓ | -58% ✓ | -55% ✓ | +0 pp | +100 pp | -100 pp | +0 pp |
| guest-browse | +0% | -77% ✓ | -82% ✓ | -82% ✓ | -92% ✓ | +0 pp | +100 pp | -100 pp | -100 pp |
| guest-browse-sticky | +0% | -76% ✓ | -80% ✓ | -81% ✓ | -92% ✓ | +0 pp | +100 pp | – | -100 pp |
| headless-api (all) | +0% | -3% | -4% | -6% ✓ | -3% | +0 pp | +0 pp | +0 pp | +0 pp |
| headless-api/headless_by_id | +0% | +8% | -3% | -8% ✓ | -3% | +0 pp | +0 pp | +0 pp | +0 pp |
| headless-api/headless_list | +0% | +0% | -4% | -5% ✓ | -4% | +0 pp | +0 pp | +0 pp | +0 pp |
| login | +2% | -25% ✓ | -10% ✓ | -14% ✓ | -10% ✓ | +0 pp | +0 pp | +0 pp | -67 pp |
| mix (all) | -1% | -75% ✓ | -97% ✓ | -4% | -99% ✓ | +0 pp | +95 pp | -98 pp | -98 pp |
| mix/ap_page | -2% | -91% ✓ | -89% ✓ | -88% ✓ | -96% ✓ | +0 pp | +100 pp | -100 pp | -100 pp |
| mix/guest_browse | -1% | -75% ✓ | -79% ✓ | -80% ✓ | -91% ✓ | +0 pp | +100 pp | -100 pp | -100 pp |
| mix/login | -2% | +2% | -4% | -2% | -3% | +0 pp | +0 pp | +0 pp | -67 pp |
| mix/search | -2% | -99% ✓ | -99% ✓ | -99% ✓ | -100% ✓ | +0 pp | +100 pp | -100 pp | -100 pp |
| search | +1% | -99% ✓ | -99% ✓ | -99% ✓ | -100% ✓ | +0 pp | +100 pp | -100 pp | -100 pp |

## S4-edge-varnish-gb80 vs S0-baseline

| scenario | req/s | p50 | p95 | p99 | TTFB p95 | errors | edge hit | set-cookie | cc private |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| guest-browse | +112% ✓ | -79% ✓ | -82% ✓ | -82% ✓ | -93% ✓ | +0 pp | +100 pp | -100 pp | -100 pp |

## S4-edge-varnish-load vs S0-baseline

| scenario | req/s | p50 | p95 | p99 | TTFB p95 | errors | edge hit | set-cookie | cc private |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| mix (all) | +544% ✓ | -91% ✓ | -96% ✓ | +6% | -98% ✓ | +0 pp | +94 pp | -98 pp | -98 pp |
| mix/ap_page | +698% ✓ | -95% ✓ | -91% ✓ | -90% ✓ | -97% ✓ | +0 pp | +100 pp | -100 pp | -100 pp |
| mix/guest_browse | +515% ✓ | -91% ✓ | -87% ✓ | -85% ✓ | -95% ✓ | +0 pp | +100 pp | -100 pp | -100 pp |
| mix/login | +692% ✓ | -34% ✓ | +6% | +8% | +7% | +0 pp | +0 pp | +0 pp | -67 pp |
| mix/search | +703% ✓ | -100% ✓ | -99% ✓ | -99% ✓ | -100% ✓ | +0 pp | +100 pp | -100 pp | -100 pp |

## S4-mock vs S0-mock

| scenario | req/s | p50 | p95 | p99 | TTFB p95 | errors | edge hit | set-cookie | cc private |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| asset-publisher (all) | +0% | -98% ✓ | -98% ✓ | -96% ✓ | -99% ✓ | +0 pp | +100 pp | -100 pp | -100 pp |
| asset-publisher/ap_page | +0% | -99% ✓ | -98% ✓ | -97% ✓ | -99% ✓ | +0 pp | +100 pp | -100 pp | -100 pp |
| asset-publisher/content_page | +0% | -99% ✓ | -97% ✓ | -90% ✓ | -97% ✓ | +0 pp | +100 pp | -100 pp | -100 pp |
| dl-download | +0% | -96% ✓ | -95% ✓ | -90% ✓ | -96% ✓ | +0 pp | +100 pp | -100 pp | -100 pp |
| guest-browse | +5% | -98% ✓ | -98% ✓ | -96% ✓ | -98% ✓ | +0 pp | +100 pp | -100 pp | -100 pp |
| guest-browse-sticky | +0% | -98% ✓ | -97% ✓ | -95% ✓ | -98% ✓ | +0 pp | +100 pp | – | -100 pp |
| headless-api (all) | +0% | +31% | +2% | +0% | +2% | +0 pp | +0 pp | +0 pp | +0 pp |
| headless-api/headless_by_id | +0% | -6% ✓ | +0% | +1% | +0% | +0 pp | +0 pp | +0 pp | +0 pp |
| headless-api/headless_list | +1% | +0% | +0% | +0% | +1% | +0 pp | +0 pp | +0 pp | +0 pp |
| login | +4% | -3% | +1% | +2% | +0% | +0 pp | +0 pp | +0 pp | +0 pp |
| mix (all) | +2% | -98% ✓ | -73% ✓ | -52% ✓ | -98% ✓ | +0 pp | +95 pp | -98 pp | -95 pp |
| mix/ap_page | +2% | -99% ✓ | -99% ✓ | -99% ✓ | -99% ✓ | +0 pp | +100 pp | -100 pp | -100 pp |
| mix/guest_browse | +2% | -98% ✓ | -98% ✓ | -97% ✓ | -98% ✓ | +0 pp | +100 pp | -100 pp | -100 pp |
| mix/login | +2% | -2% | +7% | +6% | +6% | +0 pp | +0 pp | +0 pp | +0 pp |
| mix/search | +2% | -99% ✓ | -99% ✓ | -99% ✓ | -99% ✓ | +0 pp | +100 pp | -100 pp | -100 pp |
| search | -2% | -99% ✓ | -99% ✓ | -98% ✓ | -99% ✓ | +0 pp | +100 pp | -100 pp | -100 pp |

## S5-edge-purge vs S0-baseline

| scenario | req/s | p50 | p95 | p99 | TTFB p95 | errors | edge hit | set-cookie | cc private |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|

## S5-edge-ttl vs S0-baseline

| scenario | req/s | p50 | p95 | p99 | TTFB p95 | errors | edge hit | set-cookie | cc private |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|

## S6-static vs S0-baseline

| scenario | req/s | p50 | p95 | p99 | TTFB p95 | errors | edge hit | set-cookie | cc private |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| asset-publisher (all) | +0% | -84% ✓ | -86% ✓ | -87% ✓ | -88% ✓ | +0 pp | +0 pp | -100 pp | -100 pp |
| asset-publisher/ap_page | +0% | -88% ✓ | -87% ✓ | -87% ✓ | -89% ✓ | +0 pp | +0 pp | -100 pp | -100 pp |
| asset-publisher/content_page | +0% | -78% ✓ | -74% ✓ | -74% ✓ | -75% ✓ | +0 pp | +0 pp | -100 pp | -100 pp |
| guest-browse | +0% | -80% ✓ | -83% ✓ | -84% ✓ | -86% ✓ | +0 pp | +0 pp | -100 pp | -100 pp |
| guest-browse-sticky | +0% | -79% ✓ | -82% ✓ | -83% ✓ | -85% ✓ | +0 pp | +0 pp | – | -100 pp |
| search | +2% | -99% ✓ | -99% ✓ | -99% ✓ | -100% ✓ | +0 pp | +0 pp | -100 pp | -100 pp |

## S6-static-gb80 vs S0-baseline

| scenario | req/s | p50 | p95 | p99 | TTFB p95 | errors | edge hit | set-cookie | cc private |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| guest-browse | +109% ✓ | -81% ✓ | -84% ✓ | -84% ✓ | -87% ✓ | +0 pp | +0 pp | -100 pp | -100 pp |
