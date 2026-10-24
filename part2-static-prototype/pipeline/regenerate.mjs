#!/usr/bin/env node
// regenerate.mjs — one full cycle: fetch → plan → ai → build → report → deploy → purge.
//
// Flags:
//   --full          ignore state, re-fetch and rebuild everything
//   --no-ai         deterministic fallbacks only (no model calls)
//   --dry-run       print the prompts the model would get + token estimates, no calls
//   --offline       skip fetch, use content/raw as-is (great for simulating edits)
//   --max-items N   demo cap for large collections (default MAX_ITEMS=80)
//   --force         build even when the plan says nothing changed
import { spawnSync } from 'node:child_process';
import { config } from './lib/config.mjs';
import { parseArgs, log, nowIso } from './lib/util.mjs';
import { fetchAll } from './fetch.mjs';
import { buildPlan } from './plan.mjs';
import { orchestrate, reviewBuild } from './ai.mjs';
import { build } from './build.mjs';
import { report } from './report.mjs';

function sh(cmd, env = {}) {
  log(`exec: ${cmd}`);
  const r = spawnSync(cmd, { shell: true, stdio: 'inherit', env: { ...process.env, ...env } });
  if (r.status !== 0) throw new Error(`command failed (${r.status}): ${cmd}`);
}

export async function regenerate(flags = {}) {
  const t0 = Date.now();
  const startedAt = nowIso();
  log(`regenerate: start ${JSON.stringify(flags)}`);

  const fetchInfo = flags.offline ? { startedAt, offline: true } : await fetchAll(flags);
  const plan = buildPlan(flags);
  const orch = await orchestrate(flags);

  let buildResult = { skipped: true };
  let review = null;
  if (!orch.skipBuild) {
    buildResult = build(flags);
    review = await reviewBuild({ changes: plan, build: buildResult, links: null, purge: { urls: [] } });
  }
  const r = report({ startedAt, buildResult, fetchInfo, review });

  if (!r.skipped && review && review.ok === false) {
    log(`regenerate: review says NOT ok — ${review.notes?.join('; ')} — skipping deploy/purge`);
  } else if (!r.skipped) {
    if (config.deployCmd) sh(config.deployCmd, { DIST: config.dirs.dist });
    if (config.purgeCmd) sh(config.purgeCmd, { PURGE_URLS: r.purge.urls.join(' '), PURGE_TAGS: r.purge.tags.join(' '), PURGE_ALL: String(r.purge.purgeAll) });
  }
  log(`regenerate: done in ${((Date.now() - t0) / 1000).toFixed(1)}s — ${r.skipped ? 'no changes, build skipped' : `${r.build.pages} pages, ${r.purge.urls.length} URLs to purge`}`);
  return r;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  regenerate(parseArgs()).then((r) => process.exit(r.skipped ? 0 : 0)).catch((e) => { console.error(e); process.exit(1); });
}
