// Round 4 (head d8bc703e; also run against head + main d5c22d33): the round-1 runbook storage plus
//  - a real Hosted undo (POST /session/:id/files/rewind) so the file_history record carries undoReceipts,
//  - two Sessions (O1 with an O2 Shell publication, S2) deleted through the REAL Java lifecycle completion
//    (SessionLifecycleCoordinator -> completeOperation -> ToolPublicationRetentionStore.retire). Public Workspace
//    DELETE is refused with 409 workspace_unavailable, so only the admission row is inserted by SQL (same columns as
//    ManagedAgentStore admission), exactly like the author's probes.
// Then: capture -> same-UUID replay -> fresh verify, R1-30 SIGKILL/resume, and (NEG=1) negative retirement variants.
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import * as L from './lib.mjs';
import * as W from './w1b.mjs';
import * as P from './pop.mjs';
const TAG = process.env.TAG ?? 'r4';
L.openLog(`r4-runbook-${TAG}`);
const { say } = L;
const results = { tag: TAG };
say(L.hostFacts()); say(`   server jar=${L.env().JAR} dist=${L.env().DIST} | maint jar=${W.BUNDLE_JAR} cli=${W.CLI()} db=${L.DB()}`);
const one = (q) => L.one(q);
const T = L.TENANT;

L.sh('bash /Users/wenshao/pr13138-rig/vm/o2-ctl.sh down; bash /Users/wenshao/pr13138-rig/vm/o2-ctl.sh up > /dev/null');
await P.rollout(['a', 'b']);
L.sh(`mkdir -p ${L.root('a')}/project2`);
const rig = await L.startRig(`r4-${TAG}`);
const { S } = await P.populate(rig, { extraShell: ['mkdir -p gen && python3 -c "import os\nfor i in range(3000): open(f\'gen/f{i:05d}.txt\',\'w\').write(str(i))" && ls gen | wc -l'] });

// ---- a real Hosted undo on a Files Session (two writes, rewind to the second prompt)
say('== undo');
const U = new L.HSession(rig.h, await L.createSession('ws-a1'), 'ws-a1');
say(`   U1 ${U.sessionId} create=${(await U.create(L.FILES)).status}`);
const p1 = await U.prompt('WRITE undo.txt first'); say(`     U1 WRITE first: ${P.term(p1)}`);
const p2 = await U.prompt('WRITE undo.txt second'); say(`     U1 WRITE second: ${P.term(p2)}`);
const rw = await rig.h.json(`/session/${U.sessionId}/files/rewind`, { promptId: p2.promptId, requestId: randomUUID() }, { clientId: U.clientId });
const undoFile = fs.readFileSync(`${L.root('a')}/project/undo.txt`, 'utf8').trim();
say(`     rewind(second prompt): ${rw.status} filesChanged=${JSON.stringify(rw.json?.filesChanged)} conflict=${rw.json?.conflict} -> undo.txt="${undoFile}"`);
const rec = L.sql(`SELECT CAST(res.inline_bytes AS CHAR) FROM qwen_managed_session_extension_record r JOIN qwen_managed_session_resource res ON res.session_scope_key=r.session_scope_key AND res.resource_id=r.record_resource_id WHERE r.session_id='${U.sessionId}' AND r.domain='file_history' ORDER BY r.revision DESC LIMIT 1`)[0]?.[0];
let receipts = '?';
try { receipts = JSON.parse(rec).undoReceipts?.length ?? 0; } catch { /* not inline */ }
if (receipts === '?') {
  const all = L.sql(`SELECT CAST(inline_bytes AS CHAR) FROM qwen_managed_session_resource WHERE session_id='${U.sessionId}' AND kind='managed-file_history' ORDER BY created_at DESC LIMIT 1`)[0]?.[0];
  try { receipts = JSON.parse(all).undoReceipts?.length ?? 0; } catch { receipts = 'unreadable'; }
}
results.undo = { status: rw.status, filesChanged: rw.json?.filesChanged, conflict: rw.json?.conflict, file: undoFile, receipts };
say(`     latest file_history record undoReceipts=${receipts}`);
await U.detach();

// ---- delete O1 and S2 through the real Java lifecycle completion
say('== delete O1 and S2 (SQL admission row, real coordinator completion)');
say(`   writer leases lapsed after ${await W.waitLeasesExpired('a')} ms`);
const now = () => Date.now();
const del = {};
for (const name of ['O1', 'S2']) {
  const sid = S[name].sessionId; const op = `op_r4${randomUUID().replace(/-/g, '').slice(0, 20)}`;
  const t = now();
  L.sql(`INSERT INTO managed_agent_operation (tenant_id, session_id, operation_id, operation_kind, actor_digest, idempotency_key, request_digest, state, admission_stage, delivery_state, session_status_before, receipt_id, claim_generation, attempt_count, available_at, created_at, updated_at, completed_at) VALUES ('${T}','${sid}','${op}','DELETE','sha256:${'d'.repeat(64)}','${randomUUID()}','sha256:${'e'.repeat(64)}','PENDING','JAVA_DURABLE','PENDING','ACTIVE',NULL,0,0,${t},${t},${t},NULL)`);
  L.sql(`UPDATE managed_agent_session SET status='DELETING', updated_at=${t}, version=version+1 WHERE tenant_id='${T}' AND session_id='${sid}'`);
  del[name] = { sid, op };
}
for (let i = 0; i < 60; i++) {
  const states = Object.values(del).map((d) => one(`SELECT state FROM managed_agent_operation WHERE operation_id='${d.op}'`));
  if (states.every((s) => s === 'COMPLETED')) break;
  await L.sleep(1000);
}
for (const [name, d] of Object.entries(del)) {
  const o = L.sql(`SELECT state, delivery_state, admission_stage, IFNULL(completed_at,'-') FROM managed_agent_operation WHERE operation_id='${d.op}'`)[0];
  const s = L.sql(`SELECT status, IFNULL(deleted_at,'-') FROM managed_agent_session WHERE session_id='${d.sid}'`)[0];
  const h = L.sql(`SELECT state, IFNULL(latest_checkpoint_resource_id,'NULL'), IFNULL(writer_id,'NULL') FROM qwen_managed_session_journal_head WHERE session_id='${d.sid}'`)[0];
  const r = L.sql(`SELECT operation_id, generation, recovery_protected FROM qwen_output_session_retirement WHERE session_id='${d.sid}'`)[0];
  const pubs = L.sql(`SELECT retention_state, COUNT(*) FROM qwen_tool_publication WHERE session_id='${d.sid}' GROUP BY retention_state`).map((x) => `${x[0]}=${x[1]}`).join(',') || 'none';
  d.facts = { op: o, session: s, head: h, retirement: r, publications: pubs };
  say(`   ${name} ${d.sid}: operation=${o?.join('/')} session=${s?.join('/')} head=${h?.join('/')} retirement=${r ? `${r[0] === d.op ? 'same op' : r[0]} gen=${r[1]} protected=${r[2]}` : 'none'} publications=${pubs}`);
}
results.deleted = del;
const { fence, revision } = await P.offlineAndFence(rig, 'a');
await rig.stop();
P.memberTable('a');

const fresh = (name) => W.prepareBundle(`r4-${TAG}-${name}`, { sessions: W.members('a').map((m) => m.id) }).bundle;
const req = (bundle) => W.captureRequest({ fence, revision, bundle });
const line = (r) => r.stderr.split('\n').find((l) => /^[a-z_]+: /.test(l)) ?? r.cause ?? '';

say('== A: capture / replay / verify / authority unchanged');
{
  const b = fresh('a'); const q = req(b);
  const a0 = W.authoritySnapshot(`${TAG}-before`);
  const c = await W.w1b('capture', q, { oss: true, label: `${TAG}-A-capture` });
  const c2 = await W.w1b('capture', q, { oss: true, label: `${TAG}-A-replay` });
  const v = await W.w1b('verify', W.verifyRequest(q), { label: `${TAG}-A-verify` });
  const a1 = W.authoritySnapshot(`${TAG}-after`);
  const sessions = fs.existsSync(`${b}/.w1-recovery/sessions.ndjson`) ? fs.readFileSync(`${b}/.w1-recovery/sessions.ndjson`, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
  const deletedInBundle = Object.values(del).map((d) => sessions.some((s) => JSON.stringify(s).includes(d.sid)));
  results.A = { capture: W.summary(c), captureMs: c.ms, stderr: line(c), replayIdentical: c.stdout === c2.stdout, verify: W.summary(v), verifyMs: v.ms, authorityIdentical: a0.digest === a1.digest, tables: Object.keys(a0.tables).length, deletedInBundle };
  say(`   replay identical=${results.A.replayIdentical}; authority (${results.A.tables} tables) identical=${results.A.authorityIdentical}; deleted Sessions in sessions.ndjson=${deletedInBundle.join(',')}`);
  L.sh(`rm -rf ${b}`);
}

if (process.env.KILL === '1') {
  say('== R1-30: SIGKILL while assets.ndjson is being published');
  const b = fresh('kill'); const q = req(b);
  const pred = () => fs.existsSync(`${b}/.w1-recovery`) && fs.readdirSync(`${b}/.w1-recovery`).some((f) => f.startsWith('assets.ndjson.partial'));
  pred.label = 'assets.ndjson.partial exists';
  const k = await W.w1b('capture', q, { oss: true, label: `${TAG}-R130-killed`, killWhen: pred });
  const r1 = await W.w1b('capture', q, { oss: true, label: `${TAG}-R130-resume` });
  results.R130 = { killed: k.killed, resume: W.summary(r1) };
  say(`   [${k.killed}] resume: ${W.summary(r1).slice(0, 100)}`);
  L.sh(`rm -rf ${b}`);
}

if (process.env.NEG === '1') {
  say('== negative retirement variants (each reverted before the next)');
  const o = del.O1; const s = del.S2;
  const lastCk = L.sql(`SELECT latest_checkpoint_resource_id FROM qwen_managed_session_journal_tx WHERE session_id='${s.sid}' AND latest_checkpoint_resource_id IS NOT NULL ORDER BY journal_revision DESC LIMIT 1`)[0]?.[0];
  const cases = [
    ['N1 retirement recovery_protected=TRUE', `UPDATE qwen_output_session_retirement SET recovery_protected=TRUE WHERE session_id='${s.sid}'`, `UPDATE qwen_output_session_retirement SET recovery_protected=FALSE WHERE session_id='${s.sid}'`],
    ['N2 retirement row kept, Session status back to ACTIVE', `UPDATE managed_agent_session SET status='ACTIVE', deleted_at=NULL WHERE session_id='${s.sid}'`, `UPDATE managed_agent_session SET status='DELETED', deleted_at=${s.facts.session[1]} WHERE session_id='${s.sid}'`],
    ['N3 retirement row removed (DELETED head, pointer cleared)', `CREATE TABLE r4_saved AS SELECT * FROM qwen_output_session_retirement WHERE session_id='${s.sid}'; DELETE FROM qwen_output_session_retirement WHERE session_id='${s.sid}'`, `INSERT INTO qwen_output_session_retirement SELECT * FROM r4_saved; DROP TABLE r4_saved`],
    ['N4 DELETE operation not COMPLETED/CONFIRMED', `UPDATE managed_agent_operation SET delivery_state='LEASED' WHERE operation_id='${s.op}'`, `UPDATE managed_agent_operation SET delivery_state='CONFIRMED' WHERE operation_id='${s.op}'`],
    ['N5 retirement names another operation', `UPDATE qwen_output_session_retirement SET operation_id='${o.op}' WHERE session_id='${s.sid}'`, `UPDATE qwen_output_session_retirement SET operation_id='${s.op}' WHERE session_id='${s.sid}'`],
    ['N6 retired head pointer set back to its last checkpoint', `UPDATE qwen_managed_session_journal_head SET latest_checkpoint_resource_id='${lastCk}' WHERE session_id='${s.sid}'`, `UPDATE qwen_managed_session_journal_head SET latest_checkpoint_resource_id=NULL WHERE session_id='${s.sid}'`],
  ];
  results.neg = [];
  for (const [what, apply, revert] of cases) {
    L.sql(apply);
    const b = fresh('neg'); const q = req(b);
    const r = await W.w1b('capture', q, { oss: true, label: `${TAG}-${what.split(' ')[0]}`, quiet: true });
    const row = W.opRow(q.operationId);
    L.sql(revert); L.sh(`rm -rf ${b}`);
    results.neg.push({ what, exit: r.code, state: row?.state, lastError: row?.error, stderr: line(r).slice(0, 160), summary: W.summary(r).slice(0, 120) });
    say(`   ${what.padEnd(58)} exit=${r.code} ${row?.state ?? '-'}/${row?.error ?? '-'} | ${(line(r) || W.summary(r)).slice(0, 110)}`);
  }
  const b = fresh('control'); const q = req(b);
  const r = await W.w1b('capture', q, { oss: true, label: `${TAG}-N-control` });
  results.negControl = W.summary(r);
  say(`   control after all reverts (new UUID): ${W.summary(r).slice(0, 110)}`);
  L.sh(`rm -rf ${b}`);
}
fs.writeFileSync(`${L.OUT}/r4-runbook-${TAG}.json`, JSON.stringify(results, null, 1));
say('R4-DONE');
