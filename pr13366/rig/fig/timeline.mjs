// SVG swimlane of one 2-Session run from its logs: the real lease row (sampled every
// 100 ms), the Harness→Broker tap (acquire refusals, releases) and the driver timeline.
// usage (module): timeline(run) → { svg, stats }; (cli) node timeline.mjs <run> → svg on stdout
import { readFileSync } from 'node:fs';

export function timeline(run, { width = 1480 } = {}) {
  const dir = `/Users/wenshao/pr13366-rig/out/runs/${run}`;
  const result = JSON.parse(readFileSync(`${dir}/result.json`, 'utf8').trim().split('\n').at(-1));
  const jl = (f) => readFileSync(`${dir}/${f}`, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const t0 = jl('model.jsonl').find((e) => e.t0).t;
  const tap = jl('broker-tap.jsonl').map((e) => ({ ...e, r: e.t - t0 }));
  const acq = tap.filter((e) => e.p.endsWith('tool-sessions:acquire'));
  const busy = acq.filter((e) => e.s === 409);
  const releases = tap.filter((e) => e.p.endsWith(':release'));
  const tl = result.timeline;
  const lane = (label) => label[0];
  const sidToLabel = Object.fromEntries(tl.filter((e) => e.what === 'created').map((e) => [e.session, e.label]));
  const ridToLabel = {};
  for (const e of tap) {
    const q = /harnessSessionId=([^&]+)&runtimeSessionId=([^&]+)/.exec(e.p);
    if (q && sidToLabel[q[1]]) ridToLabel[q[2]] = sidToLabel[q[1]];
  }
  const spans = [];
  let open;
  for (const e of tl.filter((x) => x.what === 'lease')) {
    const id = e.row.split(' ')[0];
    if (open && open.id !== id) { open.end = e.t; spans.push(open); open = undefined; }
    if (id !== '-' && !open) open = { id, start: e.t, who: ridToLabel[id] ?? '?' };
  }
  if (open) { open.end = tl.at(-1).t; spans.push(open); }
  const end = Math.max(...tl.map((e) => e.t)) + 400;
  const left = 150, right = 30, plotW = width - left - right;
  const x = (ms) => left + (Math.max(0, ms) / end) * plotW;
  const Y = { A: 62, B: 140 };
  const color = { A: '#1f6feb', B: '#238636' };
  let s = `<svg xmlns="http://www.w3.org/2000/svg" xml:space="preserve" width="${width}" height="275" font-family="ui-monospace,Menlo,monospace" font-size="14">`;
  const step = end > 60000 ? 10000 : end > 20000 ? 5000 : end > 8000 ? 1000 : 250;
  for (let t = 0; t <= end; t += step) {
    s += `<line x1="${x(t)}" y1="30" x2="${x(t)}" y2="222" stroke="#21262d"/>`;
    s += `<text x="${x(t)}" y="242" fill="#8b949e" text-anchor="middle" font-size="13">${step >= 1000 ? t / 1000 + ' s' : t + ' ms'}</text>`;
  }
  for (const [l, y] of Object.entries(Y)) s += `<text x="12" y="${y + 5}" fill="#e6edf3" font-weight="bold">Session ${l}</text>`;
  s += `<text x="12" y="210" fill="#8b949e" font-size="13">lease row</text>`;
  for (const sp of spans) {
    const c = color[lane(sp.who)] ?? '#6e7681';
    const w = Math.max(3, x(sp.end) - x(sp.start));
    s += `<rect x="${x(sp.start)}" y="196" width="${w}" height="22" fill="${c}" rx="3"/>`;
    if (w > 70) s += `<text x="${x(sp.start) + 6}" y="212" fill="#fff" font-size="12">${sp.who} holds</text>`;
    s += `<rect x="${x(sp.start)}" y="${Y[lane(sp.who)] - 13}" width="${w}" height="26" fill="${c}" opacity="0.3" rx="4"/>`;
  }
  // a refusal belongs to the Session that does not hold the row at that instant
  for (const b of busy) {
    const holder = spans.find((sp) => b.r >= sp.start - 150 && b.r <= sp.end + 150);
    const waiter = holder ? (lane(holder.who) === 'A' ? 'B' : 'A') : 'B';
    s += `<line x1="${x(b.r)}" y1="${Y[waiter] - 11}" x2="${x(b.r)}" y2="${Y[waiter] + 11}" stroke="#d29922" stroke-width="1.6"/>`;
  }
  for (const r of releases) s += `<line x1="${x(r.r)}" y1="190" x2="${x(r.r)}" y2="224" stroke="#f0f6fc" stroke-width="2" stroke-dasharray="3,2"/>`;
  for (const e of tl.filter((e) => e.what === 'created' || e.what === 'followup'))
    s += `<circle cx="${x(e.t)}" cy="${Y[lane(e.label)]}" r="6" fill="#8b949e"/>`;
  const used = [];
  for (const e of tl.filter((e) => e.what === 'terminal')) {
    const ok = /completed/.test(e.type);
    const code = (JSON.parse(e.data ?? 'null') ?? {}).code;
    const y = Y[lane(e.label)];
    const c = ok ? '#3fb950' : /cancel/.test(e.type) ? '#f0883e' : '#f85149';
    s += `<text x="${x(e.t)}" y="${y + 6}" fill="${c}" font-size="19" text-anchor="middle">${ok ? '✔' : '✖'}</text>`;
    const label = `${e.label} ${e.type.replace('turn.', '')}${code ? ` (${code})` : ''} @${(e.t / 1000).toFixed(1)}s`;
    const lx = Math.min(x(e.t) + 10, width - label.length * 8.2 - 6);
    const ly = y - 19 - (used.filter((u) => u.lane === lane(e.label) && Math.abs(u.x - lx) < 300).length * 15);
    used.push({ lane: lane(e.label), x: lx });
    s += `<text x="${lx}" y="${ly}" fill="${c}" font-size="13">${label}</text>`;
  }
  for (const c of tl.filter((e) => e.what === 'cancel'))
    s += `<text x="${x(c.t)}" y="${Y[lane(c.label)] + 30}" fill="#f0883e" font-size="13" text-anchor="middle">▲ cancel ${c.label} (${c.status})</text>`;
  s += `<text x="${left}" y="266" fill="#8b949e" font-size="12.5">● created / follow-up  ·  amber tick = 409 workspace_busy from the real Broker (${busy.length})  ·  white dashed = :release  ·  bar = holder in managed_workspace_execution_lease</text>`;
  s += '</svg>';
  return { svg: s, stats: { run, end, busy: busy.length, releases: releases.length, spans: spans.map((sp) => `${sp.who}:${sp.start}-${sp.end}`) } };
}

if (process.argv[1]?.endsWith('timeline.mjs') && process.argv[2]) {
  const { svg, stats } = timeline(process.argv[2]);
  console.log(svg);
  console.error(JSON.stringify(stats));
}
