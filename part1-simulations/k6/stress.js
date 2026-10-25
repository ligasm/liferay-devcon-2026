/**
 * stress.js — one step of a capacity ladder (driven by ../stress.sh).
 *
 * Open model, no think time: RATE iterations per second for DURATION, each
 * iteration one anonymous request (login: the full 3-request sign-in flow).
 * When the target cannot keep up, latency grows, k6 adds VUs up to MAX_VUS and
 * then drops iterations — stress.sh reads `dropped_iterations` and the error
 * rate to decide where the platform saturated.
 *
 *   WORKLOAD=pages   guest HTML: home 25 %, content pages 45 %, blog 15 %, news (Asset Publisher) 15 %
 *   WORKLOAD=search  /search?q=<term>  (Elasticsearch round-trip + full page render)
 *   WORKLOAD=login   GET sign-in form → POST credentials → signed-in page
 *   WORKLOAD=mix     pages 85 %, search 12 %, login 3 %
 *
 * Env: everything in lib/config.js plus WORKLOAD, MAX_VUS (default 1500),
 * REQ_TIMEOUT (default 10s), STEP_NAME (summary file name), LIGHT=1 (status +
 * Content-Length check only, body never read — needs a target that sends Content-Length).
 */
import http from 'k6/http';
import { check } from 'k6';
import { cfg, url, pick, baseOptions } from './lib/config.js';
import { recordResponse, guestHeaders, stripCookies } from './lib/checks.js';
import { loginFlow } from './login.js';
import { makeHandleSummary } from './lib/summary.js';

const WORKLOAD = __ENV.WORKLOAD || 'pages';
const RATE = cfg.RATE || 50;
const MAX_VUS = Number(__ENV.MAX_VUS || 1500);
const TIMEOUT = __ENV.REQ_TIMEOUT || '10s';
const LIGHT = __ENV.LIGHT === '1';

export const options = {
  ...baseOptions,
  scenarios: {
    stress: {
      executor: 'constant-arrival-rate',
      rate: RATE,
      timeUnit: '1s',
      duration: cfg.DURATION,
      preAllocatedVUs: Math.min(MAX_VUS, Math.max(20, Math.ceil(RATE / 5))),
      maxVUs: MAX_VUS,
      exec: 'step',
      gracefulStop: '10s',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.05'],
    'http_req_duration{page:home}': ['p(95)>=0'],
    'http_req_duration{page:content}': ['p(95)>=0'],
    'http_req_duration{page:blog}': ['p(95)>=0'],
    'http_req_duration{page:news}': ['p(95)>=0'],
    'http_req_duration{page:search}': ['p(95)>=0'],
    'http_req_duration{page:login}': ['p(95)>=0'],
    dropped_iterations: ['count>=0'],
  },
};

function guestGet(path, page, name) {
  stripCookies();
  const res = http.get(url(path), {
    headers: guestHeaders(),
    timeout: TIMEOUT,
    tags: { page, type: 'html', ...(name ? { name } : {}) },
    // LIGHT=1: do not hand the body to JS (no decompression or string copy) — for edge
    // ladders, where k6 itself would otherwise run out of CPU before Varnish does.
    ...(LIGHT ? { responseType: 'none' } : {}),
  });
  // A Liferay error page is small; a rendered Proventeq page is > 20 KB (> 15 KB gzipped).
  check(res, {
    [`${page}: 200 + full page`]: (r) => r.status === 200 &&
      (LIGHT ? Number(r.headers['Content-Length'] || 0) > 15000 : !!r.body && r.body.length > 20000),
  }, { page });
  recordResponse(res, { anonymous: true, html: true, tags: { page } });
}

function pages() {
  const r = Math.random();
  if (r < 0.25) guestGet(cfg.HOME_PATH, 'home');
  else if (r < 0.70) guestGet(pick(cfg.CONTENT_PAGES), 'content');
  else if (r < 0.85) guestGet(cfg.BLOG_PATH, 'blog');
  else guestGet(cfg.AP_PAGE, 'news');
}

function search() {
  const term = pick(cfg.SEARCH_TERMS);
  guestGet(`${cfg.SEARCH_PATH}?${cfg.SEARCH_PARAM}=${encodeURIComponent(term)}`, 'search', `${cfg.SEARCH_PATH}?q=<term>`);
}

export function step() {
  if (WORKLOAD === 'pages') return pages();
  if (WORKLOAD === 'search') return search();
  if (WORKLOAD === 'login') return loginFlow();
  const r = Math.random();
  if (r < 0.85) return pages();
  if (r < 0.97) return search();
  return loginFlow();
}

export default step;
export const handleSummary = makeHandleSummary(__ENV.STEP_NAME || `stress-${WORKLOAD}-${RATE}`);
