#!/usr/bin/env node
// plan.mjs — diff content/raw against content/state.json and write content/plan.json.
//
// The plan is the ONLY thing the orchestrator reads. It is small, human-readable
// and answers: what was added / changed / removed, which work units need the
// model (and which of those are already cached), and a token budget estimate.
// state.json is committed by report.mjs at the end of a *successful* cycle, so
// a failed build simply retries the same diff next time.
import fs from 'node:fs';
import path from 'node:path';
import { config, ensureDirs } from './lib/config.mjs';
import { KINDS, loadRaw, contentHash, publicPath, missingFields } from './lib/model.mjs';
import { readJson, writeJson, log, nowIso, estimateTokens, parseArgs } from './lib/util.mjs';

const title = (kind, i) => i.headline ?? i.title ?? i.name ?? String(i.id);

// The AI tasks and roughly what each costs; numbers are for the dry-run estimate only.
const RULE_CALL_TOKENS = 4000; // system prompt + 12 kB page skeleton + answer
const ENRICH_ITEM_TOKENS = 500; // ~1.5 kB of text in, ~80 tokens out per item
const REVIEW_CALL_TOKENS = 1500;

export function buildPlan(flags = {}) {
  ensureDirs();
  const state = readJson(config.files.state, { lastRun: null, runCount: 0, items: {} });
  const prev = flags.full ? {} : state.items;
  const next = {};
  const added = [], changed = [], removed = [];
  let unchangedCount = 0;

  for (const kind of KINDS) {
    for (const item of loadRaw(kind)) {
      const key = `${kind}:${item.id}`;
      const entry = { kind, id: item.id, hash: contentHash(kind, item), path: publicPath(kind, item), title: title(kind, item), dateModified: item.dateModified };
      next[key] = entry;
      if (!prev[key]) added.push(entry);
      else if (prev[key].hash !== entry.hash) changed.push(entry);
      else unchangedCount++;
    }
  }
  for (const [key, entry] of Object.entries(prev)) if (!next[key]) removed.push(entry);

  // ---- work units that may need the model -----------------------------------
  const workUnits = [];
  const touched = [...added, ...changed];
  const rawOf = (kind, id) => readJson(path.join(config.dirs.raw, kind, `${id}.json`));

  // (a) first-sight extraction rules: one per master layout / content structure, cached forever after.
  const ruleKeys = new Set();
  for (const e of touched.filter((e) => e.kind === 'page')) ruleKeys.add(`master:${rawOf('page', e.id)?.renderedPage?.masterPageId ?? 'default'}`);
  for (const e of touched.filter((e) => e.kind === 'structured')) ruleKeys.add(`structure:${rawOf('structured', e.id)?.contentStructureId ?? 'default'}`);
  // "cached" means a MODEL answer is on disk. A cached fallback still counts as
  // work the model would do, so dry-run estimates stay honest.
  const modelCached = (file) => readJson(file)?.source === 'model';
  for (const key of ruleKeys) {
    const cached = modelCached(path.join(config.dirs.rules, `${key.replace(/[^a-z0-9_-]/gi, '_')}.json`));
    workUnits.push({ type: 'rule', key, cached, sampleId: touched.find((e) => (key.startsWith('master') ? e.kind === 'page' : e.kind === 'structured'))?.id, estTokens: cached ? 0 : RULE_CALL_TOKENS });
  }

  // (b) enrichment for changed items with missing fields — keyed by content hash.
  for (const e of touched.filter((e) => e.kind === 'blog')) {
    const missing = missingFields(rawOf('blog', e.id));
    if (!missing.length) continue;
    const cached = readJson(path.join(config.dirs.aiCache, `${e.hash}.json`))?.source === 'ai';
    workUnits.push({ type: 'enrich', kind: 'blog', id: e.id, hash: e.hash, missing, cached, estTokens: cached ? 0 : ENRICH_ITEM_TOKENS });
  }

  // (c) optional post-build review.
  if (config.aiReview && touched.length + removed.length) workUnits.push({ type: 'review', cached: false, estTokens: REVIEW_CALL_TOKENS });

  const estTokens = workUnits.reduce((s, w) => s + w.estTokens, 0);
  const plan = {
    generatedAt: nowIso(),
    mode: flags.full ? 'full' : 'delta',
    added, changed, removed, unchangedCount,
    hasChanges: added.length + changed.length + removed.length > 0,
    workUnits,
    aiBudgetEstimate: { estTokens, budget: config.aiBudgetTokens, withinBudget: estTokens <= config.aiBudgetTokens,
      cachedUnits: workUnits.filter((w) => w.cached).length, freshUnits: workUnits.filter((w) => !w.cached).length },
    nextState: { items: next },
  };
  writeJson(config.files.plan, plan);
  log(`plan: +${added.length} ~${changed.length} -${removed.length} =${unchangedCount} | AI units: ${workUnits.length} (${plan.aiBudgetEstimate.cachedUnits} cached) ≈ ${estTokens} tokens`);
  return plan;
}

if (import.meta.url === `file://${process.argv[1]}`) buildPlan(parseArgs());
