/**
 * guest-browse-sticky.js — the RETURNING anonymous visitor.
 *
 * Identical journey to guest-browse.js, but the VU keeps its cookie jar: after
 * the first page Liferay's JSESSIONID / COOKIE_SUPPORT / SERVER_ID (and
 * GUEST_LANGUAGE_ID) ride along on every request, exactly like a real browser.
 *
 * Why a separate variant? Because the classic edge rule "bypass the cache when
 * the request has a cookie" turns this visitor into a 0 % hit ratio, while the
 * correct Liferay rule (bypass only on COMPANY_ID / ID / USER_UUID / REMEMBER_ME,
 * strip everything else) keeps them cached. Run both variants at S4 and compare
 * `edge_hit`: if sticky is much lower than fresh, your VCL / Cache Rule keys on
 * JSESSIONID and needs fixing.
 *
 * Note: `set_cookie_on_guest` is only meaningful on the FIRST request of a
 * sticky iteration (later requests already carry a session), so this scenario
 * records it with anonymous=false and the metric stays empty here on purpose.
 */
import { cfg, singleScenario, baseOptions } from './lib/config.js';
import { guestBrowse } from './guest-browse.js';
import { makeHandleSummary } from './lib/summary.js';

export const options = {
  ...baseOptions,
  scenarios: { guest_browse_sticky: singleScenario('stickyBrowse') },
  thresholds: {
    'http_req_duration{scenario:guest_browse_sticky}': ['p(95)<2000'],
    'http_req_failed{scenario:guest_browse_sticky}': ['rate<0.01'],
    'checks{scenario:guest_browse_sticky}': ['rate>0.99'],
    'http_reqs{scenario:guest_browse_sticky}': ['count>=0'],
    'edge_hit{scenario:guest_browse_sticky}': ['rate>=0'],
    'cache_control_private{scenario:guest_browse_sticky}': ['rate>=0'],
    'ttfb{scenario:guest_browse_sticky}': ['p(95)>=0'],
  },
};

export function stickyBrowse() {
  // sticky=true → never clears the jar; the VU accumulates cookies like a browser
  guestBrowse({ sticky: true });
}

export default stickyBrowse;
export const handleSummary = makeHandleSummary('guest-browse-sticky');
