import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
export const readJson = (f, fallback = null) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : fallback);
export function writeJson(f, data) {
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify(data, null, 2));
}
export const nowIso = () => new Date().toISOString();

// Rough token estimate used in dry-run mode and for budgeting: ~4 chars/token.
export const estimateTokens = (s) => Math.ceil((typeof s === 'string' ? s : JSON.stringify(s)).length / 4);

// URL-safe slug. Liferay friendlyUrlPath is usually already fine but we normalise
// trailing dashes such as "/meet/what-is-a-lug-" -> "meet/what-is-a-lug".
export const slugify = (s) =>
  String(s)
    .toLowerCase()
    .replace(/[^a-z0-9/]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/(^-|-$)/g, '')
    .replace(/-\//g, '/')
    .replace(/\/-/g, '/');

export function parseArgs(argv = process.argv.slice(2)) {
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const [k, v] = a.slice(2).split('=');
    if (v !== undefined) flags[k] = v;
    else if (argv[i + 1] && !argv[i + 1].startsWith('--')) flags[k] = argv[++i];
    else flags[k] = true;
  }
  return flags;
}

export const log = (...a) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);

// Small concurrency limiter (no p-limit dependency).
export function pLimit(n) {
  let active = 0;
  const queue = [];
  const next = () => {
    if (active >= n || !queue.length) return;
    active++;
    const { fn, res, rej } = queue.shift();
    fn().then(res, rej).finally(() => {
      active--;
      next();
    });
  };
  return (fn) => new Promise((res, rej) => {
    queue.push({ fn, res, rej });
    next();
  });
}

export function dirSize(dir) {
  let bytes = 0, files = 0;
  if (!fs.existsSync(dir)) return { bytes, files };
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { const s = dirSize(p); bytes += s.bytes; files += s.files; }
    else { bytes += fs.statSync(p).size; files++; }
  }
  return { bytes, files };
}
export const fmtBytes = (b) => (b > 1e6 ? (b / 1e6).toFixed(2) + ' MB' : (b / 1e3).toFixed(1) + ' kB');
