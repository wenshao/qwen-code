// PR #13136: upgrade a database that main (V27) wrote with real Hook Sessions to this PR (V28 + V29 backfill).
// seed   (main jar + main Harness): U1..U5 in ws-up1..ws-up5, each: 2 prompts with a write_file call (UPS once-key Hook,
//        PreToolUse, PostToolUse, Stop) + 3 Notification operations, then detach.
// tamper (SQL only, Spring stopped): U3 flip one byte of a hook_execution body (same length), U4 a copied
//        extension-record row that repeats a once key/ordinal, U5 delete the resource row of a hook_execution record.
// after  (PR jar + PR Harness): migration outcome, backfilled keys vs keys recomputed in SQL from the bodies,
//        load U1..U5, the once key stays consumed in U1, a new Session U6 in ws-up1 gets its own once key,
//        a new Session in U3's Workspace still works.
// usage: DB=up36 ARM=<dist> PHASE=seed|tamper|after node s25-upgrade.mjs
import fs from 'node:fs';
import { Report, Harness, HSession, startModel, workspace, createWorkspaceSession, storeConnection, pin, hookLedger, setControl, script, call, turn, toolTrace, RUN, sql, one, j } from './lib.mjs';
import { STORAGE } from './manifest.mjs';
const PHASE = process.env.PHASE;
const ARM = process.env.ARM ?? 'head';
const R = new Report(`s25-upgrade-${PHASE}-${ARM}`);
const STATE = `${RUN}/s25-sessions.json`;
const onceCalls = (sid) => hookLedger((e) => e.session === sid && e.name === 'once' && !e.kind).length;
const keyRows = (sid) =>
  sql(`SELECT r.domain, IFNULL(r.hook_once_key_hash,'-'), IFNULL(r.hook_occurrence_hash,'-'), IFNULL(r.hook_ordinal,'-'), IFNULL(r.hook_definition_hash,'-') FROM qwen_managed_session_extension_record r WHERE r.session_id='${sid}' AND r.domain IN ('hook_registration','hook_execution')`);
// Keys recomputed in SQL from each committed body, as an independent oracle for the Java projection.
const MISMATCH = (sid) => `SELECT COUNT(*) FROM qwen_managed_session_extension_record r JOIN qwen_managed_session_resource res ON res.session_scope_key=r.session_scope_key AND res.resource_id=r.record_resource_id
  WHERE r.session_id='${sid}' AND r.domain IN ('hook_registration','hook_execution') AND NOT (
   (r.domain='hook_execution' AND r.hook_definition_hash IS NULL
     AND r.hook_occurrence_hash <=> SHA2(JSON_UNQUOTE(JSON_EXTRACT(CAST(res.inline_bytes AS CHAR),'$.occurrenceId')),256)
     AND r.hook_ordinal <=> CAST(JSON_EXTRACT(CAST(res.inline_bytes AS CHAR),'$.ordinal') AS SIGNED)
     AND r.hook_once_key_hash <=> IF(JSON_TYPE(JSON_EXTRACT(CAST(res.inline_bytes AS CHAR),'$.onceKey'))='NULL', NULL, SHA2(JSON_UNQUOTE(JSON_EXTRACT(CAST(res.inline_bytes AS CHAR),'$.onceKey')),256)))
   OR (r.domain='hook_registration' AND r.hook_once_key_hash IS NULL AND r.hook_occurrence_hash IS NULL AND r.hook_ordinal IS NULL
     AND r.hook_definition_hash <=> SHA2(CONCAT(JSON_UNQUOTE(JSON_EXTRACT(CAST(res.inline_bytes AS CHAR),'$.run.definition.definitionId')), CHAR(0), JSON_EXTRACT(CAST(res.inline_bytes AS CHAR),'$.run.definition.definitionRevision')),256)))`;
const head = (sid) => sql(`SELECT recovery_status, IFNULL(recovery_detail_code,'-') FROM qwen_managed_session_journal_head WHERE session_id='${sid}'`)[0]?.join(' ');

const model = await startModel();
setControl({});
const h = await new Harness({ name: `s25-${PHASE}`, modelUrl: model.url, arm: ARM }).start();
try {
  if (PHASE === 'seed') {
    const out = {};
    for (const n of ['1', '2', '3', '4', '5']) {
      const ws = `ws-up${n}`;
      const w = await workspace(STORAGE[ws], ws);
      const sid = await createWorkspaceSession(w.workspaceId);
      const s = new HSession(h, sid, storeConnection(h, w.workspaceId));
      const c = await s.create({ hookCatalog: pin(ws) });
      const p1 = await s.prompt(script([[call('write_file', { file_path: `u${n}-a.txt`, content: 'a' })]], `U${n}-ONE`));
      const p2 = await s.prompt(script([[call('write_file', { file_path: `u${n}-b.txt`, content: 'b' })]], `U${n}-TWO`));
      const ops = [];
      for (let k = 0; k < 3; k++) ops.push((await s.hookOp('Notification', { message: `u${n}-${k}`, notification_type: 'rig' })).status);
      const d = await s.detach();
      out[`U${n}`] = { sid, ws, workspaceId: w.workspaceId };
      const recs = Number(one(`SELECT COUNT(*) FROM qwen_managed_session_extension_record WHERE session_id='${sid}' AND domain IN ('hook_registration','hook_execution')`));
      R.check(`U${n} seeded on ${ARM}`, c.status === 200 && p1.terminal?.[0]?.type === 'turn_complete' && p2.terminal?.[0]?.type === 'turn_complete' && ops.every((x) => x === 200) && d.status < 300 && onceCalls(sid) === 1,
        `create ${c.status}; prompts ${turn(p1)} | ${turn(p2)}; ops ${ops}; detach ${d.status}; once-key Hook calls ${onceCalls(sid)}; Hook records ${recs}`);
    }
    fs.writeFileSync(STATE, j(out));
    R.note('schema', sql(`SELECT GROUP_CONCAT(version ORDER BY installed_rank) FROM flyway_schema_history`)[0][0]);
  } else if (PHASE === 'tamper') {
    const st = JSON.parse(fs.readFileSync(STATE, 'utf8'));
    // U3: flip one byte of one hook_execution body; length unchanged, digest no longer matches.
    const [k3, r3] = sql(`SELECT r.record_key, r.record_resource_id FROM qwen_managed_session_extension_record r WHERE r.session_id='${st.U3.sid}' AND r.domain='hook_execution' ORDER BY r.first_sequence DESC LIMIT 1`)[0];
    sql(`UPDATE qwen_managed_session_resource SET inline_bytes = INSERT(inline_bytes, LOCATE('"eventName":"', inline_bytes) + 13, 1, 'X') WHERE session_id='${st.U3.sid}' AND resource_id='${r3}'`);
    R.note('U3 tamper: first letter of eventName replaced in', `${r3} (record ${k3.slice(0, 12)}); sha256 now ${one(`SELECT IF(SHA2(inline_bytes,256)=sha256,'matches','MISMATCH') FROM qwen_managed_session_resource WHERE session_id='${st.U3.sid}' AND resource_id='${r3}'`)}`);
    // U4: a second extension-record row that repeats the once-key execution (new record_key/record_id, same body).
    const [k4] = sql(`SELECT r.record_key FROM qwen_managed_session_extension_record r JOIN qwen_managed_session_resource res ON res.session_scope_key=r.session_scope_key AND res.resource_id=r.record_resource_id WHERE r.session_id='${st.U4.sid}' AND r.domain='hook_execution' AND JSON_TYPE(JSON_EXTRACT(CAST(res.inline_bytes AS CHAR),'$.onceKey'))='STRING' LIMIT 1`)[0];
    sql(`INSERT INTO qwen_managed_session_extension_record (session_scope_key, record_key, tenant_id, workspace_id, session_id, domain, record_id, operation_hash, revision, record_resource_id, task_kind, task_state, runtime_state, definition_revision, delivery_target, delivery_state, created_at, started_at, settled_at, first_sequence)
         SELECT session_scope_key, SHA2(CONCAT(record_key,'-dup'),256), tenant_id, workspace_id, session_id, domain, CONCAT(record_id,'-dup'), SHA2(CONCAT(operation_hash,'-dup'),256), revision, record_resource_id, task_kind, task_state, runtime_state, definition_revision, delivery_target, delivery_state, created_at, started_at, settled_at, first_sequence FROM qwen_managed_session_extension_record WHERE session_id='${st.U4.sid}' AND record_key='${k4}'`);
    R.note('U4 tamper: duplicated once-key row', `${k4.slice(0, 12)} -> ${one(`SELECT COUNT(*) FROM qwen_managed_session_extension_record WHERE session_id='${st.U4.sid}' AND domain='hook_execution'`)} hook_execution rows`);
    // U5: the resource row of one hook_execution record is gone.
    const [k5, r5] = sql(`SELECT r.record_key, r.record_resource_id FROM qwen_managed_session_extension_record r WHERE r.session_id='${st.U5.sid}' AND r.domain='hook_execution' ORDER BY r.first_sequence DESC LIMIT 1`)[0];
    sql(`DELETE FROM qwen_managed_session_resource WHERE session_id='${st.U5.sid}' AND resource_id='${r5}'`);
    R.note('U5 tamper: deleted resource', `${r5} (record ${k5.slice(0, 12)})`);
    for (const u of ['U1', 'U2', 'U3', 'U4', 'U5']) R.note(`${u} journal head before upgrade`, head(st[u].sid));
  } else if (PHASE === 'after') {
    const st = JSON.parse(fs.readFileSync(STATE, 'utf8'));
    R.note('flyway history', sql(`SELECT version, description, type, success, execution_time FROM flyway_schema_history WHERE version >= '27' ORDER BY installed_rank`).map((r) => r.join(' ')).join(' | '));
    R.check('V28 and V29 applied successfully', one(`SELECT COUNT(*) FROM flyway_schema_history WHERE version IN ('28','29') AND success=1`) === '2');
    R.note('indexes', sql(`SELECT DISTINCT INDEX_NAME, NON_UNIQUE FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='qwen_managed_session_extension_record' AND INDEX_NAME LIKE '%hook%'`).map((r) => r.join(':')).join(' '));
    const expect = { U1: 'READY -', U2: 'READY -', U3: 'BLOCKED_RESOURCE hook_admission_record_unverified', U4: 'BLOCKED_RESOURCE hook_admission_record_duplicate', U5: 'BLOCKED_RESOURCE hook_admission_record_unverified' };
    for (const u of Object.keys(expect)) {
      const rows = keyRows(st[u].sid);
      const nullExec = rows.filter((r) => r[0] === 'hook_execution' && r[2] === '-').length;
      const nullReg = rows.filter((r) => r[0] === 'hook_registration' && r[4] === '-').length;
      R.check(`${u}: journal head after the backfill`, head(st[u].sid) === expect[u], `${head(st[u].sid)}; ${rows.length} Hook rows, unprojected: ${nullExec} executions, ${nullReg} registrations; mismatches vs SQL recomputation (projected rows): ${one(MISMATCH(st[u].sid) + " AND (r.hook_occurrence_hash IS NOT NULL OR r.hook_definition_hash IS NOT NULL)")}`);
    }
    R.check('U1/U2: every backfilled key equals the SQL recomputation from its body', one(MISMATCH(st.U1.sid)) === '0' && one(MISMATCH(st.U2.sid)) === '0', `U1 ${one(MISMATCH(st.U1.sid))}, U2 ${one(MISMATCH(st.U2.sid))} mismatches`);
    R.check('U1 and U2 hold the same once-key hash (two Sessions may use one key)', one(`SELECT COUNT(DISTINCT session_id) FROM qwen_managed_session_extension_record WHERE session_id IN ('${st.U1.sid}','${st.U2.sid}') AND hook_once_key_hash IS NOT NULL`) === '2' && one(`SELECT COUNT(DISTINCT hook_once_key_hash) FROM qwen_managed_session_extension_record WHERE session_id IN ('${st.U1.sid}','${st.U2.sid}') AND hook_once_key_hash IS NOT NULL`) === '1');
    // Live use after the upgrade.
    const S = {};
    for (const u of ['U1', 'U2', 'U3', 'U4', 'U5']) {
      S[u] = new HSession(h, st[u].sid, storeConnection(h, st[u].workspaceId));
      const l = await S[u].load();
      R.note(`${u} load on ${ARM}`, `${l.status} ${l.json?.code ?? ''} ${String(l.json?.message ?? l.json?.error ?? '').slice(0, 160)}`);
      st[u].load = l.status;
    }
    R.check('U1, U2 load 200; U3, U4, U5 are refused', st.U1.load === 200 && st.U2.load === 200 && [st.U3.load, st.U4.load, st.U5.load].every((x) => x >= 400));
    const before = onceCalls(st.U1.sid);
    const p3 = await S.U1.prompt(script([[call('write_file', { file_path: 'u1-c.txt', content: 'c' })]], 'U1-THREE'));
    const ops = [];
    for (let k = 0; k < 3; k++) ops.push((await S.U1.hookOp('Notification', { message: `u1-after-${k}`, notification_type: 'rig' })).status);
    R.check('U1 after the upgrade: turn completes, once-key Hook does not fire again, Notification ops 200', p3.terminal?.[0]?.type === 'turn_complete' && onceCalls(st.U1.sid) === before && before === 1 && ops.every((x) => x === 200),
      `${turn(p3)}; once-key Hook calls ${before} -> ${onceCalls(st.U1.sid)}; ops ${ops}; ${toolTrace(p3.events).filter((x) => x.startsWith('result')).join(' ').slice(0, 120)}`);
    R.check('U1 rows written by this PR carry keys equal to the SQL recomputation', one(MISMATCH(st.U1.sid)) === '0' && one(`SELECT COUNT(*) FROM qwen_managed_session_extension_record WHERE session_id='${st.U1.sid}' AND domain='hook_execution' AND hook_occurrence_hash IS NULL`) === '0',
      `mismatches ${one(MISMATCH(st.U1.sid))}; hook_execution rows ${one(`SELECT COUNT(*) FROM qwen_managed_session_extension_record WHERE session_id='${st.U1.sid}' AND domain='hook_execution'`)}`);
    const d1 = await S.U1.detach();
    const l1 = await S.U1.load();
    const p4 = await S.U1.prompt(script([[call('write_file', { file_path: 'u1-d.txt', content: 'd' })]], 'U1-FOUR'));
    R.check('U1 detach + load + prompt after the upgrade', d1.status < 300 && l1.status === 200 && p4.terminal?.[0]?.type === 'turn_complete' && onceCalls(st.U1.sid) === 1, `detach ${d1.status} load ${l1.status} ${turn(p4)} once calls ${onceCalls(st.U1.sid)}`);
    await S.U1.detach();
    await S.U2.detach();
    // A new Session in U1's Workspace consumes the same once key for itself.
    const w1 = await workspace(STORAGE['ws-up1'], 'ws-up1');
    const u6 = await createWorkspaceSession(w1.workspaceId);
    const S6 = new HSession(h, u6, storeConnection(h, w1.workspaceId));
    const c6 = await S6.create({ hookCatalog: pin('ws-up1') });
    const p6 = await S6.prompt(script([[call('write_file', { file_path: 'u6-a.txt', content: 'a' })]], 'U6-ONE'));
    const p6b = await S6.prompt(script([[call('write_file', { file_path: 'u6-b.txt', content: 'b' })]], 'U6-TWO'));
    R.check('new Session U6 in ws-up1: once-key Hook fires exactly once', c6.status === 200 && p6.terminal?.[0]?.type === 'turn_complete' && p6b.terminal?.[0]?.type === 'turn_complete' && onceCalls(u6) === 1, `${turn(p6)} | ${turn(p6b)} once calls ${onceCalls(u6)}`);
    await S6.detach();
    // A new Session in the Workspace whose only other Session (U3) the backfill blocked.
    const w3 = await workspace(STORAGE['ws-up3'], 'ws-up3');
    const u7 = await createWorkspaceSession(w3.workspaceId);
    const S7 = new HSession(h, u7, storeConnection(h, w3.workspaceId));
    const c7 = await S7.create({ hookCatalog: pin('ws-up3') });
    const p7 = await S7.prompt(script([[call('write_file', { file_path: 'u7-a.txt', content: 'a' })]], 'U7-ONE'));
    R.check('new Session U7 in ws-up3 (U3 blocked) works', c7.status === 200 && p7.terminal?.[0]?.type === 'turn_complete' && onceCalls(u7) === 1, `${c7.status} ${turn(p7)} once calls ${onceCalls(u7)}`);
    await S7.detach();
    fs.writeFileSync(STATE, j({ ...st, U6: { sid: u6 }, U7: { sid: u7 } }));
  }
} finally {
  await h.close();
  await model.close();
  R.done();
}
