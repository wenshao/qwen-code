// S21: R2-4. A Shell turn's receipt is committed, then Harness A dies before the
// continuation. While another holder owns the Workspace execution lease, Harness B
// loads the Session: the resume must acquire the Workspace and gets 409
// workspace_busy. Then the lease is handed back and the load is retried.
// MODE=acquire-lost instead drops the Broker's reply to the resume's acquire once
// (an uncertain acquisition, not a definite refusal).
// env: DB, ST, TAG, HARNESS_WT (both Harnesses), REMOTE_HARNESS_HOST/NAMES for B on another host
import fs from 'node:fs';
import * as L from './lib.mjs';
import { fakeToolCall, startFakeOpenAIServer } from '/Users/wenshao/git/qwen-code-pr12894/integration-tests/fake-openai-server.ts';

const DB = process.env.DB ?? 'o5a';
const HTTP = 18894, BPORT = 19894, PROXY = 18895, CTRL = 'http://127.0.0.1:18896';
const ST = process.env.ST ?? 's40';
const TAG = process.env.TAG ?? `s21-${Date.now()}`;
const MODE = process.env.MODE ?? 'busy';
L.openLog(`s21-${TAG}`);
const side = `${L.RIG}/run/side-${TAG}.log`;
fs.rmSync(side, { force: true });
const ctrl = async (p: string, body?: unknown) => (await fetch(CTRL + p, body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) })).json();
let continuation = 0;
const model = await startFakeOpenAIServer(async ({ body }) => {
  const messages = body['messages'] as Array<{ role: string; content: unknown }>;
  const lastUser = messages.findLastIndex((m) => m.role === 'user');
  if (!messages.slice(lastUser + 1).some((x) => x.role === 'tool')) {
    if (JSON.stringify(messages[lastUser]?.content ?? '').includes('[[hold]]'))
      return { toolCalls: [fakeToolCall('run_shell_command', { command: 'echo holding; sleep 45; echo held', timeout: 120000 }, `call-${TAG}-x`)] };
    return { toolCalls: [fakeToolCall('run_shell_command', { command: `${L.NODE22} ${L.RIG}/gen.mjs ${TAG} 2097152 1024 0 ${side}` }, `call-${TAG}`)] };
  }
  continuation++;
  return { content: `done ${TAG} history-tools=${messages.filter((m) => m.role === 'tool').length}` };
});
const proxy = await L.startBrokerProxy(`http://127.0.0.1:${BPORT}`);
let dropAcquire = 0;
const identities: any[] = [];
proxy.state.hook = (entry: any, body: Buffer) => {
  if (/:acquire$/.test(entry.url)) { try { const j = JSON.parse(body.toString()); identities.push({ harnessSessionId: j.harnessSessionId, runtimeSessionId: j.runtimeSessionId }); } catch {} }
  if (process.env.KILL_AT === 'ack' && killA && /:acknowledge$/.test(entry.url)) { killA(); killA = undefined; return 'drop-request'; }
  return dropAcquire > 0 && /:acquire$/.test(entry.url) && dropAcquire-- > 0 ? 'drop-reply' : 'forward';
};
let killA: (() => void) | undefined;
let ackKilled = false;
const ws = `ws-${ST}`;
if (L.sql(DB, `SELECT COUNT(*) FROM managed_workspace_registry WHERE workspace_id='${ws}'`)[0][0] === '0') L.seedRegistry(DB, ws, `st-${ST}`);
const KEY = `SHA2(CONCAT('${L.TENANT}', CHAR(0), 'st-${ST}'), 256)`;
const lease = () => L.sql(DB, `SELECT COALESCE(LEFT(holder_key, 12), 'NULL') FROM managed_workspace_execution_lease WHERE storage_key = ${KEY}`).map((r: string[]) => r[0]);
const conn = (h: any) => ({ ...L.storeConnection(h, ws, HTTP), baseUrl: `http://127.0.0.1:${PROXY}` });
const hosts: any[] = [];
process.on('exit', () => { for (const x of hosts) try { x.child?.kill('SIGKILL'); } catch {} });
const start = async (name: string) => { const h = await new L.Harness({ name, modelUrl: model.baseUrl, brokerUrl: proxy.url }).start(); hosts.push(h); return h; };
const runs = () => (fs.existsSync(side) ? fs.readFileSync(side, 'utf8').trim().split('\n').length : 0);
const t0 = Date.now();
const since = () => `${((Date.now() - t0) / 1000).toFixed(1)} s`;

const A = await start(`s21-${TAG}-A`);
const sessionId = await L.createWorkspaceSession(HTTP, ws);
const s = new L.HSession(A, sessionId, conn(A));
L.say('create on A', `${(await s.create()).status} (${A.remote ?? 'this Mac'}) mode=${MODE} harness=${process.env.HARNESS_WT?.split('/').pop()}`);
await ctrl('/clear');
if (process.env.KILL_AT !== 'ack') await ctrl('/rule', { match: '/receipts/commit', action: 'forward-then-hold', count: 1 });
else killA = () => { ackKilled = true; A.child.kill('SIGKILL'); };
const sub = await s.submit(`[[${TAG}]] run it`);
let held: any = null;
for (let i = 0; i < 2400 && !held; i++) {
  held = ackKilled ? { status: 'ack-dropped' } : (await ctrl(`/ledger?since=${t0}`)).find((e: any) => String(e.status).endsWith('-held'));
  if (!held) await L.sleep(50);
}
A.child.kill('SIGKILL');
await L.sleep(300);
L.say('crash', `submit ${sub.status}; ${ackKilled ? 'killed when it sent :acknowledge (request dropped)' : held ? 'receipt commit committed, reply withheld' : 'never reached'}; Harness A killed at ${since()}; generator runs ${runs()}`);
const original = L.sql(DB, `SELECT holder_key FROM managed_workspace_execution_lease WHERE storage_key = ${KEY}`).map((r: string[]) => r[0]);
if (MODE === 'busy-released' && identities.length) {
  const id = identities[0];
  const rel = await fetch(`http://127.0.0.1:${BPORT}/internal/runtime-broker/v1/tool-sessions/${encodeURIComponent(id.runtimeSessionId)}:release`, { method: 'POST', headers: { Authorization: `Bearer ${L.BROKER_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ protocolVersion: 1, requestId: crypto.randomUUID(), ...id }) });
  L.say('release A', `tool session ${id.runtimeSessionId.slice(0, 8)} -> ${rel.status} ${(await rel.text()).slice(0, 120)}; lease now ${lease()}`);
}
if (MODE === 'busy' || MODE === 'busy-released') {
  L.sql(DB, `INSERT INTO managed_workspace_execution_lease (storage_key) VALUES (${KEY}) ON DUPLICATE KEY UPDATE storage_key = storage_key`);
  L.sql(DB, `UPDATE managed_workspace_execution_lease SET holder_key = '${'f'.repeat(64)}' WHERE storage_key = ${KEY}`);
  L.say('lease', `was ${original.map((k: string) => k.slice(0, 12))} -> now held by another holder ${lease()}`);
} else if (MODE === 'acquire-lost') {
  dropAcquire = 1;
  L.say('lease', `${lease()}; the Broker reply to the next :acquire will be dropped`);
}
if (MODE.startsWith('restart')) {
  const { execFileSync } = await import('node:child_process');
  L.say('Broker restart', execFileSync('${L.RIG}/restart-spring.sh'.replace('${L.RIG}', L.RIG), { encoding: 'utf8', env: process.env }).trim().slice(0, 120) + ` @${since()}; lease ${lease()}`);
}
let X: any, xs: any, xDone: Promise<any> | undefined;
if (MODE === 'restart-busy') {
  X = await start(`s21-${TAG}-X`);
  const xid = await L.createWorkspaceSession(HTTP, ws);
  xs = new L.HSession(X, xid, conn(X));
  L.say('Session X in the same Workspace', `create ${(await xs.create()).status}`);
  xDone = xs.prompt('[[hold]] run it', 180_000).catch((e: any) => ({ terminal: [], err: String(e) }));
  for (let i = 0; i < 100 && (lease()[0] === 'NULL' || lease()[0] === original[0]?.slice(0, 12)); i++) await L.sleep(200);
  L.say('Session X', `running "echo holding; sleep 45"; lease ${lease()} @${since()}`);
}
const B = await start(`s21-${TAG}-B`);
(s as any).h = B; (s as any).connection = conn(B);
// Let the dead Harness's writer grant lapse first, so every load below reaches the resume.
const wait = 65_000 - (Date.now() - t0);
if (wait > 0) await L.sleep(wait);
const seq: string[] = [];
const loadOnce = async () => {
  const r = await s.load();
  const code = r.json?.code ?? r.json?.error ?? '';
  seq.push(`${r.status}${code ? ' ' + code : ''} @${since()}`);
  return r;
};
let ld: any;
for (let i = 0; i < 3; i++) { ld = await loadOnce(); if (ld.status === 200) break; await L.sleep(5000); }
L.say('load on B (writer grant lapsed)', `${seq.join(' -> ')} (${B.remote ?? 'this Mac'})`);
const status = async () => { const r = await fetch(`${B.baseUrl}/session/${sessionId}/status`, { headers: { ...B.headers(), 'X-Qwen-Client-Id': (s as any).clientId ?? '' } }).catch(() => null); return r ? `${r.status} ${JSON.stringify(await r.json().catch(() => ({}))).slice(0, 140)}` : 'no reply'; };
await L.sleep(3000);
L.say('status on B', await status());
if (ld.status !== 200) {
  if (MODE === 'busy' || MODE === 'busy-released') {
    L.sql(DB, `UPDATE managed_workspace_execution_lease SET holder_key = ${MODE === 'busy-released' || !original[0] ? 'NULL' : `'${original[0]}'`} WHERE storage_key = ${KEY}`);
    L.say('lease', `handed back -> ${lease()}`);
  }
  seq.length = 0;
  let after: any;
  const ta = Date.now();
  do { after = await loadOnce(); if (after.status !== 200) await L.sleep(2000); } while (after.status !== 200 && Date.now() - ta < 150_000);
  L.say('load after release', seq.join(' -> '));
} else if (!/"recoveryBlocked":true/.test(await status())) {
  if (MODE === 'busy' || MODE === 'busy-released') {
    L.sql(DB, `UPDATE managed_workspace_execution_lease SET holder_key = ${MODE === 'busy-released' || !original[0] ? 'NULL' : `'${original[0]}'`} WHERE storage_key = ${KEY}`);
    L.say('lease', `handed back -> ${lease()}`);
  }
} else {
  const pr = await s.submit(`[[${TAG}]] next prompt`);
  L.say('prompt on B', `${pr.status} ${JSON.stringify(pr.json ?? {}).slice(0, 120)}`);
  if (MODE === 'busy' || MODE === 'busy-released') {
    L.sql(DB, `UPDATE managed_workspace_execution_lease SET holder_key = ${MODE === 'busy-released' || !original[0] ? 'NULL' : `'${original[0]}'`} WHERE storage_key = ${KEY}`);
    L.say('lease', `handed back -> ${lease()}`);
  }
  await L.sleep(2000);
  const pr2 = await s.submit(`[[${TAG}]] next prompt after release`);
  L.say('prompt on B after release', `${pr2.status} ${JSON.stringify(pr2.json ?? {}).slice(0, 120)}`);
  const d = await s.detach();
  const C = await start(`s21-${TAG}-C`);
  (s as any).h = C; (s as any).connection = conn(C);
  let lc: any;
  const tc = Date.now();
  do { lc = await s.load(); if (lc.status !== 200) await L.sleep(2000); } while (lc.status !== 200 && Date.now() - tc < 150_000);
  L.say('detach B, load on new Harness C', `detach ${d.status} load ${lc.status} ${lc.status === 200 ? '' : JSON.stringify(lc.json)} @${since()}`);
}
if (xDone) { const xr: any = await xDone; L.say('Session X turn', L.summarizeTurn(xr)); }
const idle = await s.waitIdle(180_000).catch((e: any) => ({ error: String(e) }));
L.say('final status', JSON.stringify(idle).slice(0, 160));
const events = await s.transcript().catch(() => []);
L.say('turn', `terminal=${JSON.stringify(events.filter((e: any) => e.type?.startsWith('turn_')).map((e: any) => e.type))}; assistant=${JSON.stringify(L.assistantText(events)).slice(0, 80)}`);
L.say('side-effects', `generator ran ${runs()} time(s); continuation model calls ${continuation}`);
const journal = L.sql(DB, `SELECT CAST(record_bytes AS CHAR) FROM qwen_managed_session_journal_tx WHERE session_id='${sessionId}' ORDER BY journal_revision`).map((x: string[]) => x[0]).join('\n');
const kc: Record<string, number> = {};
for (const k of (journal.match(/"kind":"[a-z._]+"/g) ?? []).map((k) => k.slice(8, -1))) kc[k] = (kc[k] ?? 0) + 1;
L.say('journal', kc);
L.say('publications', L.publications(DB, sessionId).map((p: any) => `${p.id.slice(0, 8)} ${p.state}/${p.phase}`));
L.say('harness logs', hosts.map((h) => `${h.name.replace(/^s21-[^-]+-/, '')}: ${JSON.stringify(h.log().split('\n').filter((l: string) => /fail|block|error|busy|recover/i.test(l)).map((l: string) => l.slice(0, 160)).slice(0, 3))}`));
for (const h of hosts) await h.stop().catch(() => undefined);
process.exit(0);
