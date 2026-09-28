// Live checks for the /review Criticals on 6846d1e2.
// R1-1: a stdout write after that stream's finish -> spurious blocked receipt?
//        Sweep of fast-exit output shapes + a grandchild that keeps stdout open.
// R1-2: a Shell that never spawns (its cwd was deleted by the previous call).
import fs from 'node:fs';
import * as L from './lib.mjs';
import { fakeToolCall, startFakeOpenAIServer } from '../wt-pr/integration-tests/fake-openai-server.ts';

const DB = process.env.DB ?? 'p848f';
const HTTP = Number(process.env.HTTP ?? 18848);
const ROOTS = process.env.ROOTS ?? 'roots6';
const MODE = process.env.MODE ?? 'sweep';
L.openLog(`s19-${MODE}-${process.env.ARM ?? ''}`);
const SHAPES = [
  'printf x',
  'head -c 65536 /dev/zero | tr "\\000" a',
  'head -c 65537 /dev/zero | tr "\\000" a',
  'head -c 1048577 /dev/zero | tr "\\000" b',
  'head -c 3145728 /dev/zero | tr "\\000" c; echo tail',
  'head -c 2000000 /dev/zero | tr "\\000" d; head -c 700000 /dev/zero | tr "\\000" e >&2',
  'seq 1 200000',
  'for i in 1 2 3 4 5 6 7 8; do head -c 300000 /dev/zero | tr "\\000" f; head -c 1000 /dev/zero | tr "\\000" g >&2; done',
];
const calls: Record<string, Array<[string, Record<string, unknown>]>> = {};
let queue: Array<Array<[string, Record<string, unknown>]>> = [];
const model = await startFakeOpenAIServer(async ({ body }) => {
  const messages = body['messages'] as Array<{ role: string; content: unknown }>;
  const lastUser = messages.findLastIndex((m) => m.role === 'user');
  const key = (JSON.stringify(messages[lastUser]?.content ?? '').match(/\[\[(K\d+)\]\]/) ?? [])[1];
  const receipts = messages.slice(lastUser + 1).filter((m) => m.role === 'tool');
  if (key && calls[key] && !receipts.length) return { toolCalls: calls[key].map(([n, a], i) => fakeToolCall(n, a, `${key}-${i}`)) };
  return { content: 'ok' };
});
void queue;
const h = await new L.Harness({ name: `crit-${MODE}`, modelUrl: model.baseUrl, brokerUrl: 'http://127.0.0.1:19848' }).start();
async function session(st: string) {
  const ws = `ws-${st}`;
  if (L.sql(DB, `SELECT COUNT(*) FROM managed_workspace_registry WHERE workspace_id='${ws}'`)[0][0] === '0') L.seedRegistry(DB, ws, `st-${st}`);
  fs.mkdirSync(`${L.RIG}/${ROOTS}/${st}/child`, { recursive: true });
  const s = new L.HSession(h, await L.createWorkspaceSession(HTTP, ws), L.storeConnection(h, ws, HTTP));
  const c = await s.create({ toolProfile: 'hosted-workspace-shell/1' });
  if (c.status !== 200) throw new Error(`create ${c.status}`);
  return s;
}
function results(events: any[]) {
  return events.flatMap((e) => e.data?.record?.message?.parts ?? []).filter((p: any) => p.functionResponse).map((p: any) => {
    const r = p.functionResponse.response;
    return `${r.executionStatus ?? '-'}:${r.capture ? `${r.capture.captureStatus}/${r.capture.deliveryStatus}${r.capture.captureReason ? '/' + r.capture.captureReason : ''}` : 'no-capture'}${r.error ? ` err=${JSON.stringify(String(r.error).slice(0, 60))}` : ''}`;
  });
}
let n = 0;
if (MODE === 'sweep') {
  const S = await session(process.env.ST ?? 'o');
  const rounds = Number(process.env.ROUNDS ?? 5);
  const tally: Record<string, number> = {};
  for (let round = 0; round < rounds; round++) {
    for (const [i, shape] of SHAPES.entries()) {
      const key = `K${++n}`;
      calls[key] = [['run_shell_command', { command: shape, timeout: 120000 }]];
      const r = await S.prompt(`[[${key}]]`, 180000);
      const res = results(r.events ?? []).join(',');
      const k = `shape${i} ${r.terminal?.map((t: any) => t.type).join(',') || 'blocked'} ${res}`;
      tally[k] = (tally[k] ?? 0) + 1;
      if (r.status2?.recoveryBlocked) {
        L.say('BLOCKED', `round ${round} shape ${i} (${shape.slice(0, 60)}): ${res}; harness: ${h.log().split('\n').filter((l) => /blocked|failed/.test(l)).slice(-1)[0]?.slice(0, 200)}`);
        break;
      }
    }
  }
  for (const [k, v] of Object.entries(tally)) L.say('tally', `${v}x ${k}`);
}
if (MODE === 'grandchild') {
  const S = await session(process.env.ST ?? 'p');
  calls.K1 = [['run_shell_command', { command: '(sleep 1; echo late-from-grandchild) & echo early', timeout: 60000 }]];
  const r = await S.prompt('[[K1]]', 120000);
  L.say('grandchild', `${L.summarizeTurn(r)} ${results(r.events ?? []).join(',')}`);
  L.say('grandchild harness', h.log().split('\n').filter((l) => /blocked|failed/.test(l)).slice(-2).map((l) => l.slice(0, 200)));
}
if (MODE === 'logger') {
  const S = await session(process.env.ST ?? 'c2');
  calls.K1 = [['run_shell_command', { command: '(i=0; while [ $i -lt 10 ]; do echo tick-$i; i=$((i+1)); sleep 0.3; done) & echo started', timeout: 60000 }]];
  const r = await S.prompt('[[K1]]', 120000);
  L.say('logger', `${L.summarizeTurn(r)} ${results(r.events ?? []).join(',')}`);
  L.say('logger harness', h.log().split('\n').filter((l) => /blocked|failed/.test(l)).slice(-2).map((l) => l.slice(0, 200)));
}
if (MODE === 'nospawn') {
  const st = process.env.ST ?? 'q';
  const S = await session(st);
  // Call 0 removes the saved Workspace directory itself; call 1 then has no cwd to spawn in.
  calls.K1 = [
    ['run_shell_command', { command: 'rm -rf "$PWD" && echo removed' }],
    ['run_shell_command', { command: 'echo second >> /tmp/qwen-r12-probe.txt' }],
  ];
  const r = await S.prompt('[[K1]]', 180000);
  L.say('nospawn', `${L.summarizeTurn(r)} ${results(r.events ?? []).join(' | ')}`);
  L.say('nospawn harness', h.log().split('\n').filter((l) => /blocked|failed/.test(l)).slice(-2).map((l) => l.slice(0, 260)));
  L.say('nospawn fs', `workspace dir exists=${fs.existsSync(`${L.RIG}/${ROOTS}/${st}/child`)}`);
}
await h.stop();
process.exit(0);
