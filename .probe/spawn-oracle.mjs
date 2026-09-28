// Differential: the PR's model of what a spawned process receives (passedEnvironment / spawnedEnvironmentView)
// against what a real child spawned by node:child_process.spawn with the same env object sees in its own
// process.env. Platform-agnostic (macOS / Linux container / Windows runner).
// usage: node spawn-oracle.mjs <storage-paths-lite.js> [fuzzCount] [seed]
// Prints one `ORACLE_JSON {...}` line per case and a final `ORACLE_SUMMARY {...}` line.
import { spawn } from 'node:child_process';
import * as os from 'node:os';
import { pathToFileURL } from 'node:url';

const [modPath, fuzzArg = '600', seedArg = '12934'] = process.argv.slice(2);
const lite = await import(pathToFileURL(modPath).href);
const WIN = os.platform() === 'win32';

// The child reads the probe names from stdin and reports, for each, what its own process.env gives.
const CHILD = `let s='';process.stdin.setEncoding('utf8');process.stdin.on('data',d=>s+=d).on('end',()=>{
const names=JSON.parse(s);const look=names.map(n=>{const v=process.env[n];
return [n, typeof v==='string'?v:(v===undefined?null:'<'+typeof v+'>'), n in process.env]});
process.stdout.write(JSON.stringify({keys:Object.keys(process.env),look}))})`;

function runChild(env, names) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(process.execPath, ['-e', CHILD], { env, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (e) {
      resolve({ spawnThrew: `${e.name}${e.code ? ` ${e.code}` : ''}: ${String(e.message).slice(0, 120)}` });
      return;
    }
    let out = '', err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', (e) => resolve({ spawnThrew: `async ${e.code}: ${e.message}` }));
    child.on('close', (code) => {
      try { resolve(JSON.parse(out)); } catch { resolve({ childFailed: `exit ${code}: ${err.slice(0, 200)}` }); }
    });
    child.stdin.end(JSON.stringify(names));
  });
}

// Builds env objects with the shapes spawn handles: own, inherited, non-enumerable, getters.
function build({ own = {}, proto, hidden = {}, getters = {} } = {}) {
  const env = proto ? Object.create(proto) : {};
  for (const [k, v] of Object.entries(own)) Object.defineProperty(env, k, { value: v, enumerable: true, writable: true, configurable: true });
  for (const [k, v] of Object.entries(hidden)) Object.defineProperty(env, k, { value: v, enumerable: false });
  for (const [k, g] of Object.entries(getters)) Object.defineProperty(env, k, { get: g, enumerable: true });
  return env;
}

const CASES = [
  ['control: empty', () => build()],
  ['plain strings', () => build({ own: { A: '1', QWEN_HOME: WIN ? 'C:\\abs\\qh' : '/abs/qh' } })],
  ['inherited key', () => build({ own: { A: '1' }, proto: { QWEN_HOME: 'inherited' } })],
  ['inherited key shadowed by own undefined', () => build({ own: { QWEN_HOME: undefined }, proto: { QWEN_HOME: 'inherited' } })],
  ['non-enumerable own key', () => build({ own: { A: '1' }, hidden: { QWEN_HOME: 'hidden' } })],
  ['undefined value', () => build({ own: { QWEN_HOME: undefined, B: '2' } })],
  ['null value', () => build({ own: { QWEN_HOME: null } })],
  ['number / boolean values', () => build({ own: { N: 0, T: true, F: false, BIG: 12345678901234567890 } })],
  ['array value', () => build({ own: { QWEN_HOME: [WIN ? 'C:\\abs\\qh' : '/abs/qh'], X: ['a', 'b'] } })],
  ['object values', () => build({ own: { X: { toString: () => 'ts' }, Y: {} } })],
  ['empty value', () => build({ own: { E: '' } })],
  ['value with = and newline', () => build({ own: { X: 'a=b\nc=d' } })],
  ['long value (100 KB)', () => build({ own: { L: 'x'.repeat(100_000) } })],
  ['Symbol value', () => build({ own: { X: Symbol('s') } })],
  ['getter that throws', () => build({ own: { A: '1' }, getters: { X: () => { throw new Error('unreadable'); } } })],
  ['NUL byte in string value', () => build({ own: { X: 'a\0b' } })],
  ['NUL byte in non-string value', () => build({ own: { X: ['a\0b'] } })],
  ['NUL byte in name', () => build({ own: { 'X\0Y': '1' } })],
  ['= inside a name', () => build({ own: { 'QWEN_HOME=alt': 'home' } })],
  ['name starting with = (=C:)', () => build({ own: { '=C:': 'C:\\work' } })],
  ['empty name', () => build({ own: { '': 'x' } })],
  ['names like an array index', () => build({ own: { 0: 'zero', 1: 'one', '01': 'pad', 4294967294: 'maxidx', 4294967295: 'notidx', '-1': 'neg', '1.5': 'frac' } })],
  ['two spellings (UPPER, lower)', () => build({ own: { QWEN_HOME: 'U', qwen_home: 'L' } })],
  ['two spellings (lower first)', () => build({ own: { qwen_home: 'L', QWEN_HOME: 'U' } })],
  ['first spelling undefined', () => build({ own: { QWEN_HOME: undefined, qwen_home: 'L' } })],
  ['later spelling undefined', () => build({ own: { qwen_home: undefined, QWEN_HOME: 'U' } })],
  ['Mixed + lower', () => build({ own: { Qwen_Home: 'M', qwen_home: 'L' } })],
  ['unicode case: eszett vs SS', () => build({ own: { 'ß': 'eszett', SS: 'ss' } })],
  ['unicode case: eszett alone', () => build({ own: { 'ß': 'eszett' } })],
  ['unicode case: dotless i / e-acute', () => build({ own: { 'ı': 'dotless', 'é': 'e', 'É': 'E' } })],
  ['Object.prototype names as variables', () => build({ own: { toString: 'x', constructor: 'c', hasOwnProperty: 'h' } })],
  ['falsy env: undefined', () => undefined],
  ['falsy env: null', () => null],
  ['falsy env: empty string', () => ''],
  ['falsy env: 0', () => 0],
  ['falsy env: false', () => false],
];

// Seeded fuzz over the same shapes.
let seed = Number(seedArg) >>> 0;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const pick = (a) => a[Math.floor(rnd() * a.length)];
const NAMES = ['QWEN_HOME', 'qwen_home', 'Qwen_Home', 'QWEN_CODE_SYSTEM_SETTINGS_PATH', 'qwen_code_system_settings_path', 'A', 'a', 'Path', 'PATH', '0', '7', '01', '4294967295', 'X=Y', '=C:', '=D:', 'ß', 'SS', 'é', 'É', '_', 'toString', 'HOME', 'home'];
const VALUES = ['v', '', '/abs', 'rel', 'C:\\w', undefined, undefined, null, 0, 1, true, ['/abs/x'], ['p', 'q'], 'with=eq', 'ünï'];
for (let i = 0; i < Number(fuzzArg); i++) {
  const spec = { own: {}, proto: undefined, hidden: {} };
  const n = 1 + Math.floor(rnd() * 6);
  for (let j = 0; j < n; j++) {
    const r = rnd();
    const k = pick(NAMES), v = pick(VALUES);
    if (r < 0.12) (spec.proto ??= {})[k] = v;
    else if (r < 0.2) spec.hidden[k] = v;
    else spec.own[k] = v;
  }
  if (rnd() < 0.04) spec.own.S = Symbol('s');
  if (rnd() < 0.04) spec.own.Z = 'nul\0here';
  CASES.push([`fuzz #${i}`, () => build(spec), true]);
}

// What the child would see if spawn passed every enumerable key's string form as it is.
function naive(env) {
  const m = {};
  for (const k in env) { const v = env[k]; if (v !== undefined) m[k] = String(v); }
  return m;
}
const show = (v) => (typeof v === 'symbol' ? v.toString() : v);

const tally = { agree: 0, bothRefuse: 0, refusedAndChanged: 0, overRefusal: 0, underRefusal: 0, mismatch: 0 };
const mism = [];
let controlExtras = null;

async function one([label, make, isFuzz]) {
  const env = make();
  let passed, view, modelErr = null;
  try { passed = lite.passedEnvironment(env); view = lite.spawnedEnvironmentView(env); }
  catch (e) { modelErr = `${e.name}: ${e.message}`; }
  const keys = [];
  if (env && typeof env === 'object') for (const k in env) keys.push(k);
  const names = [...new Set([...keys, ...keys.map((k) => k.toUpperCase()), ...keys.map((k) => k.toLowerCase()),
    'QWEN_HOME', 'qwen_home', '0', '01', '=C:', 'SS', 'ß', 'A'])];
  const child = await runChild(env, names);
  const rec = { case: label, names: keys };
  if (child.spawnThrew || child.childFailed) {
    rec.spawn = child.spawnThrew ?? child.childFailed;
    if (modelErr) { rec.verdict = 'both refuse'; tally.bothRefuse++; }
    else { rec.verdict = 'UNDER-REFUSAL: model accepts, spawn refuses'; tally.underRefusal++; mism.push(rec); }
    rec.model = modelErr ?? 'accepts';
    return rec;
  }
  const extras = child.keys.filter((k) => !(passed && k in passed));
  if (label === 'control: empty') controlExtras = new Set(child.keys);
  const received = Object.fromEntries(child.look.filter(([, v]) => v !== null && !v.startsWith?.('<')).map(([n, v]) => [n, v]));
  if (modelErr) {
    rec.model = modelErr;
    // Does the child receive the env as it is? Compare with the naive expectation.
    const nv = env && typeof env === 'object' ? naive(env) : null;
    const asIs = nv && Object.entries(nv).every(([k, v]) => child.look.find(([n]) => n === k)?.[1] === v)
      && child.keys.filter((k) => !controlExtras?.has(k)).every((k) => k in nv);
    const diffs = [];
    if (!nv) diffs.push('spawn passed its own environment instead');
    else for (const [k, v] of Object.entries(nv)) {
      const got = child.look.find(([n]) => n === k)?.[1];
      if (got !== v) diffs.push(`${JSON.stringify(k)}: passed ${JSON.stringify(v.slice(0, 40))}, child sees ${JSON.stringify(got)}`);
    }
    for (const k of child.keys) if (nv && !(k in nv) && !controlExtras?.has(k)) diffs.push(`child has extra name ${JSON.stringify(k)} = ${JSON.stringify(child.look.find(([n]) => n === k)?.[1] ?? '?')}`);
    rec.childDiffers = diffs.slice(0, 4);
    if (asIs) { rec.verdict = 'OVER-REFUSAL: child receives it as it is'; tally.overRefusal++; mism.push(rec); }
    else { rec.verdict = 'refused; child would not receive it as it is'; tally.refusedAndChanged++; }
    return rec;
  }
  // Model accepts and spawn succeeds: compare names and every lookup.
  const bad = [];
  const missing = Object.keys(passed).filter((k) => !child.keys.includes(k));
  const unexpected = extras.filter((k) => !controlExtras?.has(k));
  if (missing.length) bad.push(`passed but child does not list: ${JSON.stringify(missing)}`);
  if (unexpected.length) bad.push(`child lists names not passed: ${JSON.stringify(unexpected)}`);
  for (const [n, v, has] of child.look) {
    const cv = v !== null && !String(v).startsWith('<') ? v : undefined;
    const mv = view[n];
    if (cv !== mv) bad.push(`lookup ${JSON.stringify(n)}: child ${JSON.stringify(cv)}, view ${JSON.stringify(mv)}`);
    const protoName = n in Object.prototype;
    if (!protoName && has !== n in view) bad.push(`in ${JSON.stringify(n)}: child ${has}, view ${n in view}`);
  }
  rec.passedKeys = Object.keys(passed).length;
  if (bad.length) { rec.verdict = 'MISMATCH'; rec.details = bad.slice(0, 8); tally.mismatch++; mism.push(rec); }
  else { rec.verdict = 'agree'; tally.agree++; }
  if (!isFuzz) rec.childSees = Object.fromEntries(Object.entries(received).slice(0, 8).map(([k, v]) => [k, v.length > 30 ? `${v.slice(0, 27)}...` : v]));
  return rec;
}

// Run the control first (it defines the names spawn itself adds), then the rest with limited concurrency.
const results = [await one(CASES[0])];
let idx = 1;
const worker = async () => { while (idx < CASES.length) { const c = CASES[idx++]; results.push(await one(c)); } };
await Promise.all(Array.from({ length: 6 }, worker));
const order = new Map(CASES.map(([l], i) => [l, i]));
results.sort((a, b) => order.get(a.case) - order.get(b.case));
for (const r of results) console.log(`ORACLE_JSON ${JSON.stringify(r, (k, v) => show(v))}`);

// R1-3 witness: readEnvironmentVariable(process.env, name) takes the fast path; the spawned child does not.
process.env['0'] = 'zero';
const r13 = await runChild(process.env, ['0']);
const r13rec = { fastPath: lite.readEnvironmentVariable(process.env, '0') ?? null, viewOfProcessEnv: lite.spawnedEnvironmentView(process.env)['0'] ?? null, childSees: r13.look?.[0]?.[1] ?? null, childLists0: r13.keys?.includes('0') };
console.log(`ORACLE_R13 ${JSON.stringify(r13rec)}`);
delete process.env['0'];

console.log(`ORACLE_SUMMARY ${JSON.stringify({ platform: os.platform(), arch: os.arch(), node: process.version, cases: results.length, curated: CASES.filter((c) => !c[2]).length, fuzz: CASES.filter((c) => c[2]).length, spawnAdds: [...(controlExtras ?? [])], ...tally })}`);
