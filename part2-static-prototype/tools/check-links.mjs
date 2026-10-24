#!/usr/bin/env node
// check-links.mjs — CLI for pipeline/lib/links.mjs: exits 1 if any internal link is broken.
import path from 'node:path';
import { checkLinks } from '../pipeline/lib/links.mjs';
const r = checkLinks(path.resolve(process.argv[2] ?? 'dist'));
console.log(`pages: ${r.pages}, links checked: ${r.checked}, broken: ${r.broken.length}`);
r.broken.slice(0, 30).forEach((b) => console.log(`  ${b.from} → ${b.href}`));
process.exit(r.broken.length ? 1 : 0);
