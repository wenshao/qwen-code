// Round-2 probes (fixture model) for the F1/F2/N3/M11 fixes on the real stack.
// Run from wt-r3: ARM=r3 node --import tsx ../rig/s9-r2-probes.ts T1 T2 ...
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import * as L from './lib.mjs';
import { fakeToolCall, startFakeOpenAIServer } from '../wt-pr/integration-tests/fake-openai-server.ts';

const DB = process.env.DB ?? 'p848c';
const HTTP = Number(process.env.HTTP ?? 18848);
const ARM = process.env.ARM ?? 'r3';
const ROOTS = process.env.ROOTS ?? 'roots3';
const only = process.argv.slice(2);
const want = (p: string) => !only.length || only.includes(p);
L.openLog(`s9-r2-probes-${ARM}-${only.join('-')}`);
type Call = [string, Record<string, unknown>];
// Each marker: list of rounds (tool-call batches); after the last round the model answers text.
const SEQ: Record<string, Call[][]> = {
  TAIL: [[['run_shell_command', { command: 'echo t >> runs.txt; i=0; while [ $i -lt 400 ]; do echo "line $i padding padding padding padding"; i=$((i+1)); done; echo "FINAL-$((6*7))-TAIL: the real failure"; exit 2' }]]],
  BIGFAIL: [[['run_shell_command', { command: 'echo t >> runs.txt; head -c 204800 /dev/zero | tr "\\000" "a"; echo; echo "FINAL-$((6*7+1))-TAIL on stderr" >&2; exit 4' }]]],
  CTRLERR: [[['run_shell_command', { command: "head -c 70000 /dev/zero | tr '\\000' '\\001'; exit 3" }]]],
  CJK: [[['run_shell_command', { command: 'i=0; while [ $i -lt 900 ]; do echo "第${i}行：托管工作区输出预览需要保留尾部 🙂"; i=$((i+1)); done; echo "错误：链接失败 FINAL-44-TAIL" >&2; exit 5' }]]],
  BG: [[['run_shell_command', { command: 'echo bg >> bg.txt', is_background: true }]]],
  MIXBG: [
    [['write_file', { file_path: 'mix.txt', content: 'from write_file\n' }], ['run_shell_command', { command: 'echo bg >> mix.txt', is_background: true }]],
    [['run_shell_command', { command: 'echo fg >> mix.txt' }]],
  ],
  INTER: [
    [['run_shell_command', { command: 'echo r1 >> inter.txt' }]],
    [['run_shell_command', { command: 'echo r2 >> inter.txt', is_background: true }]],
    [['run_shell_command', { command: 'echo r3 >> inter.txt' }]],
  ],
  DIRARG: [
    [['run_shell_command', { command: 'echo d >> dir.txt', directory: 'sub' }]],
    [['run_shell_command', { command: 'echo d >> dir.txt' }]],
  ],
};
const saw: Record<string, string[][]> = {};
const model = await startFakeOpenAIServer(async ({ body }) => {
  const messages = body['messages'] as Array<{ role: string; content: unknown; tool_calls?: unknown[] }>;
  const lastUser = messages.findLastIndex((m) => m.role === 'user' && /\[\[/.test(JSON.stringify(m.content)));
  const marker = [...JSON.stringify(messages[lastUser]?.content ?? '').matchAll(/\[\[([A-Z0-9_]+)\]\]/g)].at(-1)?.[1] ?? 'NONE';
  const after = messages.slice(lastUser + 1);
  const round = after.filter((m) => m.role === 'assistant' && m.tool_calls?.length).length;
  // what the model saw for the previous round
  if (round > 0) {
    const lastAssistant = after.findLastIndex((m) => m.role === 'assistant' && m.tool_calls?.length);
    (saw[marker] ??= [])[round - 1] = after.slice(lastAssistant + 1).filter((m) => m.role === 'tool').map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content)));
  }
  const rounds = SEQ[marker];
  if (rounds && round < rounds.length)
    return { toolCalls: rounds[round].map(([name, args], i) => fakeToolCall(name, args, `${marker.toLowerCase()}-${round}-${i}`)) };
  return { content: `${marker} done after ${round} tool rounds` };
});
const broker = await L.startBrokerProxy(process.env.BROKER ?? 'http://127.0.0.1:19848');
const h = await new L.Harness({ name: `r2probe-${ARM}-${only.join('')}`, modelUrl: model.baseUrl, brokerUrl: broker.url }).start();
const harnessPort = new URL(h.baseUrl).port;
L.say('arm', `${ARM}: harness ${h.baseUrl}`);
const dir = (st: string) => `${L.RIG}/${ROOTS}/${st}/child`;
const listeners = () => {
  try {
    return execFileSync('/usr/sbin/lsof', ['-a', '-p', String(h.child.pid), '-iTCP', '-sTCP:LISTEN', '-nP', '-Fn'], { encoding: 'utf8' })
      .split('\n').filter((l) => l.startsWith('n')).map((l) => l.slice(1).split(':').pop()).filter((p) => p !== harnessPort);
  } catch {
    return [];
  }
};
async function session(st: string) {
  const ws = `ws-${st}`;
  if (L.sql(DB, `SELECT COUNT(*) FROM managed_workspace_registry WHERE workspace_id='${ws}'`)[0][0] === '0') L.seedRegistry(DB, ws, `st-${st}`);
  const s = new L.HSession(h, await L.createWorkspaceSession(HTTP, ws), L.storeConnection(h, ws, HTTP));
  const c = await s.create({ toolProfile: 'hosted-workspace-shell/1' });
  if (c.status !== 200) throw new Error(`create ${c.status} ${JSON.stringify(c.json)}`);
  return s;
}
async function probe(p: string, st: string, marker: string) {
  if (!want(p)) return;
  fs.mkdirSync(dir(st), { recursive: true });
  const S = await session(st);
  const t0 = Date.now();
  const r = await S.prompt(`[[${marker}]]`, 300_000);
  L.say(p, `--- ws-${st} ${marker}: ${L.summarizeTurn(r)} text=${JSON.stringify(L.assistantText(r.events ?? []).slice(0, 60))}`);
  const counts: Record<string, number> = {};
  for (const l of L.ledgerSince(broker.ledger, t0)) {
    const k = l.replace(/[0-9a-f-]{36}/g, '<id>');
    counts[k] = (counts[k] ?? 0) + 1;
  }
  L.say(`${p} broker`, Object.entries(counts).map(([k, v]) => `${v}x ${k}`));
  for (const e of r.events ?? []) {
    const rec = e.data?.record;
    for (const part of rec?.message?.parts ?? []) {
      if (!part.functionResponse) continue;
      const resp = part.functionResponse.response;
      const text = JSON.stringify(resp);
      L.say(`${p} result`, `${part.functionResponse.name} status=${resp.executionStatus ?? '-'} capture=${resp.capture?.captureStatus ?? '-'}/${resp.capture?.deliveryStatus ?? '-'} recordBytes=${Buffer.byteLength(JSON.stringify(rec))} exit=${(text.match(/Exit Code: (\d+)/) ?? [])[1] ?? 'none'} tail42=${text.includes('FINAL-42-TAIL')} tail43=${text.includes('FINAL-43-TAIL')} tail44=${text.includes('FINAL-44-TAIL')} fffd=${text.includes('\\ufffd') || text.includes('�')} gap=${/preview truncated/.test(text)}`);
      if (resp.error && !resp.capture) L.say(`${p} error text`, JSON.stringify(resp.error).slice(0, 220));
    }
  }
  if (saw[marker]) L.say(`${p} model saw`, saw[marker].map((round, i) => `round ${i}: ${round.map((c) => c.slice(0, 120)).join(' | ')}`));
  L.say(`${p} listeners after turn`, JSON.stringify(listeners()));
  L.say(`${p} fs`, fs.readdirSync(dir(st)).map((f) => `${f}=${JSON.stringify(fs.readFileSync(`${dir(st)}/${f}`, 'utf8').slice(0, 40))}`).join(' '));
  const st2 = await S.status();
  await S.detach();
  const load = await S.load({ toolProfile: 'hosted-workspace-shell/1' });
  const next = load.status === 200 ? await S.prompt('[[TEXT]]') : null;
  L.say(`${p} after`, `recoveryBlocked=${st2.recoveryBlocked}; detach+load -> ${load.status}; next text turn: ${next ? L.summarizeTurn(next) : '-'}`);
}
try {
  await probe('T1', 'g', 'TAIL');
  await probe('T2', 'h', 'BIGFAIL');
  await probe('T3', 'i', 'CTRLERR');
  await probe('T4', 'u', 'CJK');
  await probe('F2a', 'k', 'BG');
  await probe('F2b', 'l', 'MIXBG');
  await probe('F2c', 'm', 'INTER');
  await probe('F2d', 'n', 'DIRARG');
} catch (e: any) {
  L.say('ERROR', String(e?.stack ?? e));
} finally {
  L.say('harness errors', h.log().split('\n').filter((l) => /failed|blocked/i.test(l)).slice(-8).map((l) => l.slice(0, 260)));
  await h.stop();
  await broker.close();
}
process.exit(0);
