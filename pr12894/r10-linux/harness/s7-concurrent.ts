// S7: N Hosted Shell sessions of one tenant, each on its own storage, run a large
// output at the same time through one Harness (tenant/head/journal row-lock contention).
import fs from 'node:fs';
import * as L from './lib.mjs';
import { fakeToolCall, startFakeOpenAIServer } from '/root/git/qwen-code-c2/integration-tests/fake-openai-server.ts';
const DB = process.env.DB ?? 'o2d', HTTP = 18894, BPORT = 19894;
const N = Number(process.env.N ?? 4), SO = Number(process.env.SO ?? 256 * 1024 * 1024), SE = Number(process.env.SE ?? 1048576);
const BASE = Number(process.env.ST_BASE ?? 50), TAG = process.env.TAG ?? `c${Date.now()}`;
L.openLog(`s7-${TAG}`);
const model = await startFakeOpenAIServer(async ({ body }) => {
  const messages = body['messages'] as Array<{ role: string; content: unknown }>;
  const lastUser = messages.findLastIndex((m) => m.role === 'user');
  const m = JSON.stringify(messages[lastUser]?.content ?? '').match(/\[\[(\w+)\]\]/);
  const receipts = messages.slice(lastUser + 1).filter((x) => x.role === 'tool');
  if (m && !receipts.length) return { toolCalls: [fakeToolCall('run_shell_command', { command: `${L.NODE22} ${L.RIG}/gen.mjs ${m[1]} ${SO} ${SE} 0 ${L.RIG}/run/side-${m[1]}.log` }, `call-${m[1]}`)] };
  return { content: 'done' };
});
const h = await new L.Harness({ name: `s7-${TAG}`, modelUrl: model.baseUrl, brokerUrl: `http://127.0.0.1:${BPORT}` }).start();
process.on('exit', () => { try { h.child?.kill('SIGKILL'); } catch {} });
const runs = [];
for (let i = 0; i < N; i++) {
  const st = `s${BASE + i}`, ws = `ws-${st}`, tag = `${TAG}x${i}`;
  if (L.sql(DB, `SELECT COUNT(*) FROM managed_workspace_registry WHERE workspace_id='${ws}'`)[0][0] === '0') L.seedRegistry(DB, ws, `st-${st}`);
  const sid = await L.createWorkspaceSession(HTTP, ws);
  const s = new L.HSession(h, sid, L.storeConnection(h, ws, HTTP));
  const c = await s.create();
  if (c.status !== 200) throw new Error(`create ${c.status}`);
  runs.push({ s, sid, tag });
}
const t0 = Date.now();
const results = await Promise.all(runs.map(async ({ s, sid, tag }) => {
  const t = Date.now();
  let r: any;
  try { r = await s.prompt(`[[${tag}]] run`, 1_500_000); } catch (e) { r = { terminal: [], status2: await s.status() }; }
  const pub = L.publications(DB, sid)[0];
  let bytes = 'n/a';
  if (pub) { const rb = L.rebuildStream(DB, pub.id, 'stdout'); bytes = rb.sha256 === L.genStream(tag, 'stdout', SO) ? 'exact' : `differs (${rb.segments} seg)`; }
  return `${tag}: ${L.summarizeTurn(r)} wall=${Date.now() - t}ms stdout=${bytes} phase=${pub?.phase}`;
}));
for (const l of results) L.say('run', l);
L.say('total', `${N} x ${SO} B concurrently in ${Date.now() - t0} ms`);
L.say('harness', h.log().split('\n').filter((l) => /fail|block|deadlock|timeout/i.test(l)).map((l) => l.slice(0, 240)));
await h.stop();
process.exit(0);
