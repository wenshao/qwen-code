// End-to-end HTTP timing against a real daemon (loopback), cache-miss legacy reads.
// usage: node bench-http.mjs <armDir> <home> <ws> <port> <samples> <out>
import { writeFileSync } from 'node:fs';
import { startDaemon, get } from './daemon.mjs';
const [arm, home, ws, port, samplesArg, out] = process.argv.slice(2);
const N = Number(samplesArg);
const d = await startDaemon({ arm, home, workspace: ws, port: Number(port), log: out.replace(/\.json$/, '.daemon.log') });
const split = d.capabilities.features.includes('extension_list_details');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ops = {
  legacyFull: async () => { await sleep(2200); return (await get(d, '/workspace/extensions')); }, // > 2 s cache TTL => always a miss
  ...(split ? {
    summary: () => get(d, '/workspace/extensions/summary'),
    detail: () => get(d, '/workspace/extensions/bulk-000/details'),
    summaryThenDetail: async () => { const a = await get(d, '/workspace/extensions/summary'); const b = await get(d, '/workspace/extensions/bulk-000/details'); return { status: a.status === 200 && b.status === 200 ? 200 : 0, ms: a.ms + b.ms, bytes: a.bytes + b.bytes }; },
  } : {}),
};
const names = Object.keys(ops);
// warm-up (also JIT): one of each
for (const n of names) await ops[n]();
const samples = Object.fromEntries(names.map((n) => [n, []])); const bytes = {};
for (let i = 0; i < N; i++) {
  const order = i % 2 ? [...names].reverse() : names;
  for (const n of order) { const r = await ops[n](); if (r.status !== 200) throw new Error(`${n} -> ${r.status}`); samples[n].push(r.ms); bytes[n] = r.bytes; }
}
await d.stop();
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const res = { arm: arm.split('/').pop(), node: process.version, platform: `${process.platform}/${process.arch}`, samples: N, medianMs: {}, rangeMs: {}, bytes, raw: samples };
for (const n of names) { res.medianMs[n] = +med(samples[n]).toFixed(2); res.rangeMs[n] = [+Math.min(...samples[n]).toFixed(2), +Math.max(...samples[n]).toFixed(2)]; }
writeFileSync(out, JSON.stringify(res, null, 2));
console.log(JSON.stringify({ arm: res.arm, medianMs: res.medianMs, rangeMs: res.rangeMs, bytes }, null, 0));
