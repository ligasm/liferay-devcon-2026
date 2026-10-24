/**
 * asset-publisher.js — Asset Publisher page vs a plain content page, side by side.
 *
 * Two scenarios run concurrently with the same load shape:
 *   ap_page       hammers AP_PAGE (a page with a dynamic Asset Publisher)
 *   content_page  hammers the first CONTENT_PAGES entry (plain web content)
 *
 * Liferay's own DXP 7.4 benchmark put the Asset Publisher inflection point at
 * ~11,000 concurrent users vs ~25,000 for plain web content on the same node —
 * roughly 2.3× the cost per page view. This script lets you show that ratio on
 * your own hardware (S0–S2), and then show it disappearing once the guest HTML
 * is served from the edge (S4), where both pages cost the same.
 *
 * Both scenarios run as fresh anonymous visitors (cookie jar cleared per request).
 */
import { sleep } from 'k6';
import { cfg, thinkTime, singleScenario, baseOptions } from './lib/config.js';
import { viewPage } from './guest-browse.js';
import { makeHandleSummary } from './lib/summary.js';

const perScenario = (name) => ({
  [`http_req_duration{scenario:${name}}`]: ['p(95)<2000'],
  [`http_req_failed{scenario:${name}}`]: ['rate<0.01'],
  [`checks{scenario:${name}}`]: ['rate>0.99'],
  [`http_reqs{scenario:${name}}`]: ['count>=0'],
  [`edge_hit{scenario:${name}}`]: ['rate>=0'],
  [`set_cookie_on_guest{scenario:${name}}`]: ['rate>=0'],
  [`cache_control_private{scenario:${name}}`]: ['rate>=0'],
  [`ttfb{scenario:${name}}`]: ['p(95)>=0'],
});

export const options = {
  ...baseOptions,
  scenarios: {
    ap_page: singleScenario('assetPublisherPage'),
    content_page: singleScenario('contentPage'),
  },
  thresholds: { ...perScenario('ap_page'), ...perScenario('content_page') },
};

export function assetPublisherPage() {
  viewPage(cfg.AP_PAGE, 'asset-publisher');
  sleep(thinkTime());
}

export function contentPage() {
  viewPage(cfg.CONTENT_PAGES[0], 'content');
  sleep(thinkTime());
}

export const handleSummary = makeHandleSummary('asset-publisher');
