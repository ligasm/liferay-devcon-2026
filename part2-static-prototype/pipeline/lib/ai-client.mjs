// ai-client.mjs — the only file that talks to the Anthropic API.
//
// Three modes, chosen once per cycle:
//   live     ANTHROPIC_API_KEY set                → real calls, usage logged
//   dry-run  --dry-run                            → print the exact prompt, estimate tokens, return null
//   off      --no-ai or no key                    → return null immediately (callers use deterministic fallbacks)
//
// Every call: stable system prompt marked cache_control:ephemeral (prompt caching),
// a hard per-cycle token budget, and a ledger the report turns into a cost line.
import { config } from './config.mjs';
import { estimateTokens, log } from './util.mjs';

let mode = 'off';
let client = null;
export const ledger = { mode, calls: [], totals: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, estimated: 0 }, budget: config.aiBudgetTokens, budgetExceeded: false };

export async function initAi(flags = {}) {
  if (flags['no-ai']) mode = 'off';
  else if (flags['dry-run']) mode = 'dry-run';
  else if (config.anthropicApiKey) {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    client = new Anthropic({ apiKey: config.anthropicApiKey });
    mode = 'live';
  } else {
    mode = 'off';
    log('ai: no ANTHROPIC_API_KEY, running deterministic fallbacks only (use --dry-run to see prompts)');
  }
  ledger.mode = mode;
  return mode;
}
export const aiMode = () => mode;
export const spent = () => ledger.totals.input + ledger.totals.output + ledger.totals.cacheRead + ledger.totals.estimated;

const tierPrice = (tier) => config.price[tier === 'smart' ? 'smart' : 'cheap'];
export function estimatedCostUsd() {
  return ledger.calls.reduce((usd, c) => {
    const p = tierPrice(c.tier);
    if (c.mode === 'dry-run' && !c.skipped) return usd + (c.estTokens * p.input) / 1e6; // rough: all estimated tokens priced as fresh input
    return usd + (c.usage.input * p.input + c.usage.output * p.output + c.usage.cacheRead * p.cacheRead + c.usage.cacheWrite * p.input * 1.25) / 1e6;
  }, 0);
}

/**
 * Ask the model. Returns parsed JSON (or text) — or null when the model was not
 * consulted (off / dry-run / over budget / error), so callers always fall back.
 * @param {{task:string, tier:'cheap'|'smart', system:string, user:string, maxTokens?:number, json?:boolean}} req
 */
export async function askModel({ task, tier = 'cheap', system, user, maxTokens = 1024, json = true }) {
  const model = tier === 'smart' ? config.aiModelSmart : config.aiModelCheap;
  const est = estimateTokens(system) + estimateTokens(user) + Math.min(maxTokens, 400);
  const entry = { task, tier, model, mode, at: new Date().toISOString(), usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, estTokens: est };

  if (mode === 'off') return null;
  if (spent() + est > config.aiBudgetTokens) {
    ledger.budgetExceeded = true;
    log(`ai: budget ${config.aiBudgetTokens} would be exceeded by "${task}" (+${est}); using fallback`);
    ledger.calls.push({ ...entry, skipped: 'budget' });
    return null;
  }

  if (mode === 'dry-run') {
    ledger.totals.estimated += est;
    ledger.calls.push(entry);
    console.log(`\n──── DRY RUN · ${task} · ${model} · ≈${est} tokens ────`);
    console.log(`[system, cache_control=ephemeral]\n${system}\n\n[user]\n${user.slice(0, 3000)}${user.length > 3000 ? `\n… (${user.length - 3000} more chars)` : ''}\n`);
    return null;
  }

  try {
    // Verified against the prompt-caching docs (Sept 2026): no beta header,
    // cache_control goes on the system content block; usage reports
    // cache_read_input_tokens / cache_creation_input_tokens.
    // Caveat: a prompt shorter than the model's minimum (Haiku 4.5: 4096 tokens)
    // is silently not cached — the ledger will show cacheRead=0 in that case.
    const res = await client.messages.create({
      model,
      max_tokens: maxTokens,
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: user }],
    });
    const u = res.usage ?? {};
    entry.usage = { input: u.input_tokens ?? 0, output: u.output_tokens ?? 0, cacheRead: u.cache_read_input_tokens ?? 0, cacheWrite: u.cache_creation_input_tokens ?? 0 };
    for (const k of Object.keys(entry.usage)) ledger.totals[k] += entry.usage[k];
    ledger.calls.push(entry);
    const text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    log(`ai: ${task} ${model} in=${entry.usage.input} cached=${entry.usage.cacheRead} out=${entry.usage.output}`);
    return json ? parseJson(text) : text;
  } catch (e) {
    ledger.calls.push({ ...entry, error: e.message });
    log(`ai: ${task} failed (${e.message}); using fallback`);
    return null;
  }
}

function parseJson(text) {
  const m = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/); // tolerate prose around the JSON
  try { return JSON.parse(m ? m[0] : text); } catch { return null; }
}
