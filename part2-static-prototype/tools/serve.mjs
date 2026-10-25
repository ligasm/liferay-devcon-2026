#!/usr/bin/env node
// serve.mjs — 30-line static server for dist/ that honours the generated _headers
// rules (Cache-Control + Cache-Tag) so you can `curl -sSD-` what the edge would send.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const dist = path.resolve(process.argv[2] ?? 'dist');
const port = Number(process.env.PORT ?? 4321);
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.wasm': 'application/wasm', '.pf_meta': 'application/octet-stream', '.pf_index': 'application/octet-stream', '.pf_fragment': 'application/octet-stream' };
// Mount the static site under the portal's URL layout so load tests written for Liferay hit it unchanged:
//   SERVE_PREFIX=/web/proventeq        /web/proventeq/news  → /news/
//   SERVE_ALIASES=/home=/              /web/proventeq/home  → /   (the page that was generated as the site root)
const prefix = (process.env.SERVE_PREFIX ?? '').replace(/\/$/, '');
const aliases = Object.fromEntries((process.env.SERVE_ALIASES ?? '').split(',').filter(Boolean).map((a) => a.split('=')));
const rules = parseHeaders(path.join(dist, '_headers'));
function parseHeaders(f) {
  if (!fs.existsSync(f)) return [];
  const out = []; let cur = null;
  for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
    if (!line.trim() || line.startsWith('#')) continue;
    if (!line.startsWith(' ')) { cur = { path: line.trim(), headers: {} }; out.push(cur); }
    else { const [k, ...v] = line.trim().split(':'); cur.headers[k.trim()] = v.join(':').trim(); }
  }
  return out;
}
const match = (rule, url) => (rule.endsWith('*') ? url.startsWith(rule.slice(0, -1)) : rule === url);
http.createServer((req, res) => {
  let url = decodeURIComponent(req.url.split('?')[0]);
  if (prefix && (url === prefix || url.startsWith(prefix + '/'))) url = url.slice(prefix.length) || '/';
  url = aliases[url.replace(/\/$/, '')] ?? url;
  let file = path.join(dist, url);
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) { file = path.join(file, 'index.html'); if (!url.endsWith('/')) url += '/'; }
  const headers = {};
  for (const r of rules) if (match(r.path, url)) Object.assign(headers, r.headers);
  if (!fs.existsSync(file)) { res.writeHead(404, { 'Content-Type': 'text/html' }); return res.end(fs.existsSync(path.join(dist, '404.html')) ? fs.readFileSync(path.join(dist, '404.html')) : 'not found'); }
  res.writeHead(200, { 'Content-Type': types[path.extname(file)] ?? 'application/octet-stream', ...headers });
  fs.createReadStream(file).pipe(res);
}).listen(port, process.env.HOST ?? '127.0.0.1', () => console.log(`serving ${dist} on http://${process.env.HOST ?? '127.0.0.1'}:${port}${prefix}`));
