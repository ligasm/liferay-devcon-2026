#!/usr/bin/env node
// report.mjs — the cycle's receipt: reports/<ISO>.md + reports/latest.json.
// What changed, pages built, build time, dist size, tokens (cached vs fresh),
// estimated cost, and the CDN purge list (URLs + tags). Also COMMITS state.json —
// this is the last step, so a failed cycle never advances the delta cursor.
import fs from 'node:fs';
import path from 'node:path';
import { config, ensureDirs } from './lib/config.mjs';
import { readJson, writeJson, log, nowIso, fmtBytes, parseArgs } from './lib/util.mjs';
import { checkLinks } from './lib/links.mjs';

// Which URLs/tags must be purged at the edge for this set of changes.
function purgeList(plan, posts) {
  const urls = new Set(), tags = new Set();
  let purgeAll = false;
  const byId = Object.fromEntries((posts ?? []).map((p) => [p.id, p]));
  for (const e of [...plan.added, ...plan.changed, ...plan.removed]) {
    urls.add(e.path);
    switch (e.kind) {
      case 'blog':
        tags.add(`post-${e.id}`).add('blog-list').add('home');
        urls.add('/').add('/blog/');
        for (const c of byId[e.id]?.categories ?? []) { tags.add(`category-${c.slug}`); urls.add(`/category/${c.slug}/`); }
        break;
      case 'page': tags.add(`page-${e.id}`).add('home'); urls.add('/'); break;
      case 'document': tags.add('documents'); urls.add('/documents/'); break;
      case 'structured': tags.add(`structured-${e.id}`); break;
      case 'nav': purgeAll = true; break; // menu is in every page's header
    }
  }
  if (purgeAll) tags.add('*');
  const abs = (u) => config.publicUrl + u;
  return { purgeAll, urls: [...urls].sort().map(abs), tags: [...tags].sort() };
}

export function report({ startedAt, buildResult, fetchInfo, review } = {}) {
  ensureDirs();
  const plan = readJson(config.files.plan);
  const buildInfo = readJson(config.files.buildInfo, {});
  const ai = buildInfo.ai ?? { mode: 'skipped', totals: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, estimated: 0 }, calls: [] };
  const prevLatest = readJson(path.join(config.dirs.reports, 'latest.json'));
  const posts = readJson(path.join(config.dirs.build, 'posts.json'), []);
  buildResult ??= buildInfo.skipBuild ? { skipped: true } : readJson(path.join(config.dirs.content, 'build-result.json'), { skipped: true });

  const links = buildResult.skipped || !fs.existsSync(config.dirs.dist) ? null : checkLinks(config.dirs.dist);
  // size regressions: changed pages that grew > 50 % against the previous build
  const prevSizes = Object.fromEntries((prevLatest?.build?.pageList ?? []).map((p) => [p.path, p.bytes]));
  const regressions = (buildResult.pageList ?? []).filter((p) => prevSizes[p.path] && p.bytes > prevSizes[p.path] * 1.5).map((p) => ({ path: p.path, before: prevSizes[p.path], after: p.bytes }));

  // thin pages: content pages whose extracted text is tiny — usually a portlet that renders client-side or per-user
  const thinPages = readJson(path.join(config.dirs.build, 'pages.json'), []).filter((p) => p.text.length < 200).map((p) => ({ path: p.path, chars: p.text.length }));

  const r = {
    at: nowIso(), startedAt: startedAt ?? plan?.generatedAt, mode: plan?.mode, skipped: !!buildResult.skipped,
    fetch: fetchInfo ?? readJson(path.join(config.dirs.raw, 'fetch-info.json')),
    changes: { added: plan?.added ?? [], changed: plan?.changed ?? [], removed: plan?.removed ?? [], unchangedCount: plan?.unchangedCount ?? 0 },
    build: buildResult.skipped ? { skipped: true, pages: 0, seconds: 0, distBytes: 0 } : buildResult,
    links, regressions, thinPages,
    ai: { mode: ai.mode, totals: ai.totals, wouldUse: plan?.aiBudgetEstimate, calls: ai.calls?.length ?? 0, budget: ai.budget, budgetExceeded: ai.budgetExceeded, estimatedCostUsd: ai.estimatedCostUsd ?? 0, rules: ai.rules, enrichUnits: ai.enrichUnits, enrichCached: ai.enrichCached,
      callLog: (ai.calls ?? []).map((c) => ({ task: c.task, model: c.model, ...c.usage, estTokens: c.estTokens, skipped: c.skipped, error: c.error })) },
    review,
    purge: plan && !buildResult.skipped ? purgeList(plan, posts) : { purgeAll: false, urls: [], tags: [] },
  };

  const md = renderMarkdown(r);
  const stamp = r.at.replace(/[:.]/g, '-');
  fs.writeFileSync(path.join(config.dirs.reports, `${stamp}.md`), md);
  writeJson(path.join(config.dirs.reports, 'latest.json'), r);

  // Commit the delta cursor only now, after everything above succeeded.
  if (plan && !buildResult.skipped) {
    const state = readJson(config.files.state, { runCount: 0 });
    writeJson(config.files.state, { lastRun: r.fetch?.startedAt ?? r.startedAt, runCount: (state.runCount ?? 0) + 1, committedAt: r.at, items: plan.nextState.items });
  } else if (plan) {
    const state = readJson(config.files.state, { runCount: 0, items: {} });
    writeJson(config.files.state, { ...state, lastRun: r.fetch?.startedAt ?? state.lastRun, runCount: (state.runCount ?? 0) + 1 });
  }
  log(`report: reports/${stamp}.md`);
  return r;
}

function renderMarkdown(r) {
  const t = r.ai.totals;
  const list = (arr) => (arr.length ? arr.map((e) => `- ${e.kind} ${e.id} — ${e.title} → \`${e.path}\``).join('\n') : '_none_');
  return `# Regeneration report — ${r.at}

**Mode:** ${r.mode} · **Build:** ${r.skipped ? 'SKIPPED (no changes)' : `${r.build.pages} pages in ${r.build.seconds.toFixed(1)} s, dist ${fmtBytes(r.build.distBytes)}`}

## Changes
- added: ${r.changes.added.length} · changed: ${r.changes.changed.length} · removed: ${r.changes.removed.length} · unchanged: ${r.changes.unchangedCount}

### Added
${list(r.changes.added)}

### Changed
${list(r.changes.changed)}

### Removed
${list(r.changes.removed)}

## AI usage (mode: ${r.ai.mode})
| metric | tokens |
|---|---|
| fresh input | ${t.input} |
| cache read (prompt cache) | ${t.cacheRead} |
| cache write | ${t.cacheWrite} |
| output | ${t.output} |
| dry-run estimate | ${t.estimated} |

- would use without caches/fallbacks: ≈${r.ai.wouldUse?.estTokens ?? 0} tokens for ${r.ai.wouldUse?.freshUnits ?? 0} fresh unit(s), ${r.ai.wouldUse?.cachedUnits ?? 0} unit(s) already answered by the model cache
- calls: ${r.ai.calls} · budget: ${r.ai.budget ?? '-'}${r.ai.budgetExceeded ? ' **EXCEEDED — fallbacks used**' : ''} · est. cost: $${(r.ai.estimatedCostUsd ?? 0).toFixed(4)}
- extraction rules: ${JSON.stringify(r.ai.rules ?? {})}
- enrichment units: ${r.ai.enrichUnits ?? 0} (${r.ai.enrichCached ?? 0} served from content-hash cache)
${r.ai.callLog?.length ? '\n| task | model | in | cached | out | est |\n|---|---|---|---|---|---|\n' + r.ai.callLog.map((c) => `| ${c.task} | ${c.model} | ${c.input} | ${c.cacheRead} | ${c.output} | ${c.estTokens}${c.skipped ? ' (skipped: ' + c.skipped + ')' : ''}${c.error ? ' (error: ' + String(c.error).slice(0, 60) + ')' : ''} |`).join('\n') : ''}

## Quality
- broken internal links: ${r.links ? r.links.broken.length + ' of ' + r.links.checked + ' checked' : 'n/a'}
${r.links?.broken?.slice(0, 10).map((b) => `  - ${b.from} → ${b.href}`).join('\n') ?? ''}
- size regressions (>50 %): ${r.regressions.length}
- thin content pages (<200 chars, probably a client-side or per-user portlet): ${r.thinPages.map((p) => p.path).join(', ') || 'none'}
${r.review ? `- review: ${r.review.ok ? 'OK' : 'NEEDS ATTENTION'} — ${(r.review.notes ?? []).join('; ')}` : '- review: not requested (AI_REVIEW=0)'}

## CDN purge
- purge all: ${r.purge.purgeAll}
- tags: ${r.purge.tags.join(', ') || '_none_'}
- urls (${r.purge.urls.length}):
${r.purge.urls.map((u) => `  - ${u}`).join('\n')}
`;
}

if (import.meta.url === `file://${process.argv[1]}`) report(parseArgs());
