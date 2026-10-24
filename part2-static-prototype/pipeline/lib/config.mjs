// Single place where every knob lives. Everything is an env var so the speaker
// can point the whole pipeline at their own DXP by editing .env only.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// Tiny .env loader (no dependency): KEY=value lines, '#' comments, no expansion.
function loadDotEnv(file = path.join(ROOT, '.env')) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
loadDotEnv();

const env = (k, d) => (process.env[k] === undefined || process.env[k] === '' ? d : process.env[k]);
const num = (k, d) => Number(env(k, d));
const bool = (k, d = false) => ['1', 'true', 'yes'].includes(String(env(k, d)).toLowerCase());

export const config = {
  // --- Liferay source -------------------------------------------------------
  liferayUrl: env('LIFERAY_URL', 'https://liferay.dev').replace(/\/$/, ''),
  siteId: env('LIFERAY_SITE_ID', '14'),
  // none | basic | oauth2  (oauth2 = client-credentials against /o/oauth2/token)
  authMode: env('LIFERAY_AUTH', 'none'),
  basicUser: env('LIFERAY_USER', ''),
  basicPassword: env('LIFERAY_PASSWORD', ''),
  oauthClientId: env('LIFERAY_OAUTH_CLIENT_ID', ''),
  oauthClientSecret: env('LIFERAY_OAUTH_CLIENT_SECRET', ''),
  userAgent: env('USER_AGENT', 'Mozilla/5.0 (X11; Linux x86_64) devcon2026-static-prototype/0.1'),
  siteMenuName: env('SITE_MENU_NAME', 'Site Menu'),
  homePagePath: env('HOME_PAGE_PATH', '/home'), // the site page that becomes '/'
  // Where /documents/... image URLs should point in the static site.
  // Default: the portal itself (images stay on Liferay/CDN). Set to '' to keep relative.
  assetOrigin: env('ASSET_ORIGIN', env('LIFERAY_URL', 'https://liferay.dev')).replace(/\/$/, ''),
  // The public origin of the static site (used for canonical URLs and purge lists)
  publicUrl: env('PUBLIC_URL', 'https://static.example.com').replace(/\/$/, ''),

  // --- Fetch behaviour ------------------------------------------------------
  maxItems: num('MAX_ITEMS', 80), // demo cap; --full-catalog to lift
  pageSize: num('PAGE_SIZE', 50),
  concurrency: num('FETCH_CONCURRENCY', 4),
  retries: num('FETCH_RETRIES', 3),
  // every N runs re-list all ids (cheap, fields=id) to detect deletions
  fullRelistEvery: num('FULL_RELIST_EVERY', 8),
  fetchRenderedPages: bool('FETCH_RENDERED_PAGES', true),
  // Pages that only host dynamic portlets (search, forms) and make no sense as static HTML.
  skipPages: env('SKIP_PAGES', '/blogs,/search,/vulnerabilities').split(',').map((s) => s.trim()).filter(Boolean),

  // --- AI orchestration -----------------------------------------------------
  // NOTE for the speaker: confirm the current model IDs before the talk.
  aiModelCheap: env('AI_MODEL_CHEAP', 'claude-haiku-4-5'),
  aiModelSmart: env('AI_MODEL_SMART', 'claude-sonnet-4-5'),
  aiBudgetTokens: num('AI_BUDGET_TOKENS', 20000), // hard per-cycle ceiling (input+output)
  aiBatchSize: num('AI_BATCH_SIZE', 8), // items per enrichment call
  aiReview: bool('AI_REVIEW', false), // post-build review is opt-in
  anthropicApiKey: env('ANTHROPIC_API_KEY', ''),
  // USD per million tokens, for the cost estimate in the report (edit to taste)
  price: {
    cheap: { input: num('PRICE_CHEAP_IN', 1), output: num('PRICE_CHEAP_OUT', 5), cacheRead: num('PRICE_CHEAP_CACHE', 0.1) },
    smart: { input: num('PRICE_SMART_IN', 3), output: num('PRICE_SMART_OUT', 15), cacheRead: num('PRICE_SMART_CACHE', 0.3) },
  },

  // --- Deploy / purge / webhook -----------------------------------------------
  deployCmd: env('DEPLOY_CMD', ''),
  purgeCmd: env('PURGE_CMD', ''),
  webhookPort: num('WEBHOOK_PORT', 8787),
  webhookSecret: env('WEBHOOK_SECRET', ''),
  webhookDebounceMs: num('WEBHOOK_DEBOUNCE_MS', 20000),

  // --- Paths ----------------------------------------------------------------
  dirs: {
    raw: path.join(ROOT, 'content', 'raw'),
    build: path.join(ROOT, 'content', 'build'),
    rules: path.join(ROOT, 'content', 'rules'),
    aiCache: path.join(ROOT, 'content', 'ai-cache'),
    reports: path.join(ROOT, 'reports'),
    site: path.join(ROOT, 'site'),
    dist: path.join(ROOT, 'dist'),
  },
  files: {
    state: path.join(ROOT, 'content', 'state.json'),
    plan: path.join(ROOT, 'content', 'plan.json'),
    aiLog: path.join(ROOT, 'content', 'ai-log.json'),
    buildInfo: path.join(ROOT, 'content', 'build-info.json'),
  },
};

export function ensureDirs() {
  for (const d of Object.values(config.dirs)) if (!d.endsWith('dist') && !d.endsWith('site')) fs.mkdirSync(d, { recursive: true });
}
