// PR #12950 probe S1: every invalid file_path shape in a batch with a valid
// sibling, through the packaged Hosted Harness + real Broker/worker + MySQL.
// Same script runs against ARM=pr and ARM=base.
import fs from 'node:fs';
import path from 'node:path';
import * as L from './lib.mjs';
import { fakeToolCall, startFakeOpenAIServer } from '../wt-pr/integration-tests/fake-openai-server.ts';

const ARM = process.env.ARM ?? 'pr';
const DB = process.env.DB ?? 'p950a';
const HTTP = Number(process.env.HTTP ?? 18950);
const BPORT = Number(process.env.BPORT ?? 19950);
const ROOTS = path.resolve(L.RIG, process.env.ROOTS ?? 'roots');
const ST = process.env.ST ?? 'a';
const ONLY = process.env.ONLY?.split(',');
L.openLog(`s1-shapes-${ARM}`);

const ws = `ws-${ST}`;
const dir = path.join(ROOTS, ST, 'child');
const outside = path.join(L.SP, 'outside-sentinel');
fs.mkdirSync(outside, { recursive: true });
for (const f of fs.readdirSync(dir)) if (/^(ok|sib|shell)-/.test(f)) fs.rmSync(path.join(dir, f));
fs.writeFileSync(path.join(dir, 'proof.txt'), 'PROOF_IN_WORKSPACE\n');

type Case = { tool: string; args: Record<string, unknown>; profile?: string; sibling?: 'write' | 'shell'; order?: 'invalid-first' | 'invalid-last' };
const abs = (f: string) => path.join(dir, f);
const CASES: Record<string, Case> = {
  MISSING: { tool: 'read_file', args: {} },
  NULL: { tool: 'read_file', args: { file_path: null } },
  EMPTY: { tool: 'write_file', args: { file_path: '', content: 'x' } },
  BLANK: { tool: 'write_file', args: { file_path: '   ', content: 'x' } },
  NUMBER: { tool: 'edit', args: { file_path: 123, old_string: 'a', new_string: 'b' } },
  ABS_IN_WS_READ: { tool: 'read_file', args: { file_path: abs('proof.txt') } },
  ABS_IN_WS_WRITE: { tool: 'write_file', args: { file_path: abs('abs-write.txt'), content: 'must not exist' } },
  ABS_IN_WS_EDIT: { tool: 'edit', args: { file_path: abs('proof.txt'), old_string: 'PROOF', new_string: 'EDITED' } },
  ABS_OUTSIDE_WRITE: { tool: 'write_file', args: { file_path: path.join(outside, 'escaped.txt'), content: 'must not exist' } },
  ABS_PADDED: { tool: 'read_file', args: { file_path: ` ${abs('proof.txt')} ` } },
  DOTDOT: { tool: 'write_file', args: { file_path: '../escape.txt', content: 'must not exist' } },
  BACKSLASH: { tool: 'read_file', args: { file_path: 'a\\b.txt' } },
  DRIVE: { tool: 'read_file', args: { file_path: 'C:/secret-host-path' } },
  NUL: { tool: 'write_file', args: { file_path: 'a\u0000b.txt', content: 'x' } },
  SURROGATE: { tool: 'read_file', args: { file_path: '\ud800.txt' } },
  // Mixed file/Shell batches in the Shell profile.
  SHELL_SIBLING_FIRST: { tool: 'write_file', args: { file_path: abs('mixed.txt'), content: 'x' }, profile: 'hosted-workspace-shell/1', sibling: 'shell', order: 'invalid-last' },
  SHELL_SIBLING_LAST: { tool: 'read_file', args: { file_path: abs('proof.txt') }, profile: 'hosted-workspace-shell/1', sibling: 'shell', order: 'invalid-first' },
};

const seen: Record<string, { round2?: any; round3?: any; siblingBeforeCorrection?: boolean; t2?: number }> = {};
const model = await startFakeOpenAIServer(async ({ body }) => {
  const messages = body['messages'] as Array<{ role: string; content: unknown; tool_call_id?: string }>;
  const lastUser = messages.findLastIndex((m) => m.role === 'user');
  const all = [...JSON.stringify(messages[lastUser]?.content ?? '').matchAll(/\[\[([A-Z_]+)\]\]/g)];
  const key = all.at(-1)?.[1];
  const receipts = messages.slice(lastUser + 1).filter((m) => m.role === 'tool');
  if (!key || !CASES[key]) return { content: 'ok' };
  const c = CASES[key];
  const s = (seen[key] ??= {});
  if (receipts.length === 0) {
    const invalid = fakeToolCall(c.tool, c.args, `${key.toLowerCase()}-invalid`);
    const sibling =
      c.sibling === 'shell'
        ? fakeToolCall('run_shell_command', { command: `echo ran > shell-${key}.txt` }, `${key.toLowerCase()}-sibling`)
        : fakeToolCall('write_file', { file_path: `sib-${key}.txt`, content: 'sibling must not run' }, `${key.toLowerCase()}-sibling`);
    return { toolCalls: c.order === 'invalid-last' ? [sibling, invalid] : [invalid, sibling] };
  }
  if (receipts.length === 2 && !s.round2) {
    s.t2 = Date.now();
    s.round2 = receipts.map((m) => ({ id: m.tool_call_id, content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) }));
    s.siblingBeforeCorrection =
      fs.existsSync(path.join(dir, `sib-${key}.txt`)) || fs.existsSync(path.join(dir, `shell-${key}.txt`));
    return { toolCalls: [fakeToolCall('write_file', { file_path: `ok-${key}.txt`, content: `corrected ${key}` }, `${key.toLowerCase()}-corrected`)] };
  }
  s.round3 = receipts.map((m) => ({ id: m.tool_call_id, content: (typeof m.content === 'string' ? m.content : JSON.stringify(m.content)).slice(0, 160) }));
  return { content: `DONE_${key}` };
});

const proxy = await L.startBrokerProxy(`http://127.0.0.1:${BPORT}`);
const h = await new L.Harness({ name: `s1-${ARM}`, modelUrl: model.baseUrl, brokerUrl: proxy.url }).start();
if (L.sql(DB, `SELECT COUNT(*) FROM managed_workspace_registry WHERE workspace_id='${ws}'`)[0][0] === '0') L.seedRegistry(DB, ws, `st-${ST}`);
const results: any[] = [];
for (const key of Object.keys(CASES)) {
  if (ONLY && !ONLY.includes(key)) continue;
  const c = CASES[key];
  const launchesBefore = L.launches(DB).length;
  const s = new L.HSession(h, await L.createWorkspaceSession(HTTP, ws), L.storeConnection(h, ws, HTTP));
  const created = await s.create({ toolProfile: c.profile ?? L.PROFILE });
  if (created.status !== 200) throw new Error(`create ${key}: ${created.status} ${JSON.stringify(created.json)}`);
  const t0 = Date.now();
  const r = await s.prompt(`[[${key}]]`);
  const st = seen[key] ?? {};
  const brokerBeforeCorrection = proxy.ledger
    .filter((e: any) => e.t >= t0 && e.t < (st.t2 ?? Infinity))
    .map((e: any) => `${e.method} ${e.url.replace('/internal/runtime-broker/v1', '')} -> ${e.status}${e.code ? ` ${e.code}` : ''}`);
  const parts = (r.events ?? []).flatMap((e: any) => e.data?.record?.message?.parts ?? []);
  const persistedCalls = parts.filter((p: any) => p.functionCall).map((p: any) => p.functionCall.id);
  const persistedResults = parts.filter((p: any) => p.functionResponse).map((p: any) => p.functionResponse.id);
  const invalidError = String(st.round2?.[c.order === 'invalid-last' ? 1 : 0]?.content ?? '');
  const rawPath = typeof c.args['file_path'] === 'string' && (c.args['file_path'] as string).trim().length > 2 ? (c.args['file_path'] as string).trim() : null;
  const res = {
    key,
    tool: c.tool,
    terminal: r.terminal?.map((t: any) => t.type).join(','),
    recoveryBlocked: r.status2?.recoveryBlocked,
    ms: r.ms,
    modelRound2Ids: st.round2?.map((x: any) => x.id) ?? null,
    invalidError: invalidError.slice(0, 200),
    echoesPath: rawPath ? invalidError.includes(rawPath) : false,
    siblingError: String(st.round2?.[c.order === 'invalid-last' ? 0 : 1]?.content ?? '').slice(0, 120),
    siblingBeforeCorrection: st.siblingBeforeCorrection ?? null,
    brokerBeforeCorrection,
    correctedFile: fs.existsSync(path.join(dir, `ok-${key}.txt`)) ? fs.readFileSync(path.join(dir, `ok-${key}.txt`), 'utf8') : null,
    siblingFileAtEnd: fs.existsSync(path.join(dir, `sib-${key}.txt`)) || fs.existsSync(path.join(dir, `shell-${key}.txt`)),
    persistedCalls,
    persistedResults,
    workerLaunches: L.launches(DB).length - launchesBefore,
  };
  results.push(res);
  L.say(key, `${L.summarizeTurn(r)} calls=${JSON.stringify(persistedCalls)} results=${JSON.stringify(persistedResults)} sibBefore=${res.siblingBeforeCorrection} echo=${res.echoesPath} corrected=${JSON.stringify(res.correctedFile)}`);
  L.say(`${key}:broker<fix`, brokerBeforeCorrection.join(' | ') || '<none>');
  if (st.round2) L.say(`${key}:err`, res.invalidError);
  await s.detach();
}
const sentinels = {
  absWrite: fs.existsSync(abs('abs-write.txt')),
  outsideWrite: fs.existsSync(path.join(outside, 'escaped.txt')),
  dotdot: fs.existsSync(path.join(ROOTS, ST, 'escape.txt')),
  proof: fs.readFileSync(abs('proof.txt'), 'utf8').trim(),
};
L.say('sentinels', sentinels);
L.say('holders', L.holders(DB));
fs.mkdirSync(path.join(L.RIG, 'out'), { recursive: true });
fs.writeFileSync(path.join(L.RIG, 'out', `s1-shapes-${ARM}.json`), JSON.stringify({ arm: ARM, results, sentinels }, null, 2));
await h.stop();
await proxy.close();
await model.close?.();
process.exit(0);
