/**
 * search.js — anonymous site search.
 *
 * GET <SEARCH_PATH>?<SEARCH_PARAM>=<random term>
 *
 * URL shape, verified against learn.liferay.com ("Searching for Content"):
 *   http://localhost:8080/web/guest/search?q=data
 * The Search Bar widget sends keywords in the `q` query parameter by default
 * ("Keywords Parameter Name" in the widget's configuration — if an admin
 * renamed it, set SEARCH_PARAM). The destination page defaults to the site's
 * /search page (SEARCH_PATH). Real search URLs also carry the widget's
 * `_com_liferay_portal_search_web_search_bar_portlet_SearchBarPortlet_INSTANCE_xxx_formDate=…`
 * parameter, which is irrelevant to the results and only serves to fragment
 * edge cache keys — a good thing to point at when you show the S4 cache-key
 * allow-list.
 *
 * Every search is an Elasticsearch round-trip plus a full page render; it is
 * the one guest flow that an edge cache can only partially help (per-term).
 */
import http from 'k6/http';
import { sleep, check } from 'k6';
import { cfg, url, pick, thinkTime, singleScenario, baseOptions } from './lib/config.js';
import { recordResponse, checkHtml, guestHeaders, stripCookies } from './lib/checks.js';
import { makeHandleSummary } from './lib/summary.js';

export const options = {
  ...baseOptions,
  scenarios: { search: singleScenario('searchOnce') },
  thresholds: {
    'http_req_duration{scenario:search}': ['p(95)<3000'],
    'http_req_failed{scenario:search}': ['rate<0.01'],
    'checks{scenario:search}': ['rate>0.99'],
    'http_reqs{scenario:search}': ['count>=0'],
    'edge_hit{scenario:search}': ['rate>=0'],
    'set_cookie_on_guest{scenario:search}': ['rate>=0'],
    'cache_control_private{scenario:search}': ['rate>=0'],
    'ttfb{scenario:search}': ['p(95)>=0'],
  },
};

export function searchOnce() {
  stripCookies();
  const term = pick(cfg.SEARCH_TERMS);
  const res = http.get(`${url(cfg.SEARCH_PATH)}?${cfg.SEARCH_PARAM}=${encodeURIComponent(term)}`, {
    headers: guestHeaders(),
    // keep the URL out of the metric tags (k6 would otherwise create one series per term)
    tags: { page: 'search', type: 'html', name: `${cfg.SEARCH_PATH}?${cfg.SEARCH_PARAM}=<term>` },
  });
  checkHtml(res, 'search');
  check(res, {
    'search: has results markup': (r) => !!r.body && /search-results|search-total-label|portal_search_web/.test(r.body),
  }, { page: 'search' });
  recordResponse(res, { anonymous: true, html: true, tags: { page: 'search' } });
  sleep(thinkTime());
}

export default searchOnce;
export const handleSummary = makeHandleSummary('search');
