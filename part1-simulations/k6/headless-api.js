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
 *      API_AUTH=basic (default when API_USER is set) | session
 *        basic   — HTTP Basic on every call. Liferay verifies the password hash on
 *                  EVERY request (~0.5 s on a stock box), which drowns the
 *                  DB-vs-index difference this scenario exists to show.
 *        session — setup() signs in once through the login form; every call reuses
 *                  that portal session cookie (what a signed-in SPA does).
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import encoding from 'k6/encoding';
import { cfg, url, thinkTime, singleScenario, baseOptions } from './lib/config.js';
import { recordResponse, stripCookies, header } from './lib/checks.js';
import { parseLoginForm } from './login.js';
import { makeHandleSummary } from './lib/summary.js';

const API_USER = __ENV.API_USER || '';
const API_PASS = __ENV.API_PASS || '';
const PAGE_SIZE = __ENV.PAGE_SIZE || '20';
const API_AUTH = __ENV.API_AUTH || (API_USER ? 'basic' : 'none');

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

function apiHeaders(data) {
  const h = { Accept: 'application/json', 'Accept-Encoding': 'gzip, br' };
  if (API_AUTH === 'session' && data && data.cookie) {
    h.Cookie = data.cookie;
    h['x-csrf-token'] = data.csrf; // PortalSessionAuthVerifier wants the CSRF token on /o/ calls
  }
  else if (API_AUTH === 'basic' && API_USER) h.Authorization = `Basic ${encoding.b64encode(`${API_USER}:${API_PASS}`)}`;
  return h;
}

/** Sign in once through the login form; return the session cookie + its CSRF token. */
function sessionCookie() {
  const page = http.get(url(cfg.LOGIN_PATH), { tags: { step: 'setup' } });
  const form = parseLoginForm(page);
  if (!form) throw new Error('setup: no login form found at ' + cfg.LOGIN_PATH);
  const post = http.post(form.action, {
    ...form.fields,
    [`${cfg.LOGIN_NS}login`]: API_USER || cfg.LOGIN_USER,
    [`${cfg.LOGIN_NS}password`]: API_PASS || cfg.LOGIN_PASS,
  }, { redirects: 0, tags: { step: 'setup' } });
  if (post.status !== 302 && post.status !== 303) throw new Error(`setup: login POST returned HTTP ${post.status}`);
  const signedIn = http.get(url(cfg.HOME_PATH), { tags: { step: 'setup' } });
  const m = signedIn.body.match(/authToken\s*[=:]\s*['"]([^'"]+)['"]/);
  if (!m) throw new Error('setup: no Liferay.authToken on the signed-in page');
  const jar = http.cookieJar().cookiesForURL(cfg.BASE_URL);
  return { cookie: Object.keys(jar).map((k) => `${k}=${jar[k][0]}`).join('; '), csrf: m[1] };
}

const listUrl = () => `${url(`/o/headless-delivery/v1.0/sites/${cfg.SITE_ID}/blog-postings`)}?pageSize=${PAGE_SIZE}`;
const byIdUrl = (id) => url(`/o/headless-delivery/v1.0/blog-postings/${id}`);

/** Runs once: find a BlogsEntry id if BLOG_ID is not given. */
export function setup() {
  const session = API_AUTH === 'session' ? sessionCookie() : {};
  if (cfg.BLOG_ID) return { blogId: cfg.BLOG_ID, ...session };
  const res = http.get(listUrl(), { headers: apiHeaders(session), tags: { step: 'setup' } });
  if (res.status !== 200) throw new Error(`setup: list call failed with HTTP ${res.status} — check SITE_ID (${cfg.SITE_ID}) and guest permissions`);
  const items = res.json('items') || [];
  if (items.length === 0) throw new Error('setup: the site has no blog postings; set BLOG_ID or create one');
  return { blogId: String(items[0].id), ...session };
}

export function listBlogs(data) {
  stripCookies();
  const res = http.get(listUrl(), { headers: apiHeaders(data), tags: { page: 'headless-list', type: 'json' } });
  check(res, {
    'list: 200': (r) => r.status === 200,
    'list: JSON with items': (r) => (header(r, 'content-type') || '').includes('json') && Array.isArray(r.json('items')),
  }, { page: 'headless-list' });
  recordResponse(res, { anonymous: true, html: false, tags: { page: 'headless-list' } });
  sleep(thinkTime());
}

export function getBlog(data) {
  stripCookies();
  const res = http.get(byIdUrl(data.blogId), { headers: apiHeaders(data), tags: { page: 'headless-by-id', type: 'json', name: byIdUrl('<id>') } });
  check(res, {
    'by-id: 200': (r) => r.status === 200,
    'by-id: JSON with id': (r) => (header(r, 'content-type') || '').includes('json') && String(r.json('id')) === String(data.blogId),
  }, { page: 'headless-by-id' });
  recordResponse(res, { anonymous: true, html: false, tags: { page: 'headless-by-id' } });
  sleep(thinkTime());
}

export const handleSummary = makeHandleSummary('headless-api');
