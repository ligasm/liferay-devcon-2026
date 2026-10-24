/**
 * dl-download.js — Documents & Media download throughput.
 *
 * Downloads DL_URL repeatedly with `discardResponseBodies: true` (k6 never
 * allocates the body, so the client is not the bottleneck) and records:
 *   dl_bytes_per_sec   Trend   Content-Length / transfer time
 *   dl_bytes           Counter total bytes (from Content-Length)
 *   edge_hit           Rate    did the file come from the edge?
 *   cache_control_private       does D&M still send `Cache-Control: private`?
 *
 * Out of the box Liferay streams every D&M file with `Cache-Control: private`
 * (ServletResponseUtil default), so no shared cache may store it — even for a
 * guest-visible image. S3 turns on "Documents and Media → Cache Control"
 * (Public, max-age) for guest-visible files; you should see `edge_hit` go from
 * 0 % to ~100 % and cache_control_private from 100 % to 0 % at S4.
 *
 * Liferay's benchmark reference for this flow: 95 % of 100 KB downloads in
 * 5.96 ms at 11,500 concurrent users (origin only, no CDN).
 *
 * Env: DL_URL (default /documents/guest/0/sample.pdf — set it to a real
 * /documents/<groupId>/<folderId>/<file>/<uuid> URL from your site), VUS|RATE, DURATION
 */
import http from 'k6/http';
import { check } from 'k6';
import { Trend, Counter } from 'k6/metrics';
import { cfg, url, singleScenario, baseOptions } from './lib/config.js';
import { recordResponse, guestHeaders, stripCookies, header } from './lib/checks.js';
import { makeHandleSummary } from './lib/summary.js';

export const dlBytesPerSec = new Trend('dl_bytes_per_sec');
export const dlBytes = new Counter('dl_bytes');

export const options = {
  ...baseOptions,
  discardResponseBodies: true,
  scenarios: { dl_download: singleScenario('download') },
  thresholds: {
    'http_req_duration{scenario:dl_download}': ['p(95)<1500'],
    'http_req_failed{scenario:dl_download}': ['rate<0.01'],
    'http_reqs{scenario:dl_download}': ['count>=0'],
    'edge_hit{scenario:dl_download}': ['rate>=0'],
    'set_cookie_on_guest{scenario:dl_download}': ['rate>=0'],
    'cache_control_private{scenario:dl_download}': ['rate>=0'],
    'ttfb{scenario:dl_download}': ['p(95)>=0'],
  },
};

export function download() {
  stripCookies();
  const res = http.get(url(cfg.DL_URL), {
    headers: guestHeaders({ Accept: '*/*' }),
    tags: { page: 'dl', type: 'document' },
  });
  check(res, {
    'dl: status 200': (r) => r.status === 200,
    'dl: has Content-Length': (r) => header(r, 'content-length') !== undefined,
  }, { page: 'dl' });
  recordResponse(res, { anonymous: true, html: false, tags: { page: 'dl' } });

  // With discardResponseBodies the body is gone, but Content-Length still tells us the size.
  const len = Number(header(res, 'content-length') || 0);
  if (len > 0 && res.timings.duration > 0) {
    dlBytes.add(len);
    dlBytesPerSec.add(len / (res.timings.duration / 1000));
  }
}

export default download;
export const handleSummary = makeHandleSummary('dl-download');
