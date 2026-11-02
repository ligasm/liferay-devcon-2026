/**
 * login.js — a real form login through the Liferay Login portlet.
 *
 *   1. GET  /c/portal/login            → renders the sign-in page (LoginPortlet)
 *   2. parse the form: action URL (a portlet action URL carrying p_auth), every
 *      hidden input (formDate, saveLastPath, redirect, doActionAfterLogin) and
 *      the namespaced login/password field names
 *   3. POST credentials                → expect 302 + auth cookies
 *   4. GET  a signed-in page            → must contain the sign-out link
 *   5. GET  /c/portal/logout            → 302
 *
 * Field names, verified from modules/apps/login/login-web/.../login.jsp on
 * liferay-portal master:
 *   <portlet:actionURL name="/login/login"> with <portlet:param mvcRenderCommandName=/login/login>
 *   <aui:form name="fm" method="post">
 *     <aui:input name="saveLastPath" type="hidden">      → _com_liferay_login_web_portlet_LoginPortlet_saveLastPath
 *     <aui:input name="redirect" type="hidden">          → …_redirect
 *     <aui:input name="doActionAfterLogin" type="hidden"> → …_doActionAfterLogin
 *     <aui:input name="login">                           → …_login
 *     <aui:input name="password" type="password">        → …_password
 *     <aui:input name="rememberMe" type="checkbox">      → …_rememberMe
 *   <aui:form> also emits a hidden …_formDate, and the portlet URL builder appends
 *   p_auth=<token> to the action URL (auth.token.check.enabled=true by default).
 *
 * Executor: constant-arrival-rate — the open model matters here. Liferay's own
 * 7.4 benchmark saw the NATIVE login provider degrade past ~400 concurrent
 * login attempts (68 % CPU at 400 users), because password
 * hashing (PBKDF2/bcrypt) is deliberately expensive; offloading auth to a
 * dedicated IdP took the same hardware to 19,000 virtual users. Keep RATE modest
 * (default 2/s) — every successful login also creates a server-side session.
 *
 * Env: LOGIN_USER, LOGIN_PASS, LOGIN_PATH, LOGOUT_PATH, LOGIN_NS, SIGNED_IN_MARKER,
 *      RATE (logins per second), VUS (pre-allocated), DURATION
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Rate } from 'k6/metrics';
import { cfg, url, thinkTime, baseOptions } from './lib/config.js';
import { recordResponse, guestHeaders, stripCookies, header } from './lib/checks.js';
import { makeHandleSummary } from './lib/summary.js';

export const loginDuration = new Trend('login_duration', true); // the POST only
export const loginSuccess = new Rate('login_success');

export const options = {
  ...baseOptions,
  scenarios: {
    login: {
      executor: 'constant-arrival-rate',
      rate: cfg.RATE || 2,
      timeUnit: '1s',
      duration: cfg.DURATION,
      preAllocatedVUs: cfg.VUS,
      maxVUs: Math.max(cfg.VUS * 4, 20),
      exec: 'loginFlow',
      gracefulStop: '10s',
    },
  },
  thresholds: {
    'http_req_duration{scenario:login}': ['p(95)<3000'],
    'http_req_failed{scenario:login}': ['rate<0.01'],
    login_success: ['rate>0.99'],
    login_duration: ['p(95)<2000'],
    'http_reqs{scenario:login}': ['count>=0'],
    'edge_hit{scenario:login}': ['rate>=0'],
    'cache_control_private{scenario:login}': ['rate>=0'],
    'ttfb{scenario:login}': ['p(95)>=0'],
  },
};

/** Extract the login form (action + hidden fields) from the sign-in page HTML. */
export function parseLoginForm(res) {
  const doc = res.html();
  let form = doc.find(`form[action*="${cfg.LOGIN_NS.replace(/^_|_$/g, '')}"]`); // action contains the portlet id
  if (form.size() === 0) form = doc.find('form.sign-in-form');
  if (form.size() === 0) form = doc.find('form');
  if (form.size() === 0) return null;

  let action = form.attr('action') || '';
  const fields = {};
  form.find('input[type="hidden"]').each((_, el) => {
    const n = el.getAttribute('name');
    if (n) fields[n] = el.getAttribute('value') || '';
  });

  // p_auth: normally already in the action URL; fall back to the page's Liferay.authToken
  if (!/[?&]p_auth=/.test(action) && !fields.p_auth) {
    const m = res.body.match(/Liferay\.authToken\s*=\s*['"]([^'"]+)['"]/);
    if (m) action += (action.includes('?') ? '&' : '?') + `p_auth=${m[1]}`;
  }
  return { action: action.startsWith('http') ? action : url(action), fields };
}

export function loginFlow() {
  stripCookies(); // every iteration is a brand-new browser
  const tags = { page: 'login' };

  // 1. sign-in page
  const page = http.get(url(cfg.LOGIN_PATH), { headers: guestHeaders(), tags: { ...tags, step: 'get-form' } });
  recordResponse(page, { anonymous: true, html: true, tags: { ...tags, step: 'get-form' } });
  const form = check(page, { 'login: sign-in page 200': (r) => r.status === 200 }, tags) ? parseLoginForm(page) : null;
  if (!form) {
    loginSuccess.add(false);
    return;
  }

  // 2. POST credentials (redirects: 0 so we can assert the 302 + Set-Cookie ourselves)
  const payload = {
    ...form.fields,
    [`${cfg.LOGIN_NS}login`]: cfg.LOGIN_USER,
    [`${cfg.LOGIN_NS}password`]: cfg.LOGIN_PASS,
  };
  const post = http.post(form.action, payload, {
    headers: guestHeaders({ Referer: url(cfg.LOGIN_PATH), Accept: 'text/html,*/*;q=0.8' }),
    redirects: 0,
    tags: { ...tags, step: 'post', name: `${cfg.LOGIN_PATH} [POST]` },
  });
  loginDuration.add(post.timings.duration);
  recordResponse(post, { anonymous: false, html: false, tags: { ...tags, step: 'post' } });

  const authCookies = ['COMPANY_ID', 'ID', 'USER_UUID', 'LOGIN'].filter((c) => post.cookies && post.cookies[c]);
  const ok = check(post, {
    'login: POST → 302 redirect': (r) => r.status === 302 || r.status === 303,
    'login: auth cookies set (COMPANY_ID/ID/USER_UUID)': () => authCookies.length > 0,
    // With browser.cache.disabled=false (S3+) the 302 carries no Cache-Control at all;
    // what matters is that nothing marks it shareable. The signed-in page is checked below.
    'login: POST not publicly cacheable': (r) => !/public|s-maxage/.test(header(r, 'cache-control') || ''),
  }, tags);
  loginSuccess.add(ok);
  if (!ok) {
    return;
  }

  // 3. a signed-in page (cookie jar now carries the session)
  sleep(thinkTime());
  const home = http.get(url(cfg.HOME_PATH), { headers: guestHeaders(), tags: { ...tags, step: 'signed-in-page', page: 'home-signed-in' } });
  recordResponse(home, { anonymous: false, html: true, tags: { ...tags, step: 'signed-in-page' } });
  check(home, {
    'login: signed-in page 200': (r) => r.status === 200,
    'login: page shows signed-in marker': (r) => !!r.body && r.body.includes(cfg.SIGNED_IN_MARKER),
    'login: signed-in page NOT served from edge': (r) => !/HIT/i.test(header(r, 'cf-cache-status') || header(r, 'x-cache') || ''),
    'login: signed-in page Cache-Control private': (r) => /private|no-store/.test(header(r, 'cache-control') || ''),
  }, tags);

  // 4. logout
  sleep(thinkTime());
  const out = http.get(url(cfg.LOGOUT_PATH), { headers: guestHeaders(), redirects: 0, tags: { ...tags, step: 'logout' } });
  check(out, { 'logout: redirect or 200': (r) => r.status === 302 || r.status === 200 }, tags);
}

export default loginFlow;
export const handleSummary = makeHandleSummary('login');
