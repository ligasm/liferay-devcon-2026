#!/usr/bin/env node
// fetch.mjs — pull content from Liferay Headless Delivery into content/raw/.
//
// Why a raw mirror on disk?  Because every later stage (plan, ai, build) can then
// run offline and deterministically, and "what changed" is a pure file diff.
//
// Modes:
//   --full        ignore state, re-fetch everything (up to MAX_ITEMS)
//   default       delta: filter=dateModified gt <lastRun>, plus a cheap id re-list
//                 every FULL_RELIST_EVERY runs (or --relist) to catch deletions
//   --max-items N demo cap
import fs from 'node:fs';
import path from 'node:path';
import { config, ensureDirs } from './lib/config.mjs';
import { request, listAll, siteApi } from './lib/liferay.mjs';
import { KINDS, rawDir, rawFile, renderedFile, loadRaw } from './lib/model.mjs';
import { readJson, writeJson, log, pLimit, parseArgs, nowIso } from './lib/util.mjs';

const BLOG_FIELDS = 'id,headline,alternativeHeadline,description,articleBody,friendlyUrlPath,dateModified,datePublished,creator.name,image,taxonomyCategoryBriefs,keywords,numberOfComments';
const DOC_FIELDS = 'id,title,description,contentUrl,adaptedImages,fileExtension,encodingFormat,sizeInBytes,dateModified,friendlyUrlPath,creator.name';

function saveRaw(kind, item) {
  const { actions, ...rest } = item; // HATEOAS noise, never needed
  writeJson(rawFile(kind, item.id), rest);
}

// OData filter for delta mode. Liferay wants an ISO timestamp without millis.
const sinceFilter = (iso) => `filter=${encodeURIComponent(`dateModified gt ${iso.replace(/\.\d+Z$/, 'Z')}`)}`;

async function fetchCollection(kind, endpoint, fields, { since, max }) {
  const q = [`sort=dateModified:desc`, fields ? `fields=${fields}` : '', since ? sinceFilter(since) : ''].filter(Boolean).join('&');
  const { items, totalCount } = await listAll(`${endpoint}${endpoint.includes('?') ? '&' : '?'}${q}`, { max });
  items.forEach((i) => saveRaw(kind, i));
  log(`${kind}: fetched ${items.length} (site has ${totalCount})${since ? ' since ' + since : ''}`);
  return items;
}

// Deletion detection without re-downloading bodies: page through `fields=id`
// (sorted by dateModified desc) until we have seen every id we know about.
async function relistIds(endpoint, knownIds) {
  const seen = new Set();
  const pending = new Set(knownIds);
  for (let page = 1; pending.size && page <= 200; page++) {
    const j = await request(siteApi(`${endpoint}${endpoint.includes('?') ? '&' : '?'}fields=id&sort=dateModified:desc&pageSize=100&page=${page}`));
    for (const i of j.items ?? []) { seen.add(i.id); pending.delete(i.id); }
    if (page >= (j.lastPage ?? 1)) break;
  }
  return { seen, missing: [...pending] };
}

function removeRaw(kind, id) {
  fs.rmSync(rawFile(kind, id), { force: true });
  if (kind === 'page') fs.rmSync(renderedFile(id), { force: true });
  log(`${kind}: ${id} deleted upstream, removed from raw`);
}

// GET /site-pages answered HTTP 500 on liferay.dev on 2026-09-18 while every
// single-page endpoint worked. Real feeds break; the pipeline degrades instead
// of failing: refresh each page we already know (raw mirror + content/seed).
async function listSitePagesResilient() {
  try {
    return (await listAll('/site-pages', { max: config.maxItems, retries: 1 })).items; // fail fast, we have a fallback
  } catch (e) {
    log(`page: listing failed (${e.message}) → refreshing known pages one by one`);
    const seed = readJson(path.join(config.dirs.content, 'seed', 'site-pages.json'), { items: [] }).items;
    const paths = new Set([...loadRaw('page'), ...seed].map((p) => p.friendlyUrlPath));
    const limit = pLimit(config.concurrency);
    const items = await Promise.all([...paths].map((p) => limit(() => request(siteApi(`/site-pages${p}`)).catch((err) => (log(`page: ${p} → ${err.message}`), null)))));
    // /security aliases /vulnerabilities on liferay.dev: dedupe by id
    return [...new Map(items.filter(Boolean).map((p) => [p.id, p])).values()];
  }
}

async function fetchSitePages({ full }) {
  // Always re-list (one request), but only download the rendered HTML
  // (~120 kB each) when dateModified moved or we lack a copy.
  const items = (await listSitePagesResilient()).filter((p) => !config.skipPages.includes(p.friendlyUrlPath));
  const known = new Map(loadRaw('page').map((p) => [p.id, p]));
  const limit = pLimit(config.concurrency);
  let rendered = 0;
  await Promise.all(items.map((p) => limit(async () => {
    const prev = known.get(p.id);
    const stale = full || !prev || prev.dateModified !== p.dateModified || !fs.existsSync(renderedFile(p.id));
    if (stale && config.fetchRenderedPages) {
      // renderedPageURL is the documented .../site-pages/{friendlyUrlPath}/rendered-page; build it ourselves if the listing omits it
      const html = await request(p.renderedPage?.renderedPageURL ?? siteApi(`/site-pages${p.friendlyUrlPath}/rendered-page`), { accept: 'text/html' });
      fs.writeFileSync(renderedFile(p.id), html);
      rendered++;
    }
    saveRaw('page', p);
    known.delete(p.id);
  })));
  for (const id of known.keys()) removeRaw('page', id); // no longer listed → deleted
  log(`page: listed ${items.length}, downloaded ${rendered} rendered page(s)`);
}

// headless-delivery's /navigation-menus is deprecated from 2026.Q1 (moved to headless-admin-site);
// Learn says existing integrations keep working.
async function fetchNavMenus() {
  const { items } = await listAll('/navigation-menus');
  const known = new Set(loadRaw('nav').map((n) => n.id));
  items.forEach((n) => { saveRaw('nav', n); known.delete(n.id); });
  known.forEach((id) => removeRaw('nav', id));
  log(`nav: ${items.length} menus`);
}

export async function fetchAll(flags = {}) {
  ensureDirs();
  KINDS.forEach((k) => fs.mkdirSync(rawDir(k), { recursive: true }));
  const state = readJson(config.files.state, { lastRun: null, runCount: 0, items: {} });
  const full = !!flags.full || !state.lastRun;
  const since = full ? null : new Date(Date.parse(state.lastRun) - config.deltaOverlapMs).toISOString();
  const max = Number(flags['max-items'] ?? config.maxItems);
  if (Number.isNaN(max)) throw new Error(`--max-items must be a number, got "${flags['max-items']}"`);
  const startedAt = nowIso();
  const t0 = Date.now();

  await fetchCollection('blog', '/blog-postings', BLOG_FIELDS, { since, max });
  await fetchCollection('document', '/documents', DOC_FIELDS, { since, max });
  // structured-contents: 0 on liferay.dev, but the speaker's DXP will have them.
  // flat: also list web content inside folders, which the same-look build renders.
  const structured = flags.flat ? '/structured-contents?flatten=true' : '/structured-contents';
  await fetchCollection('structured', structured, '', { since, max }).catch((e) => log('structured: skipped:', e.message));
  await fetchSitePages({ full });
  await fetchNavMenus();

  // Deletion sweep for the large collections.
  const relist = full || flags.relist || (state.runCount + 1) % config.fullRelistEvery === 0;
  if (relist) {
    for (const [kind, endpoint] of [['blog', '/blog-postings'], ['document', '/documents'], ['structured', structured]]) {
      const knownIds = loadRaw(kind).map((i) => i.id);
      if (!knownIds.length) continue;
      const { missing } = await relistIds(endpoint, knownIds).catch(() => ({ missing: [] }));
      missing.forEach((id) => removeRaw(kind, id));
      log(`${kind}: deletion sweep, ${missing.length} removed`);
    }
  }

  // Trim the raw mirror to the demo cap (keep newest) so a delta run cannot grow it forever.
  for (const kind of ['blog', 'document']) {
    const all = loadRaw(kind).sort((a, b) => (b.dateModified > a.dateModified ? 1 : -1));
    all.slice(max).forEach((i) => fs.rmSync(rawFile(kind, i.id), { force: true }));
  }

  writeJson(path.join(config.dirs.raw, 'fetch-info.json'), { startedAt, full, since, max, relist, ms: Date.now() - t0 });
  log(`fetch done in ${((Date.now() - t0) / 1000).toFixed(1)}s (mode=${full ? 'full' : 'delta'})`);
  return { startedAt, full };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  fetchAll(parseArgs()).catch((e) => { console.error(e); process.exit(1); });
}
