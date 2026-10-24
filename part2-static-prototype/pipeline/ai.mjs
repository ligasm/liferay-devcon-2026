#!/usr/bin/env node
// ai.mjs — THE ORCHESTRATOR. Reads content/plan.json and decides the cycle.
//
//   nothing changed  → "skip build", zero tokens, zero seconds of Astro
//   otherwise        → 1. extraction rules (model on first sight, cached forever)
//                      2. deterministic transforms  (pipeline/transforms/*)
//                      3. enrichment of items with missing fields (cheap model,
//                         batched, content-hash cached, hard token budget)
//                      4. write content/build/*.json for Astro + content/ai-log.json
//   post-build       → optional review gate (AI_REVIEW=1), see reviewBuild()
//
// The model is "in charge" of judgement calls; scripts do the bulk work.
import fs from 'node:fs';
import path from 'node:path';
import { config, ensureDirs } from './lib/config.mjs';
import { loadRaw, renderedFile, publicPath, contentHash, missingFields } from './lib/model.mjs';
import { readJson, writeJson, log, parseArgs, nowIso, slugify } from './lib/util.mjs';
import { initAi, askModel, ledger, aiMode, estimatedCostUsd } from './lib/ai-client.mjs';
import { RULE_SYSTEM, ENRICH_SYSTEM, REVIEW_SYSTEM } from './lib/prompts.mjs';
import { sanitizeHtml, textOf, rewriteHref, setKnownPaths } from './transforms/html-sanitize.mjs';
import { applyRule, skeleton, FALLBACK_RULE } from './transforms/rendered-page-extract.mjs';

const ruleFile = (key) => path.join(config.dirs.rules, `${key.replace(/[^a-z0-9_-]/gi, '_')}.json`);
const cacheFile = (hash) => path.join(config.dirs.aiCache, `${hash}.json`);

// ---------------------------------------------------------------------------
// (a) Extraction rules — one model call per master layout, ever.
// ---------------------------------------------------------------------------
async function resolveRule(unit) {
  const existing = readJson(ruleFile(unit.key));
  // A cached model-made rule is final. A cached *fallback* rule is retried once a key is present.
  if (existing && (existing.source === 'model' || aiMode() === 'off')) return existing;

  const sampleHtml = unit.sampleId && unit.key.startsWith('master:') ? fs.readFileSync(renderedFile(unit.sampleId), 'utf8') : null;
  let rule = null;
  if (sampleHtml) {
    const answer = await askModel({ task: `rule ${unit.key}`, tier: 'smart', system: RULE_SYSTEM, user: `Page skeleton:\n${skeleton(sampleHtml)}`, maxTokens: 400 });
    if (answer?.contentSelector) {
      const test = applyRule(sampleHtml, answer);
      if (test.text.length > 100) rule = { ...answer, source: 'model', model: config.aiModelSmart, createdAt: nowIso() };
      else log(`ai: rule for ${unit.key} rejected (extracted ${test.text.length} chars), using fallback`);
    }
  }
  rule ??= { ...FALLBACK_RULE, createdAt: nowIso() };
  writeJson(ruleFile(unit.key), rule);
  return rule;
}

// ---------------------------------------------------------------------------
// (b) Enrichment — only for items missing fields, batched, cached by hash.
// ---------------------------------------------------------------------------
const fallbackEnrichment = (post) => ({
  description: (post.text.slice(0, 157).replace(/\s+\S*$/, '') + (post.text.length > 157 ? '…' : '')) || post.title,
  seoTitle: post.title.slice(0, 60),
  readingMinutes: Math.max(1, Math.round(post.text.split(/\s+/).length / 200)),
  suggestedCategory: 'Other',
  source: 'fallback',
});

// `units` = what the plan says may need ASKING (changed posts only). Applying
// answers happens for every post, from the content-hash cache: an unchanged
// post keeps its (already paid for) answer forever.
async function enrich(units, posts, rawById) {
  const postsById = Object.fromEntries(posts.map((p) => [p.id, p]));
  // Ask only for units without a model answer on disk. Fallback answers are
  // cached too (so --no-ai runs are stable) but get upgraded once a key exists.
  const fresh = aiMode() === 'off' ? units.filter((u) => !fs.existsSync(cacheFile(u.hash))) : units.filter((u) => readJson(cacheFile(u.hash))?.source !== 'ai');
  for (let i = 0; i < fresh.length; i += config.aiBatchSize) {
    const batch = fresh.slice(i, i + config.aiBatchSize);
    const payload = batch.map((u) => ({ id: u.id, headline: postsById[u.id].title, text: postsById[u.id].text.slice(0, 1500) }));
    const answer = await askModel({ task: `enrich ${batch.length} posts`, tier: 'cheap', system: ENRICH_SYSTEM, user: JSON.stringify(payload), maxTokens: 120 * batch.length + 50 });
    for (const u of batch) {
      const a = Array.isArray(answer) ? answer.find((x) => x.id === u.id) : null;
      const result = a ? { ...a, source: 'ai', model: config.aiModelCheap } : fallbackEnrichment(postsById[u.id]);
      // Fallbacks are cached too, but flagged so a later live run can upgrade them.
      writeJson(cacheFile(u.hash), { ...result, createdAt: nowIso() });
    }
  }
  for (const post of posts) {
    const missing = missingFields(rawById[post.id]);
    if (!missing.length) continue;
    const c = readJson(cacheFile(post.hash)) ?? fallbackEnrichment(post);
    for (const f of missing) {
      if (f === 'description') { post.description = c.description; post.descriptionSource = c.source; }
      if (f === 'seoTitle') post.seoTitle = c.seoTitle;
      if (f === 'suggestedCategory' && !post.categories.length) post.categories = [{ name: c.suggestedCategory, slug: slugify(c.suggestedCategory), suggested: true }];
    }
    post.readingMinutes = c.readingMinutes ?? post.readingMinutes;
  }
}

// ---------------------------------------------------------------------------
// Deterministic transforms → content/build/*.json
// ---------------------------------------------------------------------------
function transformBlog(raw) {
  const html = sanitizeHtml(raw.articleBody ?? '');
  const text = textOf(html);
  const categories = (raw.taxonomyCategoryBriefs ?? []).map((c) => ({ name: c.taxonomyCategoryName, slug: slugify(c.taxonomyCategoryName) }));
  return {
    id: raw.id, slug: slugify(raw.friendlyUrlPath || raw.id), path: publicPath('blog', raw), hash: contentHash('blog', raw),
    title: raw.headline, seoTitle: raw.alternativeHeadline || raw.headline, description: raw.description?.trim() || '',
    descriptionSource: raw.description?.trim() ? 'portal' : 'missing',
    html, text, author: raw.creator?.name ?? '', datePublished: raw.datePublished, dateModified: raw.dateModified,
    categories, keywords: raw.keywords ?? [], image: raw.image?.contentUrl ? rewriteHref(raw.image.contentUrl) : null,
    readingMinutes: Math.max(1, Math.round(text.split(/\s+/).length / 200)), numberOfComments: raw.numberOfComments ?? 0,
    portalUrl: `${config.liferayUrl}/blogs/-/blogs/${raw.friendlyUrlPath}`,
  };
}

function transformPage(raw, rules) {
  const key = `master:${raw.renderedPage?.masterPageId ?? 'default'}`;
  const rule = rules[key] ?? readJson(ruleFile(key)) ?? FALLBACK_RULE;
  const html = fs.existsSync(renderedFile(raw.id)) ? fs.readFileSync(renderedFile(raw.id), 'utf8') : '';
  const extracted = html ? applyRule(html, rule) : { title: raw.title, html: '', text: '' };
  return {
    id: raw.id, slug: slugify(raw.friendlyUrlPath.replace(/^\//, '')), path: publicPath('page', raw), hash: contentHash('page', raw),
    title: extracted.title || raw.title, html: extracted.html, text: extracted.text, dateModified: raw.dateModified,
    master: raw.renderedPage?.masterPageId ?? null, ruleKey: key, ruleSource: rule.source, hidden: !!raw.pageSettings?.hiddenFromNavigation,
    portalUrl: `${config.liferayUrl}${raw.friendlyUrlPath}`, seoDescription: raw.pageSettings?.seoSettings?.description || extracted.text.slice(0, 160),
  };
}

const transformDocument = (raw) => ({
  id: raw.id, title: raw.title, description: raw.description ?? '', ext: raw.fileExtension, size: raw.sizeInBytes, dateModified: raw.dateModified,
  url: rewriteHref(raw.contentUrl), mime: raw.encodingFormat,
  thumb: rewriteHref(raw.adaptedImages?.find((a) => /thumb/i.test(a.resolutionName))?.contentUrl ?? ''),
  preview: rewriteHref(raw.adaptedImages?.find((a) => /preview/i.test(a.resolutionName))?.contentUrl ?? ''),
});

// Structured contents (web content articles) → generic field list, template by structure id.
const transformStructured = (raw) => ({
  id: raw.id, slug: slugify(raw.friendlyUrlPath || raw.id), path: publicPath('structured', raw), hash: contentHash('structured', raw),
  title: raw.title, description: raw.description ?? '', dateModified: raw.dateModified, structureId: raw.contentStructureId,
  template: `structure-${raw.contentStructureId}`, portalUrl: `${config.liferayUrl}/w/${raw.friendlyUrlPath ?? ''}`,
  fields: (raw.contentFields ?? []).map((f) => ({ name: f.name, label: f.label, type: f.dataType, value: f.contentFieldValue?.data ?? '', html: f.dataType === 'html' ? sanitizeHtml(f.contentFieldValue?.data ?? '') : null })),
});

function transformNav(menus, knownPaths, pages) {
  const byUuid = new Map(pages.map((p) => [p.uuid, p]));
  const byTitle = new Map(pages.map((p) => [String(p.title).toLowerCase(), p]));
  const toLink = (item) => {
    const label = item.name ?? item.typeSettings?.title ?? item.typeSettings?.name_en_US ?? '';
    let href = null, external = false;
    if (item.type === 'layout') {
      const page = byUuid.get(item.typeSettings?.layoutUuid) ?? byTitle.get(label.toLowerCase());
      href = page ? publicPath('page', page) : null;
    } else if (item.type === 'url') {
      const url = item.typeSettings?.url ?? '';
      href = rewriteHref(url);
      if (href?.startsWith('/') && !knownPaths.has(href)) { href = `${config.liferayUrl}${url}`; } // not generated statically → portal
      external = /^https?:\/\//.test(href);
    }
    const children = (item.navigationMenuItems ?? []).map(toLink).filter(Boolean);
    if (!label || (!href && !children.length)) return null; // null-name items with no target are dropped
    return { label, href: href ?? '#', external, newTab: item.typeSettings?.useNewTab === 'true', children };
  };
  const out = {};
  for (const m of menus) out[m.name] = (m.navigationMenuItems ?? []).map(toLink).filter(Boolean);
  return out;
}

// ---------------------------------------------------------------------------
export async function orchestrate(flags = {}) {
  ensureDirs();
  const plan = readJson(config.files.plan);
  if (!plan) throw new Error('no plan.json — run plan.mjs first');
  const t0 = Date.now();

  if (!plan.hasChanges && !flags.full && !flags.force) {
    log('ai: nothing changed → skip build (0 tokens)');
    writeJson(config.files.buildInfo, { skipBuild: true, reason: 'no changes', at: nowIso(), ai: { mode: 'skipped', totals: ledger.totals, calls: [] } });
    return { skipBuild: true };
  }

  await initAi(flags);

  // 1. rules first: transforms depend on them
  const rules = {};
  for (const u of plan.workUnits.filter((w) => w.type === 'rule')) rules[u.key] = await resolveRule(u);

  // 2. deterministic transforms. Link rewriting needs to know which paths will
  //    exist, so compute the URL universe from raw first (pure function of ids).
  const rawPages = loadRaw('page'), rawBlogs = loadRaw('blog'), rawStructured = loadRaw('structured');
  const knownPaths = new Set(['/', '/blog/', '/documents/', ...rawPages.map((p) => publicPath('page', p)), ...rawBlogs.map((b) => publicPath('blog', b)), ...rawStructured.map((s) => publicPath('structured', s))]);
  rawBlogs.forEach((b) => (b.taxonomyCategoryBriefs ?? []).forEach((c) => knownPaths.add(`/category/${slugify(c.taxonomyCategoryName)}/`)));
  setKnownPaths(knownPaths);
  const pages = rawPages.map((p) => transformPage(p, rules)).sort((a, b) => a.path.localeCompare(b.path));
  const posts = rawBlogs.map(transformBlog).sort((a, b) => (b.datePublished > a.datePublished ? 1 : -1));
  const documents = loadRaw('document').map(transformDocument).sort((a, b) => (b.dateModified > a.dateModified ? 1 : -1));
  const structured = rawStructured.map(transformStructured);
  const nav = transformNav(loadRaw('nav'), knownPaths, rawPages);

  // 3. enrichment (only the units the plan flagged)
  const rawById = Object.fromEntries(rawBlogs.map((b) => [b.id, b]));
  const enrichUnits = plan.workUnits.filter((w) => w.type === 'enrich' && rawById[w.id]);
  await enrich(enrichUnits, posts, rawById);
  for (const p of posts) if (!p.description) Object.assign(p, { description: fallbackEnrichment(p).description, descriptionSource: 'fallback' });

  // 4. write build inputs
  const categories = {};
  for (const p of posts) for (const c of p.categories) (categories[c.slug] ??= { name: c.name, slug: c.slug, count: 0 }).count++;
  const site = { name: config.liferayUrl.replace(/^https?:\/\//, ''), liferayUrl: config.liferayUrl, publicUrl: config.publicUrl, generatedAt: nowIso(),
    siteMenuName: config.siteMenuName, nav, counts: { posts: posts.length, pages: pages.length, documents: documents.length, structured: structured.length } };
  writeJson(path.join(config.dirs.build, 'site.json'), site);
  writeJson(path.join(config.dirs.build, 'posts.json'), posts);
  writeJson(path.join(config.dirs.build, 'pages.json'), pages);
  writeJson(path.join(config.dirs.build, 'documents.json'), documents);
  writeJson(path.join(config.dirs.build, 'structured.json'), structured);
  writeJson(path.join(config.dirs.build, 'categories.json'), Object.values(categories).sort((a, b) => b.count - a.count));

  const ai = { mode: ledger.mode, totals: ledger.totals, calls: ledger.calls, budget: ledger.budget, budgetExceeded: ledger.budgetExceeded, estimatedCostUsd: estimatedCostUsd(),
    rules: Object.fromEntries(Object.entries(rules).map(([k, r]) => [k, r.source])), enrichUnits: enrichUnits.length, enrichCached: enrichUnits.filter((u) => u.cached).length };
  writeJson(config.files.aiLog, ai);
  writeJson(config.files.buildInfo, { skipBuild: false, at: nowIso(), orchestrateMs: Date.now() - t0, ai });
  log(`ai: orchestrated in ${Date.now() - t0}ms · mode=${ledger.mode} · tokens in=${ledger.totals.input} cached=${ledger.totals.cacheRead} out=${ledger.totals.output} est=${ledger.totals.estimated}`);
  return { skipBuild: false, ai };
}

// (c) Post-build review gate — called by regenerate.mjs when AI_REVIEW=1.
export async function reviewBuild(report) {
  if (!config.aiReview) return null;
  const slim = { added: report.changes.added.length, changed: report.changes.changed.length, removed: report.changes.removed.length,
    pagesBuilt: report.build.pages, buildSeconds: report.build.seconds, distBytes: report.build.distBytes, prevDistBytes: report.build.prevDistBytes,
    brokenLinks: report.links?.broken?.slice(0, 20) ?? [], purge: report.purge.urls.slice(0, 20) };
  const answer = await askModel({ task: 'review build', tier: 'cheap', system: REVIEW_SYSTEM, user: JSON.stringify(slim), maxTokens: 300 });
  // Deterministic gate when the model is unavailable: same thresholds as the prompt.
  return answer ?? { ok: !(report.build.pages === 0 || (report.links?.broken?.length ?? 0) > 0), notes: ['deterministic review (model not consulted)'], source: 'fallback' };
}

if (import.meta.url === `file://${process.argv[1]}`) orchestrate(parseArgs()).catch((e) => { console.error(e); process.exit(1); });
