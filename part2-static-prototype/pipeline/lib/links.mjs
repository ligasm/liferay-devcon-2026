// links.mjs — tiny internal link checker over dist/: every href/src that starts
// with "/" must resolve to a file in dist. Used by report.mjs and tools/check-links.mjs.
import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'node-html-parser';

export function checkLinks(dist) {
  const pages = [];
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith('.html') && pages.push(path.join(d, e.name))));
  walk(dist);
  const exists = (href) => {
    const clean = decodeURIComponent(href.split(/[?#]/)[0]);
    const p = path.join(dist, clean);
    return fs.existsSync(p) && (fs.statSync(p).isFile() || fs.existsSync(path.join(p, 'index.html')));
  };
  const broken = [];
  let checked = 0;
  for (const file of pages) {
    const doc = parse(fs.readFileSync(file, 'utf8'));
    const from = '/' + path.relative(dist, file).replace(/\\/g, '/').replace(/index\.html$/, '');
    for (const el of doc.querySelectorAll('a[href], img[src], link[href], script[src]')) {
      const v = el.getAttribute('href') ?? el.getAttribute('src');
      if (!v || !v.startsWith('/') || v.startsWith('//')) continue;
      checked++;
      if (!exists(v)) broken.push({ from, href: v });
    }
  }
  return { pages: pages.length, checked, broken };
}
