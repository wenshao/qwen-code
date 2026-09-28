// S2: same-Workspace concurrency, sequential reuse, worker lifecycle.
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { R, api, sql, one, register, modelCalls, waitTurn, g0Rest, out, sleep } from './lib.mjs';

const ARM = process.env.ARM ?? 'pr';
const res = { arm: ARM };
const workers = () => {
  const lines = execSync(`ps -Ao pid,rss,command | grep 'fc30c1c3-658a-459a-9a85-13701a898397/scratchpad/wt-.*/dist/cli.js managed-runtime-worker' | grep -v grep || true`, { encoding: 'utf8' })
    .trim().split('\n').filter(Boolean);
  return { count: lines.length, rssMiB: Math.round(lines.reduce((a, l) => a + Number(l.trim().split(/\s+/)[1]), 0) / 1024) };
};
const launches = () => (fs.existsSync(`${R}/run/launches-${process.env.DB}.log`) ? fs.readFileSync(`${R}/run/launches-${process.env.DB}.log`, 'utf8').trim().split('\n').filter(Boolean).length : 0);

register('ws-seq', 'st-g');
register('ws-par', 'st-h');
res.before = { workers: workers(), launches: launches() };

// sequential: 3 sessions one after another in ws-seq
res.sequential = [];
for (let i = 1; i <= 3; i++) {
  const c = await api('POST', '/v1/agents/sessions', g0Rest('ws-seq', `G0_FILES name=seq${i}.txt`), { key: `seq-${i}` });
  const w = await waitTurn(c.json.id, { timeoutMs: 90_000 });
  res.sequential.push({ i, status: c.status, turn: w.rows[0]?.slice(1, 3), ms: w.ms, file: fs.existsSync(`${R}/roots/g/child/seq${i}.txt`) ? fs.readFileSync(`${R}/roots/g/child/seq${i}.txt`, 'utf8') : null });
}
res.afterSequential = { workers: workers(), launches: launches() };

// concurrent: 2 sessions at once in ws-par with a slow model (1.5 s per step)
const [p1, p2] = await Promise.all([
  api('POST', '/v1/agents/sessions', g0Rest('ws-par', 'G0_FILES name=par1.txt delay=1500'), { key: 'par-1' }),
  api('POST', '/v1/agents/sessions', g0Rest('ws-par', 'G0_FILES name=par2.txt delay=1500'), { key: 'par-2' }),
]);
const [w1, w2] = await Promise.all([waitTurn(p1.json.id, { timeoutMs: 120_000 }), waitTurn(p2.json.id, { timeoutMs: 120_000 })]);
const evs = async (id) => {
  const e = await api('GET', `/v1/agents/sessions/${id}/events`);
  return (e.json.data ?? []).map((x) => x.type + (x.data?.code ? `(${x.data.code})` : '') + (x.data?.error?.code ? `(${x.data.error.code})` : ''));
};
res.concurrent = [
  { status: p1.status, turn: w1.rows[0]?.slice(1, 3), ms: w1.ms, events: await evs(p1.json.id), file: fs.existsSync(`${R}/roots/h/child/par1.txt`) },
  { status: p2.status, turn: w2.rows[0]?.slice(1, 3), ms: w2.ms, events: await evs(p2.json.id), file: fs.existsSync(`${R}/roots/h/child/par2.txt`) },
];
res.leaseRows = sql(`SELECT storage_key, COALESCE(holder_key,'<null>') FROM managed_workspace_execution_lease`);
// after both settle: is ws-par usable again?
await sleep(1000);
const after = await api('POST', '/v1/agents/sessions', g0Rest('ws-par', 'G0_FILES name=par3.txt'), { key: 'par-3' });
const w3 = await waitTurn(after.json.id, { timeoutMs: 90_000 });
res.afterConcurrent = { turn: w3.rows[0]?.slice(1, 3), file: fs.existsSync(`${R}/roots/h/child/par3.txt`) };
await sleep(5000);
res.end = { workers: workers(), launches: launches() };
console.log(JSON.stringify(res, null, 1));
out(`s2-${ARM}.json`, res);
