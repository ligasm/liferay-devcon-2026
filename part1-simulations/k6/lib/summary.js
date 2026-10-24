/**
 * k6/lib/summary.js — shared handleSummary() that writes
 *   <RESULTS_DIR>/<STAGE_LABEL>/<scenario>.summary.json
 * (the k6 end-of-test data object plus a `meta` block) and prints a compact
 * console summary that fits on a projector.
 *
 * NOTE: k6 does not create parent directories — run.sh does `mkdir -p` first.
 * If you run `k6 run` by hand, create results/<STAGE_LABEL>/ yourself.
 */
import { cfg } from './config.js';

const fmtMs = (v) => (v === undefined ? '   -   ' : `${v.toFixed(0).padStart(6)}ms`);
const fmtPct = (v) => (v === undefined ? '  -  ' : `${(v * 100).toFixed(1).padStart(5)}%`);

function metric(data, name) {
  const m = data.metrics[name];
  return m ? m.values : undefined;
}

function consoleReport(data, scenario) {
  const lines = [];
  const dur = metric(data, 'http_req_duration') || {};
  const t = metric(data, 'ttfb') || {};
  const reqs = metric(data, 'http_reqs') || {};
  const failed = metric(data, 'http_req_failed') || {};
  const eh = metric(data, 'edge_hit') || {};
  const sc = metric(data, 'set_cookie_on_guest') || {};
  const cc = metric(data, 'cache_control_private') || {};
  const checks = metric(data, 'checks') || {};

  lines.push('');
  lines.push(`┌─ ${cfg.STAGE_LABEL} / ${scenario} ${'─'.repeat(Math.max(0, 50 - cfg.STAGE_LABEL.length - scenario.length))}`);
  lines.push(`│ requests      ${String(reqs.count || 0).padStart(7)}   ${(reqs.rate || 0).toFixed(1)} req/s`);
  lines.push(`│ duration      p50 ${fmtMs(dur.med)}  p95 ${fmtMs(dur['p(95)'])}  p99 ${fmtMs(dur['p(99)'])}`);
  lines.push(`│ ttfb          p50 ${fmtMs(t.med)}  p95 ${fmtMs(t['p(95)'])}`);
  lines.push(`│ errors        ${fmtPct(failed.rate)}   checks passed ${fmtPct(checks.rate)}`);
  lines.push(`│ edge hit      ${fmtPct(eh.rate)}   set-cookie on guest ${fmtPct(sc.rate)}   cache-control private ${fmtPct(cc.rate)}`);

  // Per-scenario breakdown when the script defines several scenarios (mix.js, asset-publisher.js)
  const sub = Object.keys(data.metrics)
    .filter((k) => /^http_req_duration\{scenario:[^}]+\}$/.test(k))
    .sort();
  if (sub.length > 1) {
    lines.push('│');
    for (const k of sub) {
      const name = k.match(/scenario:([^}]+)/)[1];
      const v = data.metrics[k].values;
      const r = metric(data, `http_reqs{scenario:${name}}`) || {};
      const e = metric(data, `edge_hit{scenario:${name}}`) || {};
      lines.push(`│   ${name.padEnd(18)} ${String(r.count || 0).padStart(6)} req  p95 ${fmtMs(v['p(95)'])}  edge hit ${fmtPct(e.rate)}`);
    }
  }
  // Thresholds
  const failedThresholds = [];
  for (const [name, m] of Object.entries(data.metrics)) {
    for (const [expr, th] of Object.entries(m.thresholds || {})) {
      if (th.ok === false) failedThresholds.push(`${name}: ${expr}`);
    }
  }
  lines.push(`│ thresholds    ${failedThresholds.length ? 'FAILED → ' + failedThresholds.join('; ') : 'all passed'}`);
  lines.push('└' + '─'.repeat(70));
  lines.push('');
  return lines.join('\n');
}

/**
 * makeHandleSummary('guest-browse') → function to `export { handleSummary }` from a scenario.
 */
export function makeHandleSummary(scenario) {
  return function handleSummary(data) {
    const path = `${cfg.RESULTS_DIR}/${cfg.STAGE_LABEL}/${scenario}.summary.json`;
    const out = {
      meta: {
        scenario,
        stage: cfg.STAGE_LABEL,
        base_url: cfg.BASE_URL,
        generated_at: new Date().toISOString(),
        k6_version: (typeof __ENV !== 'undefined' && __ENV.K6_VERSION) || undefined,
        config: {
          VUS: cfg.VUS, RATE: cfg.RATE, DURATION: cfg.DURATION,
          THINK_MIN: cfg.THINK_MIN, THINK_MAX: cfg.THINK_MAX, WITH_ASSETS: cfg.WITH_ASSETS,
        },
      },
      ...data,
    };
    return {
      [path]: JSON.stringify(out, null, 1),
      stdout: consoleReport(data, scenario),
    };
  };
}
