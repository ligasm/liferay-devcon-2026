/**
 * headless-api.js — Headless Delivery: list (search index) vs get-by-id (database).
 *
 *   headless_list   GET /o/headless-delivery/v1.0/sites/{SITE_ID}/blog-postings?pageSize=20
 *   headless_by_id  GET /o/headless-delivery/v1.0/blog-postings/{BLOG_ID}
 *
 * Collection endpoints in Liferay's Headless APIs are answered from the search
 * index (Elasticsearch) — that's how `search`, `filter`, `sort` and `page`
 * work — whereas a get-by-id goes straight to the service layer / DB (and
 * therefore through EntityCache). Under load the two behave very differently:
 * the list depends on Elasticsearch latency and `trackTotalHits`, the get-by-id
 * on the entity cache hit ratio (S2). Both are tagged separately so the summary
 * shows them side by side.
 *
 * The endpoints are called anonymously (guest must have VIEW on the blog
 * entries). Set API_USER/API_PASS to use Basic auth instead (demo only —
 * production integrations should use OAuth 2.0).
 *
 * Env: SITE_ID (groupId), BLOG_ID (optional — discovered from the list in setup()),
 *      API_USER/API_PASS (optional), VUS|RATE, DURATION
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import encoding from 'k6/encoding';
import { cfg, url, thinkTime, singleScenario, baseOptions } from './lib/config.js';
import { recordResponse, stripCookies, header } from './lib/checks.js';
import { makeHandleSummary } from './lib/summary.js';

const API_USER = __ENV.API_USER || '';
const API_PASS = __ENV.API_PASS || '';
const PAGE_SIZE = __ENV.PAGE_SIZE || '20';

const perScenario = (name) => ({
  [`http_req_duration{scenario:${name}}`]: ['p(95)<1500'],
  [`http_req_failed{scenario:${name}}`]: ['rate<0.01'],
  [`checks{scenario:${name}}`]: ['rate>0.99'],
  [`http_reqs{scenario:${name}}`]: ['count>=0'],
  [`edge_hit{scenario:${name}}`]: ['rate>=0'],
  [`cache_control_private{scenario:${name}}`]: ['rate>=0'],
  [`ttfb{scenario:${name}}`]: ['p(95)>=0'],
});

export const options = {
  ...baseOptions,
  scenarios: {
    headless_list: singleScenario('listBlogs'),
    headless_by_id: singleScenario('getBlog'),
  },
  thresholds: { ...perScenario('headless_list'), ...perScenario('headless_by_id') },
};

function apiHeaders() {
  const h = { Accept: 'application/json', 'Accept-Encoding': 'gzip, br' };
  if (API_USER) h.Authorization = `Basic ${encoding.b64encode(`${API_USER}:${API_PASS}`)}`;
  return h;
}

const listUrl = () => `${url(`/o/headless-delivery/v1.0/sites/${cfg.SITE_ID}/blog-postings`)}?pageSize=${PAGE_SIZE}`;
const byIdUrl = (id) => url(`/o/headless-delivery/v1.0/blog-postings/${id}`);

/** Runs once: find a BlogsEntry id if BLOG_ID is not given. */
export function setup() {
  if (cfg.BLOG_ID) return { blogId: cfg.BLOG_ID };
  const res = http.get(listUrl(), { headers: apiHeaders(), tags: { step: 'setup' } });
  if (res.status !== 200) throw new Error(`setup: list call failed with HTTP ${res.status} — check SITE_ID (${cfg.SITE_ID}) and guest permissions`);
  const items = res.json('items') || [];
  if (items.length === 0) throw new Error('setup: the site has no blog postings; set BLOG_ID or create one');
  return { blogId: String(items[0].id) };
}

export function listBlogs() {
  stripCookies();
  const res = http.get(listUrl(), { headers: apiHeaders(), tags: { page: 'headless-list', type: 'json' } });
  check(res, {
    'list: 200': (r) => r.status === 200,
    'list: JSON with items': (r) => (header(r, 'content-type') || '').includes('json') && Array.isArray(r.json('items')),
  }, { page: 'headless-list' });
  recordResponse(res, { anonymous: true, html: false, tags: { page: 'headless-list' } });
  sleep(thinkTime());
}

export function getBlog(data) {
  stripCookies();
  const res = http.get(byIdUrl(data.blogId), { headers: apiHeaders(), tags: { page: 'headless-by-id', type: 'json', name: byIdUrl('<id>') } });
  check(res, {
    'by-id: 200': (r) => r.status === 200,
    'by-id: JSON with id': (r) => (header(r, 'content-type') || '').includes('json') && String(r.json('id')) === String(data.blogId),
  }, { page: 'headless-by-id' });
  recordResponse(res, { anonymous: true, html: false, tags: { page: 'headless-by-id' } });
  sleep(thinkTime());
}

export const handleSummary = makeHandleSummary('headless-api');
