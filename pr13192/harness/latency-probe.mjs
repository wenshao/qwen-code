// Alternates writer renewals between two live servers (base and head) so host
// load drift hits both arms equally; reports per-arm latency percentiles.
import { writeFileSync } from 'node:fs';

const [, , baseUrlA, baseUrlB, rounds, outFile] = process.argv;
const arms = { base: baseUrlA, head: baseUrlB };
const samples = { base: [], head: [] };
const sessions = {};

async function post(url, session, op, body) {
  const started = process.hrtime.bigint();
  const response = await fetch(`${url}/internal/managed-session-store/v1/sessions/${session}/writers:${op}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Qwen-Tenant-Id': 'latency',
      'X-Qwen-Managed-Writer-Token': 'l'.repeat(32) },
    body: JSON.stringify(body),
  });
  await response.text();
  if (response.status !== 200) throw new Error(`${op} ${response.status}`);
  return Number(process.hrtime.bigint() - started) / 1e6;
}

for (const [arm, url] of Object.entries(arms)) {
  sessions[arm] = `lat-${arm}-${Date.now()}`;
  await post(url, sessions[arm], 'acquire', { workspaceId: 'ws-lat', writerId: 'w', leaseMillis: 60000 });
  for (let i = 0; i < 20; i++) {
    await post(url, sessions[arm], 'renew', { workspaceId: 'ws-lat', writerId: 'w', writerGeneration: 1, leaseMillis: 60000 });
  }
}
for (let i = 0; i < Number(rounds); i++) {
  const order = i % 2 === 0 ? ['base', 'head'] : ['head', 'base'];
  for (const arm of order) {
    samples[arm].push(await post(arms[arm], sessions[arm], 'renew',
      { workspaceId: 'ws-lat', writerId: 'w', writerGeneration: 1, leaseMillis: 60000 }));
  }
}
const pct = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const summary = {};
for (const arm of Object.keys(samples)) {
  summary[arm] = { n: samples[arm].length, p50: +pct(samples[arm], 0.5).toFixed(2),
    p90: +pct(samples[arm], 0.9).toFixed(2), p99: +pct(samples[arm], 0.99).toFixed(2) };
}
summary.deltaP50Ms = +(summary.head.p50 - summary.base.p50).toFixed(2);
writeFileSync(outFile, JSON.stringify({ summary, samples }, null, 2));
console.log(JSON.stringify(summary));
