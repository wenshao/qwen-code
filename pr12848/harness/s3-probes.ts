// Deterministic probes for #12848 on the real stack (fixture model).
// Run from wt-pr: node --import tsx ../rig/s3-probes.ts P1 P2 ...
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import * as L from './lib.mjs';
import { fakeToolCall, startFakeOpenAIServer } from '../wt-pr/integration-tests/fake-openai-server.ts';

const DB = process.env.DB ?? 'p848a';
const HTTP = Number(process.env.HTTP ?? 18848);
const BROKER = process.env.BROKER ?? 'http://127.0.0.1:19848';
const ARM = process.env.ARM ?? 'pr';
const ROOTS = process.env.ROOTS ?? 'roots1';
const only = process.argv.slice(2);
const want = (p: string) => !only.length || only.includes(p);
L.openLog(`s3-probes-${ARM}-${only.join('-')}`);
const SHELL = { toolProfile: 'hosted-workspace-shell/1' };

const CALLS: Record<string, Array<[string, Record<string, unknown>]>> = {
  CTRLERR: [['run_shell_command', { command: "head -c 70000 /dev/zero | tr '\\000' '\\001'; exit 3" }]],
  CTRLOK: [['run_shell_command', { command: "head -c 70000 /dev/zero | tr '\\000' '\\001'" }]],
  TAIL: [['run_shell_command', { command: 'i=0; while [ $i -lt 400 ]; do echo "line $i padding padding padding padding"; i=$((i+1)); done; echo "FINAL-$((6*7))-TAIL: the real failure"; exit 2' }]],
  TWO: [
    ['run_shell_command', { command: 'echo one >> two.txt' }],
    ['run_shell_command', { command: 'echo two >> two.txt' }],
  ],
  MIX: [
    ['write_file', { file_path: 'mix.txt', content: 'from write_file\n' }],
    ['run_shell_command', { command: 'cat mix.txt && echo from-shell >> mix.txt' }],
  ],
  BIG: [['run_shell_command', { command: 'echo big >> big-runs.txt; yes 0123456789abcdef | head -c 314572800', timeout: 600000 }]],
  TIMEOUT: [['run_shell_command', { command: 'echo t >> timeout-runs.txt; yes 0123456789abcdef', timeout: 20000 }]],
  BG: [['run_shell_command', { command: 'echo bg >> bg.txt', is_background: true }]],
  LONG: [['run_shell_command', { command: 'sh wait45.sh', timeout: 120000 }]],
};
const modelSaw: Record<string, string[]> = {};
const model = await startFakeOpenAIServer(async ({ body }) => {
  const messages = body['messages'] as Array<{ role: string; content: unknown }>;
  const lastUser = messages.findLastIndex((m) => m.role === 'user' && /\[\[/.test(JSON.stringify(m.content)));
  const marker = [...JSON.stringify(messages[lastUser]?.content ?? '').matchAll(/\[\[([A-Z0-9_]+)\]\]/g)].at(-1)?.[1] ?? 'NONE';
  const receipts = messages.slice(lastUser + 1).filter((m) => m.role === 'tool');
  const calls = CALLS[marker];
  if (calls && !receipts.length)
    return { toolCalls: calls.map(([name, args], i) => fakeToolCall(name, args, `${marker.toLowerCase()}-${i}`)) };
  modelSaw[marker] = receipts.map((r) => (typeof r.content === 'string' ? r.content : JSON.stringify(r.content)));
  return { content: `${marker} done` };
});
const broker = await L.startBrokerProxy(BROKER);
const h = await new L.Harness({ name: `probe-${ARM}-${only.join('')}`, modelUrl: model.baseUrl, brokerUrl: broker.url }).start();
L.say('arm', `${ARM}: harness ${h.baseUrl} pid ${h.child.pid}`);
const dir = (st: string) => `${L.RIG}/${ROOTS}/${st}/child`;
async function session(st: string) {
  const ws = `ws-${st}`;
  if (L.sql(DB, `SELECT COUNT(*) FROM managed_workspace_registry WHERE workspace_id='${ws}'`)[0][0] === '0') L.seedRegistry(DB, ws, `st-${st}`);
  const s = new L.HSession(h, await L.createWorkspaceSession(HTTP, ws), L.storeConnection(h, ws, HTTP));
  const c = await s.create(SHELL);
  if (c.status !== 200) throw new Error(`create ${c.status} ${JSON.stringify(c.json)}`);
  return s;
}
const listeners = () => {
  try {
    return execFileSync('/usr/sbin/lsof', ['-a', '-p', String(h.child.pid), '-iTCP', '-sTCP:LISTEN', '-nP', '-Fn'], { encoding: 'utf8' })
      .split('\n').filter((l) => l.startsWith('n')).map((l) => l.slice(1));
  } catch {
    return [];
  }
};
const resultBytes = (st: string) => L.sql(DB, `SELECT COUNT(*), IFNULL(SUM(byte_length),0) FROM qwen_managed_session_resource WHERE workspace_id='ws-${st}' AND kind LIKE 'managed-tool-result-%'`)[0];
const toolRecords = (events: any[]) =>
  events.filter((e) => (e.data?.record?.message?.parts ?? []).some((p: any) => p.functionResponse));
async function next(name: string, s: L.HSession) {
  const again = await s.prompt('[[TEXT]]');
  L.say(name, `next text turn: ${L.summarizeTurn(again)}`);
}
async function probe(p: string, st: string, marker: string, opts: { ms?: number; sample?: boolean } = {}) {
  if (!want(p)) return;
  fs.mkdirSync(dir(st), { recursive: true });
  const S = await session(st);
  const before = listeners();
  const t0 = Date.now();
  let peak = { harness: 0 };
  const timer = opts.sample
    ? setInterval(() => {
        try {
          const rss = Number(execFileSync('/bin/ps', ['-o', 'rss=', '-p', String(h.child.pid)], { encoding: 'utf8' }).trim()) / 1024;
          peak.harness = Math.max(peak.harness, rss);
        } catch {}
      }, 500)
    : undefined;
  const r = await S.prompt(`[[${marker}]]`, opts.ms);
  if (timer) clearInterval(timer);
  L.say(p, `--- ws-${st} ${marker}: ${L.summarizeTurn(r)}${opts.sample ? ` peak harness RSS ${peak.harness.toFixed(0)} MiB` : ''}`);
  const counts: Record<string, number> = {};
  for (const l of L.ledgerSince(broker.ledger, t0)) counts[l.replace(/[0-9a-f-]{36}/g, '<id>')] = (counts[l.replace(/[0-9a-f-]{36}/g, '<id>')] ?? 0) + 1;
  L.say(`${p} broker`, Object.entries(counts).map(([k, v]) => `${v}x ${k}`));
  for (const e of toolRecords(r.events ?? [])) {
    const rec = JSON.stringify(e.data.record);
    L.say(`${p} tool_result record`, `bytes=${Buffer.byteLength(rec)}`);
    for (const part of e.data.record.message.parts) {
      if (!part.functionResponse) continue;
      const resp = part.functionResponse.response;
      const text = JSON.stringify(resp);
      L.say(`${p} response`, `${part.functionResponse.name} status=${resp.executionStatus} capture=${resp.capture?.captureStatus}/${resp.capture?.deliveryStatus} previewTruncated=${resp.capture?.previewTruncated} jsonBytes=${Buffer.byteLength(text)} hasExitCode=${/Exit Code:/.test(text)} hasTail=${text.includes("FINAL-42-TAIL")}`);
      L.say(`${p} response text head`, JSON.stringify((resp.output ?? resp.error ?? '').slice(0, 160)));
      if (resp.runtimeError) L.say(`${p} runtimeError`, JSON.stringify(resp.runtimeError).slice(0, 200));
    }
  }
  if (modelSaw[marker]) L.say(`${p} model saw`, modelSaw[marker].map((c) => `${Buffer.byteLength(c)}B exit=${/Exit Code:/.test(c)} tail=${c.includes("FINAL-42-TAIL")}`));
  L.say(`${p} sql`, `tool-result rows/bytes for ws-${st}: ${JSON.stringify(resultBytes(st))}`);
  L.say(`${p} listeners`, `before=${before.length} after=${listeners().length} (${listeners().join(' ')})`);
  L.say(`${p} fs`, fs.readdirSync(dir(st)).map((f) => `${f}:${fs.statSync(`${dir(st)}/${f}`).size}`).join(' '));
  await next(p, S);
  return r;
}
try {
  await probe('P1', process.env.ST_P1 ?? 'j', 'CTRLERR');
  await probe('P1b', process.env.ST_P1B ?? 'k', 'CTRLOK');
  await probe('P2', process.env.ST_P2 ?? 'l', 'TAIL');
  await probe('P3', process.env.ST_P3 ?? 'm', 'TWO');
  await probe('P4', process.env.ST_P4 ?? 'n', 'MIX');
  await probe('P5', process.env.ST_P5 ?? 'o', 'BIG', { ms: 900_000, sample: true });
  await probe('P6', process.env.ST_P6 ?? 'p', 'TIMEOUT', { ms: 300_000, sample: true });
  await probe('P7', process.env.ST_P7 ?? 'q', 'BG');
  if (want('P8')) { fs.mkdirSync(dir(process.env.ST_P8 ?? 'r'), { recursive: true }); fs.writeFileSync(dir(process.env.ST_P8 ?? 'r') + '/wait45.sh', 'echo start >> slow.txt\nsleep 45\necho done-after-45 >> slow.txt\necho done-after-45\n'); }
  await probe('P8', process.env.ST_P8 ?? 'r', 'LONG', { ms: 300_000 });
} catch (e: any) {
  L.say('ERROR', String(e?.stack ?? e));
} finally {
  L.say('harness errors', h.log().split('\n').filter((l) => /error|Error|fail|blocked/i.test(l)).slice(-10).map((l) => l.slice(0, 300)));
  await h.stop();
  await broker.close();
  await model.close?.();
}
process.exit(0);
