// node run.mjs <scenario> <arm> <engine> [tag]
import { makeRig, sleep, q, rows } from './rig.mjs';
import { randomUUID, randomBytes } from 'node:crypto';
import fs from 'node:fs';

const [scenario, arm, engine, tag = ''] = process.argv.slice(2);
const SC = {};

// --- smoke: one legacy Session, one Turn ---
SC.smoke = async (r) => {
  await r.boot();
  const T = 't-smoke';
  const c = await r.createSession(T, 'smoke');
  r.record('create', { status: c.status, id: c.json?.id, sessionStatus: c.json?.status });
  const s = await r.submit(T, c.json.id, r.directive({ n: 3 }));
  r.record('submit', { status: s.status, body: s.json });
  r.record('turns', await r.waitTurns(T, c.json.id));
  r.record('proxyPaths', [...new Set(r.proxyLog.map((x) => `${x.method} ${x.url.replace(/\/session\/[^/]+/, '/session/:id')}`))]);
};

// --- dispatch errors through the advice (405 / 415 / 400s) ---
SC.dispatch = async (r) => {
  await r.boot({ harness: false });
  const T = 't-dispatch';
  const out = {};
  out.put_collection = await r.api(T, 'PUT', '/v1/agents/sessions', {});
  out.delete_collection = await r.api(T, 'DELETE', '/v1/agents/sessions');
  out.text_plain_with_key = await r.api(T, 'POST', '/v1/agents/sessions', 'hello', { 'content-type': 'text/plain', 'idempotency-key': randomUUID() }, { raw: true });
  out.text_plain_no_key = await r.api(T, 'POST', '/v1/agents/sessions', 'hello', { 'content-type': 'text/plain' }, { raw: true });
  out.limit_not_int = await r.api(T, 'GET', '/v1/agents/sessions?limit=abc');
  out.missing_header = await r.api(T, 'POST', '/v1/agents/sessions', { agent_id: 'qwen-code' });
  out.bad_cursor = await r.api(T, 'GET', '/v1/agents/sessions?cursor=!!notbase64!!');
  out.restore_missing_param = await r.api(T, 'GET', '/internal/managed-session-store/v1/sessions/s1/restore', undefined, { 'x-qwen-managed-writer-token': 'x'.repeat(40) });
  out.malformed_json = await r.api(T, 'POST', '/v1/agents/sessions', '{"agent_id":', { 'content-type': 'application/json', 'idempotency-key': randomUUID() }, { raw: true });
  for (const [k, v] of Object.entries(out)) r.record(k, { status: v.status, code: v.code, allow: v.headers.allow ?? null, message: v.json?.error?.message ?? v.json?.message ?? null });
  r.record('springErrors', r.grepLog('spring', /ERROR|Exception/).slice(0, 12).map((l) => l.slice(0, 300)));
};

const WS = '/api/agent/web-shell/v1';
async function waitOperation(r, T, sid, op, timeoutMs = 60000) {
  const end = Date.now() + timeoutMs;
  let last;
  while (Date.now() < end) {
    last = await r.api(T, 'GET', `/v1/agents/sessions/${sid}/operations/${op}`);
    if (last.json && !['pending', 'running', 'accepted', 'in_progress'].includes(last.json.status)) return last;
    await sleep(250);
  }
  return last;
}

// --- tr_TR default locale: every lower-cased protocol token ---
SC.locale = async (r) => {
  await r.boot();
  const T = 't-locale';
  const a = await r.createSession(T, 'locale-a');
  const sid = a.json.id;
  r.record('create.status', a.json?.status);
  r.record('get.status', (await r.api(T, 'GET', `/v1/agents/sessions/${sid}`)).json?.status);
  r.record('list.statuses', (await r.api(T, 'GET', '/v1/agents/sessions?limit=5')).json?.data?.map((s) => s.status));
  const wq = await r.api(T, 'POST', `${WS}/sessions/query`, { limit: 5 });
  r.record('webshell.query', { status: wq.status, statuses: (wq.json?.sessions ?? wq.json?.data ?? wq.json?.items ?? []).map((s) => s.status), raw: wq.text.slice(0, 200) });
  // A held Turn: status while running.
  const s1 = await r.submit(T, sid, r.directive({ n: 2, hold: 4000 }));
  const tid = s1.json.turn_id;
  await sleep(1500);
  const running = await r.api(T, 'GET', `/v1/agents/sessions/${sid}/turns/${tid}`);
  r.record('turn.whileRunning', { http: running.status, status: running.json?.status });
  const turnsList = await r.api(T, 'GET', `/v1/agents/sessions/${sid}/turns`);
  r.record('turns.list.whileRunning', turnsList.json?.data?.map((t) => t.status));
  r.record('turns.settled1', await r.waitTurns(T, sid));
  // A real failing tool (read_file of a missing file) on a Workspace Session.
  r.registerWorkspace();
  const WT = 'ws-tenant';
  const wsCreate = await r.createSession(WT, 'locale-ws', { workspace: { workspace_id: 'rig-workspace' } });
  r.record('ws.create', { http: wsCreate.status, code: wsCreate.code, status: wsCreate.json?.status });
  if (wsCreate.status === 202) {
    const wsid = wsCreate.json.id;
    const s2 = await r.submit(WT, wsid, r.directive({ failTool: process.env.FAIL_PATH ?? '/definitely/missing/pr13325.txt', argName: process.env.FAIL_ARG ?? 'file_path' }));
    r.record('ws.submit', { http: s2.status, code: s2.code });
    r.record('ws.turns', await r.waitTurns(WT, wsid, 120000));
    const items = await r.api(WT, 'GET', `/v1/agents/sessions/${wsid}/items?limit=50`);
    r.record('ws.items', (items.json?.data ?? []).map((i) => ({ type: i.type, status: i.status ?? null })));
    r.record('ws.tool.events.status', rows(r.sql(`SELECT event_type, COALESCE(JSON_UNQUOTE(JSON_EXTRACT(data_json,'$.status')),'-') FROM managed_agent_event WHERE tenant_id=${q(WT)} AND session_id=${q(wsid)} AND event_type LIKE '%tool%' ORDER BY sequence_id`)));
  }
  // Archive while active -> session_state_conflict message; then close + archive.
  const ar0 = await r.api(T, 'POST', `/v1/agents/sessions/${sid}/archive`, undefined, { 'idempotency-key': randomUUID() });
  r.record('archiveWhileActive', { http: ar0.status, code: ar0.code, message: ar0.json?.error?.message });
  const cl = await r.api(T, 'POST', `/v1/agents/sessions/${sid}/close`, undefined, { 'idempotency-key': randomUUID() });
  const clDone = cl.json?.id ? await waitOperation(r, T, sid, cl.json.id) : null;
  const ar = await r.api(T, 'POST', `/v1/agents/sessions/${sid}/archive`, undefined, { 'idempotency-key': randomUUID() });
  const arDone = ar.json?.id ? await waitOperation(r, T, sid, ar.json.id) : null;
  r.record('closeArchive', { close: cl.status, closeOp: clDone?.json?.status ?? cl.text.slice(0, 120), archive: ar.status, archiveOp: arDone?.json?.status ?? ar.text.slice(0, 120) });
  r.record('get.afterArchive', (await r.api(T, 'GET', `/v1/agents/sessions/${sid}`)).json?.status);
  const refused = await r.submit(T, sid, 'after archive');
  r.record('submit.afterArchive', { http: refused.status, code: refused.code, message: refused.json?.error?.message });
  r.record('db.statuses', rows(r.sql(`SELECT status FROM managed_agent_session WHERE tenant_id=${q(T)}`)));
};

// --- title policy across create / rename, and a 300-char title on base ---
SC.title = async (r) => {
  await r.boot();
  const T = 't-title';
  const out = {};
  for (const n of [256, 257, 300, 512, 513]) {
    const c = await r.createSession(T, 't'.repeat(n));
    out[`create${n}`] = { http: c.status, code: c.code, storedLen: c.json?.metadata?.title?.length ?? null };
  }
  const ctl = await r.createSession(T, 'bad\ttitle');
  out.createControlTab = { http: ctl.status, code: ctl.code, stored: ctl.json?.metadata?.title ?? null };
  const okId = (await r.createSession(T, 'short')).json.id;
  for (const n of [256, 257, 300]) {
    const p = await r.api(T, 'PATCH', `/v1/agents/sessions/${okId}`, { title: 't'.repeat(n) }, { 'idempotency-key': randomUUID() });
    out[`rename${n}`] = { http: p.status, code: p.code };
  }
  // WebShell create with a 300-char title (OpenAPI still says maxLength 512 there).
  const wc = await r.api(T, 'POST', `${WS}/sessions/create`, { requestId: randomUUID(), title: 'w'.repeat(300) });
  out.webshellCreate300 = { http: wc.status, code: wc.code };
  for (const [k, v] of Object.entries(out)) r.record(k, v);
  // On an arm that accepts a 300-char title: does a Turn on it reach the Harness?
  const c300 = await r.createSession(T, 'x'.repeat(300), { input: [{ type: 'text', text: r.directive({ n: 2 }) }] });
  r.record('create300WithInput', { http: c300.status, code: c300.code });
  if (c300.status === 202) {
    r.record('create300WithInput.turns', await r.waitTurns(T, c300.json.id, 90000));
    r.record('create300WithInput.harnessErrors', r.grepLog('spring', /title|256|invalid/i).slice(0, 5).map((l) => l.slice(0, 300)));
  }
};

// --- recoveryDetailCode width vs the VARCHAR(128) column ---
SC.recovery = async (r) => {
  await r.boot({ harness: false });
  const T = 't-recovery';
  const token = 'w'.repeat(40);
  const base = '/internal/managed-session-store/v1/sessions';
  const sessionFor = async (label) => {
    const sid = `rec-${label}-${randomBytes(3).toString('hex')}`;
    const acq = await r.api(T, 'POST', `${base}/${sid}/writers:acquire`, { workspaceId: 'ws-rec', writerId: 'writer-1', leaseMillis: 60000 }, { 'x-qwen-managed-writer-token': token });
    return { sid, acq };
  };
  const block = (sid, code) => r.api(T, 'POST', `${base}/${sid}/recovery:block`, { workspaceId: 'ws-rec', writerId: 'writer-1', writerGeneration: 1, recoveryStatus: 'BLOCKED_EXECUTION', recoveryDetailCode: code }, { 'x-qwen-managed-writer-token': token });
  const head = (sid) => rows(r.sql(`SELECT recovery_status, COALESCE(CHAR_LENGTH(recovery_detail_code),0) FROM qwen_managed_session_journal_head WHERE tenant_id=${q(T)} AND session_id=${q(sid)}`))[0];
  const cases = { len129: 'c'.repeat(129), len4096: 'c'.repeat(4096), len128: 'c'.repeat(128), cjk128: '码'.repeat(128), emoji64: '😀'.repeat(64), emoji65: '😀'.repeat(65) };
  for (const [k, code] of Object.entries(cases)) {
    const { sid, acq } = await sessionFor(k);
    if (acq.status !== 200) { r.record(k, { acquire: acq.status, body: acq.text.slice(0, 200) }); continue; }
    const b = await block(sid, code);
    r.record(k, { http: b.status, code: b.code, row: head(sid) });
  }
  r.record('springDataTooLong', r.grepLog('spring', /Data too long|Data truncation|1406/).slice(0, 3).map((l) => l.slice(0, 260)));
};

// --- keyset pagination when updated_at moves (rename and Turn variants) ---
SC.paging = async (r) => {
  await r.boot();
  const list = async (T, limit, cursor) => (await r.api(T, 'GET', `/v1/agents/sessions?limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`)).json;
  const walk = async (T, limit) => {
    const seen = [];
    let cursor;
    for (let i = 0; i < 20; i++) {
      const page = await list(T, limit, cursor);
      seen.push(...page.data.map((s) => s.metadata?.title));
      if (!page.has_more) break;
      cursor = page.next_cursor ?? page.last_id;
    }
    return seen;
  };
  for (const variant of ['rename', 'turn']) {
    const T = `t-page-${variant}`;
    const ids = {};
    for (const name of ['A', 'B', 'C']) { ids[name] = (await r.createSession(T, name)).json.id; await sleep(20); }
    const p1 = await list(T, 2);
    const p1Titles = p1.data.map((s) => s.metadata?.title);
    const off = ['A', 'B', 'C'].find((n) => !p1Titles.includes(n));
    if (variant === 'rename') {
      const ren = await r.api(T, 'PATCH', `/v1/agents/sessions/${ids[off]}`, { title: off }, { 'idempotency-key': randomUUID() });
      r.record(`${variant}.renameHttp`, ren.status);
    } else {
      const s = await r.submit(T, ids[off], r.directive({ n: 3 }));
      r.record(`${variant}.submitHttp`, s.status);
      await r.waitTurns(T, ids[off]);
    }
    const p2 = await list(T, 2, p1.next_cursor ?? p1.last_id);
    r.record(`${variant}.result`, { page1: p1Titles, offPage1: off, page2: p2?.data?.map((s) => s.metadata?.title) ?? p2, cursorField: p1.next_cursor ? 'next_cursor' : 'last_id', fullWalkLimit1: await walk(T, 1) });
  }
};

// --- replay while the Harness is disabled, and replays after delete ---
SC.replay = async (r) => {
  await r.boot();
  const T = 't-replay';
  const K = { submit: randomUUID(), create: randomUUID(), rename: randomUUID(), renameDel: randomUUID(), unarchDel: randomUUID() };
  const A = (await r.createSession(T, 'A')).json.id;
  const turnText = r.directive({ n: 2 });
  const s1 = await r.submit(T, A, turnText, K.submit);
  r.record('p1.submit', { http: s1.status, replayed: s1.json?.replayed });
  await r.waitTurns(T, A);
  const createBody = { input: [{ type: 'text', text: r.directive({ n: 2 }) }] };
  const c1 = await r.createSession(T, 'B', createBody, K.create);
  r.record('p1.createWithInput', { http: c1.status, replay: c1.headers['x-qwen-idempotent-replay'] });
  await r.waitTurns(T, c1.json.id);
  const ren = await r.api(T, 'PATCH', `/v1/agents/sessions/${A}`, { title: 'A2' }, { 'idempotency-key': K.rename });
  r.record('p1.rename', { http: ren.status, replay: ren.headers['x-qwen-idempotent-replay'] });
  // Rename then delete C; archive + unarchive then delete D.
  const C = (await r.createSession(T, 'C')).json.id;
  const renC = await r.api(T, 'PATCH', `/v1/agents/sessions/${C}`, { title: 'C2' }, { 'idempotency-key': K.renameDel });
  const delC = await r.api(T, 'DELETE', `/v1/agents/sessions/${C}`, undefined, { 'idempotency-key': randomUUID() });
  const delCop = delC.json?.id ? await waitOperation(r, T, C, delC.json.id) : null;
  r.record('p1.renameThenDeleteC', { rename: renC.status, delete: delC.status, deleteOp: delCop?.json?.status ?? delC.text.slice(0, 120) });
  const D = (await r.createSession(T, 'D')).json.id;
  const clD = await r.api(T, 'POST', `/v1/agents/sessions/${D}/close`, undefined, { 'idempotency-key': randomUUID() });
  if (clD.json?.id) await waitOperation(r, T, D, clD.json.id);
  const arD = await r.api(T, 'POST', `/v1/agents/sessions/${D}/archive`, undefined, { 'idempotency-key': randomUUID() });
  const arDop = arD.json?.id ? await waitOperation(r, T, D, arD.json.id) : null;
  const unD = await r.api(T, 'POST', `/v1/agents/sessions/${D}/unarchive`, undefined, { 'idempotency-key': K.unarchDel });
  const delD = await r.api(T, 'DELETE', `/v1/agents/sessions/${D}`, undefined, { 'idempotency-key': randomUUID() });
  const delDop = delD.json?.id ? await waitOperation(r, T, D, delD.json.id) : null;
  r.record('p1.archiveUnarchiveDeleteD', { archive: arD.status, archiveOp: arDop?.json?.status ?? null, unarchive: unD.status, unarchiveStatus: unD.json?.status, delete: delD.status, deleteOp: delDop?.json?.status ?? null });
  // Replays after delete (Harness still up).
  const rC = await r.api(T, 'PATCH', `/v1/agents/sessions/${C}`, { title: 'C2' }, { 'idempotency-key': K.renameDel });
  r.record('afterDelete.renameReplay', { http: rC.status, code: rC.code, replay: rC.headers['x-qwen-idempotent-replay'] ?? null, status: rC.json?.status ?? null, title: rC.json?.metadata?.title ?? null });
  const rCx = await r.api(T, 'PATCH', `/v1/agents/sessions/${C}`, { title: 'C3' }, { 'idempotency-key': K.renameDel });
  r.record('afterDelete.renameReplayOtherBody', { http: rCx.status, code: rCx.code });
  const rD = await r.api(T, 'POST', `/v1/agents/sessions/${D}/unarchive`, undefined, { 'idempotency-key': K.unarchDel });
  r.record('afterDelete.unarchiveReplay', { http: rD.status, code: rD.code, replay: rD.headers['x-qwen-idempotent-replay'] ?? null, status: rD.json?.status ?? null });
  r.record('afterDelete.getC', (await r.api(T, 'GET', `/v1/agents/sessions/${C}`)).status);
  r.record('afterDelete.listIds', ((await r.api(T, 'GET', '/v1/agents/sessions?limit=20')).json?.data ?? []).map((s) => s.metadata?.title));
  // Phase 2: restart Spring with the Harness disabled.
  const counts = () => rows(r.sql(`SELECT (SELECT COUNT(*) FROM managed_agent_turn WHERE tenant_id=${q(T)}), (SELECT COUNT(*) FROM managed_agent_command WHERE tenant_id=${q(T)}), (SELECT COUNT(*) FROM managed_agent_session WHERE tenant_id=${q(T)})`))[0];
  const before = counts();
  await r.stop(r.st.spring);
  await r.stop(r.st.harness);
  await r.startSpring({ env: { QWEN_MANAGED_AGENT_HARNESS_ENABLED: 'false', QWEN_MANAGED_AGENT_WORKSPACE_FILES_ENABLED: 'false' }, label: 'spring-disabled' });
  const rs = await r.submit(T, A, turnText, K.submit);
  r.record('outage.submitReplay', { http: rs.status, code: rs.code, replayed: rs.json?.replayed ?? null });
  const rc = await r.createSession(T, 'B', createBody, K.create);
  r.record('outage.createReplay', { http: rc.status, code: rc.code, replay: rc.headers['x-qwen-idempotent-replay'] ?? null });
  const rr = await r.api(T, 'PATCH', `/v1/agents/sessions/${A}`, { title: 'A2' }, { 'idempotency-key': K.rename });
  r.record('outage.renameReplay', { http: rr.status, code: rr.code, replay: rr.headers['x-qwen-idempotent-replay'] ?? null });
  const ns = await r.submit(T, A, 'fresh during outage');
  r.record('outage.freshSubmit', { http: ns.status, code: ns.code });
  const nc = await r.createSession(T, 'E', { input: [{ type: 'text', text: 'fresh' }] });
  r.record('outage.freshCreateWithInput', { http: nc.status, code: nc.code });
  const after = counts();
  r.record('outage.rowCounts', { before, after });
};

// --- lock order: public cancel vs Harness admission, interleaved deterministically ---
// holder takes the Session row; cancel queues on it (wait 1); the held /prompt
// response is released so recordAdmission runs and queues too (wait 2); holder
// commits. base: admission already holds the Turn row -> cycle. head: admission
// queues on the Session row before touching the Turn row -> no cycle.
SC.lockorder = async (r) => {
  await r.boot();
  const N = Number(process.env.REPS ?? 5);
  const T = 't-lock';
  for (let i = 0; i < N; i++) {
    const sid = (await r.createSession(T, `L${i}`)).json.id;
    const hold = r.armPromptHold();
    const s = await r.submit(T, sid, r.directive({ n: 2, hold: 5000 }));
    const tid = s.json.turn_id;
    let timer;
    await Promise.race([hold.arrived, new Promise((_, rej) => (timer = setTimeout(() => rej(new Error('prompt never reached the proxy')), 30000)))]);
    clearTimeout(timer);
    const h = r.holder(`h${i}`);
    await h.run(`BEGIN; SELECT session_id FROM managed_agent_session WHERE tenant_id=${q(T)} AND session_id=${q(sid)} FOR UPDATE;`);
    const dl0 = r.deadlockCount();
    const t0 = Date.now();
    const cancelP = r.cancel(T, sid, tid);
    const waiting = () => rows(r.sql(`SELECT REGEXP_REPLACE(LEFT(t.trx_query, 400), '[[:space:]]+', ' ') FROM information_schema.innodb_trx t JOIN information_schema.processlist p ON p.id = t.trx_mysql_thread_id WHERE t.trx_state='LOCK WAIT' AND p.db = ${q(r.db)}`)).map((x) => x[0].replace(/[\u0000-\u0002]/g, '').replace(/^.*?(SELECT|UPDATE|INSERT|DELETE)/i, '$1').slice(0, 90));
    await r.waitLockWaits(1);
    await sleep(600);
    const b1 = r.lockWaits();
    const q1 = waiting();
    hold.release();
    const w2 = await r.waitLockWaits(b1 + 1);
    await sleep(400);
    const q2 = waiting();
    const w1 = b1;
    await h.run('COMMIT;');
    const c = await cancelP;
    const turns = await r.waitTurns(T, sid, 90000);
    const dl1 = r.deadlockCount();
    h.close();
    const turnRow = rows(r.sql(`SELECT status, COALESCE(error_code,''), COALESCE(error_message,''), retry_count, submission_attempted FROM managed_agent_turn WHERE tenant_id=${q(T)} AND session_id=${q(sid)} AND turn_id=${q(tid)}`))[0];
    const events = rows(r.sql(`SELECT event_type FROM managed_agent_event WHERE tenant_id=${q(T)} AND session_id=${q(sid)} AND turn_id=${q(tid)} ORDER BY sequence_id`)).map((x) => x[0]);
    const cmd = rows(r.sql(`SELECT COUNT(*) FROM managed_agent_command WHERE tenant_id=${q(T)} AND session_id=${q(sid)} AND turn_id=${q(tid)}`))[0][0];
    r.record(`rep${i}`, { waits: [w1, w2], queueBeforeRelease: q1, queueAfterRelease: q2, cancelHttp: c.status, cancelCode: c.code, cancelMs: c.ms, cancelBody: c.json?.error?.message ?? c.json?.status ?? null, deadlocks: dl1 - dl0, turn: turnRow, cancelCommandRows: Number(cmd), events, ms: Date.now() - t0 });
  }
  r.record('springDeadlockLines', r.grepLog('spring', /Deadlock|deadlock|DeadlockLoser|CannotAcquireLock/).length);
  r.record('springDeadlockSample', r.grepLog('spring', /Deadlock found|DeadlockLoser|CannotAcquireLock|lock wait/i).slice(0, 6).map((l) => l.slice(0, 400)));
};

// --- upgrade V46 -> V47 with data, the new index in EXPLAIN, a cursor minted
// before the deploy, and rolling the jar back onto the V47 schema ---
SC.upgrade = async (r) => {
  const isMy = r.cfg.engine === 'mysql';
  const flyway = () => rows(r.sql(`SELECT version, description, success FROM flyway_schema_history WHERE version >= 45 ORDER BY installed_rank`));
  const indexes = () => [...new Set(rows(r.sql(`SELECT INDEX_NAME, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=${q(r.db)} AND TABLE_NAME='managed_agent_session' GROUP BY INDEX_NAME`)).map((x) => x.join('(') + ')'))];
  const captureListSql = async (T, cursor) => {
    r.sql(`SET GLOBAL log_output='TABLE'`, null);
    r.sql(`TRUNCATE TABLE mysql.general_log`, null);
    r.sql(`SET GLOBAL general_log='ON'`, null);
    await r.api(T, 'GET', `/v1/agents/sessions?limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
    r.sql(`SET GLOBAL general_log='OFF'`, null);
    const all = rows(r.sql(`SELECT REPLACE(REPLACE(CONVERT(argument USING utf8mb4), '\\n', ' '), '\\t', ' ') FROM mysql.general_log WHERE command_type IN ('Query','Execute') ORDER BY event_time`, null)).map((x) => x[0]);
    return all.find((s) => /FROM\s+managed_agent_session/i.test(s) && /ORDER BY (updated_at|created_at) DESC/i.test(s))?.replace(/^[\u0000-\u0002]+/, '') ?? null;
  };
  const explain = (stmt) => {
    if (!stmt) return null;
    const plan = isMy ? r.sql(`EXPLAIN FORMAT=TREE ${stmt}`) : rows(r.sql(`EXPLAIN ${stmt}`)).map((x) => x.join(' | ')).join('\n');
    const analyze = isMy ? r.sql(`EXPLAIN ANALYZE ${stmt}`) : rows(r.sql(`ANALYZE ${stmt}`)).map((x) => x.join(' | ')).join('\n');
    return { plan, analyze };
  };
  // Phase 1: base jar on a fresh database.
  r.cfg.arm = 'base';
  await r.boot();
  const U = 't-upg';
  const ids = [];
  for (let i = 0; i < 6; i++) { ids.push((await r.createSession(U, `U${i}`)).json.id); await sleep(15); }
  const s = await r.submit(U, ids[0], r.directive({ n: 2 }));
  await r.waitTurns(U, ids[0]);
  const B = 't-bulk';
  const bulkN = Number(process.env.BULK ?? 3000);
  for (let i = 0; i < bulkN; i += 25) await Promise.all(Array.from({ length: Math.min(25, bulkN - i) }, (_, j) => r.createSession(B, `bulk-${i + j}`)));
  r.record('base.flyway', flyway());
  r.record('base.indexes', indexes());
  const bp1 = (await r.api(U, 'GET', '/v1/agents/sessions?limit=2')).json;
  r.record('base.page1', { titles: bp1.data.map((x) => x.metadata?.title), next_cursor: bp1.next_cursor ?? null, decoded: bp1.next_cursor ? Buffer.from(bp1.next_cursor, 'base64url').toString() : null });
  const baseSql = await captureListSql(B);
  r.record('base.listSql', baseSql);
  r.record('base.explain', explain(baseSql));
  // Phase 2: head jar on the same database (Flyway applies V47).
  await r.stop(r.st.spring);
  const bootMs = await r.startSpring({ arm: 'head', label: 'spring-head' });
  r.record('head.bootMs', bootMs);
  r.record('head.flyway', flyway());
  r.record('head.flywayLog', r.grepLog('spring-head', /Migrating schema|Successfully applied|V47|Successfully validated/).map((l) => l.replace(/^.*?(INFO|WARN|ERROR)/, '$1').slice(0, 200)));
  r.record('head.indexes', indexes());
  const carried = (await r.api(U, 'GET', `/v1/agents/sessions?limit=2&cursor=${encodeURIComponent(bp1.next_cursor)}`)).json;
  const fresh1 = (await r.api(U, 'GET', '/v1/agents/sessions?limit=2')).json;
  const fresh2 = (await r.api(U, 'GET', `/v1/agents/sessions?limit=2&cursor=${encodeURIComponent(fresh1.next_cursor)}`)).json;
  r.record('head.cursorFromBase', { page2: carried?.data?.map((x) => x.metadata?.title) ?? carried, freshPage1: fresh1.data.map((x) => x.metadata?.title), freshPage2: fresh2.data.map((x) => x.metadata?.title) });
  const headSql = await captureListSql(B);
  r.record('head.listSql', headSql);
  r.record('head.explain', explain(headSql));
  const s2 = await r.submit(U, ids[1], r.directive({ n: 2 }));
  r.record('head.turnOnOldSession', { http: s2.status, turns: await r.waitTurns(U, ids[1]) });
  // Phase 3: roll the jar back to base on the V47 schema.
  await r.stop(r.st.spring);
  let rollback;
  try { rollback = { bootMs: await r.startSpring({ arm: 'base', label: 'spring-rollback' }) }; } catch (e) { rollback = { error: String(e.message) }; }
  rollback.flywayLog = r.grepLog('spring-rollback', /Validate failed|not resolved locally|future|Successfully validated|ERROR/).map((l) => l.replace(/^.*?(INFO|WARN|ERROR)/, '$1').slice(0, 260)).slice(0, 6);
  if (!rollback.error) {
    const l = await r.api(U, 'GET', '/v1/agents/sessions?limit=3');
    rollback.list = { http: l.status, titles: l.json?.data?.map((x) => x.metadata?.title) };
    const rbSql = await captureListSql(B);
    rollback.explain = explain(rbSql);
  }
  r.record('rollback', rollback);
};

SC.wstitle = async (r) => {
  await r.boot({ harness: false });
  const T = 't-wstitle';
  for (const n of [256, 257, 300, 512, 513]) {
    const wc = await r.api(T, 'POST', `${WS}/sessions/create`, { requestId: randomUUID(), idempotencyKey: randomUUID(), agentId: 'qwen-code', title: 'w'.repeat(n) });
    r.record(`webshellCreate${n}`, { http: wc.status, code: wc.code, message: wc.json?.error?.message ?? null, storedLen: (wc.json?.session?.title ?? wc.json?.title)?.length ?? null });
  }
};

const scenarioFn = SC[scenario];
if (!scenarioFn) { console.error('unknown scenario', scenario, Object.keys(SC)); process.exit(2); }
const name = `${scenario}-${arm}-${engine}${tag ? '-' + tag : ''}`;
const db = `s_${scenario}_${arm}_${tag || 'x'}`.replace(/[^a-z0-9_]/gi, '_').slice(0, 60);
const extra = process.env.RIG_CFG ? JSON.parse(process.env.RIG_CFG) : {};
const r = makeRig({ name, arm, engine, db, ...extra });
try {
  r.sql(`DROP DATABASE IF EXISTS \`${db}\``, null);
  await scenarioFn(r);
  r.log('SCENARIO-DONE');
} catch (e) {
  r.log('SCENARIO-ERROR', e.stack ?? String(e));
  r.record('error', String(e.message ?? e));
} finally {
  await r.shutdown();
  r.log('SHUTDOWN-DONE');
  process.exit(0);
}
