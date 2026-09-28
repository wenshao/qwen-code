// PR #12950 probe S4: refusal paths the driver does not walk.
//  LOOP16           model never corrects -> 16-round bound
//  REFUSE_THEN_TEXT model gives up after one refusal (no acquisition at all)
//  ACQUIRE_REFUSE   valid write (acquires) -> invalid batch -> text: is the lease released?
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import * as L from './lib.mjs';
import { fakeToolCall, startFakeOpenAIServer } from '../wt-pr/integration-tests/fake-openai-server.ts';

const ARM = process.env.ARM ?? 'pr';
const DB = process.env.DB ?? 'p950a';
const HTTP = Number(process.env.HTTP ?? 18950);
const BPORT = Number(process.env.BPORT ?? 19950);
const ROOTS = path.resolve(L.RIG, process.env.ROOTS ?? 'roots');
const ST = process.env.ST ?? 'f';
L.openLog(`s4-rounds-${ARM}${process.env.KEYS ? '-' + process.env.KEYS : ''}`);
const ws = `ws-${ST}`;
const dir = path.join(ROOTS, ST, 'child');
const counts: Record<string, number> = {};
const model = await startFakeOpenAIServer(async ({ body }) => {
  const messages = body['messages'] as Array<{ role: string; content: unknown }>;
  const lastUser = messages.findLastIndex((m) => m.role === 'user');
  const key = [...JSON.stringify(messages[lastUser]?.content ?? '').matchAll(/\[\[([A-Z_0-9]+)\]\]/g)].at(-1)?.[1] ?? '';
  const receipts = messages.slice(lastUser + 1).filter((m) => m.role === 'tool');
  counts[key] = (counts[key] ?? 0) + 1;
  const n = counts[key];
  if (key === 'LOOP16') return { toolCalls: [fakeToolCall('read_file', { file_path: path.join(dir, 'proof.txt') }, `loop-${n}`)] };
  if (key === 'LOOP16V') return { toolCalls: [fakeToolCall('read_file', { file_path: path.join(dir, `proof-${n}.txt`) }, `loopv-${n}`)] };
  if (key === 'REFUSE_THEN_TEXT') return receipts.length ? { content: 'I cannot read absolute paths; stopping.' } : { toolCalls: [fakeToolCall('read_file', { file_path: '/etc/hosts' }, 'rtt-invalid')] };
  if (key === 'ACQUIRE_REFUSE') {
    if (receipts.length === 0) return { toolCalls: [fakeToolCall('write_file', { file_path: 'acq.txt', content: 'acquired' }, 'acq-write')] };
    if (receipts.length === 1) return { toolCalls: [fakeToolCall('read_file', { file_path: path.join(dir, 'acq.txt') }, 'acq-invalid')] };
    return { content: 'ACQUIRE_REFUSE_DONE' };
  }
  if (key === 'PLAIN') return receipts.length ? { content: 'PLAIN_DONE' } : { toolCalls: [fakeToolCall('read_file', { file_path: 'proof.txt' }, `plain-${n}`)] };
  if (key === 'HISTORY') {
    const calls = messages.flatMap((m: any) => (m.tool_calls ?? []).map((c: any) => c.id));
    const tools = messages.filter((m) => m.role === 'tool').map((m: any) => m.tool_call_id);
    return { content: `HISTORY calls=${calls.length} results=${tools.length} paired=${JSON.stringify(calls) === JSON.stringify(tools)}` };
  }
  return { content: 'ok' };
});
const proxy = await L.startBrokerProxy(`http://127.0.0.1:${BPORT}`);
const h = await new L.Harness({ name: `s4-${ARM}`, modelUrl: model.baseUrl, brokerUrl: proxy.url }).start();
if (L.sql(DB, `SELECT COUNT(*) FROM managed_workspace_registry WHERE workspace_id='${ws}'`)[0][0] === '0') L.seedRegistry(DB, ws, `st-${ST}`);
fs.writeFileSync(path.join(dir, 'proof.txt'), 'PROOF\n');
const skey = createHash('sha256').update(`t-rig\0st-${ST}`).digest('hex');
const holder = () => L.holders(DB).find(([k]) => k.includes(skey))?.[1] ?? '<no row>';
const out: any = {};
for (const key of (process.env.KEYS ?? 'LOOP16,REFUSE_THEN_TEXT,ACQUIRE_REFUSE').split(',')) {
  const s = new L.HSession(h, await L.createWorkspaceSession(HTTP, ws), L.storeConnection(h, ws, HTTP));
  await s.create();
  const t0 = Date.now();
  const r = await s.prompt(`[[${key}]]`);
  const parts = (r.events ?? []).flatMap((e: any) => e.data?.record?.message?.parts ?? []);
  const broker = proxy.ledger.filter((e: any) => e.t >= t0).map((e: any) => e.url.replace('/internal/runtime-broker/v1', '').replace(/\/[0-9a-f-]{36}/g, '/…'));
  const summary: any = {
    turn: L.summarizeTurn(r),
    modelRequests: counts[key],
    persistedCalls: parts.filter((p: any) => p.functionCall).length,
    persistedResults: parts.filter((p: any) => p.functionResponse).length,
    brokerCalls: [...new Set(broker)].map((u) => `${u}×${broker.filter((x) => x === u).length}`),
    holderAfterTurn: holder(),
    harnessErr: h.log().split('\n').filter((l) => l.includes(r.promptId)).slice(-1)[0]?.slice(0, 160) ?? null,
  };
  const next = await s.prompt('[[PLAIN]]');
  summary.nextPromptSameSession = L.summarizeTurn(next);
  await s.detach();
  const loaded = await s.load();
  summary.reload = loaded.status;
  const hist = loaded.status === 200 ? await s.prompt('[[HISTORY]]') : null;
  summary.historyAfterReload = hist ? `${L.summarizeTurn(hist)} ${L.assistantText(hist.events ?? []).slice(0, 80)}` : null;
  await s.detach();
  out[key] = summary;
  L.say(key, summary);
}
fs.writeFileSync(path.join(L.RIG, 'out', `s4-rounds-${ARM}${process.env.KEYS ? '-' + process.env.KEYS : ''}.json`), JSON.stringify(out, null, 2));
await h.stop();
await proxy.close();
process.exit(0);
