// S17: the three product changes of 2cbf89313a over c21efbdfa1.
//   A. the marker path is a FIFO (the bot's R1-1): the guard must refuse at once instead of blocking in open()
//   B. inspect: an unreadable root is "unavailable", a readable different root is "mismatch"
//   C. resolving a permission Action (main's D6b public route) is new work: it is refused while the mount is unavailable
// Public route: real Java connector, approval mode "default", packaged Harness on a fixed port.
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import * as L from './lib.mjs';
L.openLog('s17-new-head');
const { say, sleep } = L; const R = '/srv/w1a'; const MARK = '.qwen-managed-storage.json';
const OLD = '/opt/w1a/r3-head-server.jar';
const state = () => JSON.parse(fs.readFileSync(`${L.RUN}/pub-state.json`, 'utf8'));
say(L.hostFacts()); say(L.svc('status').replace(/\n/g, ' '));
for (const s of 'abc') L.seedWs(`ws-${s}`, s);
const insp = (st, jar) => { const t0 = Date.now(); const cfg = L.env();
  const r = spawnSync('/opt/qwen/jdk/bin/java', ['-cp', jar ?? '/opt/w1a/head-server.jar', `-Dloader.main=${L.MAIN}`, 'org.springframework.boot.loader.launch.PropertiesLauncher', 'inspect', L.TENANT, `st-${st}`, `${R}/${st}`],
    { env: { PATH: '/usr/local/bin:/usr/bin:/bin', W1_JDBC_URL: `jdbc:mysql://127.0.0.1:3306/${L.DB()}?allowPublicKeyRetrieval=true&useSSL=false`, W1_JDBC_USER: 'root', W1_JDBC_PASSWORD: cfg.DBPASS || 'rootpw' }, encoding: 'utf8', timeout: 20000, cwd: '/tmp' });
  const out = (r.stdout ?? '').split('\n').filter((l) => l.trim()).at(-1) ?? '';
  const ms = Date.now() - t0;
  return ms >= 19900 ? `NO ANSWER within 20 s (process killed; exit ${r.status ?? r.signal})` : `${out.replace(/operation=\S+ completed=\S+ /, '')} (${ms} ms)`; };
const ledgerSince = (n) => state().ledger.slice(n).map((e) => `${L.opName(e.url)}→${e.status}${e.code ? `(${e.code})` : ''}`).join('  ') || '<no Broker calls>';
const turnRow = (sid) => L.sql(`SELECT status, COALESCE(error_code,'-') FROM managed_agent_turn WHERE session_id='${sid}' ORDER BY created_at DESC LIMIT 1`)[0] ?? ['<no turn row>'];
const opRows = (sid) => L.sql(`SELECT operation_kind, state, delivery_state, attempt_count, COALESCE(error_code,'-') FROM managed_agent_operation WHERE session_id='${sid}' AND operation_kind LIKE '%ACTION%' ORDER BY created_at`).map((r) => r.join('/')).join(' ; ') || '<no action operation>';
async function create(ws, text) {
  const res = await L.api('POST', '/v1/agents/sessions', { agent_id: 'qwen-code', input: [{ type: 'input_text', text }], workspace: { workspace_id: ws, cwd_relative: 'project' } }, { key: randomUUID() });
  return res.json.id;
}
async function pending(sid) {
  for (let i = 0; i < 120; i++) { const r = await L.api('GET', `/v1/agents/sessions/${sid}/actions`); const a = (r.json?.data ?? []).find((x) => ['pending', 'requested'].includes(String(x.state ?? x.status).toLowerCase())); if (a) return a; await sleep(250); }
  return null;
}
async function respond(sid, a, optionId) {
  const body = { kind: 'permission', input_revision: a.input_revision ?? a.inputRevision, policy_revision: a.policy_revision ?? a.policyRevision, option_id: optionId };
  const r = await L.api('POST', `/v1/agents/sessions/${sid}/actions/${a.id ?? a.action_id}/responses`, body, { key: randomUUID() });
  return `${r.status} ${JSON.stringify(r.json).slice(0, 200)}`;
}
const waitTurn = async (sid, ms = 30000) => { const t0 = Date.now(); let row; for (;;) { row = turnRow(sid); if (['COMPLETED', 'FAILED', 'CANCELLED'].includes(row[0]) || Date.now() - t0 > ms) break; await sleep(250); } return row.join(' / '); };

say('== C. resolving a permission Action through the public route (approval mode "default")');
let n0 = state().ledger.length;
const s1 = await create('ws-a', 'WRITE act1.txt x'); let a1 = await pending(s1);
say(`C1 control. Session ${s1?.slice(0, 8)}: pending Action ${a1 ? `${(a1.id ?? a1.action_id).slice(0, 24)}… options ${JSON.stringify((a1.options ?? []).map((o) => o.option_id ?? o.optionId ?? o.id))}` : 'NOT FOUND'}; turn ${turnRow(s1).join(' / ')}`);
if (!a1) { say('   raw actions list:', JSON.stringify((await L.api('GET', `/v1/agents/sessions/${s1}/actions`)).json).slice(0, 400)); }
const allow = (a) => { const ids = (a.options ?? []).map((o) => o.option_id ?? o.optionId ?? o.id); return ids.find((i) => /allow.*once|proceed.*once|allow/i.test(i)) ?? 'allow'; };
if (a1) {
  say(`   respond ${allow(a1)} with the mount intact: ${await respond(s1, a1, allow(a1))}`);
  say(`   turn ${await waitTurn(s1)}; act1.txt ${fs.existsSync(`${R}/a/project/act1.txt`) ? 'written' : 'NOT written'}; operations: ${opRows(s1)}`);
  say(`   broker: ${ledgerSince(n0)}`);
}
n0 = state().ledger.length; const m0 = state().modelCalls;
const s2 = await create('ws-a', 'WRITE act2.txt x'); const a2 = await pending(s2);
say(`C2 cached attachment. Session ${s2?.slice(0, 8)}: pending Action ${a2 ? 'found' : 'NOT FOUND'}; inspect: ${insp('a')}`);
if (a2) {
  fs.renameSync(`${R}/a/${MARK}`, `${R}/a/${MARK}.moved`);
  say(`   marker moved away -> inspect: ${insp('a')}`);
  say(`   respond ${allow(a2)}: ${await respond(s2, a2, allow(a2))}`);
  await sleep(6000);
  say(`   after 6 s: turn ${turnRow(s2).join(' / ')}; act2.txt ${fs.existsSync(`${R}/a/project/act2.txt`) ? 'WRITTEN' : 'not written'}; operations: ${opRows(s2)}`);
  say(`   broker: ${ledgerSince(n0)}; model calls +${state().modelCalls - m0}`);
  const again = await L.api('GET', `/v1/agents/sessions/${s2}/actions`);
  say(`   Action list now: ${JSON.stringify((again.json?.data ?? []).map((x) => ({ state: x.state ?? x.status, id: (x.id ?? x.action_id ?? '').slice(0, 20) })))}`);
  fs.renameSync(`${R}/a/${MARK}.moved`, `${R}/a/${MARK}`);
  say(`   marker back -> inspect: ${insp('a')}`);
  const a2b = await pending(s2);
  if (a2b) say(`   respond again: ${await respond(s2, a2b, allow(a2b))}`);
  say(`   turn ${await waitTurn(s2, 60000)}; act2.txt ${fs.existsSync(`${R}/a/project/act2.txt`) ? 'written' : 'not written'}; operations: ${opRows(s2)}`);
}
n0 = state().ledger.length;
const s3 = await create('ws-b', 'WRITE act3.txt x'); const a3 = await pending(s3);
say(`C3 cold attachment. Session ${s3?.slice(0, 8)} on storage b: pending Action ${a3 ? 'found' : 'NOT FOUND'}`);
if (a3) {
  fs.renameSync(`${R}/b/${MARK}`, `${R}/b/${MARK}.moved`);
  say('  ', L.svc('restart').split(' ===')[0], '(Spring restarted: the connector has no cached attachment; the Harness keeps running)');
  say(`   marker of b moved away -> inspect: ${insp('b')}`);
  const a3b = (await pending(s3)) ?? a3;
  say(`   respond ${allow(a3b)}: ${await respond(s3, a3b, allow(a3b))}`);
  await sleep(6000);
  say(`   after 6 s: turn ${turnRow(s3).join(' / ')}; act3.txt ${fs.existsSync(`${R}/b/project/act3.txt`) ? 'WRITTEN' : 'not written'}; operations: ${opRows(s3)}`);
  say(`   broker: ${ledgerSince(n0)}`);
  fs.renameSync(`${R}/b/${MARK}.moved`, `${R}/b/${MARK}`);
}

say('== A. the marker path is a FIFO (storage c, service stopped for the maintenance probes)');
L.svc('stop');
say(`   before: inspect (2cbf8931) ${insp('c')}`);
fs.renameSync(`${R}/c/${MARK}`, `${R}/c/${MARK}.real`); L.sh(`mkfifo ${R}/c/${MARK}`);
say(`   marker replaced by a FIFO: ${L.sh(`stat -c '%F' ${R}/c/${MARK}`)}`);
say(`   inspect with the 2cbf8931 jar: ${insp('c')}`);
say(`   inspect with the c21efbdf jar: ${insp('c', OLD)}`);
say('  ', L.svc('start').split(' ===')[0]);
n0 = state().ledger.length; const t0 = Date.now();
const s4 = await create('ws-c', 'WRITE fifo.txt x');
say(`   public create on storage c with the FIFO in place: turn ${await waitTurn(s4, 40000)} after ${Date.now() - t0} ms; fifo.txt ${fs.existsSync(`${R}/c/project/fifo.txt`) ? 'WRITTEN' : 'not written'}; broker: ${ledgerSince(n0)}`);
say(`   health after that: ${(await L.api('GET', '/actuator/health')).status}`);
L.svc('stop');
fs.rmSync(`${R}/c/${MARK}`); fs.renameSync(`${R}/c/${MARK}.real`, `${R}/c/${MARK}`);
say(`   marker restored: inspect ${insp('c')}`);

say('== B. inspect: unreadable root versus a different root (storage c)');
fs.renameSync(`${R}/c`, `${R}/c.away`);
say(`   root moved away (path missing):        2cbf8931: ${insp('c')}`);
say(`                                          c21efbdf: ${insp('c', OLD)}`);
fs.mkdirSync(`${R}/c/project`, { recursive: true }); L.sh(`sleep 0.05; touch ${R}/c`);
say(`   another directory at the same path:    2cbf8931: ${insp('c')}`);
fs.rmSync(`${R}/c`, { recursive: true }); fs.renameSync(`${R}/c.away`, `${R}/c`);
say(`   original back:                         2cbf8931: ${insp('c')}`);
say('S17-DONE');
