// After recovery: old receipts, evidence, and what current authorization may start next.
import * as d from './drive.mjs';
import fs from 'node:fs';
const label = process.argv[2];
const { A, B, C, D } = JSON.parse(fs.readFileSync(`/rig/out/${label}-arms.json`, 'utf8')).arms;
const say = (...a) => console.log(d.now(), ...a);
say('host', JSON.stringify(d.hostFacts()));
for (const row of d.sql(`SELECT storage_id, JSON_UNQUOTE(JSON_EXTRACT(loss_evidence_json,'$.fact')), JSON_UNQUOTE(JSON_EXTRACT(loss_evidence_json,'$.source')), JSON_UNQUOTE(JSON_EXTRACT(loss_evidence_json,'$.observedAt')), JSON_UNQUOTE(JSON_EXTRACT(loss_evidence_json,'$.hostDomain')), JSON_UNQUOTE(JSON_EXTRACT(stop_evidence_json,'$.fact')), JSON_UNQUOTE(JSON_EXTRACT(stop_evidence_json,'$.source')), JSON_UNQUOTE(JSON_EXTRACT(stop_evidence_json,'$.observedAt')), JSON_UNQUOTE(JSON_EXTRACT(stop_evidence_json,'$.hostDomain')) FROM qwen_runtime_binding ORDER BY storage_id, runtime_generation`))
  say(`evidence ${row[0]}: loss=${row[1]}/${row[2]}@${row[3]} stop=${row[5]}/${row[6]}@${row[7]} sameDomain=${row[4] === row[8]} domain=${String(row[8]).slice(0, 8)}…:${String(row[8]).split(':')[1]}:${String(row[8]).split(':')[2]?.slice(0, 8)}…`);
say('raw evidence key sample', JSON.stringify(d.sql(`SELECT JSON_KEYS(stop_evidence_json) FROM qwen_runtime_binding LIMIT 1`)[0]));
// old receipts remain readable facts
for (const [name, arm, call] of [['A settled', A, A.settledCall], ['A in-flight', A, A.escapeCall], ['C settled', C, C.settledCall]]) {
  const row = d.sql(`SELECT execution_state, IFNULL(execution_status,'-'), IF(result_json IS NULL,'no result','result kept'), IFNULL(loss_evidence_id,'-') FROM qwen_tool_execution WHERE execution_call_id='${call}'`)[0];
  say(`receipt ${name}: ${row.join(' | ')}`);
}
say('prepared receipts:', JSON.stringify(d.sql(`SELECT execution_state, COUNT(*), SUM(result_json IS NOT NULL) FROM qwen_tool_execution WHERE tool_call_id LIKE 'prep-%' GROUP BY execution_state`)));
// C: authorization is gone -> nothing new may start
const wc = await d.warm(C.sid);
say('C warm (access revoked, Session deleted, Registry changed, mount removed):', wc.status, JSON.stringify(wc.json));
const ac = await d.acquire(C.sid, `rs-C2-${C.sid.slice(-6)}`);
say('C acquire:', ac.status, JSON.stringify(ac.json));
// A: current authorization creates the next generation
const wa = await d.warm(A.sid);
say('A warm (authorized):', wa.status, JSON.stringify(wa.json), `${wa.ms} ms`);
const rs2 = `rs-A2-${A.sid.slice(-6)}`;
const aa = await d.acquire(A.sid, rs2);
say('A acquire new Runtime Session:', aa.status, JSON.stringify(aa.json).slice(0, 160));
const c = await d.create(A.sid, rs2, 'call-after-reboot', 'echo after-reboot >> settled.txt; cat settled.txt; tail -1 escaped-marker; pgrep -af escaped-writer || echo "no escaped writer process"');
for (let i = 0; i < 40; i++) {
  const s = await d.status(A.sid, rs2, c.json.executionCallId);
  if (s.json?.status?.state === 'settled') { say('A new execution:', s.json.status.result.executionStatus, JSON.stringify(s.json.status.result.responseParts?.[0]?.text).slice(0, 500)); break; }
  await d.sleep(250);
}
// old Runtime Session of A is not usable any more
const old = await d.create(A.sid, A.rsid, 'call-old-session', 'echo must-not-run > old-session.txt');
say('A create on the ORIGINAL Runtime Session:', old.status, JSON.stringify(old.json).slice(0, 200), 'file exists:', fs.existsSync(`${A.dir}/old-session.txt`));
