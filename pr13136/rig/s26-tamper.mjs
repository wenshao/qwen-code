// PR #13136: cold-load refusal matrix on the real stack. One Hook Session (ws-tm<n>: SessionStart, UPS, Permission,
// Pre/PostToolUse, PostToolBatch, Stop, MessageDisplay) runs two write_file turns, then detaches. For each resource
// kind x {missing, flip, truncate}: tamper one row in MySQL, cold-load on this arm's Harness, record the answer, restore
// the row (and the journal head's recovery status), then the next case. A control load at the end must succeed.
// usage: DB=<db> ARM=<dist> node s26-tamper.mjs <ws>
import fs from 'node:fs';
import { Report, Harness, HSession, startModel, workspace, createWorkspaceSession, storeConnection, pin, setControl, script, call, turn, RUN, sql, one, j, sleep } from './lib.mjs';
import { STORAGE } from './manifest.mjs';
const [WS] = process.argv.slice(2);
const ARM = process.env.ARM ?? 'head';
const PICK = process.env.PICK === 'latest' ? 'DESC' : 'ASC';
const R = new Report(`s26-tamper-${WS}-${ARM}${PICK === 'DESC' ? '-latest' : ''}`);
const KINDS = ['managed-hook_registration', 'managed-hook-catalog', 'managed-hook_execution', 'managed-hook-plan', 'managed-hook-input', 'managed-hook-result', 'managed-hook-messages', 'managed-checkpoint', 'managed-tool-outcome', 'managed-message'];
const MODES = ['missing', 'flip', 'truncate'];
const model = await startModel();
setControl({});
let h = await new Harness({ name: `s26-${WS}`, modelUrl: model.url, arm: ARM }).start();
const w = await workspace(STORAGE[WS], WS);
const sid = await createWorkspaceSession(w.workspaceId);
const results = [];
try {
  let s = new HSession(h, sid, storeConnection(h, w.workspaceId));
  const c = await s.create({ hookCatalog: pin(WS) });
  const p1 = await s.prompt(script([[call('write_file', { file_path: 'tm-a.txt', content: 'a' })]], 'TM-ONE'));
  const p2 = await s.prompt(script([[call('write_file', { file_path: 'tm-b.txt', content: 'b' })]], 'TM-TWO'));
  const d = await s.detach();
  R.check('seed Session', c.status === 200 && p1.terminal?.[0]?.type === 'turn_complete' && p2.terminal?.[0]?.type === 'turn_complete' && d.status < 300, `${c.status} | ${turn(p1)} | ${turn(p2)} | detach ${d.status}`);
  R.note('resource kinds', sql(`SELECT kind, COUNT(*) FROM qwen_managed_session_resource WHERE session_id='${sid}' GROUP BY kind ORDER BY kind`).map((r) => r.join('=')).join(' '));
  const ctl0 = await s.load();
  R.check('control load before tampering', ctl0.status === 200, `${ctl0.status} ${ctl0.json?.code ?? ''}`);
  await s.detach();
  sql(`DROP TABLE IF EXISTS rig_bak_res`);
  sql(`DROP TABLE IF EXISTS rig_bak_head`);
  for (const kind of KINDS) {
    // The earliest resource of the kind: an early record revision, the first plan, and so on.
    const rid = one(`SELECT resource_id FROM qwen_managed_session_resource WHERE session_id='${sid}' AND kind='${kind}' ORDER BY created_at ${PICK}, resource_id ${PICK} LIMIT 1`);
    if (!rid) {
      R.note(`${kind}`, 'not present in this Session');
      continue;
    }
    for (const mode of MODES) {
      sql(`CREATE TABLE rig_bak_res AS SELECT * FROM qwen_managed_session_resource WHERE session_id='${sid}' AND resource_id='${rid}'`);
      sql(`CREATE TABLE rig_bak_head AS SELECT * FROM qwen_managed_session_journal_head WHERE session_id='${sid}'`);
      const where = `session_id='${sid}' AND resource_id='${rid}'`;
      if (mode === 'missing') sql(`DELETE FROM qwen_managed_session_resource WHERE ${where}`);
      // Replace one byte inside the body (position 20, a byte of a JSON key or value): same length, wrong digest.
      if (mode === 'flip') sql(`UPDATE qwen_managed_session_resource SET inline_bytes = INSERT(inline_bytes, 20, 1, IF(SUBSTRING(inline_bytes, 20, 1)='x', 'y', 'x')) WHERE ${where}`);
      if (mode === 'truncate') sql(`UPDATE qwen_managed_session_resource SET inline_bytes = LEFT(inline_bytes, LENGTH(inline_bytes) - 1) WHERE ${where}`);
      s = new HSession(h, sid, storeConnection(h, w.workspaceId));
      let l;
      for (let k = 0; k < 20; k++) {
        l = await s.load().catch((e) => ({ status: 'ERR', json: { code: e.message } }));
        // A refusal that only says the previous open still holds the writer lease is retried; anything else is the answer.
        if (!(l.status === 409 && /lease|writer/i.test(l.json?.code ?? ''))) break;
        await sleep(5000);
      }
      const msg = String(l.json?.message ?? l.json?.error ?? '').replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, '<id>').slice(0, 140);
      const head = sql(`SELECT recovery_status, IFNULL(recovery_detail_code,'-') FROM qwen_managed_session_journal_head WHERE session_id='${sid}'`)[0].join(' ');
      results.push({ kind, mode, status: l.status, code: l.json?.code ?? null, message: msg, head });
      R.say(`  ${kind} ${mode}: ${l.status} ${l.json?.code ?? ''} | head ${head} | ${msg}`);
      if (l.status === 200) await s.detach();
      sql(`DELETE FROM qwen_managed_session_resource WHERE ${where}`);
      sql(`INSERT INTO qwen_managed_session_resource SELECT * FROM rig_bak_res`);
      sql(`UPDATE qwen_managed_session_journal_head h JOIN rig_bak_head b ON b.tenant_id=h.tenant_id AND b.session_id=h.session_id SET h.recovery_status=b.recovery_status, h.recovery_detail_code=b.recovery_detail_code`);
      sql(`DROP TABLE rig_bak_res`);
      sql(`DROP TABLE rig_bak_head`);
    }
  }
  s = new HSession(h, sid, storeConnection(h, w.workspaceId));
  let ctl;
  for (let k = 0; k < 20; k++) {
    ctl = await s.load();
    if (ctl.status === 200) break;
    await sleep(5000);
  }
  const p3 = ctl.status === 200 ? await s.prompt(script([[call('write_file', { file_path: 'tm-c.txt', content: 'c' })]], 'TM-THREE')) : null;
  R.check('control load after restoring every row, then a turn', ctl.status === 200 && p3?.terminal?.[0]?.type === 'turn_complete', `${ctl.status} ${ctl.json?.code ?? ''} ${p3 ? turn(p3) : ''}`);
  if (ctl.status === 200) await s.detach();
  const tampered = results.filter((r) => r.status === 200);
  R.check('every tampered case is refused', tampered.length === 0, tampered.map((r) => `${r.kind}/${r.mode}`).join(' ') || 'none loaded');
} finally {
  fs.writeFileSync(`${R.file}-matrix.json`, j(results));
  await h.close();
  await model.close();
  R.done({ session: sid });
}
