// PR #12950 probe S3: failed / uncertain refusal commits must block recovery.
// A Store proxy sits between the Harness and Spring's Session Store and fails
// (503) or drops the reply of the one commit that carries the refusal batch.
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import * as L from './lib.mjs';
import { fakeToolCall, startFakeOpenAIServer } from '../wt-pr/integration-tests/fake-openai-server.ts';

const ARM = process.env.ARM ?? 'pr';
const DB = process.env.DB ?? 'p950a';
const HTTP = Number(process.env.HTTP ?? 18950);
const BPORT = Number(process.env.BPORT ?? 19950);
const ROOTS = path.resolve(L.RIG, process.env.ROOTS ?? 'roots');
const LETTERS = (process.env.LETTERS ?? 'b,c,d,e').split(',');
L.openLog(`s3-commit-fault-${ARM}`);

type Fault = { name: string; match: 'assistant' | 'tool_result'; action: 'fail-503' | 'drop-reply-after-forward'; acquireFirst?: boolean };
const FAULTS: Fault[] = [
  { name: 'ASSISTANT_503', match: 'assistant', action: 'fail-503' },
  { name: 'RESULT_503', match: 'tool_result', action: 'fail-503' },
  { name: 'RESULT_REPLY_LOST', match: 'tool_result', action: 'drop-reply-after-forward' },
  { name: 'AFTER_ACQUIRE_RESULT_503', match: 'tool_result', action: 'fail-503', acquireFirst: true },
];

const model = await startFakeOpenAIServer(async ({ body }) => {
  const messages = body['messages'] as Array<{ role: string; content: unknown }>;
  const lastUser = messages.findLastIndex((m) => m.role === 'user');
  const key = [...JSON.stringify(messages[lastUser]?.content ?? '').matchAll(/\[\[([A-Z_0-9]+)\]\]/g)].at(-1)?.[1];
  const receipts = messages.slice(lastUser + 1).filter((m) => m.role === 'tool');
  if (key === 'PLAIN') {
    if (!receipts.length) return { toolCalls: [fakeToolCall('write_file', { file_path: `plain-${Date.now()}.txt`, content: 'plain' }, `plain-${Date.now()}`)] };
    return { content: 'PLAIN_DONE' };
  }
  const f = FAULTS.find((x) => x.name === key);
  if (!f) return { content: 'ok' };
  const invalid = () => fakeToolCall('read_file', { file_path: '/etc/hosts' }, `${key!.toLowerCase()}-invalid`);
  if (f.acquireFirst) {
    if (receipts.length === 0) return { toolCalls: [fakeToolCall('write_file', { file_path: `pre-${key}.txt`, content: 'pre' }, `${key!.toLowerCase()}-pre`)] };
    if (receipts.length === 1) return { toolCalls: [invalid()] };
    return { content: `DONE_${key}` };
  }
  if (receipts.length === 0) return { toolCalls: [invalid()] };
  return { content: `DONE_${key}` };
});

const storeProxy = await L.startPassProxy(`http://127.0.0.1:${HTTP}`);
const h = await new L.Harness({ name: `s3-${ARM}`, modelUrl: model.baseUrl, brokerUrl: `http://127.0.0.1:${BPORT}` }).start();
const results: any[] = [];
for (const [i, f] of FAULTS.entries()) {
  const letter = LETTERS[i];
  const ws = `ws-${letter}`;
  if (L.sql(DB, `SELECT COUNT(*) FROM managed_workspace_registry WHERE workspace_id='${ws}'`)[0][0] === '0') L.seedRegistry(DB, ws, `st-${letter}`);
  const conn = { ...L.storeConnection(h, ws, HTTP), baseUrl: storeProxy.url };
  const s = new L.HSession(h, await L.createWorkspaceSession(HTTP, ws), conn);
  const created = await s.create();
  if (created.status !== 200) throw new Error(`create: ${created.status} ${JSON.stringify(created.json)}`);
  let hits = 0;
  storeProxy.state.hook = (entry: any, body: Buffer) => {
    if (!entry.url.endsWith('/transactions:commit')) return 'forward';
    const j = JSON.parse(body.toString('utf8'));
    if (j.operation !== 'commitMessage') return 'forward';
    const text = (j.resources ?? []).map((r: any) => (r.bytesBase64 ? Buffer.from(r.bytesBase64, 'base64').toString('utf8') : '')).join('\n');
    const isRefusalAssistant = f.match === 'assistant' && text.includes('"type":"assistant"') && text.includes(`${f.name.toLowerCase()}-invalid`);
    const isRefusalResult = f.match === 'tool_result' && text.includes('"type":"tool_result"') && text.includes('Hosted file tools require file_path');
    if (isRefusalAssistant || isRefusalResult) {
      hits++;
      return f.action;
    }
    return 'forward';
  };
  const r = await s.prompt(`[[${f.name}]]`);
  storeProxy.state.hook = null;
  const lease = L.holders(DB);
  const skey = createHash('sha256').update('t-rig\0st-' + letter).digest('hex');
  const heldBy = lease.find(([k]) => k.includes(skey))?.[1] ?? '<no row>';
  // Can a different Session in the same Workspace still run a tool?
  const other = new L.HSession(h, await L.createWorkspaceSession(HTTP, ws), L.storeConnection(h, ws, HTTP));
  await other.create();
  const o = await other.prompt('[[PLAIN]]');
  await other.detach();
  // The faulted Session: another prompt, then detach + load + prompt.
  const again = await s.submit('[[PLAIN]]');
  if (again.status === 202) await s.waitIdle().catch(() => undefined);
  const againStatus = await s.status();
  const det = await s.detach();
  const loaded = await s.load();
  const afterLoad = loaded.status === 200 ? await s.submit('[[PLAIN]]') : { status: 'n/a', json: null };
  const res = {
    fault: f.name,
    injectedHits: hits,
    terminal: r.terminal?.map((t: any) => t.type).join(',') || '<none>',
    recoveryBlocked: r.status2?.recoveryBlocked,
    leaseRowsHeld: heldBy,
    otherSessionSameWorkspace: L.summarizeTurn(o),
    samePromptAgain: `${again.status} ${again.status === 202 ? 'blocked=' + againStatus?.recoveryBlocked : JSON.stringify(again.json).slice(0, 90)}`,
    sessionId: s.sessionId,
    letter,
    detach: `${det.status} ${det.status === 204 ? '' : JSON.stringify(det.json).slice(0, 80)}`,
    reload: `${loaded.status} ${loaded.status === 200 ? '' : JSON.stringify(loaded.json).slice(0, 90)}`,
    promptAfterReload: `${afterLoad.status} ${JSON.stringify(afterLoad.json).slice(0, 90)}`,
    harnessLog: h.log().split('\n').filter((l) => l.includes('recovery blocked') || l.includes('failed:')).slice(-2),
  };
  if (loaded.status === 200 && afterLoad.status === 202) await s.waitIdle().catch(() => undefined);
  await s.detach().catch(() => undefined);
  results.push(res);
  L.say(f.name, res);
}
// Cold reload of every faulted Session in a brand-new Harness process.
await h.stop();
const h2 = await new L.Harness({ name: `s3-cold-${ARM}`, modelUrl: model.baseUrl, brokerUrl: `http://127.0.0.1:${BPORT}` }).start();
for (const res of results) {
  const ws = `ws-${res.letter}`;
  const s2 = new L.HSession(h2, res.sessionId, L.storeConnection(h2, ws, HTTP));
  const ld = await s2.load();
  const st = ld.status === 200 ? await s2.status() : null;
  const pr = ld.status === 200 ? await s2.submit('[[PLAIN]]') : null;
  if (pr?.status === 202) await s2.waitIdle().catch(() => undefined);
  res.coldLoad = `load=${ld.status}${ld.status === 200 ? '' : ' ' + JSON.stringify(ld.json).slice(0, 80)} blocked=${st?.recoveryBlocked} prompt=${pr ? pr.status + ' ' + (pr.status === 202 ? '' : JSON.stringify(pr.json).slice(0, 80)) : 'n/a'}`;
  L.say(`${res.fault}:cold`, res.coldLoad);
}
await h2.stop();
L.say('holders', L.holders(DB));
fs.writeFileSync(path.join(L.RIG, 'out', `s3-commit-fault-${ARM}.json`), JSON.stringify(results, null, 2));
await h.stop();
await storeProxy.close();
process.exit(0);
