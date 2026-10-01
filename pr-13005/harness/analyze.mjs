// Summarise every run under runs/: per-case request breakdown from the
// recording proxy, vitest per-test durations/outcome, and the monitor
// tool_call telemetry record.
import fs from 'node:fs';
import path from 'node:path';

const ROOT = '/root/verify/pr13005/runs';
const strip = (s) => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');

function telemetryObjects(file) {
  const s = fs.readFileSync(file, 'utf8');
  const out = [];
  let d = 0, st = -1, inStr = false, esc = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{') { if (d === 0) st = i; d++; }
    else if (c === '}') { d--; if (d === 0) { try { out.push(JSON.parse(s.slice(st, i + 1))); } catch {} } }
  }
  return out;
}

function findFiles(dir, name, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) findFiles(p, name, acc);
    else if (e.name === name) acc.push(p);
  }
  return acc;
}

const rows = [];
for (const rid of fs.readdirSync(ROOT).sort()) {
  const dir = path.join(ROOT, rid);
  if (!fs.existsSync(path.join(dir, 'meta.json'))) continue;
  const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'));
  const reqs = fs.existsSync(path.join(dir, 'proxy.jsonl'))
    ? fs.readFileSync(path.join(dir, 'proxy.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)).sort((a, b) => a.tRecv - b.tRecv)
    : [];
  // Split by case: each case has exactly one main:user-prompt request, and a
  // case's CLI process exits before the next case starts.
  const starts = reqs.map((r, i) => (r.purpose === 'main:user-prompt' ? i : -1)).filter((i) => i >= 0);
  const cases = {};
  if (meta.filter) cases.call = reqs;
  else {
    cases.registered = reqs.slice(0, starts[1] ?? reqs.length);
    cases.call = starts[1] !== undefined ? reqs.slice(starts[1]) : [];
  }
  const vt = strip(fs.readFileSync(path.join(dir, 'vitest.ansi'), 'utf8'));
  const dur = (re) => { const m = vt.match(re); return m ? { ok: m[1] === '✓', ms: Number(m[2]) } : null; };
  const callRes = dur(/([✓×]) monitor-tool > should call monitor tool when asked to watch a command\s+(\d+)ms/);
  const regRes = dur(/([✓×]) monitor-tool > should have monitor tool registered\s+(\d+)ms/);
  const timedOut = /Test timed out in (\d+)ms/.exec(vt);
  const monitorCalls = [];
  for (const f of findFiles(path.join(dir, 'itest-output'), 'telemetry.log')) {
    if (!f.includes('monitor-tool-call')) continue;
    for (const o of telemetryObjects(f)) {
      const a = o.attributes || {};
      if (a['event.name'] === 'qwen-code.tool_call') monitorCalls.push({ fn: a.function_name, success: a.success });
    }
  }
  const summarise = (list) => {
    if (!list.length) return null;
    const t0 = list[0].tRecv;
    const by = {};
    for (const r of list) by[r.purpose] = (by[r.purpose] || 0) + 1;
    return {
      n: list.length,
      byPurpose: by,
      toolsCalled: list.flatMap((r) => r.respToolCalls),
      monitorDeclaredUpfront: list[0].tools.includes('monitor'),
      spanSec: +((Math.max(...list.map((r) => r.tEnd)) - t0) / 1000).toFixed(1),
      ttfbSec: list.map((r) => +((r.tFirstByte - r.tRecv) / 1000).toFixed(1)),
    };
  };
  rows.push({
    rid, arm: meta.arm, injectMs: meta.injectMs, exit: meta.exit, wallSec: meta.wallSec,
    call: { vitest: callRes, timedOut: timedOut ? Number(timedOut[1]) : null, ...summarise(cases.call), telemetry: monitorCalls },
    registered: meta.filter ? null : { vitest: regRes, ...summarise(cases.registered) },
  });
}
fs.writeFileSync('/root/verify/pr13005/summary.json', JSON.stringify(rows, null, 2));
for (const r of rows) {
  const c = r.call;
  console.log(
    `${r.rid.padEnd(16)} arm=${r.arm.padEnd(4)} L=${String(r.injectMs / 1000).padStart(2)}s exit=${r.exit} ` +
      `call:${c.vitest ? (c.vitest.ok ? 'PASS' : 'FAIL') : '?'} ${c.vitest ? (c.vitest.ms / 1000).toFixed(1) + 's' : ''} ` +
      `reqs=${c.n} ${JSON.stringify(c.byPurpose)} upfront=${c.monitorDeclaredUpfront} tel=${JSON.stringify(c.telemetry)}` +
      (r.registered ? ` | reg:${r.registered.vitest?.ok ? 'PASS' : 'FAIL'} ${(r.registered.vitest?.ms / 1000).toFixed(1)}s reqs=${r.registered.n} ${JSON.stringify(r.registered.byPurpose)}` : ''),
  );
}
