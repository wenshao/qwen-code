// S20: R13-1 fix (af962df7). The core Shell tool refuses a leading `sleep >= 2`
// before the process starts, so the worker returns not_started with the reason in
// error.message ("Blocked: sleep 3 followed by: <rest>. ..."). The command text
// controls the message length and where a surrogate pair sits relative to the
// 2048-unit head/tail cut used for messages over 4096 units.
// Per case: what the model saw, whether it holds a lone surrogate, the durable
// receipt, recovery state, and a reload + second turn that replays the history.
// env: DB, ST_BASE, LABEL, LOCAL=1 for the local path, CASESET
import fs from 'node:fs';
import * as L from './lib.mjs';
import { fakeToolCall, startFakeOpenAIServer } from '/Users/wenshao/git/qwen-code-pr12894/integration-tests/fake-openai-server.ts';

const DB = process.env.DB ?? 'o4a';
const HTTP = 18894, BPORT = 19894, PROXY = 18895, CTRL = 'http://127.0.0.1:18896';
const BASE = Number(process.env.ST_BASE ?? 40);
const LABEL = process.env.LABEL ?? 'run';
L.openLog(`s20-${LABEL}`);
const PREFIX = 'Blocked: sleep 3 followed by: ';
const E = '\u{1F600}';
// rest = "echo " + filler, placed so that the emoji's high surrogate lands on a chosen index.
const restWithEmojiAt = (index: number, total: number) => {
  const before = index - PREFIX.length - 'echo '.length;
  return `echo ${'a'.repeat(before)}${E}${'b'.repeat(Math.max(0, total - before - 2))}`;
};
const ALL: Record<string, Array<{ name: string; command: string }>> = {
  basic: [
    { name: 'sleep 3 then echo (short reason)', command: 'sleep 3; echo slept' },
    { name: 'sleep 1 then echo (runs)', command: 'sleep 1; echo slept1' },
  ],
  long: [
    { name: 'reason ~5000 units, ASCII only', command: `sleep 3; ${restWithEmojiAt(3000, 4960).replace(E, 'cc')}` },
    { name: 'reason ~5000 units, emoji high surrogate at index 2047 (head cut)', command: `sleep 3; ${restWithEmojiAt(2047, 4960)}` },
    { name: 'reason ~5000 units, emoji at index 2046 (pair kept whole)', command: `sleep 3; ${restWithEmojiAt(2046, 4960)}` },
    { name: 'reason ~5000 units, all emoji (tail cut may split)', command: `sleep 3; echo ${E.repeat(2480)}` },
    { name: 'reason ~5000 units, all emoji, one more ASCII char', command: `sleep 3; echo x${E.repeat(2480)}` },
  ],
  huge: [
    { name: 'reason ~200000 units, ASCII', command: `sleep 3; echo ${'z'.repeat(200000)}` },
  ],
};
// REAL2=1: a recording forwarder in front of the real provider notes whether the
// request body carries an escaped lone surrogate, U+FFFD, or the raw emoji.
import http from 'node:http';
export const realSeen: string[] = [];
if (process.env.REAL2 === '1') {
  const realCfg = JSON.parse(fs.readFileSync(`${process.env.HOME}/.qwen/settings.json`, 'utf8'));
  const upstream = new URL(realCfg.modelProviders.openai.find((p: any) => p.id === 'qwen3.8-max').baseUrl);
  const rec = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = Buffer.concat(chunks);
    const s = body.toString('latin1');
    const target = new URL(upstream.pathname.replace(/\/$/, '') + req.url!.replace(/^\/v1/, ''), upstream);
    const r = await fetch(target, { method: req.method, headers: { 'content-type': 'application/json', authorization: String(req.headers.authorization) }, body: chunks.length ? body : undefined });
    realSeen.push(`${req.method} ${req.url} ${body.length} B -> ${r.status}; escaped lone surrogates ${(s.match(/\\ud[89ab][0-9a-f]{2}(?!\\ud[c-f])|(?<!\\ud[89ab][0-9a-f]{2})\\ud[c-f][0-9a-f]{2}/gi) ?? []).length}, U+FFFD ${(s.match(/\xef\xbf\xbd/g) ?? []).length}, raw emoji ${(s.match(/\xf0\x9f\x98\x80/g) ?? []).length}, truncation marker ${s.includes('error truncated')}`);
    res.writeHead(r.status, { 'content-type': r.headers.get('content-type') ?? 'text/event-stream' });
    for await (const c of r.body as any) res.write(c);
    res.end();
  });
  await new Promise<void>((r) => rec.listen(0, '127.0.0.1', r));
  process.env.REAL_BASEURL = `http://127.0.0.1:${(rec.address() as any).port}/v1`;
}
const cases = ALL[process.env.CASESET ?? 'basic'].filter((_, i) => !process.env.ONLY || process.env.ONLY.split(',').includes(String(i)));
const LONE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g;
let seenAll: string[] = [];
const text = (c: unknown) => (typeof c === 'string' ? c : Array.isArray(c) ? c.map((p: any) => p?.text ?? JSON.stringify(p)).join('') : JSON.stringify(c ?? ''));
const model = await startFakeOpenAIServer(async ({ body }) => {
  const messages = body['messages'] as Array<{ role: string; content: unknown }>;
  const lastUser = messages.findLastIndex((m) => m.role === 'user');
  const m = JSON.stringify(messages[lastUser]?.content ?? '').match(/\[\[case(\d+)\]\]/);
  const receipts = messages.slice(lastUser + 1).filter((x) => x.role === 'tool');
  seenAll = messages.filter((x) => x.role === 'tool').map((x) => text(x.content));
  if (m && !receipts.length && !/second/.test(JSON.stringify(messages[lastUser]?.content))) return { toolCalls: [fakeToolCall('run_shell_command', { command: cases[Number(m[1])].command }, `call-${LABEL}-${m[1]}`)] };
  return { content: 'done' };
});
const h = await new L.Harness({ name: `s20-${LABEL}`, modelUrl: model.baseUrl, brokerUrl: `http://127.0.0.1:${BPORT}` }).start();
process.on('exit', () => { try { h.child?.kill('SIGKILL'); } catch {} });
const describe = (s: string) => {
  const lone = [...s.matchAll(LONE)].map((x) => `${x.index}:U+${x[0].charCodeAt(0).toString(16).toUpperCase()}`);
  return `${s.length} units; truncated=${s.includes('[... error truncated ...]')}; lone surrogates=${lone.length ? lone.join(',') : 0}; U+FFFD=${(s.match(/�/g) ?? []).length}`;
};
for (const [i, c] of cases.entries()) {
  const st = `s${BASE + i}`, ws = `ws-${st}`;
  if (L.sql(DB, `SELECT COUNT(*) FROM managed_workspace_registry WHERE workspace_id='${ws}'`)[0][0] === '0') L.seedRegistry(DB, ws, `st-${st}`);
  const sessionId = await L.createWorkspaceSession(HTTP, ws);
  const s = new L.HSession(h, sessionId, { ...L.storeConnection(h, ws, HTTP), baseUrl: `http://127.0.0.1:${PROXY}` });
  await s.create();
  seenAll = [];
  const t0 = Date.now();
  const r = await s.prompt(`[[case${i}]] run`, 180_000).catch((e: any) => ({ terminal: [], err: String(e) }));
  const seen = seenAll.at(-1) ?? '';
  fs.writeFileSync(`${L.RIG}/out/s20-${LABEL}-case${i}.txt`, seen);
  const refused = (await (await fetch(`${CTRL}/ledger?since=${t0}`)).json()).filter((e: any) => typeof e.status === 'number' && e.status >= 400).map((e: any) => `${e.method} ${String(e.url).replace(/.*\/v1\/sessions\/[^/]+/, '')} -> ${e.status}`);
  L.say(c.name, `command ${c.command.length} units; ${L.summarizeTurn(r)}; blocked=${((await s.status().catch(() => ({}))) as any).recoveryBlocked}`);
  L.say('  model saw', `${describe(seen)}; head ${JSON.stringify(seen.slice(0, 60))} ... tail ${JSON.stringify(seen.slice(-40))}`);
  if (refused.length) L.say('  4xx/5xx', refused.slice(0, 4));
  const journal = L.sql(DB, `SELECT CAST(record_bytes AS CHAR) FROM qwen_managed_session_journal_tx WHERE session_id='${sessionId}' ORDER BY journal_revision`).map((x: string[]) => x[0]).join('\n');
  const kc: Record<string, number> = {};
  for (const k of (journal.match(/"kind":"[a-z._]+"/g) ?? []).map((k) => k.slice(8, -1))) kc[k] = (kc[k] ?? 0) + 1;
  const stored = L.sql(DB, `SELECT CAST(inline_bytes AS CHAR) FROM qwen_managed_session_resource WHERE session_id='${sessionId}' AND kind='managed-message'`).map((x: string[]) => x[0] ?? '').filter((x: string) => /Blocked: sleep|did not start|Command: /.test(x)).join('\n');
  L.say('  journal', `${JSON.stringify(kc)}; stored tool message: "Blocked: sleep 3"=${stored.includes('Blocked: sleep 3')}, "did not start"=${stored.includes('Runtime Shell did not start')}, truncation marker=${stored.includes('error truncated')}`);
  const d = await s.detach();
  const h2 = await new L.Harness(process.env.REAL2 === "1" ? { name: `s20-${LABEL}-r${i}`, brokerUrl: `http://127.0.0.1:${BPORT}`, realModel: "qwen3.8-max" } : { name: `s20-${LABEL}-r${i}`, modelUrl: model.baseUrl, brokerUrl: `http://127.0.0.1:${BPORT}` }).start();
  (s as any).h = h2; (s as any).connection = { ...L.storeConnection(h2, ws, HTTP), baseUrl: `http://127.0.0.1:${PROXY}` };
  const ld = await s.load();
  L.say('  reload', `detach ${d.status} load ${ld.status}${ld.status === 200 ? '' : ' ' + JSON.stringify(ld.json).slice(0, 160)}`);
  if (ld.status === 200) {
    seenAll = [];
    const r2 = await s.prompt(process.env.REAL2 === "1" ? "In one short sentence: why did the previous shell command not run? Do not call any tools." : `[[case${i}]] second turn, no tools`, 180_000).catch((e: any) => ({ terminal: [], err: String(e) }));
    if (process.env.REAL2 === "1") { L.say("  provider requests", realSeen.splice(0)); }
    if (process.env.REAL2 === "1") L.say("  real model turn", `${L.summarizeTurn(r2)}; answer=${JSON.stringify(L.assistantText((r2 as any).events ?? [])).slice(0, 200)}; harness: ${JSON.stringify(h2.log().split("\n").filter((l: string) => /fail|error|invalid|40\d|50\d/i.test(l)).map((l: string) => l.slice(0, 260)).slice(0, 4))}`);
    const replay = seenAll[0] ?? '';
    if (process.env.REAL2 !== "1") L.say('  second turn (new Harness process)', `${L.summarizeTurn(r2)}; history tool message ${replay === seen ? 'identical to turn 1' : `DIFFERS: ${describe(replay)}`}`);
  }
  await h2.stop();
}
L.say('harness', h.log().split('\n').filter((l: string) => /fail|block|error|conflict|refus|invalid/i.test(l)).map((l: string) => l.slice(0, 220)).slice(0, 12));
await h.stop();
process.exit(0);
