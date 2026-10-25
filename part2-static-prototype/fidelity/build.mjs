#!/usr/bin/env node
// build.mjs — Liferay as a headless CMS → the same site as plain static HTML.
//
//   ENV_FILE=.env.local-proventeq node fidelity/build.mjs        # → dist-fidelity/
//
// Everything comes from Liferay's APIs; no rendered page is fetched:
//   pages      GET /o/headless-delivery/v1.0/sites/{id}/site-pages(/{path}?nestedFields=pageDefinition)
//   fragments  GET /api/jsonws/fragment.fragmententry/get-fragment-entries (html, css, js, configuration)
//   news       GET …/structured-contents?flatten=true        (Asset Publisher widget)
//   blog       GET …/blog-postings                           (Blogs widget)
//   documents  GET …/documents?flatten=true  + each referenced file's contentUrl
//   theme      the Classic theme's CSS and icon sprite (static files of the theme module)
// The layout tree and fragment templates are rendered here (render.mjs, freemarker.mjs),
// widgets from the headless data (widgets.mjs), and the theme CSS is pruned to what the
// pages use (css.mjs). URLs stay the portal's (/web/<site>/<page>, /documents/d/…), so
// the static site can replace the portal behind the same hostname.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { config, ROOT } from '../pipeline/lib/config.mjs';
import { request, listAll } from '../pipeline/lib/liferay.mjs';
import { log, slugify } from '../pipeline/lib/util.mjs';
import { parse as parseHtml } from 'node-html-parser';
import { renderElement, pageShell, esc } from './render.mjs';
import { widgetRenderers, WIDGETS } from './widgets.mjs';
import { buildCss, collectUsed } from './css.mjs';

const env = (k, d) => (process.env[k] === undefined || process.env[k] === '' ? d : process.env[k]);
const OUT = path.resolve(ROOT, env('FIDELITY_DIST', 'dist-fidelity'));
const LOCALE = env('LOCALE', 'en_US');
const SITE = config.sitePath; // /web/proventeq
const SITE_NAME = config.siteName || 'Site';
const TITLE_SUFFIX = env('TITLE_SUFFIX', ` - ${SITE_NAME} - Liferay DXP`);
// Theme and widget CSS in Liferay's cascade order; '@tokens' marks where the theme's design
// tokens go (see below).
const THEME_CSS = env('THEME_CSS', '/o/classic-theme/css/clay.css,/o/asset-publisher-web/css/main.css,/o/portal-search-web/css/main.css,/o/blogs-web/blogs/css/main.css,/o/social-bookmarks-taglib/css/main.css,/o/classic-theme/css/main.css,@tokens,/o/layout-common-styles/main.css?plid=@home').split(',');
// (@home = the home page's id, which is its plid)
const THEME_ICONS = env('THEME_ICONS', '/o/classic-theme/images/clay/icons.svg');
const LR = config.liferayUrl;

const started = Date.now();
let apiCalls = 0;
const api = (url, opts) => { apiCalls++; return request(url, opts); };
const list = (p) => { apiCalls++; return listAll(p, { max: 10000 }); };
const hash = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 10);

async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); }
  }));
  return out;
}

async function binary(url) {
  apiCalls++;
  const auth = config.authMode === 'basic' ? { Authorization: 'Basic ' + Buffer.from(`${config.basicUser}:${config.basicPassword}`).toString('base64') } : {};
  const r = await fetch(url, { headers: auth, signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  return Buffer.from(await r.arrayBuffer());
}

// ---- 1. fetch ------------------------------------------------------------------------
log(`fetch ${LR} site ${config.siteId} (${SITE})`);
const pageList = (await list('/site-pages?fields=id,friendlyUrlPath,title')).items;
const homeId = pageList.find((p) => p.friendlyUrlPath === config.homePagePath)?.id;
const pages = await pool(pageList, config.concurrency, (p) =>
  api(`${LR}/o/headless-delivery/v1.0/sites/${config.siteId}/site-pages${p.friendlyUrlPath}?nestedFields=pageDefinition&fields=title,friendlyUrlPath,pageDefinition,pageSettings,dateModified`));

const jsonws = (p) => api(`${LR}/api/jsonws/${p}`);
const fragments = new Map();
for (const coll of await jsonws(`fragment.fragmentcollection/get-fragment-collections/group-id/${config.siteId}`)) {
  for (const e of await jsonws(`fragment.fragmententry/get-fragment-entries/fragment-collection-id/${coll.fragmentCollectionId}`)) {
    fragments.set(e.fragmentEntryKey, e);
  }
}

const byDate = (a, b) => new Date(b.datePublished) - new Date(a.datePublished);
const news = (await list('/structured-contents?flatten=true&fields=id,title,friendlyUrlPath,datePublished,keywords,description,contentFields')).items
  .map((n) => ({ ...n, fields: (n.contentFields ?? []).map((f) => ({ label: f.label, html: f.contentFieldValue?.data ?? '' })) }))
  .sort(byDate);
const posts = (await list('/blog-postings?fields=id,headline,alternativeHeadline,description,friendlyUrlPath,datePublished,creator,keywords,articleBody')).items.sort(byDate);
const documents = (await list('/documents?flatten=true&fields=id,title,contentUrl,friendlyUrlPath,encodingFormat,sizeInBytes')).items;

// The theme's design tokens (:root { --font-size-base: … }) are generated per request from the
// theme's frontend-token-definition (plus style-book values) and inlined into the page head;
// no API returns them. They are the one thing taken from a rendered page: the inline style
// block that defines them, from the home page, once per build.
async function themeTokens() {
  const html = await api(`${LR}${SITE}${config.homePagePath}`, { accept: 'text/html' });
  const block = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).find((t) => /:root\s*\{[^}]*--font-size-base/.test(t));
  if (!block) throw new Error('theme token block (:root { --font-size-base … }) not found on the home page');
  return block;
}
const themeCss = await Promise.all(THEME_CSS.map(async (u) => ({
  name: u,
  css: u === '@tokens' ? await themeTokens() : await api(`${LR}${u.replace('@home', homeId)}`, { accept: 'text/css' }),
})));
const sprite = await api(`${LR}${THEME_ICONS}`, { accept: 'image/svg+xml' });
const fetchMs = Date.now() - started;
log(`fetched ${pages.length} pages, ${fragments.size} fragments, ${news.length} web contents, ${posts.length} blog posts, ${documents.length} documents in ${fetchMs} ms (${apiCalls} API calls)`);

// ---- 2. render -----------------------------------------------------------------------
const widgetsOn = (page) => {
  const names = [];
  const walk = (e) => { if (e.type === 'Widget') names.push(e.definition.widgetInstance.widgetName); (e.pageElements ?? []).forEach(walk); };
  walk(page.pageDefinition.pageElement);
  return names;
};
const hostOf = (widget) => pages.find((p) => widgetsOn(p).includes(widget))?.friendlyUrlPath;
const newsPage = hostOf(WIDGETS.AP);
const blogPage = hostOf(WIDGETS.BLOGS);

const urls = {
  page: (p) => `${SITE}${p}`,
  newsItem: (n) => `${SITE}/w/${n.friendlyUrlPath}`,
  blogPost: (p) => `${SITE}${blogPage}/-/blogs/${p.friendlyUrlPath}`,
  newsTag: (t) => `${SITE}${newsPage}/-/tag/${slugify(t)}`,
  blogTag: (t) => `${SITE}${blogPage}/-/tag/${slugify(t)}`,
  listPage: (pagePath, n, tag) => {
    const base = tag ? `${SITE}${pagePath}/-/tag/${slugify(tag)}` : `${SITE}${pagePath}`;
    return n === 1 ? base : `${base}/-/page/${n}`;
  },
  absolute: (u) => `${config.publicUrl}${u}`,
  icons: '/assets/icons.svg', // fixed up with the content hash after rendering
  searchIndex: '/assets/search-index.json',
};
const data = { news, posts };
const icons = new Set();
const outputs = []; // { url, html }
const usedFragments = new Set();
const allScripts = [];

function renderPage(page, { url, view = null, title = null, description = null }) {
  const ctx = { fragments, locale: LOCALE, widgets: widgetRenderers, usedFragments, scripts: [], icons, data, urls, pagePath: page.friendlyUrlPath, view };
  const body = renderElement(page.pageDefinition.pageElement, ctx);
  const seo = page.pageSettings?.seoSettings ?? {};
  allScripts.push(...ctx.scripts);
  outputs.push({
    url,
    title: (title ?? (seo.htmlTitle || page.title)) + TITLE_SUFFIX,
    description: description ?? seo.description ?? '',
    body,
    scripts: ctx.scripts,
  });
}

const tagsOf = (items) => [...new Set(items.flatMap((i) => i.keywords ?? []))];
const pagesOf = (total, delta) => Array.from({ length: Math.max(1, Math.ceil(total / delta)) }, (_, i) => i + 1);
const widgetConfig = (page, name) => {
  let cfg = {};
  const walk = (e) => { if (e.type === 'Widget' && e.definition.widgetInstance.widgetName === name) cfg = e.definition.widgetInstance.widgetConfig ?? {}; (e.pageElements ?? []).forEach(walk); };
  walk(page.pageDefinition.pageElement);
  return cfg;
};

for (const page of pages) {
  const p = page.friendlyUrlPath;
  renderPage(page, { url: urls.page(p) });
  if (p === newsPage) {
    const delta = Number(widgetConfig(page, WIDGETS.AP).delta ?? 20);
    for (const n of news) renderPage(page, { url: urls.newsItem(n), view: { newsItem: n }, title: n.title, description: n.description || '' });
    for (const n of pagesOf(news.length, delta).slice(1)) renderPage(page, { url: urls.listPage(p, n), view: { page: n } });
    for (const t of tagsOf(news)) {
      const count = news.filter((x) => x.keywords?.includes(t)).length;
      for (const n of pagesOf(count, delta)) renderPage(page, { url: urls.listPage(p, n, t), view: { tag: t, page: n }, title: `${t} - ${page.title}` });
    }
  }
  if (p === blogPage) {
    const delta = Number(widgetConfig(page, WIDGETS.BLOGS).pageDelta ?? 20);
    for (const post of posts) renderPage(page, { url: urls.blogPost(post), view: { post }, title: post.headline, description: post.description || '' });
    for (const n of pagesOf(posts.length, delta).slice(1)) renderPage(page, { url: urls.listPage(p, n), view: { page: n } });
    for (const t of tagsOf(posts)) {
      const count = posts.filter((x) => x.keywords?.includes(t)).length;
      for (const n of pagesOf(count, delta)) renderPage(page, { url: urls.listPage(p, n, t), view: { tag: t, page: n }, title: `${t} - ${page.title}` });
    }
  }
}

// Links: absolute portal URLs become site-relative; portal-only functions (/c/portal/login,
// /group/…) keep working by pointing back at the portal.
const fixLinks = (html) => html
  .replaceAll(`href="${LR}${SITE}`, `href="${SITE}`)
  .replace(/(href|action)="\/(c|group|user|o\/oauth2)\//g, `$1="${LR}/$2/`);
for (const o of outputs) o.body = fixLinks(o.body);

// ---- 3. CSS: theme + used fragments, pruned to the selectors the pages use -------------
// Liferay emits a fragment's CSS after its first instance on the page, so the cascade follows
// first use (header before chips, …), not the collection order
const fragmentCss = [...usedFragments].map((k) => fragments.get(k)).filter((e) => e.css?.trim())
  .map((e) => ({ name: `fragment:${e.fragmentEntryKey}`, css: e.css }));
// the page skeleton (#wrapper, .d-flex …) carries theme rules too, so it is part of the input
const shellSample = pageShell({ title: '', description: '', canonical: '', css: '', body: '', scripts: [] });
const used = collectUsed([shellSample, ...outputs.map((o) => o.body)], allScripts);
const { css: siteCss, stats: cssStats } = buildCss([...themeCss, ...fragmentCss], used);

// url(...) in the theme CSS is relative to the theme module: copy what survives pruning
const cssAssets = new Map();
const cssRewritten = siteCss.replace(/url\((['"]?)([^'")]+)\1\)/g, (m, q, u) => {
  if (/^(data:|https?:|#)/.test(u)) return m;
  const src = THEME_CSS.find((s) => s.startsWith('/o/classic-theme/')) ?? THEME_CSS[0];
  const abs = new URL(u, `${LR}${src}`);
  if (abs.origin !== new URL(LR).origin) return m;
  cssAssets.set(abs.pathname, abs.href);
  return `url(${q}${abs.pathname}${q})`;
});
const cssUrl = `/assets/site.${hash(cssRewritten)}.css`;

// ---- 4. icon sprite: only the symbols referenced ------------------------------------------
const symbols = [...icons].map((name) => {
  const m = sprite.match(new RegExp(`<symbol[^>]*id="${name}"[^>]*>[\\s\\S]*?</symbol>`));
  if (!m) log(`warn: icon "${name}" not in ${THEME_ICONS}`);
  return m?.[0] ?? '';
});
const spriteOut = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">${symbols.join('')}</svg>`;
const iconsUrl = `/assets/icons.${hash(spriteOut)}.svg`;

// ---- 5. documents: every /documents/ URL in the output, copied under the same path ------
// empty the directory rather than replacing it: a server bind-mounting it keeps working
fs.mkdirSync(OUT, { recursive: true });
for (const e of fs.readdirSync(OUT)) fs.rmSync(path.join(OUT, e), { recursive: true, force: true });
const write = (rel, content) => {
  const f = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, content);
  return Buffer.byteLength(content);
};
const docRefs = new Set();
for (const s of [cssRewritten, ...outputs.map((o) => o.body)]) {
  for (const m of s.matchAll(/\/documents\/[^"')\s<>]+/g)) docRefs.add(m[0].replace(/&amp;/g, '&'));
}
const docTypes = {};
const copied = [];
await pool([...docRefs], config.concurrency, async (ref) => {
  const clean = decodeURIComponent(ref.split(/[?#]/)[0]);
  const friendly = clean.match(/^\/documents\/d\/[^/]+\/(.+)$/)?.[1];
  const legacy = clean.match(/^\/documents\/\d+\/\d+\/([^/]+)/)?.[1];
  const doc = documents.find((d) => (friendly ? d.friendlyUrlPath === friendly : d.title === legacy));
  if (!doc) { log(`warn: ${ref} matches no document of the site; left pointing at the portal`); return; }
  write(clean, await binary(`${LR}${doc.contentUrl}`));
  docTypes[clean] = doc.encodingFormat;
  copied.push({ path: clean, bytes: doc.sizeInBytes });
});
for (const [p, href] of cssAssets) write(p, await binary(href));
// static files of portal modules referenced from the markup (e.g. the blogs cover placeholder)
const moduleAssets = new Set(outputs.flatMap((o) => [...o.body.matchAll(/\ssrc="(\/o\/[^"?]+)"/g)].map((m) => m[1])));
for (const p of moduleAssets) write(p, await binary(`${LR}${p}`));

// ---- 6. write pages, assets, search index, server config -------------------------------
write(cssUrl, cssRewritten);
write(iconsUrl, spriteOut);

const text = (html) => html.replace(/<(script|style)[\s\S]*?<\/\1>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
// Like Liferay's layout indexer: a page is found by its name and its fragments' rendered
// text, not by what its widgets render (the News page does not match a news item's text)
const fragmentsOnly = (html) => {
  const root = parseHtml(html);
  root.querySelectorAll('.portlet-boundary, style, script').forEach((e) => e.remove());
  return root.textContent;
};
const index = [
  ...pages.filter((p) => p.friendlyUrlPath !== '/search').map((p) => {
    const body = outputs.find((o) => o.url === urls.page(p.friendlyUrlPath)).body;
    return { t: p.title, u: urls.page(p.friendlyUrlPath), x: text(fragmentsOnly(body)).slice(0, 20000), k: 'page' };
  }),
  ...news.map((n) => ({ t: n.title, u: urls.newsItem(n), x: text(`${(n.keywords ?? []).join(' ')} ${n.description ?? ''} ${n.fields.map((f) => f.html).join(' ')}`).slice(0, 20000), k: 'news' })),
  ...posts.map((p) => ({ t: p.headline, u: urls.blogPost(p), x: text(`${(p.keywords ?? []).join(' ')} ${p.alternativeHeadline ?? ''} ${p.description} ${p.articleBody}`).slice(0, 20000), k: 'blog' })),
];
const indexJson = JSON.stringify(index);
const indexUrl = `/assets/search-index.${hash(indexJson)}.json`; // hashed: /assets/ is cached as immutable
write(indexUrl, indexJson);

let htmlBytes = 0;
for (const o of outputs) {
  const html = pageShell({
    title: o.title,
    description: o.description,
    canonical: urls.absolute(o.url),
    css: cssUrl,
    body: o.body.replaceAll(urls.icons + '#', iconsUrl + '#'),
    scripts: o.scripts.map((js) => js.replaceAll(urls.searchIndex, indexUrl).replaceAll(urls.icons + '#', iconsUrl + '#')),
  });
  htmlBytes += write(path.join(o.url, 'index.html'), html);
}
const home = urls.page(config.homePagePath);
write('index.html', `<!DOCTYPE html><meta charset="utf-8"><meta http-equiv="refresh" content="0; url=${home}"><link rel="canonical" href="${urls.absolute(home)}"><a href="${home}">${esc(SITE_NAME)}</a>\n`);

// nginx: same URL layout as the portal; extension-less /documents/d/… get their real type
const types = Object.entries(docTypes).map(([p, t]) => `\t\tlocation = ${p} { default_type ${t}; add_header Cache-Control "public, max-age=86400"; }`).join('\n');
write('_server/nginx.conf', `# generated by fidelity/build.mjs — serve ${path.basename(OUT)}/ as the site root
worker_processes auto;
events { worker_connections 4096; }
http {
	include       /etc/nginx/mime.types;
	sendfile      on;
	tcp_nopush    on;
	keepalive_timeout 65;
	access_log    off;
	# the .gz next to each text file is sent as is, with a Content-Length; gzip covers the rest
	gzip_static   on;
	gzip          on;
	gzip_types    text/css application/javascript application/json image/svg+xml;
	server {
		listen 8091;
		root /usr/share/nginx/html;
		location = / { return 302 ${home}; }
		location /assets/ { add_header Cache-Control "public, max-age=31536000, immutable"; try_files $uri =404; }
		# Liferay's friendly document URLs have no extension: one exact location per file sets its type
${types}
		location /documents/ { add_header Cache-Control "public, max-age=86400"; try_files $uri =404; }
		location / {
			add_header Cache-Control "public, max-age=60, stale-while-revalidate=300";
			try_files $uri $uri/index.html =404;
		}
		location /_server/ { return 404; }
	}
}
`);

// precompressed copies for gzip_static: nginx then never compresses per request
let gzBytes = 0;
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
  e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);
for (const f of walk(OUT).filter((f) => /\.(html|css|js|json|svg)$/.test(f) && !f.includes(`${path.sep}_server${path.sep}`))) {
  const gz = zlib.gzipSync(fs.readFileSync(f), { level: 9 });
  fs.writeFileSync(`${f}.gz`, gz);
  gzBytes += gz.length;
}

// ---- 7. report ------------------------------------------------------------------------------
const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
const report = {
  generated: new Date().toISOString(),
  source: `${LR} site ${config.siteId}`,
  apiCalls,
  fetchMs,
  totalMs: Date.now() - started,
  pages: outputs.length,
  byKind: {
    sitePages: pages.length,
    newsItems: news.length,
    blogPosts: posts.length,
    listAndTagPages: outputs.length - pages.length - news.length - posts.length,
  },
  htmlBytes,
  gzBytes,
  css: { bytes: Buffer.byteLength(cssRewritten), sources: cssStats },
  icons: [...icons],
  documents: copied,
  fragmentsUsed: [...usedFragments],
};
write('_server/build-report.json', JSON.stringify(report, null, 2));
log(`wrote ${outputs.length} pages (${kb(htmlBytes)} HTML), CSS ${kb(report.css.bytes)} (from ${kb(cssStats.reduce((a, s) => a + s.before, 0))}), ${copied.length} documents, ${icons.size} icons → ${path.relative(ROOT, OUT)}/ in ${report.totalMs} ms`);
