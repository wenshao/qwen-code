// PR #12868 round 6: random inputs for the built fitManagedRuntimeProviderResult.
// No stack is needed: the function is imported from the arm's dist.
// Invariants checked on every case:
//   F1 the fitted value fits the budget
//   F2 a value that already fits is returned unchanged
//   F3 no lone surrogate appears that the input did not have
//   F4 a notice counts exactly the code points it replaces
//   F5 what is kept is a head and a tail of the original text
//   F6 llmContent becomes the stub only when text cut to its notices could not fit
//   F7 no field grows
// usage: ARM=<h7|h6> node fit-fuzz.mjs [cases] [seed]
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ARM, WT, RIG } from './lib.mjs';

const CASES = Number(process.argv[2] ?? 3000);
let seed = Number(process.argv[3] ?? 12868);
const rnd = () => {
  // mulberry32
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = (list) => list[Math.floor(rnd() * list.length)];
const between = (a, b) => a + Math.floor(rnd() * (b - a + 1));

const mod = await import(pathToFileURL(path.join(WT, 'packages/cli/dist/src/serve/managed-runtime-provider-protocol.js')).href);
const fit = mod.fitManagedRuntimeProviderResult;
const STUB = '[Managed Runtime provider omitted this tool result to fit the wire limit.]';
const NOTICE = /\n\[Managed Runtime provider omitted (\d+) characters here to fit the (\d+)-byte wire limit\.\]\n/g;
const bytes = (v) => Buffer.byteLength(JSON.stringify(v), 'utf8');
const lone = (text) => (text.match(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g) ?? []).length;
const points = (text) => [...text].length;

const ALPHABETS = {
  ascii: () => String.fromCharCode(between(0x61, 0x7a)),
  cjk: () => String.fromCharCode(between(0x4e00, 0x4eff)),
  emoji: () => String.fromCodePoint(between(0x1f600, 0x1f64f)),
  quotes: () => pick(['"', '\\']),
  control: () => String.fromCharCode(pick([0x01, 0x02, 0x1b, 0x0a, 0x09, 0x7f])),
  latin: () => String.fromCharCode(between(0xc0, 0xff)),
  mixed: () => pick([ALPHABETS.ascii, ALPHABETS.cjk, ALPHABETS.emoji, ALPHABETS.quotes, ALPHABETS.control, ALPHABETS.latin])(),
};
function text(units, kind) {
  if (units === 0) return '';
  const make = ALPHABETS[kind];
  // Build from a short random block, repeated: long texts stay cheap.
  let block = '';
  const blockLength = between(1, 64);
  for (let i = 0; i < blockLength; i++) block += make();
  let out = '';
  while (out.length < units) out += block;
  // Cut on a code point boundary.
  let end = units;
  const last = out.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end--;
  return out.slice(0, end);
}
const size = () => pick([0, 1, 40, 90, 200, between(1, 400), between(400, 4000), between(4000, 40000), between(40000, 200000)]);
const kinds = Object.keys(ALPHABETS);

function makeCase() {
  const budget = pick([2000, 4096, 16384, 65536, 262144, between(1500, 300000)]);
  const kind = pick(['execute', 'execute', 'status', 'cancel']);
  const result = {};
  const llm = pick(['string', 'string', 'parts', 'media']);
  if (llm === 'string') result.llmContent = text(size(), pick(kinds));
  else if (llm === 'parts') result.llmContent = Array.from({ length: between(1, 3) }, () => ({ text: text(size(), pick(kinds)) }));
  else result.llmContent = [{ text: text(size(), pick(kinds)) }, { inlineData: { mimeType: 'image/png', data: 'A'.repeat(size()) } }];
  const display = pick(['string', 'shell', 'shell', 'diff', 'none']);
  if (display === 'string') result.returnDisplay = text(size(), pick(kinds));
  else if (display === 'shell')
    result.returnDisplay = { type: 'shell_result', version: 1, text: text(size(), pick(kinds)), output: text(size(), pick(kinds)), directory: '/w', exitCode: 0, signal: null, pid: 1, error: pick([null, text(size(), pick(kinds))]), outcome: 'completed', notices: Array.from({ length: between(0, 2) }, () => text(between(0, 300), pick(kinds))), truncated: false, outputFiles: [] };
  else if (display === 'diff') result.returnDisplay = { fileDiff: text(size(), pick(kinds)), fileName: 'a.txt', originalContent: text(size(), pick(kinds)), newContent: text(size(), pick(kinds)) };
  const execution = { executionStatus: pick(['success', 'error', 'cancelled']), result };
  if (rnd() < 0.3) execution.error = { message: text(size(), pick(kinds)), type: 'x' };
  if (rnd() < 0.15) execution.postHook = { additionalContext: text(size(), pick(kinds)) };
  if (rnd() < 0.1) execution.failureHook = { additionalContext: text(size(), pick(kinds)) };
  if (kind === 'execute') return { kind, budget, value: execution };
  const count = between(0, 12);
  const progress = Array.from({ length: count }, (_, i) => ({ seq: i + 1, output: text(size() % 20000, pick(kinds)) }));
  return { kind, budget, value: { state: 'settled', lastSeq: count, firstAvailableSeq: count ? 1 : 1, progressGap: false, progress, result: execution } };
}

// Every string leaf the fitter may cut, by a stable path.
function leaves(execution) {
  const out = new Map();
  const r = execution?.result;
  if (r && typeof r === 'object') {
    if (typeof r.llmContent === 'string') out.set('llmContent', r.llmContent);
    else if (Array.isArray(r.llmContent)) r.llmContent.forEach((p, i) => typeof p?.text === 'string' && out.set(`llmContent[${i}].text`, p.text));
    const d = r.returnDisplay;
    if (typeof d === 'string') out.set('returnDisplay', d);
    else if (d && typeof d === 'object' && d.type === 'shell_result') {
      for (const k of ['output', 'text', 'error']) if (typeof d[k] === 'string') out.set(`display.${k}`, d[k]);
      d.notices.forEach((n, i) => out.set(`display.notices[${i}]`, n));
    }
  }
  if (typeof execution?.error?.message === 'string') out.set('error.message', execution.error.message);
  return out;
}
const executionOf = (kind, value) => (kind === 'execute' ? value : value?.result);

const failures = { F1: [], F2: [], F3: [], F4: [], F5: [], F6: [], F7: [], threw: [] };
const seen = { cases: 0, alreadyFit: 0, cut: 0, stubbedLlm: 0, stubbedDisplay: 0, hooksDropped: 0, evicted: 0, usedMin: 1, usedSum: 0, usedCount: 0 };
const note = (key, c, detail) => { if (failures[key].length < 5) failures[key].push(`case ${c.n} kind=${c.kind} budget=${c.budget}: ${detail}`); else failures[key].count = (failures[key].count ?? 5) + 1; };

for (let n = 0; n < CASES; n++) {
  const c = { ...makeCase(), n };
  const before = structuredClone(c.value);
  const beforeBytes = bytes(before);
  let after;
  try {
    after = fit({ kind: c.kind }, structuredClone(c.value), c.budget);
  } catch (error) {
    note('threw', c, `${error?.name}: ${error?.message}`);
    continue;
  }
  seen.cases++;
  const afterBytes = bytes(after);
  if (beforeBytes <= c.budget) {
    seen.alreadyFit++;
    if (JSON.stringify(after) !== JSON.stringify(before)) note('F2', c, `a value of ${beforeBytes} bytes was changed`);
    continue;
  }
  if (afterBytes > c.budget) note('F1', c, `${beforeBytes} -> ${afterBytes} bytes`);
  const a = leaves(executionOf(c.kind, before));
  const b = leaves(executionOf(c.kind, after));
  let anyCut = false;
  let floorBytes = 0; // what the text would take if every leaf were cut to its notice
  for (const [key, original] of a) {
    const noticeAtMost = `\n[Managed Runtime provider omitted ${original.length} characters here to fit the ${c.budget}-byte wire limit.]\n`;
    floorBytes += Math.min(bytes(original) - 2, bytes(noticeAtMost) - 2);
    const now = b.get(key);
    if (typeof now !== 'string') continue; // replaced by a stub, checked below
    if (now === original) continue;
    if (now === STUB) continue;
    anyCut = true;
    if (lone(now) > lone(original)) note('F3', c, `${key}: lone surrogates ${lone(original)} -> ${lone(now)}`);
    if (bytes(now) > bytes(original)) note('F7', c, `${key}: ${bytes(original)} -> ${bytes(now)} bytes`);
    const notices = [...now.matchAll(NOTICE)].filter((m) => !original.includes(m[0]));
    if (notices.length !== 1) { note('F4', c, `${key}: ${notices.length} notices`); continue; }
    const m = notices[0];
    const head = now.slice(0, m.index);
    const tail = now.slice(m.index + m[0].length);
    if (!original.startsWith(head) || !original.endsWith(tail) || head.length + tail.length > original.length) { note('F5', c, `${key}: kept text is not a head and a tail of the original`); continue; }
    const omitted = points(original.slice(head.length, original.length - tail.length));
    if (omitted !== Number(m[1])) note('F4', c, `${key}: notice says ${m[1]}, ${omitted} code points are gone`);
  }
  if (anyCut) seen.cut++;
  const rb = executionOf(c.kind, before)?.result ?? {};
  const ra = executionOf(c.kind, after)?.result ?? {};
  const llmStubbed = ra.llmContent === STUB && rb.llmContent !== STUB;
  const displayStubbed = ra.returnDisplay === STUB && rb.returnDisplay !== STUB;
  if (displayStubbed) seen.stubbedDisplay++;
  const eb = executionOf(c.kind, before);
  const ea = executionOf(c.kind, after);
  if ((eb.postHook && !ea.postHook) || (eb.failureHook && !ea.failureHook)) seen.hooksDropped++;
  if (c.kind !== 'execute' && (after.progress?.length ?? 0) < (before.progress?.length ?? 0)) seen.evicted++;
  if (llmStubbed) {
    seen.stubbedLlm++;
    // Would the value have fitted with every text leaf at its notice, the
    // structured display stubbed, the hooks and the progress gone, and
    // llmContent as it was apart from that?
    const probe = structuredClone(before);
    const pe = executionOf(c.kind, probe);
    delete pe.postHook;
    delete pe.failureHook;
    if (c.kind !== 'execute') probe.progress = [];
    if (pe.result.returnDisplay !== undefined && typeof pe.result.returnDisplay !== 'string' && pe.result.returnDisplay?.type !== 'shell_result') pe.result.returnDisplay = STUB;
    const textBytes = [...leaves(pe)].reduce((sum, [, t]) => sum + bytes(t) - 2, 0);
    const smallest = bytes(probe) - textBytes + [...leaves(pe)].reduce((sum, [, t]) => sum + Math.min(bytes(t) - 2, bytes(`\n[Managed Runtime provider omitted ${t.length} characters here to fit the ${c.budget}-byte wire limit.]\n`) - 2), 0);
    if (smallest <= c.budget) note('F6', c, `llmContent became the stub although cut text would take ${smallest} bytes`);
  }
  if (!llmStubbed && anyCut) {
    const used = afterBytes / c.budget;
    seen.usedMin = Math.min(seen.usedMin, used);
    seen.usedSum += used;
    seen.usedCount++;
  }
}

const lines = [];
lines.push(`[fuzz] arm=${ARM} cases=${seen.cases} already fitting=${seen.alreadyFit} with a cut=${seen.cut} progress evicted=${seen.evicted} display stubbed=${seen.stubbedDisplay} hooks dropped=${seen.hooksDropped} llmContent stubbed=${seen.stubbedLlm}`);
lines.push(`[fuzz] budget used by values that were cut: mean ${(100 * seen.usedSum / Math.max(1, seen.usedCount)).toFixed(1)} %, lowest ${(100 * seen.usedMin).toFixed(1)} %`);
const TITLES = { F1: 'the fitted value fits the budget', F2: 'a value that fits is returned unchanged', F3: 'no lone surrogate is introduced', F4: 'a notice counts exactly the code points it replaces', F5: 'what is kept is a head and a tail of the original', F6: 'llmContent becomes the stub only when cut text could not fit', F7: 'no field grows', threw: 'the fitter does not throw' };
let failed = 0;
for (const [key, list] of Object.entries(failures)) {
  const count = list.count ?? list.length;
  lines.push(`[${count ? 'FAIL' : 'PASS'}] ${key} ${TITLES[key]}${count ? ` :: ${count} cases` : ''}`);
  for (const l of list) lines.push(`        ${l}`);
  if (count) failed++;
}
lines.push(`[SUMMARY] ${Object.keys(failures).length - failed}/${Object.keys(failures).length} checks passed`);
const file = path.join(RIG, 'out', `fit-fuzz-${ARM}.log`);
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, lines.join('\n') + '\n');
console.log(lines.join('\n'));
