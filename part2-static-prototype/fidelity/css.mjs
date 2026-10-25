// css.mjs — combine the theme CSS (fetched from Liferay) with the fragments' CSS and prune
// it to the selectors the generated pages can match. Clay alone is ~790 KB; a page of
// fragments uses a few percent of it.
//
// A selector is kept when every class and id it names occurs in the generated HTML (or in
// the safelist: class names that the emitted JS adds at runtime). Element, attribute and
// pseudo selectors are not checked, so pruning can only keep too much, never drop a rule
// that a generated element could match.
import postcss from 'postcss';

const CLASS_OR_ID = /(?<!\\)([.#])(-?[_a-zA-Z][\w-]*)/g;

function selectorUsed(sel, used) {
  // :not(.x) / :is(.a, .b) must not make a selector look unreachable: drop their arguments
  // (innermost first) and attribute selectors before checking
  let s = sel.replace(/\[[^\]]*\]/g, '');
  for (let prev = ''; prev !== s;) { prev = s; s = s.replace(/:(not|is|where|has|matches)\([^()]*\)/g, ''); }
  for (const m of s.matchAll(CLASS_OR_ID)) {
    const set = m[1] === '.' ? used.classes : used.ids;
    if (!set.has(m[2])) return false;
  }
  return true;
}

/** Collect class names, ids from HTML strings, and class-like words from JS strings. */
export function collectUsed(htmlPages, jsSources = []) {
  const classes = new Set();
  const ids = new Set();
  for (const html of htmlPages) {
    for (const m of html.matchAll(/\sclass="([^"]*)"/g)) for (const c of m[1].split(/\s+/)) c && classes.add(c);
    for (const m of html.matchAll(/\sid="([^"]*)"/g)) ids.add(m[1]);
  }
  for (const js of jsSources) {
    for (const m of js.matchAll(/['"`]([\w\s-]+)['"`]/g)) for (const c of m[1].split(/\s+/)) c && classes.add(c);
  }
  return { classes, ids };
}

/** sources: [{ name, css }] in cascade order. Returns { css, stats }. */
export function buildCss(sources, used) {
  const imports = [];
  const root = postcss.root();
  const stats = [];
  for (const { name, css } of sources) {
    const r = postcss.parse(css, { from: name });
    const before = css.length;
    r.walkAtRules('import', (at) => { imports.push(at.clone()); at.remove(); });
    r.walkAtRules('charset', (at) => at.remove());
    r.walkRules((rule) => {
      if (rule.parent?.type === 'atrule' && /keyframes$/i.test(rule.parent.name)) return;
      const keep = rule.selectors.filter((s) => selectorUsed(s, used));
      if (!keep.length) rule.remove();
      else rule.selectors = keep;
    });
    // drop at-rules (media, supports, layer) left empty by the pruning
    let changed = true;
    while (changed) {
      changed = false;
      r.walkAtRules((at) => {
        if (at.nodes && at.nodes.length === 0) { at.remove(); changed = true; }
      });
    }
    r.walkComments((c) => c.remove());
    const out = r.toString();
    stats.push({ name, before, after: out.length });
    root.append(r.nodes);
  }
  // @import must precede every other rule, so the fragments' font import moves to the top
  root.prepend(imports);
  const css = root.toString().replace(/\n\s*\n+/g, '\n');
  return { css, stats };
}
