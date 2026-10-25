// rendered-page-extract.mjs — turn a full Liferay rendered page (120 kB, 34
// scripts, theme chrome) into just the editorial content.
//
// The *rule* says where the content lives and what to drop. Rules are produced
// once per master layout — by the model on first sight, or by the fallback
// below — and cached in content/rules/. Applying a rule is pure string work.
import { parse } from 'node-html-parser';
import { config } from '../lib/config.mjs';
import { sanitizeHtml, textOf } from './html-sanitize.mjs';

// Works for stock Liferay themes; the model refines it for custom masters.
export const FALLBACK_RULE = {
  contentSelector: config.pageContentSelector || '#main-content, main, .portlet-layout',
  strip: [
    ...config.pageStripSelectors, // PAGE_STRIP_SELECTORS: site-specific header/footer fragments
    'header', 'footer', 'nav', '.portlet-navigation', '.portlet-boundary_com_liferay_site_navigation_menu_web_portlet_SiteNavigationMenuPortlet_',
    '.lfr-layout-structure-item-header--2025---copy-', '[class*="lfr-layout-structure-item-header"]', '[class*="lfr-layout-structure-item-footer"]',
    '.portlet-boundary_com_liferay_login_web_portlet_LoginPortlet_', '.portlet-boundary_com_liferay_product_navigation_user_personal_bar_web_portlet_ProductNavigationUserPersonalBarPortlet_',
  ],
  titleSelector: 'h1',
  source: 'fallback',
};

export function applyRule(html, rule = FALLBACK_RULE) {
  const doc = parse(html, { comment: false, blockTextElements: { script: true, style: true, pre: true } });
  const region = doc.querySelector(rule.contentSelector) ?? doc.querySelector('body') ?? doc;
  for (const sel of rule.strip ?? []) region.querySelectorAll(sel).forEach((n) => n.remove());
  const h1 = region.querySelector(rule.titleSelector ?? 'h1');
  const title = h1?.textContent?.trim() || doc.querySelector('title')?.textContent?.replace(/\s*-\s*Liferay.*$/, '').trim() || '';
  h1?.remove(); // the template renders its own <h1>
  const body = sanitizeHtml(region.innerHTML); // innerHTML: drop the portal wrapper itself (#main-content)
  return { title, html: body, text: textOf(body) };
}

// A compressed structural view of the page for the model: tags + id/class only,
// text truncated, scripts/styles removed. 120 kB → ~5 kB. This is what keeps
// the "ask for an extraction rule" call cheap.
export function skeleton(html, { maxChars = 12000, maxDepth = 10 } = {}) {
  const doc = parse(html, { comment: false, blockTextElements: { script: true, style: true } });
  doc.querySelectorAll('script, style, svg, noscript, link, meta').forEach((n) => n.remove());
  const lines = [];
  const walk = (node, depth) => {
    if (depth > maxDepth || lines.join('\n').length > maxChars) return;
    for (const child of node.childNodes) {
      if (child.nodeType === 3) { const t = child.textContent.trim(); if (t) lines.push('  '.repeat(depth) + '"' + t.slice(0, 40) + (t.length > 40 ? '…' : '') + '"'); continue; }
      if (child.nodeType !== 1) continue;
      const id = child.id ? `#${child.id}` : '';
      // per-instance uuid classes carry no meaning for the model, drop them
      const classes = (child.getAttribute('class') ?? '').split(/\s+/).filter((c) => c && !/^lfr-layout-structure-item-[0-9a-f]{8}-/.test(c));
      const cls = classes.slice(0, 3).map((c) => `.${c.slice(0, 40)}`).join('');
      lines.push('  '.repeat(depth) + `<${child.tagName.toLowerCase()}${id}${cls}>`);
      walk(child, depth + 1);
    }
  };
  walk(doc.querySelector('body') ?? doc, 0);
  return lines.join('\n').slice(0, maxChars);
}
