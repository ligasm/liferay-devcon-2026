// node --test pipeline/lib/config.test.mjs
// config.mjs reads the env file when it is imported, so each case runs it in a fresh process.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CONFIG_URL = new URL('./config.mjs', import.meta.url).href;

function load(envText) {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'config-test-')), 'test.env');
  fs.writeFileSync(file, envText);
  const script = `import(${JSON.stringify(CONFIG_URL)}).then(({ config }) => console.log(JSON.stringify(config)));`;
  const env = { ...process.env, ENV_FILE: file };
  for (const k of envText.matchAll(/^\s*([A-Z0-9_]+)\s*=/gim)) delete env[k[1]];
  const r = spawnSync(process.execPath, ['-e', script], { env, encoding: 'utf8' });
  return { status: r.status, stderr: r.stderr, config: r.status === 0 ? JSON.parse(r.stdout) : null };
}

test('.env.example loads with its inline comments removed', () => {
  const { config } = load(fs.readFileSync(path.join(ROOT, '.env.example'), 'utf8'));
  assert.equal(config.maxItems, 80);
  assert.equal(config.fullRelistEvery, 8);
  assert.equal(config.aiBudgetTokens, 20000);
  assert.equal(config.aiBatchSize, 8);
  assert.equal(config.authMode, 'none');
  assert.equal(config.siteMenuName, 'Site Menu');
  assert.equal(config.assetOrigin, 'https://liferay.dev');
  assert.equal(config.aiModelCheap, 'claude-haiku-4-5');
  assert.equal(config.deployCmd, '');
  assert.equal(config.purgeCmd, '');
  assert.equal(config.oauthClientId, '');
});

test('a # is a comment only after whitespace', () => {
  const { config } = load('PAGE_CONTENT_SELECTOR=#main\nPUBLIC_URL=https://x.example/a#b\nSITE_NAME=My Site # the label\n');
  assert.equal(config.pageContentSelector, '#main');
  assert.equal(config.publicUrl, 'https://x.example/a#b');
  assert.equal(config.siteName, 'My Site');
});

test('quotes protect a # and may be followed by a comment', () => {
  const { config } = load(`PAGE_CONTENT_SELECTOR="main #content" # region\nSITE_NAME='A # B'\r\nSITE_MENU_NAME="Menu"\n`);
  assert.equal(config.pageContentSelector, 'main #content');
  assert.equal(config.siteName, 'A # B');
  assert.equal(config.siteMenuName, 'Menu');
});

test('a number that does not parse stops the run instead of becoming NaN', () => {
  const { status, stderr } = load('MAX_ITEMS=80x\n');
  assert.notEqual(status, 0);
  assert.match(stderr, /MAX_ITEMS/);
});
