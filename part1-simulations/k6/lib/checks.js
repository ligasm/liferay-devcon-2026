/**
 * k6/lib/checks.js — custom metrics + helpers shared by all scenarios.
 *
 * The metrics here are the ones that move between the matrix stages and that
 * the summariser turns into slide tables:
 *
 *   ttfb                   Trend  time-to-first-byte (res.timings.waiting), ms
 *   edge_hit               Rate   1 when the response came from an edge/proxy cache
 *   set_cookie_on_guest    Rate   1 when an anonymous request got a Set-Cookie back
 *   html_bytes             Trend  size of HTML responses
 *   cache_control_private  Rate   1 when Cache-Control contains private / no-store
 */
import http from 'k6/http';
import { check } from 'k6';
import { Trend, Rate, Counter } from 'k6/metrics';
import { cfg } from './config.js';

export const ttfb = new Trend('ttfb', true);
export const edgeHit = new Rate('edge_hit');
export const setCookieOnGuest = new Rate('set_cookie_on_guest');
export const htmlBytes = new Trend('html_bytes');
export const cacheControlPrivate = new Rate('cache_control_private');
export const pageViews = new Counter('page_views');

/** Case-insensitive header lookup (k6 canonicalises header names, e.g. "Cf-Cache-Status"). */
export function header(res, name) {
  const want = name.toLowerCase();
  for (const k in res.headers) {
    if (k.toLowerCase() === want) return res.headers[k];
  }
  return undefined;
}

/**
 * Classify an edge cache status from the usual headers:
 *   Cloudflare  cf-cache-status: HIT | MISS | BYPASS | DYNAMIC | EXPIRED | STALE | UPDATING | REVALIDATED
 *   Varnish     x-cache: HIT|MISS (set by our VCL), x-varnish: "<id> <id>" on a hit, plus Age
 *   Fastly/CloudFront/Akamai  x-cache: "HIT, HIT" / "Hit from cloudfront" / "TCP_HIT"
 * Absent headers count as a MISS (the origin answered directly).
 */
export function edgeStatus(res) {
  const cf = header(res, 'cf-cache-status');
  if (cf) {
    const v = cf.toUpperCase();
    return { status: `cf:${v}`, hit: /^(HIT|STALE|UPDATING|REVALIDATED)$/.test(v) };
  }
  const xc = header(res, 'x-cache');
  if (xc) {
    const v = xc.toUpperCase();
    return { status: `x-cache:${v}`, hit: /(^|[^A-Z_])HIT/.test(v) && !/MISS|BYPASS|PASS/.test(v.split(',')[0]) };
  }
  const xv = header(res, 'x-varnish');
  if (xv) {
    // "X-Varnish: 32770 32768" → two transaction ids = served from cache
    return { status: `x-varnish:${xv}`, hit: xv.trim().split(/\s+/).length >= 2 };
  }
  const age = Number(header(res, 'age'));
  if (!Number.isNaN(age) && header(res, 'age') !== undefined) {
    return { status: `age:${age}`, hit: age > 0 };
  }
  return { status: 'none', hit: false };
}

/** Did the response try to set any cookie? (k6 parses Set-Cookie into res.cookies) */
export function setsCookie(res) {
  return Object.keys(res.cookies || {}).length > 0 || header(res, 'set-cookie') !== undefined;
}

/** Cache-Control says "private" or "no-store" → no shared cache may store it. */
export function isPrivate(res) {
  const cc = (header(res, 'cache-control') || '').toLowerCase();
  return /\bprivate\b|\bno-store\b/.test(cc);
}

/**
 * Record all custom metrics for one response.
 * `anonymous` — whether the request was made without any cookies (so a Set-Cookie
 * on it means "Liferay minted a session for a fresh visitor").
 * `tags` — extra tags (e.g. { page: 'home' }) merged into every metric sample.
 */
export function recordResponse(res, { anonymous = true, html = true, tags = {} } = {}) {
  const t = { ...tags };
  ttfb.add(res.timings.waiting, t);
  const e = edgeStatus(res);
  edgeHit.add(e.hit, { ...t, edge_status: e.status });
  cacheControlPrivate.add(isPrivate(res), t);
  if (anonymous) setCookieOnGuest.add(setsCookie(res), t);
  if (html) {
    const len = res.body ? res.body.length : Number(header(res, 'content-length') || 0);
    htmlBytes.add(len, t);
    pageViews.add(1, t);
  }
  return e;
}

/** Standard checks for an HTML page view. Returns true when all pass. */
export function checkHtml(res, name) {
  return check(res, {
    [`${name}: status 200`]: (r) => r.status === 200,
    [`${name}: is HTML`]: (r) => (header(r, 'content-type') || '').includes('text/html'),
    [`${name}: looks like Liferay`]: (r) => !!r.body && (r.body.includes('Liferay') || r.body.includes('portlet')),
  }, { page: name });
}

/**
 * Request headers that make k6 look like a real browser tab. The Accept-Encoding
 * matters: Cloudflare/Varnish key on it (Vary: Accept-Encoding), and a proxy in
 * front of Liferay should be doing the compression (GZipFilter stays off).
 */
export function guestHeaders(extra = {}) {
  return {
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, br',
    'Upgrade-Insecure-Requests': '1',
    ...extra,
  };
}

/**
 * k6 keeps a cookie jar per VU, so after the first response every request of
 * that VU would carry JSESSIONID/COOKIE_SUPPORT/GUEST_LANGUAGE_ID — exactly what a
 * naive edge rule ("bypass when a cookie is present") keys on. Anonymous
 * scenarios call this before every page view so each request looks like a
 * brand-new visitor. guest-browse-sticky.js deliberately does NOT call it.
 */
export function stripCookies() {
  http.cookieJar().clear(cfg.BASE_URL);
}

/** Random think time helper re-exported for convenience. */
export { sleep } from 'k6';
