// html-sanitize.mjs — deterministic clean-up of HTML that came out of Liferay.
//
// This is the "bulk work" that never needs a model: strip scripts, inline
// handlers and Liferay-only chrome; rewrite absolute portal links to relative
// ones; point /documents/... images at the configured asset origin.
import { parse } from 'node-html-parser';
import { config } from '../lib/config.mjs';
import { slugify } from '../lib/util.mjs';

const STRIP_SELECTORS = [
  'script', 'noscript', 'style', 'link', 'iframe[src*="liferay"]', // theme CSS/JS never travels; the static layout has its own
  '.portlet-topper', '.portlet-dropdown', '.lfr-tooltip-scope', '.sr-only.control-menu',
  '[data-lfr-editable-id] .lfr-editable-toolbar', '.announcements-banner', '.control-menu-container',
];
const STRIP_ATTRS = /^(on[a-z]+|data-senna.*|data-lfr-.*|data-analytics.*|data-layout-structure-item-id|contenteditable|draggable)$/i;

// The set of paths the static site will actually contain. Any internal portal
// link that does not land on one of these goes back to the portal, so the
// static site never has a broken internal link (the checker enforces this).
let knownPaths = null;
export const setKnownPaths = (paths) => { knownPaths = new Set(paths); };

// Maps a portal URL to the equivalent static-site path where we know one exists.
export function rewriteHref(href) {
  if (!href) return href;
  const base = config.liferayUrl;
  let h = href.startsWith(base) ? href.slice(base.length) || '/' : href;
  if (/^https?:\/\//.test(h)) return h; // external, leave alone
  if (/^(mailto:|tel:|#|javascript:)/i.test(h)) return h;
  if (h === config.sitePath) h = '/';
  else if (h.startsWith(config.sitePath + '/') || h.startsWith(config.sitePath + '?')) h = h.slice(config.sitePath.length);
  if (h.startsWith('/web/')) return base + h; // other site → back to the portal
  if (h.startsWith('/documents/') || h.startsWith('/o/adaptive-media/') || h.startsWith('/image/')) return config.assetOrigin + h;
  if (h.startsWith('/o/') || h.startsWith('/c/') || h.startsWith('/group/') || h.startsWith('/user/')) return base + h; // portal-only endpoints
  if (!h.startsWith('/')) return h;

  const [pathOnly, suffix = ''] = h.split(/(?=[?#])/); // keep ?query#hash for the portal fallback
  const hash = suffix.match(/#.*$/)?.[0] ?? '';
  let candidate;
  const m = pathOnly.match(/^\/(?:b|blogs?\/-\/blogs)\/([^/]+)/); // /b/<slug> and /blogs/-/blogs/<slug>
  if (m) candidate = `/blog/${slugify(m[1])}/`;
  else if (/^\/blogs?\/?$/.test(pathOnly)) candidate = '/blog/';
  else if (pathOnly === config.homePagePath || pathOnly === config.homePagePath + '/') candidate = '/';
  else candidate = `/${slugify(pathOnly.replace(/^\//, ''))}/`.replace('//', '/');

  if (!knownPaths || knownPaths.has(candidate)) return candidate + hash;
  return base + h; // not generated statically (older post, dynamic page) → portal
}

export function sanitizeHtml(html, { rootSelector } = {}) {
  const root = parse(html, { comment: false, blockTextElements: { script: true, style: true, pre: true } });
  const scope = rootSelector ? root.querySelector(rootSelector) ?? root : root;

  for (const sel of STRIP_SELECTORS) scope.querySelectorAll(sel).forEach((n) => n.remove());

  for (const el of scope.querySelectorAll('*')) {
    for (const name of Object.keys(el.attributes)) {
      if (STRIP_ATTRS.test(name)) el.removeAttribute(name);
    }
    if (el.tagName === 'A' && el.getAttribute('href')) el.setAttribute('href', rewriteHref(el.getAttribute('href')));
    for (const attr of ['src', 'srcset', 'poster', 'data-src']) {
      const v = el.getAttribute(attr);
      if (v && (v.startsWith('/') || v.startsWith(config.liferayUrl))) el.setAttribute(attr, rewriteHref(v));
    }
    if (el.tagName === 'IMG' && !el.getAttribute('loading')) el.setAttribute('loading', 'lazy');
    // inline style with CSS url(/documents/...) → asset origin
    const style = el.getAttribute('style');
    if (style && style.includes('url(')) el.setAttribute('style', style.replace(/url\((['"]?)(\/[^)'"]+)\1\)/g, (_, q, u) => `url(${q}${rewriteHref(u)}${q})`));
  }
  let out = scope.innerHTML;
  // Belt and braces: nothing that smells like a portal auth token survives.
  out = out.replace(/authToken['"]?\s*[:=]\s*['"][^'"]+['"]/g, '').replace(/[?&]p_auth=[A-Za-z0-9]+/g, '');
  return out.replace(/\n{3,}/g, '\n\n').trim();
}

export const textOf = (html) => parse(html).textContent.replace(/\s+/g, ' ').trim();
