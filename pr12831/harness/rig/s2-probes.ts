// Fault/edge probes on the real stack (MySQL 8.4.7 + Spring + embedded Broker
// + local-process workers + packaged Hosted Harness), fixture model.
// Run from wt-pr: node --import tsx ../rig/s2-probes.ts <probe...>
import fs from 'node:fs';
import * as L from './lib.mjs';
import { fakeToolCall, startFakeOpenAIServer } from '../wt-pr/integration-tests/fake-openai-server.ts';

const DB = 'rig1';
const HTTP = 18831;
const BROKER = 'http://127.0.0.1:19831';
const only = process.argv.slice(2);
L.openLog(`s2-probes${only.length ? '-' + only.join('-') : ''}`);

const gates = new Map<string, { promise: Promise<void>; open: () => void }>();
function gate(name: string) {
  if (!gates.has(name)) {
    let open!: () => void;
    const promise = new Promise<void>((r) => (open = r));
    gates.set(name, { promise, open });
  }
  return gates.get(name)!;
}
const modelLog: string[] = [];
const model = await startFakeOpenAIServer(async ({ body }) => {
  const messages = body['messages'] as Array<{ role: string; content: unknown; tool_calls?: unknown[] }>;
  const lastUser = messages.findLastIndex((m) => m.role === 'user' && /\[\[[A-Z0-9_]+\]\]/.test(JSON.stringify(m.content)));
  // Core merges adjacent user turns, so take the newest marker in the message.
  const marker = [...JSON.stringify(messages[lastUser]?.content ?? '').matchAll(/\[\[([A-Z0-9_]+)\]\]/g)].at(-1)?.[1] ?? 'NONE';
  if ([...JSON.stringify(messages[lastUser]?.content ?? '').matchAll(/\[\[([A-Z0-9_]+)\]\]/g)].length > 1)
    modelLog.push(`(merged user message: ${JSON.stringify(messages[lastUser]?.content).slice(0, 80)})`);
  const receipts = messages.slice(lastUser + 1).filter((m) => m.role === 'tool').length;
  modelLog.push(`${marker}#${receipts}`);
  const [kind, tag] = marker.split('_');
  if (kind === 'TEXT') return { content: `text answer ${tag ?? ''}` };
  if (kind === 'WRITE') {
    if (!receipts) return { toolCalls: [fakeToolCall('write_file', { file_path: `${tag}.txt`, content: `written by ${tag}` })] };
    return { content: `WRITE_${tag} done` };
  }
  if (kind === 'HOLDWRITE') {
    if (!receipts) return { toolCalls: [fakeToolCall('write_file', { file_path: `${tag}.txt`, content: `written by ${tag}` })] };
    await gate(`final-${tag}`).promise;
    return { content: `HOLDWRITE_${tag} done` };
  }
  if (kind === 'BIGREAD') {
    if (!receipts) return { toolCalls: [fakeToolCall('read_file', { file_path: 'big.txt' })] };
    return { content: 'big read done' };
  }
  if (kind === 'BIGWRITE') {
    if (!receipts) return { toolCalls: [fakeToolCall('write_file', { file_path: 'bigw.txt', content: 'y'.repeat(70 * 1024) })] };
    return { content: 'big write done' };
  }
  if (kind === 'MODELERR') {
    if (!receipts) return { toolCalls: [fakeToolCall('write_file', { file_path: `${tag}.txt`, content: 'first effect' })] };
    return { errorContent: 'upstream provider failed mid-stream' };
  }
  if (kind === 'ABS')
    return { toolCalls: [fakeToolCall('read_file', { file_path: `${L.RIG}/roots/j/child/abs.txt` })] };
  return { content: 'default' };
});
L.say('model', model.baseUrl);
const proxy = await L.startBrokerProxy(BROKER);
const h = await new L.Harness({ name: 's2', modelUrl: model.baseUrl, brokerUrl: proxy.url }).start();
L.say('harness', `${h.baseUrl} boot=${h.bootId}`);

function seeded(ws: string, st: string) {
  if (L.sql(DB, `SELECT COUNT(*) FROM managed_workspace_registry WHERE workspace_id='${ws}'`)[0][0] === '0') L.seedRegistry(DB, ws, st);
}
async function session(ws: string, st: string) {
  seeded(ws, st);
  const id = await L.createWorkspaceSession(HTTP, ws);
  const s = new L.HSession(h, id, L.storeConnection(h, ws, HTTP));
  const c = await s.create();
  if (c.status !== 200) throw new Error(`create ${c.status} ${JSON.stringify(c.json)}`);
  return s;
}
const holderOf = (st: string) => {
  const key = L.sql(DB, `SELECT storage_key, IFNULL(runtime_session_id,'<none>') FROM managed_workspace_execution_lease`);
  return key.map((k) => k[1]);
};
const want = (p: string) => !only.length || only.includes(p);
const file = (st: string, name: string) => {
  const p = `${L.RIG}/roots/${st}/child/${name}`;
  return fs.existsSync(p) ? JSON.stringify(fs.readFileSync(p, 'utf8').slice(0, 40)) : '<absent>';
};

try {
  // P1: two Sessions in the same Workspace storage, tool turns overlap.
  if (want('P1')) {
    L.say('P1', '--- two Sessions share Workspace ws-c (storage st-c); A holds the storage while its final answer streams');
    const A = await session('ws-c', 'st-c');
    const B = await session('ws-c', 'st-c');
    const aTurn = A.prompt('[[HOLDWRITE_A]]');
    for (let i = 0; i < 200 && !modelLog.includes('HOLDWRITE_A#1'); i++) await L.sleep(50);
    L.say('P1', `A is in its final model call (tool batch done); lease holders=${JSON.stringify(L.holders(DB).map((r) => r[1]))}`);
    const t0 = Date.now();
    const b = await B.prompt('[[WRITE_B]]');
    L.say('P1', `B: ${L.summarizeTurn(b)}`);
    for (const l of L.ledgerSince(proxy.ledger, t0)) L.say('P1 broker', l);
    gate('final-A').open();
    const a = await aTurn;
    L.say('P1', `A: ${L.summarizeTurn(a)}`);
    L.say('P1', `files: A.txt=${file('c', 'A.txt')} B.txt=${file('c', 'B.txt')}; holders now=${JSON.stringify(L.holders(DB).map((r) => r[1]))}`);
    const again = await B.submit('[[TEXT_B2]]');
    L.say('P1', `B new prompt after A finished -> ${again.status} ${JSON.stringify(again.json)}`);
    L.say('P1', `B detach -> ${(await B.detach()).status}; load -> ${JSON.stringify(await B.load())}`);
    L.say('P1', `harness log: ${h.log().split('\n').filter((l) => l.includes('recovery blocked')).slice(-1)[0]}`);
  }

  // P2: one large read blocks the Session and keeps the Workspace storage;
  // a second Session in that Workspace is then blocked on its first tool call.
  if (want('P2')) {
    L.say('P2', '--- Session D reads a 100 KiB file in ws-i (storage st-i)');
    fs.writeFileSync(`${L.RIG}/roots/i/child/big.txt`, Array.from({ length: 1600 }, (_, i) => `line ${String(i).padStart(4, '0')} ${'x'.repeat(56)}`).join('\n'));
    L.say('P2', `big.txt bytes=${fs.statSync(`${L.RIG}/roots/i/child/big.txt`).size}`);
    const D = await session('ws-i', 'st-i');
    const t0 = Date.now();
    const d = await D.prompt('[[BIGREAD]]');
    L.say('P2', `D: ${L.summarizeTurn(d)}`);
    for (const ev of d.events) for (const part of ev.data?.record?.message?.parts ?? []) if (part.functionResponse) L.say('P2', `read result committed: ${JSON.stringify(part.functionResponse).length} bytes JSON, output starts ${JSON.stringify(JSON.stringify(part.functionResponse.response).slice(0, 60))}, ends ${JSON.stringify(JSON.stringify(part.functionResponse.response).slice(-160))}`);
    for (const l of L.ledgerSince(proxy.ledger, t0)) L.say('P2 broker', l);
    L.say('P2', `harness log: ${h.log().split('\n').filter((l) => l.includes('recovery blocked')).slice(-1)[0]}`);
    L.say('P2', `lease holders=${JSON.stringify(L.holders(DB))}`);
    const E = await session('ws-i', 'st-i');
    const t1 = Date.now();
    const e = await E.prompt('[[WRITE_E]]');
    L.say('P2', `E (new Session, same Workspace): ${L.summarizeTurn(e)}`);
    for (const l of L.ledgerSince(proxy.ledger, t1)) L.say('P2 broker', l);
    L.say('P2', `E.txt=${file('i', 'E.txt')}`);
    const et = await E.prompt('[[TEXT_E2]]');
    L.say('P2', `E text-only prompt afterwards -> admit=${et.status} ${JSON.stringify(et.json)}`);
  }

  // P3: the model writes a 70 KiB file (under the 256 KiB Broker cap, over the
  // 64 KiB inline Session Store cap); then a second Session uses the Workspace.
  if (want('P3')) {
    L.say('P3', '--- Session J writes 70 KiB in ws-e (storage st-e)');
    const J = await session('ws-e', 'st-e');
    const t0 = Date.now();
    const j = await J.prompt('[[BIGWRITE]]');
    L.say('P3', `J: ${L.summarizeTurn(j)}`);
    for (const l of L.ledgerSince(proxy.ledger, t0)) L.say('P3 broker', l);
    L.say('P3', `harness log: ${h.log().split('\n').filter((l) => l.includes('recovery blocked')).slice(-1)[0]}`);
    L.say('P3', `bigw.txt=${file('e', 'bigw.txt')} lease holders=${JSON.stringify(L.holders(DB).map((r) => r[1]))}`);
    const K = await session('ws-e', 'st-e');
    const t1 = Date.now();
    const k = await K.prompt('[[WRITE_K]]');
    L.say('P3', `K (new Session, same Workspace): ${L.summarizeTurn(k)}`);
    for (const l of L.ledgerSince(proxy.ledger, t1)) L.say('P3 broker', l);
    L.say('P3', `K.txt=${file('e', 'K.txt')}`);
  }

  // P4: provider error after a committed tool batch; then a new prompt.
  if (want('P4')) {
    L.say('P4', '--- Session G: write succeeds, continuation model call fails mid-stream (ws-f)');
    const G = await session('ws-f', 'st-f');
    const t0 = Date.now();
    const g = await G.prompt('[[MODELERR_G]]');
    L.say('P4', `G turn 1: ${L.summarizeTurn(g)}`);
    for (const l of L.ledgerSince(proxy.ledger, t0)) L.say('P4 broker', l);
    L.say('P4', `G.txt=${file('f', 'G.txt')} holders=${JSON.stringify(L.holders(DB).map((r) => r[1]))}`);
    const t1 = Date.now();
    const g2 = await G.prompt('[[WRITE_G2]]');
    L.say('P4', `G turn 2 (new prompt with a tool): ${L.summarizeTurn(g2)}`);
    for (const l of L.ledgerSince(proxy.ledger, t1)) L.say('P4 broker', l);
    L.say('P4', `G2.txt=${file('f', 'G2.txt')}`);
    L.say('P4', `harness log tail: ${h.log().split('\n').filter((l) => /G|recovery|failed/.test(l)).slice(-3).join(' | ')}`);
    L.say('P4', `detach -> ${(await G.detach()).status}; load -> ${JSON.stringify(await G.load())}`);
  }

  // P5: cancel while the continuation after a tool batch is streaming.
  if (want('P5')) {
    L.say('P5', '--- Session H2: cancel during the final model call after a completed write (ws-g)');
    const H2 = await session('ws-g', 'st-g');
    const sub = H2.prompt('[[HOLDWRITE_H]]');
    for (let i = 0; i < 200 && !modelLog.includes('HOLDWRITE_H#1'); i++) await L.sleep(50);
    L.say('P5', `cancel -> ${(await H2.cancel()).status}`);
    const r = await sub;
    L.say('P5', `turn: ${L.summarizeTurn(r)}`);
    gate('final-H').open();
    L.say('P5', `holders=${JSON.stringify(L.holders(DB).map((x) => x[1]))}`);
    const r2 = await H2.prompt('[[WRITE_H2]]');
    L.say('P5', `next prompt with a tool: ${L.summarizeTurn(r2)} H2.txt=${file('g', 'H2.txt')}`);
    L.say('P5', `detach -> ${(await H2.detach()).status}; load -> ${JSON.stringify(await H2.load())}`);
  }

  // P6: absolute path from the model.
  if (want('P6')) {
    L.say('P6', '--- Session I: model passes an absolute file_path (ws-j)');
    fs.writeFileSync(`${L.RIG}/roots/j/child/abs.txt`, 'abs');
    const I = await session('ws-j', 'st-j');
    const t0 = Date.now();
    const r = await I.prompt('[[ABS]]');
    L.say('P6', `turn: ${L.summarizeTurn(r)} broker calls=${JSON.stringify(L.ledgerSince(proxy.ledger, t0))}`);
    L.say('P6', `harness log: ${h.log().split('\n').filter((l) => l.includes('failed')).slice(-1)[0]}`);
    const r2 = await I.prompt('[[TEXT_I]]');
    L.say('P6', `next text prompt: ${L.summarizeTurn(r2)}`);
  }
} finally {
  for (const g of gates.values()) g.open();
  L.say('model-log', modelLog.join(' '));
  await h.stop();
  await proxy.close();
  await model.close();
}
