// freemarker.mjs — the FreeMarker subset that fragment templates use, evaluated in Node.
//
// Supported:  [#assign name = expr /]   ${expr}
//   expr := 'str' | "str" | number | true | false | { key: expr, … }
//         | name(.name | [expr])*          (configuration.size, icons[icon])
//         | expr!default                   (default may be omitted → "")
// Anything else ([#if], [#list], ?builtins, [@macros]) throws, naming the fragment and
// the construct, so a template that needs more fails the build instead of rendering wrong.

class Unsupported extends Error {}

function tokenize(src, start, stop) {
  // Returns tokens from `start` until the terminator (`stop` = '}' for ${…}, '/]' for
  // [#assign … /]) at nesting depth 0, plus the index just past the terminator.
  const toks = [];
  let i = start;
  let depth = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (depth === 0 && stop === '}' && c === '}') return { toks, end: i + 1 };
    if (depth === 0 && stop === '/]' && src.startsWith('/]', i)) return { toks, end: i + 2 };
    if (c === '"' || c === "'") {
      let j = i + 1;
      let s = '';
      while (j < src.length && src[j] !== c) {
        if (src[j] === '\\') { s += src[j + 1]; j += 2; } else s += src[j++];
      }
      toks.push({ t: 'str', v: s });
      i = j + 1;
      continue;
    }
    const num = /^\d+(\.\d+)?/.exec(src.slice(i, i + 32));
    if (num) { toks.push({ t: 'num', v: Number(num[0]) }); i += num[0].length; continue; }
    const id = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i, i + 128));
    if (id) { toks.push({ t: 'id', v: id[0] }); i += id[0].length; continue; }
    if ('{['.includes(c)) depth++;
    if ('}]'.includes(c)) depth--;
    if ('{}[].:,!='.includes(c)) { toks.push({ t: c }); i++; continue; }
    throw new Unsupported(`unsupported character "${c}" in expression near: ${src.slice(i, i + 40)}`);
  }
  throw new Unsupported(`unterminated expression near: ${src.slice(start, start + 40)}`);
}

function parse(toks) {
  let p = 0;
  const peek = (t) => toks[p] && toks[p].t === t;
  const take = (t) => {
    if (!peek(t)) throw new Unsupported(`expected "${t}" got ${JSON.stringify(toks[p])}`);
    return toks[p++];
  };
  function primary() {
    const tk = toks[p];
    if (!tk) throw new Unsupported('unexpected end of expression');
    if (tk.t === 'str' || tk.t === 'num') { p++; return { k: 'lit', v: tk.v }; }
    if (tk.t === 'id' && (tk.v === 'true' || tk.v === 'false')) { p++; return { k: 'lit', v: tk.v === 'true' }; }
    if (tk.t === '{') {
      p++;
      const entries = [];
      while (!peek('}')) {
        const key = toks[p++];
        if (!key || (key.t !== 'str' && key.t !== 'id')) throw new Unsupported('bad hash key');
        take(':');
        entries.push([key.v, expr()]);
        if (peek(',')) p++;
      }
      take('}');
      return { k: 'hash', entries };
    }
    if (tk.t === 'id') {
      p++;
      let node = { k: 'var', name: tk.v };
      for (;;) {
        if (peek('.')) { p++; node = { k: 'get', obj: node, key: { k: 'lit', v: take('id').v } }; }
        else if (peek('[')) { p++; const key = expr(); take(']'); node = { k: 'get', obj: node, key }; }
        else return node;
      }
    }
    throw new Unsupported(`unexpected token ${JSON.stringify(tk)}`);
  }
  function expr() {
    const left = primary();
    if (!peek('!')) return left;
    p++;
    const atEnd = !toks[p] || [']', '}', ',', ':'].includes(toks[p].t);
    return { k: 'default', left, right: atEnd ? { k: 'lit', v: '' } : primary() };
  }
  const node = expr();
  return { node, rest: toks.slice(p) };
}

const MISSING = Symbol('missing');

function evaluate(node, scope) {
  switch (node.k) {
    case 'lit': return node.v;
    case 'hash': return Object.fromEntries(node.entries.map(([k, v]) => [k, evaluate(v, scope)]));
    case 'var': return node.name in scope ? scope[node.name] : MISSING;
    case 'get': {
      const obj = evaluate(node.obj, scope);
      if (obj === MISSING || obj === null || obj === undefined) return MISSING;
      const v = obj[evaluate(node.key, scope)];
      return v === undefined || v === null ? MISSING : v;
    }
    case 'default': {
      const v = evaluate(node.left, scope);
      return v === MISSING || v === '' ? evaluate(node.right, scope) : v;
    }
  }
}

/** Render one fragment template. `scope` holds `configuration` and any other globals. */
export function renderFreeMarker(src, scope, label = 'template') {
  const vars = { ...scope };
  let out = '';
  let i = 0;
  try {
    while (i < src.length) {
      const a = src.indexOf('[#', i);
      const d = src.indexOf('${', i);
      const other = [src.indexOf('[@', i), src.indexOf('<#', i), src.indexOf('[/#', i)].filter((x) => x >= 0);
      const next = Math.min(...[a, d, ...other].map((x) => (x < 0 ? Infinity : x)));
      if (next === Infinity) { out += src.slice(i); break; }
      out += src.slice(i, next);
      if (next === d) {
        const { toks, end } = tokenize(src, d + 2, '}');
        const { node, rest } = parse(toks);
        if (rest.length) throw new Unsupported(`trailing tokens in \${…}: ${JSON.stringify(rest)}`);
        const v = evaluate(node, vars);
        if (v === MISSING) throw new Unsupported(`\${${src.slice(d + 2, end - 1)}} is undefined (no "!" default)`);
        out += String(v);
        i = end;
      } else if (next === a && src.startsWith('[#assign', a)) {
        const { toks, end } = tokenize(src, a + '[#assign'.length, '/]');
        const name = toks[0];
        if (!name || name.t !== 'id' || !toks[1] || toks[1].t !== '=') throw new Unsupported('bad [#assign]');
        const { node, rest } = parse(toks.slice(2));
        if (rest.length) throw new Unsupported(`trailing tokens in [#assign ${name.v}]`);
        const v = evaluate(node, vars);
        vars[name.v] = v === MISSING ? '' : v;
        i = end;
        if (src[i] === '\n') i++; // FreeMarker strips the line of a lone directive
      } else {
        throw new Unsupported(`directive not supported: ${src.slice(next, next + 30)}`);
      }
    }
  } catch (e) {
    if (e instanceof Unsupported) throw new Error(`FreeMarker subset (${label}): ${e.message}`);
    throw e;
  }
  return out;
}
