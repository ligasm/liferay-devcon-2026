#!/usr/bin/env node
/**
 * mock/server.mjs — a tiny stand-in for Liferay DXP, used ONLY to verify that
 * the k6 scenarios run and that the custom metrics move in the right direction.
 *
 * It fakes just enough of Liferay's HTTP surface:
 *   GET  /web/guest/**                → HTML page with Liferay-ish markup
 *   GET  /web/guest/search?q=…, /search?q=… → HTML search results
 *   GET  /c/portal/login              → HTML sign-in form (LoginPortlet field names)
 *   POST …p_p_lifecycle=1…/login/login → validates p_auth + credentials, 302 + auth cookies
 *   GET  /c/portal/logout             → 302, clears cookies
 *   GET  /documents/**                → 100 KB binary
 *   GET  /o/headless-delivery/v1.0/sites/{id}/blog-postings → JSON list
 *   GET  /o/headless-delivery/v1.0/blog-postings/{id}       → JSON item
 *   GET  /o/**, /combo?…              → tiny JS/CSS with immutable cache headers
 *
 * Two modes (env MODE):
 *   origin (default) — behaves like stock Liferay: JSESSIONID/COOKIE_SUPPORT/GUEST_LANGUAGE_ID
 *                      cookies on every anonymous page, and
 *                      Cache-Control: private, no-cache, no-store, must-revalidate
 *   edge             — behaves like Varnish/Cloudflare in front of Liferay for
 *                      anonymous GETs: X-Cache: HIT, Age, no Set-Cookie,
 *                      Cache-Control: public, max-age=60. Requests carrying a
 *                      Liferay auth cookie (COMPANY_ID/ID/USER_UUID/REMEMBER_ME)
 *                      or non-GET or /c/, /o/headless-* are passed to "origin"
 *                      behaviour and reported as X-Cache: MISS/BYPASS.
 *
 * Other env: PORT (8080), LATENCY_MS (base simulated origin latency, 25),
 *            LOGIN_USER (test@liferay.com), LOGIN_PASS (test), SITE_ID (20117)
 *
 * No dependencies. Node ≥ 18.
 */
import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.PORT || 8080);
const MODE = (process.env.MODE || 'origin').toLowerCase();
const LATENCY = Number(process.env.LATENCY_MS ?? 25);
const LOGIN_USER = process.env.LOGIN_USER || 'test@liferay.com';
const LOGIN_PASS = process.env.LOGIN_PASS || 'test';
const SITE_ID = process.env.SITE_ID || '20117';
const NS = '_com_liferay_login_web_portlet_LoginPortlet_';
const AUTH_COOKIES = ['COMPANY_ID', 'ID', 'USER_UUID', 'REMEMBER_ME'];
const START = Date.now();

const blogs = JSON.parse(readFileSync(join(__dirname, 'blog-postings.json'), 'utf8'));
const BLOB = randomBytes(100 * 1024); // 100 KB document body
const authTokens = new Set(); // p_auth values we've handed out

// ---------------------------------------------------------------- helpers
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jitter = (base) => Math.max(0, base + (Math.random() * base * 0.6 - base * 0.3));

function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}
const isSignedIn = (cookies) => AUTH_COOKIES.some((c) => cookies[c]);

function guestCookies() {
  return [
    `JSESSIONID=${randomBytes(16).toString('hex').toUpperCase()}; Path=/; HttpOnly`,
    'COOKIE_SUPPORT=true; Max-Age=31536000; Path=/; HttpOnly',
    'GUEST_LANGUAGE_ID=en_US; Max-Age=31536000; Path=/; HttpOnly',
  ];
}

function filler(paragraphs) {
  const p = [];
  for (let i = 0; i < paragraphs; i++) {
    p.push(`<p>Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. (${i})</p>`);
  }
  return p.join('\n');
}

/** A page that looks like a rendered Liferay 7.4 page: theme CSS, /o/ scripts, Liferay.authToken. */
function page({ title, path, signedIn, body, pAuth }) {
  pAuth = pAuth || randomBytes(6).toString('base64url');
  authTokens.add(pAuth);
  const scripts = [
    '/o/portal-url-builder-impl/Liferay.js',
    '/o/frontend-js-web/Liferay.(HCCC2MUV).js',
    '/o/frontend-js-aui-web/aui/aui/aui-min.js',
    '/o/frontend-js-aui-web/liferay/modules.js',
    '/o/frontend-js-aui-web/aui/attribute-base/attribute-base-min.js',
    '/o/frontend-js-aui-web/aui/attribute-core/attribute-core-min.js',
    '/o/frontend-js-aui-web/aui/node-base/node-base-min.js',
    '/o/frontend-js-aui-web/liferay/liferay.js',
    '/o/frontend-js-components-web/index.js',
    '/o/frontend-taglib-clay/js/index.js',
    '/o/journal-content-web/js/main.js',
    '/o/portal-search-web/js/main.js',
  ];
  const css = [
    '/o/classic-theme/css/clay.(vy9UzUgKpBw).css',
    '/o/journal-content-web/css/main.(73o5RwC7soM).css',
    '/o/portal-search-web/css/main.(ewQ02j$q6kw).css',
    '/o/cookies-banner-web/cookies_banner/css/main.(rrlPSd7LGsE).css',
  ];
  return `<!DOCTYPE html>
<html class="ltr" dir="ltr" lang="en-US">
<head>
<title>${title} - Liferay Mock</title>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<link href="/o/classic-theme/images/favicon.ico" rel="icon" />
${css.map((h) => `<link class="lfr-css-file" data-senna-track="temporary" href="${h}" rel="stylesheet" type="text/css" />`).join('\n')}
<script data-senna-track="permanent" src="${scripts[0]}" type="text/javascript"></script>
<script data-senna-track="permanent" type="text/javascript">
// <![CDATA[
Liferay.authToken = '${pAuth}';
Liferay.currentURL = '${path}';
Liferay.ThemeDisplay = { isSignedIn: function() { return ${signedIn}; }, getScopeGroupId: function() { return '${SITE_ID}'; } };
// ]]>
</script>
${scripts.slice(1).map((s) => `<script data-senna-track="permanent" src="${s}" type="text/javascript"></script>`).join('\n')}
</head>
<body class="controls-visible ${signedIn ? 'signed-in' : 'signed-out'} public-page site">
<div class="container-fluid" id="wrapper">
<header id="banner" role="banner">
<nav class="navbar"><a href="/web/guest/home">Home</a> <a href="/web/guest/about">About</a> <a href="/web/guest/blog">Blog</a>
${signedIn ? '<a class="sign-out" href="/c/portal/logout">Sign Out</a>' : '<a class="sign-in" href="/c/portal/login">Sign In</a>'}
</nav>
</header>
<section id="content">
<div class="portlet-boundary portlet-boundary_com_liferay_journal_content_web_portlet_JournalContentPortlet_ portlet-static" id="p_p_id_com_liferay_journal_content_web_portlet_JournalContentPortlet_INSTANCE_abcd_">
<div class="portlet-content"><h1>${title}</h1>
${body}
</div></div>
</section>
<footer id="footer" role="contentinfo">Powered by Liferay (mock)</footer>
</div>
</body>
</html>`;
}

function loginForm(redirect) {
  const pAuth = randomBytes(6).toString('base64url');
  // Real Liferay: <portlet:actionURL name="/login/login"> + <aui:form> hidden inputs; p_auth is
  // appended to the action URL by the portlet URL builder (auth.token.check.enabled=true).
  const action = `/web/guest/home?p_p_id=com_liferay_login_web_portlet_LoginPortlet&p_p_lifecycle=1&p_p_state=maximized&p_p_mode=view&${NS}javax.portlet.action=%2Flogin%2Flogin&${NS}mvcRenderCommandName=%2Flogin%2Flogin&p_auth=${pAuth}`;
  const body = `
<div class="portlet-boundary portlet-boundary_com_liferay_login_web_portlet_LoginPortlet_ portlet-static" id="p_p_id_com_liferay_login_web_portlet_LoginPortlet_">
<form action="${action}" class="sign-in-form" id="${NS}fm" method="post" name="${NS}fm">
<input name="${NS}formDate" type="hidden" value="${Date.now()}" />
<input name="${NS}saveLastPath" type="hidden" value="false" />
<input name="${NS}redirect" type="hidden" value="${redirect || ''}" />
<input name="${NS}doActionAfterLogin" type="hidden" value="false" />
<label for="${NS}login">Email Address</label>
<input class="clearable field form-control" id="${NS}login" name="${NS}login" type="text" value="" />
<label for="${NS}password">Password</label>
<input class="field form-control" id="${NS}password" name="${NS}password" type="password" value="" />
<input id="${NS}rememberMeCheckbox" name="${NS}rememberMe" type="checkbox" value="true" />
<button class="btn btn-primary" type="submit">Sign In</button>
</form></div>`;
  return page({ title: 'Sign In', path: '/c/portal/login', signedIn: false, body, pAuth });
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => resolve(data));
  });
}

// ---------------------------------------------------------------- response helpers
function send(res, status, headers, body) {
  res.writeHead(status, headers);
  res.end(body);
}

/** Decide cache headers for an HTML/JSON/document response. */
function dynamicHeaders({ req, cookies, contentType, cacheable, extra = {} }) {
  const h = {
    'Content-Type': contentType,
    Vary: 'Accept-Encoding',
    'X-Powered-By': 'Liferay (mock)',
    ...extra,
  };
  const signedIn = isSignedIn(cookies);
  const edgeEligible = MODE === 'edge' && cacheable && req.method === 'GET' && !signedIn;
  if (edgeEligible) {
    // Cached edge object: shared, no cookies, short TTL + Age.
    h['Cache-Control'] = 'public, max-age=60, stale-while-revalidate=3600';
    h['X-Cache'] = 'HIT';
    h['Age'] = String(1 + (Math.floor((Date.now() - START) / 1000) % 59));
    h['Server-Timing'] = 'cdn-cache;desc=HIT, edge;dur=1';
    h['X-Cache-Tags'] = 'layout-home,site-guest';
  } else {
    // Stock Liferay: private/no-store and a session cookie for everyone.
    h['Cache-Control'] = 'private, no-cache, no-store, must-revalidate';
    h['Pragma'] = 'no-cache';
    h['Expires'] = '0';
    if (!signedIn && !cookies.JSESSIONID) h['Set-Cookie'] = guestCookies();
    if (MODE === 'edge') {
      h['X-Cache'] = signedIn || req.method !== 'GET' ? 'BYPASS' : 'MISS';
      h['Age'] = '0';
    }
  }
  return h;
}

// ---------------------------------------------------------------- router
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const path = url.pathname;
  const cookies = parseCookies(req);
  const signedIn = isSignedIn(cookies);
  const edge = MODE === 'edge' && req.method === 'GET' && !signedIn;

  // Simulated latency: origin work costs time; an edge HIT is ~1 ms.
  const originCost = (mult) => sleep(jitter(LATENCY * mult));

  // --- static assets: hashed/immutable, cheap
  if (path.startsWith('/o/') && !path.startsWith('/o/headless-') && !path.startsWith('/o/api')) {
    if (!edge) await sleep(jitter(2));
    const isCss = path.endsWith('.css');
    return send(res, 200, {
      'Content-Type': isCss ? 'text/css' : 'application/javascript',
      'Cache-Control': 'public, max-age=31536000, immutable',
      ...(MODE === 'edge' ? { 'X-Cache': 'HIT', Age: '86400' } : {}),
    }, isCss ? `/* ${path} */ .lfr-mock{display:block}` : `/* ${path} */ window.__mock=(window.__mock||0)+1;`);
  }
  if (path === '/combo') {
    return send(res, 200, { 'Content-Type': 'application/javascript', 'Cache-Control': 'public, max-age=31536000, immutable' }, '/* combo */');
  }

  // --- Headless Delivery (JSON). Lists hit the search index (slower), by-id hits the DB (fast).
  let m;
  if ((m = path.match(/^\/o\/headless-delivery\/v1\.0\/sites\/(\d+)\/blog-postings\/?$/))) {
    await originCost(1.6);
    const pageSize = Number(url.searchParams.get('pageSize') || 20);
    const body = JSON.stringify({ ...blogs, items: blogs.items.slice(0, pageSize), pageSize, siteId: Number(m[1]) });
    return send(res, 200, { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' }, body);
  }
  if ((m = path.match(/^\/o\/headless-delivery\/v1\.0\/blog-postings\/(\d+)\/?$/))) {
    await originCost(0.4);
    const item = blogs.items.find((b) => String(b.id) === m[1]);
    if (!item) return send(res, 404, { 'Content-Type': 'application/json' }, JSON.stringify({ status: 'NOT_FOUND', title: `No BlogsEntry exists with the primary key ${m[1]}` }));
    return send(res, 200, { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' }, JSON.stringify(item));
  }
  if (path.startsWith('/o/headless-') || path.startsWith('/o/api')) {
    return send(res, 404, { 'Content-Type': 'application/json' }, '{"status":"NOT_FOUND"}');
  }

  // --- Documents & Media: 100 KB stream
  if (path.startsWith('/documents/')) {
    if (!edge) await originCost(0.6);
    const h = dynamicHeaders({ req, cookies, contentType: 'application/octet-stream', cacheable: true, extra: {
      'Content-Length': String(BLOB.length),
      'Content-Disposition': 'inline; filename="sample.bin"',
      'Accept-Ranges': 'bytes',
      'Last-Modified': new Date(START).toUTCString(),
    } });
    return send(res, 200, h, BLOB);
  }

  // --- Login flow
  if (path === '/c/portal/login' && req.method === 'GET') {
    await originCost(1);
    const h = dynamicHeaders({ req, cookies, contentType: 'text/html;charset=UTF-8', cacheable: false });
    return send(res, 200, h, loginForm(url.searchParams.get('redirect')));
  }
  if (req.method === 'POST' && url.searchParams.get('p_p_lifecycle') === '1' &&
      decodeURIComponent(url.searchParams.get(`${NS}javax.portlet.action`) || '') === '/login/login') {
    const raw = await readBody(req);
    const form = new URLSearchParams(raw);
    const pAuth = url.searchParams.get('p_auth') || form.get('p_auth');
    await originCost(1.2); // password hashing is deliberately expensive on a real box
    if (!pAuth || !authTokens.has(pAuth)) {
      return send(res, 403, { 'Content-Type': 'text/html;charset=UTF-8', 'Cache-Control': 'private, no-store' }, '<html><body><h1>Forbidden</h1><p>Invalid authentication token (p_auth).</p></body></html>');
    }
    const login = form.get(`${NS}login`);
    const password = form.get(`${NS}password`);
    if (login !== LOGIN_USER || password !== LOGIN_PASS) {
      const body = loginForm('').replace('<form ', '<div class="alert alert-danger">Authentication failed. Please try again.</div>\n<form ');
      return send(res, 200, { 'Content-Type': 'text/html;charset=UTF-8', 'Cache-Control': 'private, no-cache, no-store, must-revalidate' }, body);
    }
    const redirect = form.get(`${NS}redirect`) || '/web/guest/home';
    return send(res, 302, {
      Location: redirect,
      'Cache-Control': 'private, no-cache, no-store, must-revalidate',
      'Set-Cookie': [
        `JSESSIONID=${randomBytes(16).toString('hex').toUpperCase()}; Path=/; HttpOnly`,
        'COMPANY_ID=20097; Path=/; HttpOnly',
        `ID=${randomBytes(12).toString('base64url')}; Path=/; HttpOnly`,
        `USER_UUID=${randomBytes(24).toString('base64url')}; Path=/; HttpOnly`,
        'GUEST_LANGUAGE_ID=en_US; Path=/',
      ],
    }, '');
  }
  if (path === '/c/portal/logout') {
    await originCost(0.5);
    return send(res, 302, {
      Location: '/web/guest/home',
      'Cache-Control': 'private, no-cache, no-store, must-revalidate',
      'Set-Cookie': [...AUTH_COOKIES, 'JSESSIONID'].map((c) => `${c}=; Max-Age=0; Path=/`),
    }, '');
  }
  if (path.startsWith('/c/')) {
    return send(res, 404, { 'Content-Type': 'text/html' }, '<h1>404</h1>');
  }

  // --- Search results page (/search or /web/guest/search; keyword param is "q" by default)
  if (path === '/search' || path.endsWith('/search')) {
    if (!edge) await originCost(2.2); // Elasticsearch round-trip + result rendering
    const q = url.searchParams.get('q') || '';
    const hits = blogs.items.filter((b) => !q || JSON.stringify(b).toLowerCase().includes(q.toLowerCase()));
    const body = `<div class="portlet-boundary portlet-boundary_com_liferay_portal_search_web_search_results_portlet_SearchResultsPortlet_">
<p class="search-total-label">${hits.length} results for <strong>${q.replace(/</g, '&lt;')}</strong></p>
<ul class="search-results">${hits.map((h) => `<li><a href="/web/guest/blog/-/blogs/${h.friendlyUrlPath}">${h.headline}</a></li>`).join('')}</ul>
${filler(6)}</div>`;
    const h = dynamicHeaders({ req, cookies, contentType: 'text/html;charset=UTF-8', cacheable: true });
    return send(res, 200, h, page({ title: 'Search', path, signedIn, body }));
  }

  // --- Regular pages (home, content pages, blog, asset publisher page)
  if (path === '/' || path.startsWith('/web/') || path.startsWith('/group/')) {
    const isAP = /asset|news|ap/.test(path);
    if (!edge) await originCost(isAP ? 2.3 : 1); // Asset Publisher ≈ 2.3× a plain content page (Liferay benchmark)
    const title = path.split('/').filter(Boolean).pop() || 'home';
    const body = isAP
      ? `<div class="portlet-boundary portlet-boundary_com_liferay_asset_publisher_web_portlet_AssetPublisherPortlet_"><ul class="asset-entries">${blogs.items.map((b) => `<li><h3>${b.headline}</h3><p>${(b.alternativeHeadline || '').slice(0, 200)}</p></li>`).join('')}</ul></div>${filler(20)}`
      : `${filler(30)}<img src="/o/adaptive-media/image/1/Preview-1000x0/hero.jpg" width="1000" height="562" loading="lazy" alt="" />`;
    const h = dynamicHeaders({ req, cookies, contentType: 'text/html;charset=UTF-8', cacheable: true });
    return send(res, 200, h, page({ title, path, signedIn, body }));
  }

  send(res, 404, { 'Content-Type': 'text/html' }, '<h1>404 Not Found</h1>');
});

server.keepAliveTimeout = 65_000;
server.listen(PORT, () => {
  console.log(`[mock] Liferay mock listening on http://localhost:${PORT}  MODE=${MODE}  LATENCY_MS=${LATENCY}  SITE_ID=${SITE_ID}  login=${LOGIN_USER}/${LOGIN_PASS}`);
});
