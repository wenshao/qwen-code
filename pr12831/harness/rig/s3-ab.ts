// A/B on the real stack: the same two probes against the PR Harness bundle and
// the candidate bundle. Each arm gets fresh Workspace storages.
// Run from wt-pr: ARM=pr|chk node --import tsx ../rig/s3-ab.ts <busyStorage> <bigStorage>
import fs from 'node:fs';
import * as L from './lib.mjs';
import { fakeToolCall, startFakeOpenAIServer } from '../wt-pr/integration-tests/fake-openai-server.ts';

const DB = 'rig1';
const HTTP = 18831;
const ARM = process.env.ARM ?? 'pr';
const [busy, big] = process.argv.slice(2);
L.openLog(`s3-ab-${ARM}`);

let releaseA!: () => void;
const holdA = new Promise<void>((r) => (releaseA = r));
const seen: string[] = [];
const model = await startFakeOpenAIServer(async ({ body }) => {
  const messages = body['messages'] as Array<{ role: string; content: unknown }>;
  const lastUser = messages.findLastIndex((m) => m.role === 'user' && /\[\[/.test(JSON.stringify(m.content)));
  const marker = [...JSON.stringify(messages[lastUser]?.content ?? '').matchAll(/\[\[([A-Z0-9_]+)\]\]/g)].at(-1)?.[1] ?? 'NONE';
  const receipts = messages.slice(lastUser + 1).filter((m) => m.role === 'tool').length;
  seen.push(`${marker}#${receipts}`);
  const [kind, tag] = marker.split('_');
  if (kind === 'HOLD') {
    if (!receipts) return { toolCalls: [fakeToolCall('write_file', { file_path: `${tag}.txt`, content: `by ${tag}` })] };
    await holdA;
    return { content: 'A done' };
  }
  if (kind === 'WRITE') {
    if (!receipts) return { toolCalls: [fakeToolCall('write_file', { file_path: `${tag}.txt`, content: `by ${tag}` })] };
    return { content: `${tag} done` };
  }
  if (kind === 'BIG') {
    if (!receipts) return { toolCalls: [fakeToolCall('write_file', { file_path: 'bigw.txt', content: 'y'.repeat(70 * 1024) })] };
    return { content: 'big done' };
  }
  return { content: 'text' };
});
const proxy = await L.startBrokerProxy('http://127.0.0.1:19831');
const h = await new L.Harness({ name: `ab-${ARM}`, modelUrl: model.baseUrl, brokerUrl: proxy.url }).start();
L.say('arm', `${ARM}: harness ${h.baseUrl} (dist of wt-${ARM})`);
async function session(st: string) {
  const ws = `ws-${st}`;
  if (L.sql(DB, `SELECT COUNT(*) FROM managed_workspace_registry WHERE workspace_id='${ws}'`)[0][0] === '0') L.seedRegistry(DB, ws, `st-${st}`);
  const s = new L.HSession(h, await L.createWorkspaceSession(HTTP, ws), L.storeConnection(h, ws, HTTP));
  const c = await s.create();
  if (c.status !== 200) throw new Error(`create ${c.status}`);
  return s;
}
const file = (st: string, n: string) => (fs.existsSync(`${L.RIG}/roots/${st}/child/${n}`) ? 'written' : 'absent');
const holder = () => JSON.stringify(L.holders(DB).filter((r) => r[1] !== '<none>').map((r) => r[1].slice(0, 8)));
try {
  L.say('busy', `--- ws-${busy}: A holds the storage while its final answer streams; B asks for a write`);
  const A = await session(busy);
  const B = await session(busy);
  const a = A.prompt('[[HOLD_A]]');
  for (let i = 0; i < 200 && !seen.includes('HOLD_A#1'); i++) await L.sleep(50);
  const t0 = Date.now();
  const b = await B.prompt('[[WRITE_B]]');
  L.say('busy', `B turn 1: ${L.summarizeTurn(b)} | broker: ${L.ledgerSince(proxy.ledger, t0).join('; ')}`);
  releaseA();
  L.say('busy', `A: ${L.summarizeTurn(await a)}`);
  const b2 = await B.prompt('[[WRITE_B2]]');
  L.say('busy', `B turn 2 (after A released): ${b2.status === 202 ? L.summarizeTurn(b2) : `admit=${b2.status} ${JSON.stringify(b2.json)}`}`);
  await B.detach();
  L.say('busy', `B reload: ${(await B.load()).status}; files A=${file(busy, 'A.txt')} B=${file(busy, 'B.txt')} B2=${file(busy, 'B2.txt')}; held storages=${holder()}`);

  L.say('big', `--- ws-${big}: J asks for a 70 KiB write; then K uses the same Workspace`);
  const J = await session(big);
  const t1 = Date.now();
  const j = await J.prompt('[[BIG]]');
  L.say('big', `J: ${L.summarizeTurn(j)} | broker: ${L.ledgerSince(proxy.ledger, t1).join('; ')}`);
  L.say('big', `held storages=${holder()} bigw.txt=${file(big, 'bigw.txt')}`);
  const K = await session(big);
  const t2 = Date.now();
  const k = await K.prompt('[[WRITE_K]]');
  L.say('big', `K: ${L.summarizeTurn(k)} | broker: ${L.ledgerSince(proxy.ledger, t2).join('; ')} | K.txt=${file(big, 'K.txt')}`);
  const j2 = await J.prompt('[[WRITE_J2]]');
  L.say('big', `J next prompt: ${j2.status === 202 ? L.summarizeTurn(j2) : `admit=${j2.status} ${JSON.stringify(j2.json)}`}`);
  L.say('log', h.log().split('\n').filter((l) => /recovery blocked|failed:/.test(l)).map((l) => l.replace(/^.*qwen serve: /, '')).join(' || '));
} finally {
  releaseA();
  await h.stop();
  await proxy.close();
  await model.close();
}
