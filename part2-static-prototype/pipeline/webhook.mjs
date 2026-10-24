#!/usr/bin/env node
// webhook.mjs — POST /hooks/liferay (header X-Webhook-Secret) → debounced regenerate.
// Liferay Object Actions / workflow notifications can hit this; several edits in
// a row collapse into ONE cycle thanks to the debounce.  GET /healthz for probes.
import http from 'node:http';
import { config } from './lib/config.mjs';
import { log } from './lib/util.mjs';
import { regenerate } from './regenerate.mjs';

let timer = null, running = false, queued = false, last = null;

async function runOnce() {
  if (running) { queued = true; return; }
  running = true;
  try { last = { at: new Date().toISOString(), ok: true, summary: await regenerate({}) }; }
  catch (e) { last = { at: new Date().toISOString(), ok: false, error: e.message }; log('webhook: cycle failed', e.message); }
  running = false;
  if (queued) { queued = false; schedule(); }
}
const schedule = () => { clearTimeout(timer); timer = setTimeout(runOnce, config.webhookDebounceMs); };

http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, running, lastCycle: last && { at: last.at, ok: last.ok, skipped: last.summary?.skipped, pages: last.summary?.build?.pages } }));
  }
  if (req.method === 'POST' && req.url === '/hooks/liferay') {
    if (config.webhookSecret && req.headers['x-webhook-secret'] !== config.webhookSecret) { res.writeHead(401); return res.end('bad secret'); }
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 1e6) req.destroy(); });
    req.on('end', () => {
      log(`webhook: event received (${body.length} bytes) → regenerate in ${config.webhookDebounceMs}ms`);
      schedule();
      res.writeHead(202, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ accepted: true, debounceMs: config.webhookDebounceMs }));
    });
    return;
  }
  res.writeHead(404); res.end();
}).listen(config.webhookPort, () => log(`webhook: listening on :${config.webhookPort} (POST /hooks/liferay, GET /healthz)`));
