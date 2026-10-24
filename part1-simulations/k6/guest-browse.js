/**
 * guest-browse.js — a FRESH anonymous visitor.
 *
 *   home → content page → content page → blog, with think time in between.
 *
 * Every page view is made with an empty cookie jar, so from the server's (and
 * the edge's) point of view each request is a first-time visitor: this is the
 * population a guest-HTML cache serves, and the one Liferay answers with
 * `Set-Cookie: JSESSIONID…` + `Cache-Control: private, no-cache, no-store`.
 *
 * WITH_ASSETS=1 additionally fetches the first ASSET_LIMIT <script src> and
 * <link rel=stylesheet href> URLs from each page (parsed with k6's html()), so
 * you can show the static-asset CDN effect (S3) as a separate `type:asset` tag.
 *
 * Env: BASE_URL, HOME_PATH, CONTENT_PAGES, BLOG_PATH, VUS|RATE, DURATION,
 *      THINK_MIN/THINK_MAX, WITH_ASSETS, ASSET_LIMIT, STAGE_LABEL
 */
import http from 'k6/http';
import { sleep } from 'k6';
import { cfg, url, pick, thinkTime, singleScenario, baseOptions } from './lib/config.js';
import { recordResponse, checkHtml, guestHeaders, stripCookies } from './lib/checks.js';
import { makeHandleSummary } from './lib/summary.js';

export const options = {
  ...baseOptions,
  scenarios: { guest_browse: singleScenario('guestBrowse') },
  thresholds: {
    'http_req_duration{scenario:guest_browse}': ['p(95)<2000'],
    'http_req_failed{scenario:guest_browse}': ['rate<0.01'],
    'checks{scenario:guest_browse}': ['rate>0.99'],
    // These force k6 to emit per-scenario sub-metrics in the summary (used by summarize.py)
    'http_reqs{scenario:guest_browse}': ['count>=0'],
    'edge_hit{scenario:guest_browse}': ['rate>=0'],
    'set_cookie_on_guest{scenario:guest_browse}': ['rate>=0'],
    'cache_control_private{scenario:guest_browse}': ['rate>=0'],
    'ttfb{scenario:guest_browse}': ['p(95)>=0'],
    // With WITH_ASSETS=1, break HTML and static assets out into separate rows
    'http_req_duration{type:html}': ['p(95)>=0'],
    'http_req_duration{type:asset}': ['p(95)>=0'],
    'http_reqs{type:asset}': ['count>=0'],
    'edge_hit{type:asset}': ['rate>=0'],
    'cache_control_private{type:asset}': ['rate>=0'],
  },
};

/**
 * One page view. `sticky=false` clears the VU cookie jar first (fresh visitor).
 * Returns the response so callers can chain (e.g. parse links).
 */
export function viewPage(path, name, { sticky = false, tags = {} } = {}) {
  if (!sticky) stripCookies();
  const res = http.get(url(path), {
    headers: guestHeaders(),
    tags: { page: name, type: 'html', ...tags },
  });
  checkHtml(res, name);
  recordResponse(res, { anonymous: !sticky, html: true, tags: { page: name } });
  if (cfg.WITH_ASSETS && res.status === 200) fetchAssets(res, name);
  return res;
}

/** Fetch the first N static assets referenced by the page, tagged type=asset. */
export function fetchAssets(res, name) {
  const doc = res.html();
  const urls = [];
  // k6 html(): Selection.each() hands you an Element (getAttribute), not a Selection (attr)
  doc.find('script[src]').each((_, el) => urls.push(el.getAttribute('src')));
  doc.find('link[rel="stylesheet"][href], link.lfr-css-file[href]').each((_, el) => urls.push(el.getAttribute('href')));
  const reqs = urls
    .filter((u) => u && !u.startsWith('data:') && !u.startsWith('https://null/'))
    .slice(0, cfg.ASSET_LIMIT)
    .map((u) => ['GET', u.startsWith('http') ? u : url(u), null, {
      headers: guestHeaders({ Accept: '*/*' }),
      tags: { page: name, type: 'asset' },
      responseType: 'none',
    }]);
  if (reqs.length === 0) return;
  const responses = http.batch(reqs);
  for (const r of responses) recordResponse(r, { anonymous: true, html: false, tags: { page: name, type: 'asset' } });
}

/** The full visitor journey. Exported so mix.js can reuse it. */
export function guestBrowse({ sticky = false } = {}) {
  viewPage(cfg.HOME_PATH, 'home', { sticky });
  sleep(thinkTime());
  const pages = cfg.CONTENT_PAGES.length >= 2 ? [pick(cfg.CONTENT_PAGES), pick(cfg.CONTENT_PAGES)] : cfg.CONTENT_PAGES;
  for (const p of pages) {
    viewPage(p, 'content', { sticky });
    sleep(thinkTime());
  }
  viewPage(cfg.BLOG_PATH, 'blog', { sticky });
  sleep(thinkTime());
}

export default guestBrowse;
export const handleSummary = makeHandleSummary('guest-browse');
