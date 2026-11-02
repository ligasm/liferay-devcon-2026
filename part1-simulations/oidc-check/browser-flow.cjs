// Real browser sign-ins for the OIDC check. Writes one Cookie header per login to $OIDC_OUT and prints
// what the browser saw. Needs Keycloak and the two .config files from this directory; see README.md.
//
//   set -a; . ./.env; set +a
//   NODE_PATH=<dir holding playwright> [CHROME_PATH=/usr/bin/chromium] OIDC_OUT=/tmp/oidc-check node browser-flow.cjs
const fs = require('fs');
const { chromium } = require('playwright');

for (const k of ['OIDC_USER_PASSWORD', 'LIFERAY_USER', 'LIFERAY_PASSWORD']) {
  if (!process.env[k]) throw new Error(`${k} is not set: load .env first`);
}

(async () => {
  const OUT = process.env.OIDC_OUT || '/tmp/oidc-check';
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });

  const who = (p) => p.evaluate(() => ({
    signedIn: Liferay.ThemeDisplay.isSignedIn(),
    userId: Liferay.ThemeDisplay.getUserId(),
    name: Liferay.ThemeDisplay.getUserName(),
  }));

  async function open(base) {
    const ctx = await browser.newContext();
    const p = await ctx.newPage();
    const setCookie = new Set();
    p.on('response', async (r) => {
      if (!r.url().startsWith(base)) return;
      for (const h of await r.headersArray().catch(() => [])) {
        if (h.name.toLowerCase() === 'set-cookie') setCookie.add(h.value.split('=')[0]);
      }
    });
    return { ctx, p, setCookie };
  }

  async function close({ ctx, setCookie }, tag, extra) {
    const host = (await ctx.cookies()).filter((c) => c.domain === '127.0.0.1');
    fs.writeFileSync(`${OUT}/${tag}.cookie`, host.map((c) => `${c.name}=${c.value}`).join('; ') + '\n');
    await ctx.close();
    return { tag, ...extra, setCookieSeen: [...setCookie].sort(), cookiesHeld: host.map((c) => c.name).sort() };
  }

  async function sso(base, tag) {
    const s = await open(base);
    const { p } = s;
    await p.goto(`${base}/c/portal/login`);
    await p.goto(await p.locator('a[href*="openid_connect_request"]').first().getAttribute('href'));
    await p.locator('form[action*="openid_connect_request"] button[type=submit]').first().click();
    await p.waitForSelector('#username', { timeout: 20000 });
    await p.fill('#username', 'sso.canary');
    await p.fill('#password', process.env.OIDC_USER_PASSWORD);
    await p.click('#kc-login');
    await p.waitForURL((u) => u.toString().startsWith(base), { timeout: 30000 });
    await p.waitForLoadState('load');
    const afterLogin = await who(p);
    await p.goto(`${base}/web/proventeq/home`);
    const publicPage = await who(p);
    await p.goto(`${base}/group/guest/~/control_panel/manage`);
    const groupPage = await who(p);
    return close(s, tag, { afterLogin, publicPage, groupPage });
  }

  async function password(base, tag) {
    const s = await open(base);
    const { p } = s;
    await p.goto(`${base}/c/portal/login`);
    const pw = p.locator('input[type=password]').first();
    const form = pw.locator('xpath=ancestor::form');
    await form.locator('input[name$="_login"]').fill(process.env.LIFERAY_USER);
    await pw.fill(process.env.LIFERAY_PASSWORD);
    await form.locator('button[type=submit]').first().click();
    await s.ctx.waitForEvent('close', { timeout: 6000 }).catch(() => {});
    await p.goto(`${base}/web/proventeq/home`);
    return close(s, tag, { publicPage: await who(p) });
  }

  const results = [
    await sso('http://127.0.0.1:8086', 'sso-origin'),
    await sso('http://127.0.0.1:6081', 'sso-varnish'),
    await password('http://127.0.0.1:8086', 'password'),
  ];
  console.log(JSON.stringify(results, null, 1));
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
