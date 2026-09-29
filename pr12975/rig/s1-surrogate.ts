// PR #12975 probe S1: a model tool call whose arguments hold an unpaired
// surrogate, through the packaged Hosted Harness + Spring (Session Store +
// embedded Runtime Broker) + real local-process Worker + MySQL 8.4.
// The same script runs against JAR_ARM=main (Broker without the PR) and
// JAR_ARM=merge (main + PR). Harness and Worker are the same dist/cli.js.
import fs from 'node:fs';
import path from 'node:path';
import * as L from './lib.mjs';
import { fakeToolCall, startFakeOpenAIServer } from '../wt-merge/integration-tests/fake-openai-server.ts';

const ARM = process.env.ARM ?? 'merge';
const DB = process.env.DB ?? `s1_${ARM}`;
const HTTP = Number(process.env.HTTP ?? 18975);
const BPORT = Number(process.env.BPORT ?? 19975);
const ROOTS = path.resolve(L.RIG, process.env.ROOTS ?? 'roots');
const ST = process.env.ST ?? 'a';
const ONLY = process.env.ONLY?.split(',');
L.openLog(`s1-surrogate-${ARM}`);

const ws = `ws-${ST}`;
const dir = path.join(ROOTS, ST, 'child');
const SHELL = 'hosted-workspace-shell/1';
const FILES = 'hosted-workspace-files/1';

type Case = { profile: string; tool: string; args: Record<string, unknown>; setup?: () => void; check: () => Record<string, unknown> };
const read = (f: string) => (fs.existsSync(path.join(dir, f)) ? fs.readFileSync(path.join(dir, f), 'utf8') : null);
const CASES: Record<string, Case> = {
  // Well-formed control: emoji (a surrogate pair) must still run on both arms.
  SHELL_PAIR: {
    profile: SHELL,
    tool: 'run_shell_command',
    args: { command: 'printf "rocket 🚀\\n" > pair.txt', timeout: 5000 },
    setup: () => fs.rmSync(path.join(dir, 'pair.txt'), { force: true }),
    check: () => ({ 'pair.txt': read('pair.txt') }),
  },
  // The issue's example: '?' is a shell wildcard.
  SHELL_RM: {
    profile: SHELL,
    tool: 'run_shell_command',
    args: { command: 'rm victim-\ud800.txt', timeout: 5000 },
    setup: () => {
      for (const f of ['victim-1.txt', 'victim-2.txt']) fs.writeFileSync(path.join(dir, f), `${f}\n`);
    },
    check: () => ({ 'victim-1.txt': fs.existsSync(path.join(dir, 'victim-1.txt')), 'victim-2.txt': fs.existsSync(path.join(dir, 'victim-2.txt')) }),
  },
  // v2 file tool: the model's old_string is not in the file, but "a?b" is.
  EDIT_OLD: {
    profile: FILES,
    tool: 'edit',
    args: { file_path: 'note.txt', old_string: 'a\ud800b', new_string: 'EDITED' },
    setup: () => fs.writeFileSync(path.join(dir, 'note.txt'), 'status: a?b\n'),
    check: () => ({ 'note.txt': read('note.txt') }),
  },
  // v2 file tool: half of an emoji in file content.
  WRITE_HALF: {
    profile: FILES,
    tool: 'write_file',
    args: { file_path: 'half.txt', content: 'half emoji: \ud83d end\n' },
    setup: () => fs.rmSync(path.join(dir, 'half.txt'), { force: true }),
    check: () => ({ 'half.txt': read('half.txt') }),
  },
};

const seen: Record<string, { receipts?: string[] }> = {};
const model = await startFakeOpenAIServer(async ({ body }) => {
  const messages = body['messages'] as Array<{ role: string; content: unknown; tool_call_id?: string }>;
  const lastUser = messages.findLastIndex((m) => m.role === 'user');
  const key = [...JSON.stringify(messages[lastUser]?.content ?? '').matchAll(/\[\[([A-Z_]+)\]\]/g)].at(-1)?.[1];
  const receipts = messages.slice(lastUser + 1).filter((m) => m.role === 'tool');
  if (!key || !CASES[key]) return { content: 'ok' };
  if (receipts.length === 0) return { toolCalls: [fakeToolCall(CASES[key].tool, CASES[key].args, `${key.toLowerCase()}-1`)] };
  seen[key] = { receipts: receipts.map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content)).slice(0, 300)) };
  return { content: `DONE_${key}` };
});

const proxy = await L.startBrokerProxy(`http://127.0.0.1:${BPORT}`);
const h = await new L.Harness({ name: `s1-${ARM}`, modelUrl: model.baseUrl, brokerUrl: proxy.url }).start();
if (L.sql(DB, `SELECT COUNT(*) FROM managed_workspace_registry WHERE workspace_id='${ws}'`)[0][0] === '0') L.seedRegistry(DB, ws, `st-${ST}`);
const results: any[] = [];
for (const key of Object.keys(CASES)) {
  if (ONLY && !ONLY.includes(key)) continue;
  const c = CASES[key];
  c.setup?.();
  const before = c.check();
  const launchesBefore = L.launches(DB).length;
  const rowsBefore = new Set(L.sql(DB, "SELECT execution_call_id FROM qwen_tool_execution").map((r) => r[0]));
  const s = new L.HSession(h, await L.createWorkspaceSession(HTTP, ws), L.storeConnection(h, ws, HTTP));
  const created = await s.create({ toolProfile: c.profile });
  if (created.status !== 200) throw new Error(`create ${key}: ${created.status} ${JSON.stringify(created.json)}`);
  const t0 = Date.now();
  const r = await s.prompt(`[[${key}]]`, 400_000);
  const broker = L.ledgerSince(proxy.ledger, t0);
  const after = c.check();
  const execs = L.sql(DB, "SELECT execution_call_id, execution_state, IFNULL(execution_status,'-'), LEFT(IFNULL(result_json,'-'),200) FROM qwen_tool_execution").filter((row) => !rowsBefore.has(row[0])).map((row) => row.slice(1).join(' | '));
  const res = {
    key,
    turn: L.summarizeTurn(r),
    brokerLedger: broker,
    modelSawToolResult: seen[key]?.receipts ?? null,
    before,
    after,
    lastExecutionRow: execs,
    holders: L.holders(DB),
    workerLaunches: L.launches(DB).length - launchesBefore,
    turnErrors: (r.terminal ?? []).map((t: any) => JSON.stringify(t.data ?? {}).slice(0, 300)),
  };
  results.push(res);
  L.say(key, res.turn);
  L.say(`${key}:broker`, broker.join(' | ') || '<none>');
  L.say(`${key}:model-saw`, res.modelSawToolResult ?? '<no second model call>');
  L.say(`${key}:files`, { before, after });
  L.say(`${key}:execution-row`, execs);
  L.say(`${key}:turn-end`, res.turnErrors);
  L.say(`${key}:holders`, res.holders);
  const d = await s.detach();
  L.say(`${key}:detach`, `${d.status} ${String(JSON.stringify(d.json)).slice(0, 200)}`);
}
fs.writeFileSync(path.join(L.RIG, 'out', `s1-surrogate-${ARM}.json`), JSON.stringify({ arm: ARM, results }, null, 2));
await h.stop();
await proxy.close();
await model.close?.();
process.exit(0);
