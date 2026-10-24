/**
 * mix.js — the realistic mixed workload for the on-stage before/after.
 *
 *   70 %  guest browse   (fresh anonymous visitor journey, 4 page views)
 *   15 %  search
 *   10 %  asset-publisher page
 *    5 %  login / logout
 *
 * Each share is its own `ramping-arrival-rate` scenario (open model — arrivals
 * do not slow down when Liferay does, which is what makes p95 honest), with a
 * shared stage profile: warm-up → ramp → hold → ramp-down.
 *
 *   RATE      = total iterations/s at the plateau (default 10). NB: one guest
 *               browse iteration is 4 page views, so 10 it/s ≈ 30 HTML req/s.
 *   DURATION  = total wall time (default 2m); stages are 15 % / 25 % / 45 % / 15 %.
 *   VUS       = pre-allocated VUs per scenario share (default 10, scaled by share)
 *
 * Suggested demo: `./run.sh S0-baseline mix` (60–120 s), flip the config, then
 * `./run.sh S4-edge mix` and run `python3 summarize.py`.
 */
import { cfg, durationSeconds, baseOptions } from './lib/config.js';
import { guestBrowse } from './guest-browse.js';
import { searchOnce } from './search.js';
import { assetPublisherPage } from './asset-publisher.js';
import { loginFlow } from './login.js';
import { makeHandleSummary } from './lib/summary.js';

const PEAK = cfg.RATE || 10;                 // total iterations per second at plateau
const TOTAL = durationSeconds(cfg.DURATION); // seconds
const pct = (p) => `${Math.max(1, Math.round(TOTAL * p))}s`;

/**
 * warm-up 15 % @ 25 % rate → ramp 25 % to 100 % → hold 45 % → ramp-down 15 %.
 * Stage targets must be integers, so rates are expressed per MINUTE
 * (timeUnit: '1m'); 0.5 it/s for the 5 % login share becomes 30 it/min.
 */
function stagesFor(share) {
  const peakPerMin = Math.max(1, Math.round(PEAK * share * 60));
  return [
    { duration: pct(0.15), target: Math.max(1, Math.round(peakPerMin * 0.25)) },
    { duration: pct(0.25), target: peakPerMin },
    { duration: pct(0.45), target: peakPerMin },
    { duration: pct(0.15), target: 0 },
  ];
}

function rampingScenario(exec, share) {
  const vus = Math.max(2, Math.ceil(cfg.VUS * share * 4)); // journeys are several seconds long
  return {
    executor: 'ramping-arrival-rate',
    startRate: 0,
    timeUnit: '1m',
    preAllocatedVUs: vus,
    maxVUs: vus * 5,
    stages: stagesFor(share),
    exec,
    gracefulStop: '10s',
  };
}

const perScenario = (name, p95) => ({
  [`http_req_duration{scenario:${name}}`]: [`p(95)<${p95}`],
  [`http_req_failed{scenario:${name}}`]: ['rate<0.01'],
  [`http_reqs{scenario:${name}}`]: ['count>=0'],
  [`edge_hit{scenario:${name}}`]: ['rate>=0'],
  [`set_cookie_on_guest{scenario:${name}}`]: ['rate>=0'],
  [`cache_control_private{scenario:${name}}`]: ['rate>=0'],
  [`ttfb{scenario:${name}}`]: ['p(95)>=0'],
});

export const options = {
  ...baseOptions,
  scenarios: {
    guest_browse: rampingScenario('mixGuestBrowse', 0.70),
    search: rampingScenario('mixSearch', 0.15),
    ap_page: rampingScenario('mixAssetPublisher', 0.10),
    login: rampingScenario('mixLogin', 0.05),
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<2000'],
    ...perScenario('guest_browse', 2000),
    ...perScenario('search', 3000),
    ...perScenario('ap_page', 2500),
    ...perScenario('login', 3000),
  },
};

// Thin wrappers so k6's `exec` names are stable regardless of the imported modules
export function mixGuestBrowse() { guestBrowse({ sticky: false }); }
export function mixSearch() { searchOnce(); }
export function mixAssetPublisher() { assetPublisherPage(); }
export function mixLogin() { loginFlow(); }

export const handleSummary = makeHandleSummary('mix');
