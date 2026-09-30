// S22: main's D6a Hosted approvals merged into the O2 Shell path (0027f7a7).
// approvalMode=default asks before every run_shell_command. Cases:
//  allow | deny | pair (two Shell calls in one reply: allow the first, deny the second)
//  | expire (nobody answers) | crash (Harness killed while waiting, answer on a new Harness)
// env: DB, ST_BASE, LABEL, CASES (comma list)
import fs from 'node:fs';
import * as L from './lib.mjs';
import { fakeToolCall, startFakeOpenAIServer } from '/Users/wenshao/git/qwen-code-pr12894/integration-tests/fake-openai-server.ts';

const DB = process.env.DB ?? 'o5a';
const HTTP = 18894, BPORT = 19894, PROXY = 18895;
const BASE = Number(process.env.ST_BASE ?? 60);
const LABEL = process.env.LABEL ?? 'ap';
const CASES = (process.env.CASES ?? 'allow,deny,pair,expire,crash').split(',');
L.openLog(`s22-${LABEL}`);
const side = (tag: string) => `${L.RIG}/run/side-${tag}.log`;
const runs = (tag: string) => (fs.existsSync(side(tag)) ? fs.readFileSync(side(tag), 'utf8').trim().split('\n').length : 0);
const gen = (tag: string) => `${L.NODE22} ${L.RIG}/gen.mjs ${tag} 3145728 2048 0 ${side(tag)}`;
let seen: string[] = [];
const model = await startFakeOpenAIServer(async ({ body }) => {
  const messages = body['messages'] as Array<{ role: string; content: unknown }>;
  const lastUser = messages.findLastIndex((m) => m.role === 'user');
  const text = JSON.stringify(messages[lastUser]?.content ?? '');
  const tag = text.match(/\[\[(\w+)\]\]/)?.[1] ?? 'x';
  const tools = messages.slice(lastUser + 1).filter((x) => x.role === 'tool');
  if (!tools.length) {
    if (text.includes('pair')) return { toolCalls: [fakeToolCall('run_shell_command', { command: gen(`${tag}a`) }, `call-${tag}-a`), fakeToolCall('run_shell_command', { command: gen(`${tag}b`) }, `call-${tag}-b`)] };
    return { toolCalls: [fakeToolCall('run_shell_command', { command: gen(tag) }, `call-${tag}`)] };
  }
  seen = tools.map((t: any) => `${t.tool_call_id ?? '?'}: ${String(typeof t.content === 'string' ? t.content : JSON.stringify(t.content)).replace(/\s+/g, ' ').slice(0, 110)}`);
  return { content: `done ${tag}` };
});
const proxy = await L.startBrokerProxy(`http://127.0.0.1:${BPORT}`);
const hosts: any[] = [];
process.on('exit', () => { for (const x of hosts) try { x.child?.kill('SIGKILL'); } catch {} });
const start = async (name: string) => { const h = await new L.Harness({ name, modelUrl: model.baseUrl, brokerUrl: proxy.url }).start(); hosts.push(h); return h; };
const actions = (sessionId: string) => {
  const rows = L.sql(DB, `SELECT CAST(record_bytes AS CHAR) FROM qwen_managed_session_journal_tx WHERE session_id='${sessionId}' ORDER BY journal_revision`).map((x: string[]) => x[0]).join('\n');
  const out: any[] = [];
  for (const m of rows.matchAll(/"kind":"action\.changed".*?"payload":(\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\})/g)) {
    try { out.push(JSON.parse(m[1])); } catch {}
  }
  return out;
};
const callOf = (sessionId: string, a: any) => {
  const id = a.optionsRef?.resourceId;
  if (!id) return '?';
  const raw = L.sql(DB, `SELECT CAST(inline_bytes AS CHAR) FROM qwen_managed_session_resource WHERE session_id='${sessionId}' AND resource_id='${id}'`)[0]?.[0];
  try { return JSON.parse(raw).functionCallId; } catch { return '?'; }
};
const waitRequested = async (sessionId: string, n: number, ms = 60_000) => {
  const t = Date.now();
  for (;;) {
    const req = actions(sessionId).filter((a) => a.state === 'requested');
    if (req.length >= n || Date.now() - t > ms) return req;
    await L.sleep(250);
  }
};
const answer = async (h: any, s: any, a: any, optionId: string) => {
  const r = await h.json(`/session/${s.sessionId}/actions/${a.requestId}/resolve`, { optionId, inputRevision: a.inputRevision, policyRevision: 'hosted-tool-approval/1' }, { clientId: s.clientId });
  return `${r.status} ${JSON.stringify(r.json).slice(0, 90)}`;
};
const report = async (s: any, sessionId: string, tags: string[], t0: number) => {
  L.say('  model saw', seen);
  L.say('  generator runs', tags.map((t) => `${t}=${runs(t)}`).join(' '));
  L.say('  actions', actions(sessionId).map((a) => `${a.requestId.slice(0, 8)} ${a.state} call=${callOf(sessionId, a)}`));
  L.say('  publications', L.publications(DB, sessionId).map((p: any) => `${p.id.slice(0, 8)} ${p.state}/${p.phase} capture=${p.used?.capture}`));
  L.say('  broker', L.ledgerSince(proxy.ledger, t0).filter((l: string) => /executions|publisher/.test(l)).map((l: string) => l.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, (x) => x.slice(0, 8))));
  L.say('  status', JSON.stringify(await s.status().catch((e: any) => String(e))));
};
const h = await start(`s22-${LABEL}`);
let i = 0;
for (const c of CASES) {
  const st = `s${BASE + i++}`, ws = `ws-${st}`, tag = `${LABEL}${c}`;
  for (const t of [tag, `${tag}a`, `${tag}b`]) fs.rmSync(side(t), { force: true });
  if (L.sql(DB, `SELECT COUNT(*) FROM managed_workspace_registry WHERE workspace_id='${ws}'`)[0][0] === '0') L.seedRegistry(DB, ws, `st-${st}`);
  const sessionId = await L.createWorkspaceSession(HTTP, ws);
  let host = h;
  const s = new L.HSession(host, sessionId, { ...L.storeConnection(host, ws, HTTP), baseUrl: `http://127.0.0.1:${PROXY}` });
  const timeoutMs = c === 'expire' ? 3000 : 120_000;
  const created = await s.create({ toolProfile: L.PROFILE, ...(process.env.LOCAL === '1' ? {} : { captureBytes: L.CAPTURE }), approvalMode: 'default', approvalTimeoutMs: timeoutMs });
  L.say(`=== ${c}${process.env.LOCAL === '1' ? ' (local path)' : ' (O2)'}`, `create ${created.status} approvalMode=${created.json?.approvalMode} timeout=${timeoutMs} ms`);
  seen = [];
  const t0 = Date.now();
  const sub = await s.submit(`[[${tag}]] ${c === 'pair' ? 'pair' : 'run'}`);
  if (c === 'allow' || c === 'deny') {
    const [a] = await waitRequested(sessionId, 1);
    L.say('  requested', `${a?.requestId.slice(0, 8)} for ${callOf(sessionId, a)}; generator runs before answering ${runs(tag)}`);
    L.say('  answer', await answer(host, s, a, c));
  } else if (c === 'pair') {
    const [a] = await waitRequested(sessionId, 1);
    L.say('  first requested', `${a.requestId.slice(0, 8)} for ${callOf(sessionId, a)}`);
    L.say('  allow first', await answer(host, s, a, 'allow'));
    let b: any;
    for (let w = 0; w < 240 && !b; w++) { b = actions(sessionId).find((x) => x.state === 'requested' && x.requestId !== a.requestId); if (!b) await L.sleep(250); }
    L.say('  second requested', b ? `${b.requestId.slice(0, 8)} for ${callOf(sessionId, b)}` : 'never');
    if (b) L.say('  deny second', await answer(host, s, b, 'deny'));
  } else if (c === 'expire') {
    const [a] = await waitRequested(sessionId, 1);
    L.say('  requested', `${a?.requestId.slice(0, 8)}; nobody answers`);
  } else if (c === 'crash') {
    const [a] = await waitRequested(sessionId, 1);
    L.say('  requested', `${a?.requestId.slice(0, 8)} for ${callOf(sessionId, a)}`);
    host.child.kill('SIGKILL');
    L.say('  crash', `Harness killed while the approval was pending @${Date.now() - t0} ms`);
    await L.sleep(65_000);
    host = await start(`s22-${LABEL}-b`);
    (s as any).h = host; (s as any).connection = { ...L.storeConnection(host, ws, HTTP), baseUrl: `http://127.0.0.1:${PROXY}` };
    let ld: any;
    const tl = Date.now();
    do { ld = await s.load(); if (ld.status !== 200) await L.sleep(2000); } while (ld.status !== 200 && Date.now() - tl < 120_000);
    L.say('  load on new Harness', `${ld.status} ${ld.status === 200 ? '' : JSON.stringify(ld.json)}`);
    const pending = actions(sessionId).filter((x) => x.requestId === a.requestId).map((x) => x.state);
    L.say('  action states so far', pending);
    L.say('  answer on new Harness', await answer(host, s, a, 'allow'));
  }
  const idle = await s.waitIdle(180_000).catch((e: any) => ({ error: String(e) }));
  const events = await s.transcript().catch(() => []);
  L.say('  turn', `submit ${sub.status}; terminal=${JSON.stringify(events.filter((e: any) => e.type?.startsWith('turn_')).map((e: any) => e.type))} recoveryBlocked=${(idle as any).recoveryBlocked} (${Date.now() - t0} ms)`);
  await report(s, sessionId, c === 'pair' ? [`${tag}a`, `${tag}b`] : [tag], t0);
}
L.say('harness', hosts.map((x) => `${x.name}: ${JSON.stringify(x.log().split('\n').filter((l: string) => /fail|block|error|refus/i.test(l)).map((l: string) => l.slice(0, 160)).slice(0, 3))}`));
for (const x of hosts) await x.stop().catch(() => undefined);
process.exit(0);
