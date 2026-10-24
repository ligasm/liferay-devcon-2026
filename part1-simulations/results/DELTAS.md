# Change vs S0 baseline

Percent change of each metric relative to the S0 row of the same scenario (negative is better for latency/error/cookie columns, positive is better for req/s and edge hit). Rows are skipped when the baseline has no matching scenario.

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
