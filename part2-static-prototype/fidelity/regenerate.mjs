#!/usr/bin/env node
// regenerate.mjs — one cycle of the same-look static site: fetch what changed, skip if nothing
// did, otherwise run fidelity/build.mjs and list the pages whose HTML actually changed.
//
//   ENV_FILE=.env.local-proventeq node fidelity/regenerate.mjs          # delta
//   ENV_FILE=.env.local-proventeq node fidelity/regenerate.mjs --full   # rebuild everything
//
// The delta and plan come from pipeline/; the pages come from build.mjs, which reads Liferay's
// page definitions and fragments. No model is called.
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../pipeline/lib/config.mjs';
import { fetchAll } from '../pipeline/fetch.mjs';
import { buildPlan } from '../pipeline/plan.mjs';
import { log, nowIso, parseArgs, readJson, writeJson } from '../pipeline/lib/util.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(HERE, '..', process.env.FIDELITY_DIST || 'dist-fidelity');

// url → hash of every HTML page in the output
function pageHashes() {
  const pages = new Map();
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, e.name);
      if (e.isDirectory()) walk(file);
      else if (e.name === 'index.html') {
        const url = `/${path.relative(OUT, dir)}`.replace(/\/$/, '');
        pages.set(url || '/', crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'));
      }
    }
  };
  walk(OUT);
  return pages;
}

const flags = parseArgs();
const t0 = Date.now();
const startedAt = nowIso();
await fetchAll({ ...flags, flat: true });
const plan = buildPlan(flags);
const state = readJson(config.files.state, { runCount: 0, items: {} });
const nothingChanged = !flags.full && !plan.hasChanges;

if (nothingChanged) {
  writeJson(config.files.state, { ...state, lastRun: startedAt, runCount: (state.runCount ?? 0) + 1 });
  log(`done in ${((Date.now() - t0) / 1000).toFixed(1)}s: nothing changed, build skipped`);
  process.exit(0);
}

const before = pageHashes();
const built = spawnSync(process.execPath, [path.join(HERE, 'build.mjs')], { stdio: ['ignore', 'pipe', 'inherit'], env: process.env });
if (built.status !== 0) {
  // state.json is not written, so the next run retries the same changes.
  console.error('fidelity build failed');
  process.exit(1);
}
const after = pageHashes();
const purge = [...after.keys()].filter((url) => flags.full || before.get(url) !== after.get(url));
const removed = [...before.keys()].filter((url) => !after.has(url));

writeJson(config.files.state, { lastRun: startedAt, runCount: (state.runCount ?? 0) + 1, committedAt: nowIso(), items: plan.nextState.items });
fs.mkdirSync(config.dirs.reports, { recursive: true });
fs.writeFileSync(path.join(config.dirs.reports, 'purge.txt'), [...purge, ...removed].join('\n') + '\n');
log(`done in ${((Date.now() - t0) / 1000).toFixed(1)}s: ${after.size} pages, ${purge.length + removed.length} URLs to purge`);
