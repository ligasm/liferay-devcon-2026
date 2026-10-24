// Thin Headless Delivery client: auth (none | basic | oauth2), retries with
// backoff, and a paginator. Uses Node 22's built-in fetch.
import { config } from './config.mjs';
import { log } from './util.mjs';

const API = `${config.liferayUrl}/o/headless-delivery/v1.0`;
export const siteApi = (p) => `${API}/sites/${config.siteId}${p}`;

let oauthToken = null;
async function authHeader() {
  if (config.authMode === 'basic') {
    return { Authorization: 'Basic ' + Buffer.from(`${config.basicUser}:${config.basicPassword}`).toString('base64') };
  }
  if (config.authMode === 'oauth2') {
    if (!oauthToken || oauthToken.exp < Date.now()) {
      const r = await fetch(`${config.liferayUrl}/o/oauth2/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: config.oauthClientId,
          client_secret: config.oauthClientSecret,
        }),
      });
      if (!r.ok) throw new Error(`OAuth2 token request failed: ${r.status}`);
      const j = await r.json();
      oauthToken = { value: j.access_token, exp: Date.now() + (j.expires_in - 30) * 1000 };
    }
    return { Authorization: `Bearer ${oauthToken.value}` };
  }
  return {};
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function request(url, { accept = 'application/json', retries = config.retries } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      const r = await fetch(url, {
        headers: { Accept: accept, 'User-Agent': config.userAgent, ...(await authHeader()) },
        signal: AbortSignal.timeout(30000),
      });
      if (r.status === 429 || r.status >= 500) throw new Error(`HTTP ${r.status}`);
      if (!r.ok) throw Object.assign(new Error(`HTTP ${r.status} for ${url}`), { fatal: true });
      return accept === 'application/json' ? r.json() : r.text();
    } catch (e) {
      if (e.fatal || attempt >= retries) throw e;
      const wait = 500 * 2 ** attempt;
      log(`retry ${attempt + 1}/${retries} in ${wait}ms: ${e.message}`);
      await sleep(wait);
    }
  }
}

// Walks a paged collection until `max` items or the last page.
export async function listAll(pathWithQuery, { max = Infinity, pageSize = config.pageSize, retries = config.retries } = {}) {
  const items = [];
  for (let page = 1; ; page++) {
    const sep = pathWithQuery.includes('?') ? '&' : '?';
    const j = await request(siteApi(`${pathWithQuery}${sep}pageSize=${pageSize}&page=${page}`), { retries });
    items.push(...(j.items ?? []));
    if (items.length >= max || page >= (j.lastPage ?? 1) || !(j.items ?? []).length) {
      return { items: items.slice(0, max), totalCount: j.totalCount ?? items.length };
    }
  }
}
