/**
 * publish-to-fresh.js — how long from "publish" to "fresh page at the edge"? (S5)
 *
 * One VU polls the same page at the ORIGIN and at the EDGE every POLL_MS and
 * records the gap between the moment the origin shows the new content and the
 * moment the edge does:
 *
 *   origin_to_edge_ms   Trend   t(edge fresh) − t(origin fresh)   ← the number for the slide
 *   publish_to_fresh_ms Trend   t(edge fresh) − t(publish)        (API mode only)
 *
 * Two ways to trigger the publish:
 *   manual (default)  — start the script, then publish the content in Liferay's
 *                       UI. Put a unique word in the change and pass it as
 *                       FRESH_MARKER=… so detection is exact; without a marker
 *                       the script diffs the page body with volatile bits
 *                       (p_auth, formDate, t=…, JSESSIONID) stripped out.
 *   PUBLISH_VIA_API=1 — PATCH the structured content ARTICLE_ID through Headless
 *                       Delivery (Basic auth API_USER/API_PASS, demo only) with a
 *                       new title containing the marker.
 *
 * Env: BASE_URL (edge, e.g. http://localhost:6081), ORIGIN_URL (default
 *      http://localhost:8080), PAGE (default AP_PAGE), POLL_MS (500),
 *      MAX_WAIT (120s), FRESH_MARKER, PUBLISH_VIA_API, ARTICLE_ID, API_USER, API_PASS
 *
 * Expected results: ≤ 1–2 s with the S5 purge listener; up to the edge TTL
 * (60 s) without it; TTL + grace if a soft purge is never followed by a request.
 */
import http from 'k6/http';
import { sleep, check } from 'k6';
import encoding from 'k6/encoding';
import { Trend } from 'k6/metrics';
import { cfg, url, durationSeconds, baseOptions } from './lib/config.js';
import { recordResponse, guestHeaders, stripCookies } from './lib/checks.js';
import { makeHandleSummary } from './lib/summary.js';

const ORIGIN_URL = (__ENV.ORIGIN_URL || 'http://localhost:8080').replace(/\/+$/, '');
const PAGE = __ENV.PAGE || cfg.AP_PAGE;
const POLL_MS = Number(__ENV.POLL_MS || 500);
const MAX_WAIT_S = durationSeconds(__ENV.MAX_WAIT || '120s');
const FRESH_MARKER = __ENV.FRESH_MARKER || '';
const VIA_API = __ENV.PUBLISH_VIA_API === '1';
const ARTICLE_ID = __ENV.ARTICLE_ID || '';
const API_USER = __ENV.API_USER || cfg.LOGIN_USER;
const API_PASS = __ENV.API_PASS || cfg.LOGIN_PASS;

export const originToEdge = new Trend('origin_to_edge_ms', true);
export const publishToFresh = new Trend('publish_to_fresh_ms', true);

export const options = {
  ...baseOptions,
  scenarios: {
    publish_to_fresh: {
      executor: 'shared-iterations',
      vus: 1,
      iterations: 1,
      maxDuration: `${MAX_WAIT_S + 60}s`,
      exec: 'measure',
    },
  },
  thresholds: {
    origin_to_edge_ms: ['p(95)<5000'],  // with tag purge you should be well under this
    'http_req_failed{scenario:publish_to_fresh}': ['rate<0.05'],
  },
};

/** Strip per-request noise so two renders of the same content compare equal. */
function normalise(body) {
  return (body || '')
    .replace(/Liferay\.authToken\s*=\s*'[^']*'/g, '')
    .replace(/p_auth=[A-Za-z0-9_-]+/g, '')
    .replace(/formDate=\d+/g, '')
    .replace(/[?&]t=\d{10,}/g, '')
    .replace(/JSESSIONID=[A-F0-9]+/g, '')
    .replace(/currentURL\s*=\s*'[^']*'/g, '');
}

function fetch(base, tag) {
  stripCookies();
  const res = http.get(`${base}${PAGE}`, {
    headers: guestHeaders({ 'Cache-Control': 'no-cache' }), // Varnish ignores it; a browser reload sends it
    tags: { page: 'publish-poll', source: tag },
  });
  recordResponse(res, { anonymous: true, html: true, tags: { source: tag } });
  return res;
}

const isFresh = (res, snapshot) =>
  FRESH_MARKER ? (res.body || '').includes(FRESH_MARKER) : normalise(res.body) !== snapshot;

function publishViaApi() {
  const marker = FRESH_MARKER || `fresh-${Date.now()}`;
  const res = http.patch(
    url(`/o/headless-delivery/v1.0/structured-contents/${ARTICLE_ID}`).replace(cfg.BASE_URL, ORIGIN_URL),
    JSON.stringify({ title: `Edge purge demo ${marker}` }),
    {
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Basic ${encoding.b64encode(`${API_USER}:${API_PASS}`)}`,
      },
      tags: { page: 'publish-api' },
    },
  );
  check(res, { 'publish: PATCH structured-content 200': (r) => r.status === 200 });
  return { ok: res.status === 200, marker };
}

export function measure() {
  // 1. snapshots (also warms the edge so we start from a HIT)
  const originSnap = normalise(fetch(ORIGIN_URL, 'origin').body);
  const edgeSnap = normalise(fetch(cfg.BASE_URL, 'edge').body);
  fetch(cfg.BASE_URL, 'edge');

  let marker = FRESH_MARKER;
  let tPublish = null;
  if (VIA_API) {
    if (!ARTICLE_ID) throw new Error('PUBLISH_VIA_API=1 needs ARTICLE_ID (structured content id)');
    tPublish = Date.now();
    const r = publishViaApi();
    if (!r.ok) return;
    marker = r.marker;
    console.log(`published via API at ${new Date(tPublish).toISOString()} marker="${marker}"`);
  } else {
    console.log(`\n>>> Publish the change to ${PAGE} in Liferay now${FRESH_MARKER ? ` (marker: "${FRESH_MARKER}")` : ''}. Polling for up to ${MAX_WAIT_S}s…\n`);
  }

  // 2. poll origin and edge until both show the new content
  const deadline = Date.now() + MAX_WAIT_S * 1000;
  let tOrigin = null;
  let tEdge = null;
  const fresh = (res, snap) => (marker ? (res.body || '').includes(marker) : normalise(res.body) !== snap);

  while (Date.now() < deadline && (tOrigin === null || tEdge === null)) {
    if (tOrigin === null && fresh(fetch(ORIGIN_URL, 'origin'), originSnap)) {
      tOrigin = Date.now();
      console.log(`origin fresh at +${tPublish ? tOrigin - tPublish : 0} ms`);
    }
    if (tEdge === null) {
      const e = fetch(cfg.BASE_URL, 'edge');
      if (fresh(e, edgeSnap)) {
        tEdge = Date.now();
        console.log(`edge fresh at +${tOrigin ? tEdge - tOrigin : '?'} ms after origin (X-Cache: ${e.headers['X-Cache'] || '-'}, Age: ${e.headers['Age'] || '-'})`);
      }
    }
    sleep(POLL_MS / 1000);
  }

  const ok = check(null, {
    'origin showed the new content': () => tOrigin !== null,
    'edge showed the new content': () => tEdge !== null,
  });
  if (ok) {
    originToEdge.add(Math.max(0, tEdge - tOrigin));
    if (tPublish) publishToFresh.add(tEdge - tPublish);
  } else {
    console.error(`timed out after ${MAX_WAIT_S}s — origin fresh: ${tOrigin !== null}, edge fresh: ${tEdge !== null}`);
  }
}

export const handleSummary = makeHandleSummary('publish-to-fresh');
