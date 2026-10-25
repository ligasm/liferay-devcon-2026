// render.mjs — Headless Delivery pageDefinition → the same HTML Liferay renders.
//
// The page tree (Section / Row / Column / Fragment / Widget) comes from
// GET /sites/{id}/site-pages/{path}?nestedFields=pageDefinition. Fragments are rendered
// from their template (html/css/js/configuration, fetched from Liferay) the way Liferay's
// FragmentEntryProcessors do it: FreeMarker first, then the editable values from
// `fragmentFields` are written into the elements marked data-lfr-editable-id. Class names
// and wrappers mirror Liferay's output so the theme's and the fragments' CSS apply unchanged.
import { parse } from 'node-html-parser';
import { renderFreeMarker } from './freemarker.mjs';

export const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const i18n = (v, locale) => (v && (v[locale] ?? Object.values(v)[0])) ?? '';

/** Defaults from a fragment's configuration.json, overlaid with the instance's fragmentConfig. */
export function fragmentConfiguration(entry, fragmentConfig = {}) {
  const conf = {};
  try {
    for (const set of JSON.parse(entry.configuration || '{}').fieldSets ?? []) {
      for (const f of set.fields ?? []) conf[f.name] = f.defaultValue ?? '';
    }
  } catch { /* no configuration */ }
  return { ...conf, ...fragmentConfig };
}

function applyEditables(html, fields, ctx) {
  if (!fields?.length) return html;
  const root = parse(html, { comment: true });
  const byId = new Map(fields.map((f) => [f.id, f.value]));
  for (const el of root.querySelectorAll('[data-lfr-editable-id]')) {
    const value = byId.get(el.getAttribute('data-lfr-editable-id'));
    if (!value) continue;
    const type = el.getAttribute('data-lfr-editable-type');
    if (value.html) el.set_content(i18n(value.html.value_i18n, ctx.locale));
    else if (value.fragmentImage) {
      const url = value.fragmentImage.url?.value ?? i18n(value.fragmentImage.url?.value_i18n, ctx.locale);
      if (url) el.setAttribute('src', url);
    } else if (value.text) {
      el.set_content(i18n(value.text.value_i18n, ctx.locale));
    }
    if (type === 'link' && value.fragmentLink?.value) {
      const link = value.fragmentLink.value;
      const href = link.href?.value ?? i18n(link.href_i18n ?? link.href?.value_i18n, ctx.locale);
      if (href) el.setAttribute('href', href);
      if (link.target) el.setAttribute('target', link.target === 'blank' ? '_blank' : link.target);
    }
  }
  return root.toString();
}

const ALIGN = { top: 'start', middle: 'center', bottom: 'end' };

function rowClasses(def) {
  const align = ALIGN[def.verticalAlignment] ?? 'start';
  const flex = def.reverseOrder ? 'row-reverse' : 'row';
  const c = ['row', `align-items-lg-${align}`, `align-items-sm-${align}`, `align-items-${align}`, `align-items-md-${align}`,
    `flex-lg-${flex}`, `flex-sm-${flex}`, `flex-${flex}`, `flex-md-${flex}`];
  if (def.gutters === false) c.push('no-gutters');
  return c.join(' ');
}

function columnClasses(def) {
  const vp = Object.fromEntries((def.columnViewports ?? []).map((v) => [v.id, v.columnViewportDefinition?.size]));
  const lg = def.size ?? 12;
  const md = vp.tablet ?? lg;
  const sm = vp.landscapeMobile ?? md;
  const xs = vp.portraitMobile ?? sm;
  return `col col-lg-${lg} col-sm-${sm} col-${xs} col-md-${md}`;
}

/**
 * ctx: { fragments: Map(key → entry), locale, widgets: { [widgetName]: (definition, ctx) → html },
 *        usedFragments: Set, scripts: [] }
 */
export function renderElement(el, ctx) {
  const kids = () => (el.pageElements ?? []).map((c) => renderElement(c, ctx)).join('');
  const def = el.definition ?? {};
  const id = el.id;
  switch (el.type) {
    case 'Root':
      return kids();
    case 'Section': {
      const cls = ['lfr-layout-structure-item-' + id, 'lfr-layout-structure-item-container', ...(def.cssClasses ?? [])].join(' ');
      return `<div class="${esc(cls)}" data-layout-structure-item-id="${id}">${kids()}</div>`;
    }
    case 'Row':
      return `<div class="lfr-layout-structure-item-${id} lfr-layout-structure-item-row " data-layout-structure-item-id="${id}"><div class="${rowClasses(def)}">${kids()}</div></div>`;
    case 'Column':
      return `<div class="${columnClasses(def)}">${kids()}</div>`;
    case 'Fragment': {
      const key = def.fragment?.key;
      const entry = ctx.fragments.get(key);
      if (!entry) throw new Error(`fragment "${key}" (element ${id}) is not in the fetched collections`);
      ctx.usedFragments.add(key);
      const configuration = fragmentConfiguration(entry, def.fragmentConfig);
      let html = renderFreeMarker(entry.html, { configuration }, key);
      html = applyEditables(html, def.fragmentFields, ctx);
      if (entry.js?.trim()) {
        ctx.scripts.push(`(function() {\nvar configuration = ${JSON.stringify(configuration)};\nvar fragmentElement = document.querySelector('#fragment-${id}');\n${entry.js}\n})();`);
      }
      return `<div class="lfr-layout-structure-item-${esc(key)} lfr-layout-structure-item-${id} " data-layout-structure-item-id="${id}"><div id="fragment-${id}" > ${html}</div></div>`;
    }
    case 'Widget': {
      const name = def.widgetInstance?.widgetName;
      const render = ctx.widgets[name];
      if (!render) throw new Error(`no static renderer for widget ${name} (element ${id})`);
      const slug = name.toLowerCase().replace(/_/g, '-');
      return `<div class="lfr-layout-structure-item-${slug} lfr-layout-structure-item-${id} " data-layout-structure-item-id="${id}"><div id="fragment-${id}" >${render(def.widgetInstance, ctx)}</div></div>`;
    }
    default:
      throw new Error(`page element type "${el.type}" is not supported (element ${id})`);
  }
}

/** Liferay's portlet decoration, borderless (as on the live page). `header`: the toolbar row
 *  some portlets render above their content — true for the empty one (Blogs list), or the
 *  row's inner HTML (Blogs entry: the back link). */
export function portlet(widgetName, cssClass, body, { header = false } = {}) {
  return `
	<div class="portlet-boundary portlet-boundary_${widgetName}_  portlet-static portlet-static-end portlet-borderless ${cssClass} " id="p_p_id_${widgetName}_">
		<span id="p_${widgetName}"></span>
<section class="portlet" id="portlet_${widgetName}">
	<div class="portlet-content">${header ? `
			<div class="autofit-float autofit-row portlet-header">${header === true ? `
					<div class="autofit-col autofit-col-end">
						<div class="autofit-section">
							<div class="btn-group">
</div>
						</div>
					</div>` : header}
			</div>` : ''}
			<div class=" portlet-content-container">
	<div class="portlet-body">${body}
	</div>
			</div>
	</div>
</section>
	</div>`;
}

/** The Classic theme's page skeleton around the layout, with Liferay's head essentials. */
export function pageShell({ title, description, canonical, css, body, scripts, lang = 'en-US' }) {
  const script = scripts.length ? `\n<script>\n${scripts.join('\n')}\n</script>` : '';
  return `<!DOCTYPE html>
<html class="ltr" dir="ltr" lang="${lang}">
<head>
	<title>${esc(title)}</title>
	<meta content="initial-scale=1.0, width=device-width" name="viewport" />
	<meta content="text/html; charset=UTF-8" http-equiv="content-type" />
${description ? `	<meta content="${esc(description)}" lang="${lang}" name="description" />\n` : ''}	<link href="${esc(canonical)}" rel="canonical" />
	<link href="${css}" rel="stylesheet" type="text/css" />
</head>
<body class="other controls-visible signed-out public-page site">
<div class="d-flex flex-column min-vh-100">
	<div class="d-flex flex-column flex-fill position-relative" id="wrapper">
		<div class=" flex-fill" id="content">
		<div class="layout-content portlet-layout" id="main-content" role="main">
${body}
		</div>
		</div>
	</div>
</div>${script}
</body>
</html>
`;
}
