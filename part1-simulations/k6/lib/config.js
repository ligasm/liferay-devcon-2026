/**
 * k6/lib/config.js — one place for every environment variable the scenarios read.
 *
 * Every value has a sane default so `k6 run k6/guest-browse.js` works against a
 * vanilla local Liferay on :8080. Override with `-e NAME=value` or exported env vars
 * (k6 exposes both through `__ENV`).
 */

const env = (name, fallback) => {
  const v = __ENV[name];
  return v === undefined || v === '' ? fallback : v;
};

const list = (name, fallback) =>
  env(name, fallback)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

const SITE_PATH = env('SITE_PATH', '/web/guest');

export const cfg = {
  // --- target -------------------------------------------------------------
  BASE_URL: env('BASE_URL', 'http://localhost:8080').replace(/\/+$/, ''),
  SITE_PATH,                                            // friendly URL of the site
  HOME_PATH: env('HOME_PATH', `${SITE_PATH}/home`),      // landing page
  CONTENT_PAGES: list('CONTENT_PAGES', `${SITE_PATH}/about,${SITE_PATH}/services`),
  AP_PAGE: env('AP_PAGE', `${SITE_PATH}/news`),          // a page with an Asset Publisher on it
  BLOG_PATH: env('BLOG_PATH', `${SITE_PATH}/blog`),      // blog page (or a single blog entry friendly URL)
  // Search: Liferay's Search Bar widget sends keywords as `q` by default
  // ("Keywords Parameter Name" in the widget configuration) to the site's
  // /search page, e.g. http://localhost:8080/web/guest/search?q=data.
  // Docs: learn.liferay.com → Search → Getting Started → Searching for Content.
  SEARCH_PATH: env('SEARCH_PATH', `${SITE_PATH}/search`),
  SEARCH_PARAM: env('SEARCH_PARAM', 'q'),
  SEARCH_TERMS: list('SEARCH_TERMS', 'liferay,performance,cache,portal,cloud,release,devcon'),
  DL_URL: env('DL_URL', `${SITE_PATH.replace('/web', '/documents')}/0/sample.pdf`), // /documents/<groupId>/0/<file> or any DL download URL
  SITE_ID: env('SITE_ID', '20117'),                     // groupId of the site (Site Settings → Site ID). 20117 is a common fresh-install Guest site id
  BLOG_ID: env('BLOG_ID', ''),                          // a BlogsEntry id; empty = discover from the list call in setup()

  // --- credentials for login.js -------------------------------------------
  LOGIN_USER: env('LOGIN_USER', 'test@liferay.com'),
  LOGIN_PASS: env('LOGIN_PASS', 'test'),
  LOGIN_PATH: env('LOGIN_PATH', '/c/portal/login'),
  LOGOUT_PATH: env('LOGOUT_PATH', '/c/portal/logout'),
  // Portlet namespace of the Login portlet (com.liferay.login.web). All form
  // fields are prefixed with it: _com_liferay_login_web_portlet_LoginPortlet_login
  LOGIN_NS: env('LOGIN_NS', '_com_liferay_login_web_portlet_LoginPortlet_'),
  SIGNED_IN_MARKER: env('SIGNED_IN_MARKER', '/c/portal/logout'), // string that only appears in signed-in HTML

  // --- load shape -----------------------------------------------------------
  VUS: Number(env('VUS', '10')),
  RATE: env('RATE', '') ? Number(env('RATE', '')) : null, // requests (iterations) per second; null = use VUS/DURATION
  DURATION: env('DURATION', '30s'),
  THINK_MIN: Number(env('THINK_MIN', '1')),             // seconds of think time between page views
  THINK_MAX: Number(env('THINK_MAX', '3')),
  WITH_ASSETS: env('WITH_ASSETS', '0') === '1',         // also fetch top-N static assets referenced by the HTML
  ASSET_LIMIT: Number(env('ASSET_LIMIT', '10')),

  // --- labelling --------------------------------------------------------------
  STAGE_LABEL: env('STAGE_LABEL', 'S0-baseline'),
  RESULTS_DIR: env('RESULTS_DIR', 'results'),
};

/** Absolute URL for a site-relative path. */
export const url = (path) => (path.startsWith('http') ? path : `${cfg.BASE_URL}${path}`);

/** Random element of an array. */
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

/** Think time in seconds, uniformly distributed between THINK_MIN and THINK_MAX. */
export const thinkTime = () => cfg.THINK_MIN + Math.random() * Math.max(0, cfg.THINK_MAX - cfg.THINK_MIN);

/** "30s" | "2m" | "1h" | "90" → seconds */
export function durationSeconds(d) {
  const m = String(d).trim().match(/^(\d+(?:\.\d+)?)(ms|s|m|h)?$/);
  if (!m) throw new Error(`Bad duration: ${d}`);
  const n = Number(m[1]);
  return { ms: n / 1000, s: n, m: n * 60, h: n * 3600 }[m[2] || 's'];
}

/**
 * Executor for single-flow scripts. If RATE is set we use a constant-arrival-rate
 * (open model: load does not drop when the server slows down — the honest way to
 * measure capacity). Otherwise a closed model with VUS virtual users.
 */
export function singleScenario(execFn, extra = {}) {
  if (cfg.RATE) {
    return {
      executor: 'constant-arrival-rate',
      rate: cfg.RATE,
      timeUnit: '1s',
      duration: cfg.DURATION,
      preAllocatedVUs: cfg.VUS,
      maxVUs: Math.max(cfg.VUS * 4, 20),
      exec: execFn,
      gracefulStop: '5s',
      ...extra,
    };
  }
  return {
    executor: 'constant-vus',
    vus: cfg.VUS,
    duration: cfg.DURATION,
    exec: execFn,
    gracefulStop: '5s',
    ...extra,
  };
}

/** Options shared by every scenario: stage tag on every sample + summary percentiles. */
export const baseOptions = {
  tags: { stage: cfg.STAGE_LABEL },
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36 k6-devcon2026',
  insecureSkipTLSVerify: env('INSECURE', '0') === '1',
};
