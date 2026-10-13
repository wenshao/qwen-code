// node run.mjs <scenario> <arm> <engine> [tag]
import { makeRig, sleep, q, rows } from './rig2.mjs';
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

// ===================== round 2 (head 621d2c08) =====================
const asA = (r, actor) => ({
  submit: (T, sid, text, key = randomUUID()) => r.api(T, 'POST', `/v1/agents/sessions/${sid}/events`, { type: 'agent.session.input.message', input: [{ type: 'text', text }] }, { 'idempotency-key': key }, { actor }),
  cancel: (T, sid, turnId, key = randomUUID()) => r.api(T, 'POST', `/v1/agents/sessions/${sid}/events`, { type: 'agent.session.cancel', turn_id: turnId }, { 'idempotency-key': key }, { actor }),
  rename: (T, sid, title, key = randomUUID()) => r.api(T, 'PATCH', `/v1/agents/sessions/${sid}`, { title }, { 'idempotency-key': key }, { actor }),
  create: (T, title, extra = {}, key = randomUUID()) => r.api(T, 'POST', '/v1/agents/sessions', { agent_id: 'qwen-code', ...(title !== undefined ? { metadata: { title } } : {}), ...extra }, { 'idempotency-key': key }, { actor }),
  get: (T, sid) => r.api(T, 'GET', `/v1/agents/sessions/${sid}`, undefined, {}, { actor }),
  close: (T, sid, key = randomUUID()) => r.api(T, 'POST', `/v1/agents/sessions/${sid}/close`, undefined, { 'idempotency-key': key }, { actor }),
  del: (T, sid, key = randomUUID()) => r.api(T, 'DELETE', `/v1/agents/sessions/${sid}`, undefined, { 'idempotency-key': key }, { actor }),
  op: (T, sid, op) => r.api(T, 'GET', `/v1/agents/sessions/${sid}/operations/${op}`, undefined, {}, { actor }),
});
const brief = (x) => ({ http: x.status, code: x.code, replayed: x.json?.replayed ?? x.headers?.['x-qwen-idempotent-replay'] ?? null, ...(x.json?.turn_id ? { turn: x.json.turn_id.slice(0, 13) } : {}), ...(x.json?.metadata?.title !== undefined ? { title: x.json.metadata.title } : {}), ...(x.json?.status && x.json?.object === 'agent.session' ? { status: x.json.status } : {}) });
async function waitOpAs(who, T, sid, op, timeoutMs = 60000) {
  const end = Date.now() + timeoutMs;
  let last;
  while (Date.now() < end) {
    last = await who.op(T, sid, op);
    if (last.json && !['pending', 'running', 'accepted', 'in_progress'].includes(last.json.status)) return last;
    await sleep(250);
  }
  return last;
}
const hasCol = (r, table, col) => r.sql(`SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=${q(r.db)} AND TABLE_NAME=${q(table)} AND COLUMN_NAME=${q(col)}`) === '1';
function cmdState(r, T, key) {
  const actor = hasCol(r, 'managed_agent_command', 'actor_key') ? 'COALESCE(CAST(actor_key AS CHAR),\'NULL\')' : "'(no column)'";
  return rows(r.sql(`SELECT operation, command_status, ${actor} FROM managed_agent_command WHERE tenant_id=${q(T)} AND idempotency_key=${q(key)}`)).map(([op, st, a]) => ({ op, status: st, actor_key: a }));
}
function deliveryState(r, T, sid) {
  return rows(r.sql(`SELECT revision, delivery_state, COALESCE(LEFT(lease_owner,8),'-'), attempt_count, title, idempotency_key FROM managed_session_rename_delivery WHERE tenant_id=${q(T)} AND session_id=${q(sid)}`)).map(([rev, st, lo, n, title, k]) => ({ rev: Number(rev), state: st, lease: lo, attempts: Number(n), title, key: k.slice(0, 8) }));
}
const sessionTitle = (r, T, sid) => r.sql(`SELECT COALESCE(title,'NULL'), status FROM managed_agent_session WHERE tenant_id=${q(T)} AND session_id=${q(sid)}`);
const titleCalls = (r) => r.proxyLog.filter((x) => /\/title$/.test(x.url) && !x.injected).length;

// --- replay ownership across actors on one Workspace-bound Session ---
SC.owner = async (r) => {
  r.cfg.springArgs = ['--qwen.managed-agent.dispatch.scan-delay=600s'];

  await r.boot();
  const T = 'ws-tenant', W = 'rig-workspace';
  r.registerWorkspace(T, W, 'alice', 'OPERATOR');
  r.registerWorkspace(T, W, 'bob', 'OPERATOR');
  r.registerWorkspace(T, W, 'carol', 'READER');
  const A = { alice: asA(r, 'alice'), bob: asA(r, 'bob'), carol: asA(r, 'carol'), dave: asA(r, 'dave') };
  const c = await A.alice.create(T, 'owner-s', { workspace: { workspace_id: W } });
  r.record('create', brief(c));
  const S = c.json.id;
  const K = { s1: randomUUID(), r1: randomUUID(), s2: randomUUID(), x2: randomUUID(), rf: randomUUID(), b3: randomUUID() };
  const text1 = r.directive({ n: 2 });
  r.record('alice.submit', brief(await A.alice.submit(T, S, text1, K.s1)));
  r.record('alice.submit.turns', await r.waitTurns(T, S));
  r.record('alice.rename', brief(await A.alice.rename(T, S, 'alice-title', K.r1)));
  const s2 = await A.alice.submit(T, S, r.directive({ n: 2, hold: 8000 }), K.s2);
  const turn2 = s2.json.turn_id;
  await sleep(1500);
  r.record('alice.cancel', brief(await A.alice.cancel(T, S, turn2, K.x2)));
  await r.waitTurns(T, S);
  r.record('bob.ownSubmit', brief(await A.bob.submit(T, S, r.directive({ n: 2 }), K.b3)));
  await r.waitTurns(T, S);
  // Unfinished rename: alice's Harness title call fails -> FAILED command + claimable delivery.
  r.armRule('fail', /\/session\/[^/]+\/title$/, { status: 503 });
  r.record('alice.renameUnfinished', brief(await A.alice.rename(T, S, 'alice-unfinished', K.rf)));
  r.record('unfinished.before', { cmd: cmdState(r, T, K.rf), delivery: deliveryState(r, T, S), session: sessionTitle(r, T, S), titleCalls: titleCalls(r) });
  const tc0 = titleCalls(r);
  r.record('bob.replays.aliceUnfinishedRename', brief(await A.bob.rename(T, S, 'alice-unfinished', K.rf)));
  r.record('unfinished.afterBob', { cmd: cmdState(r, T, K.rf), delivery: deliveryState(r, T, S), session: sessionTitle(r, T, S), titleCallsByBob: titleCalls(r) - tc0 });
  // Live-Session replay matrix.
  const live = {};
  for (const who of ['bob', 'carol', 'dave', 'alice']) {
    const a = A[who];
    live[who] = {
      submitReplay: brief(await a.submit(T, S, text1, K.s1)),
      renameReplay: brief(await a.rename(T, S, 'alice-title', K.r1)),
      renameReplayOtherTitle: brief(await a.rename(T, S, 'other-title', K.r1)),
      cancelReplay: brief(await a.cancel(T, S, turn2, K.x2)),
      bobKeySubmitReplay: brief(await a.submit(T, S, r.directive({ n: 2 }), K.b3)),
    };
  }
  r.record('live', live);
  r.record('alice.retriesOwnUnfinished', brief(await A.alice.rename(T, S, 'alice-unfinished', K.rf)));
  r.record('unfinished.final', { cmd: cmdState(r, T, K.rf), delivery: deliveryState(r, T, S), session: sessionTitle(r, T, S) });
  r.record('actorKeys', Object.fromEntries(Object.entries(K).map(([k, v]) => [k, cmdState(r, T, v)])));
  // Bound-Session delete needs the Linux-only durable local process; write the
  // tombstone with the same UPDATE the product's DELETE completion runs
  // (ManagedAgentStore delete completion), then replay again.
  r.sql(`UPDATE managed_agent_session SET status = 'DELETED', harness_boot_id = NULL, harness_event_epoch = NULL, harness_last_event_id = 0, deleted_at = ${Date.now()}, updated_at = ${Date.now()}, version = version + 1 WHERE tenant_id = ${q(T)} AND session_id = ${q(S)}`);
  r.record('delete', { via: 'product delete-completion UPDATE', row: sessionTitle(r, T, S) });
  const dead = {};
  for (const who of ['alice', 'bob', 'carol', 'dave']) {
    const a = A[who];
    dead[who] = {
      get: (await a.get(T, S)).status,
      submitReplay: brief(await a.submit(T, S, text1, K.s1)),
      bobKeySubmitReplay: brief(await a.submit(T, S, r.directive({ n: 2 }), K.b3)),
      freshSubmit: brief(await a.submit(T, S, 'fresh after delete')),
      renameReplay: brief(await a.rename(T, S, 'alice-title', K.r1)),
      freshRename: brief(await a.rename(T, S, 'fresh-title')),
      cancelReplay: brief(await a.cancel(T, S, turn2, K.x2)),
    };
  }
  // Legacy (unbound) Session: a real DELETE through the public route.
  const LT = 't-own-legacy';
  const lg = asA(r, 'rig-actor');
  const LS = (await lg.create(LT, 'legacy')).json.id;
  const LK = { s: randomUUID(), r: randomUUID(), x: randomUUID() };
  const ltext = r.directive({ n: 2 });
  await lg.submit(LT, LS, ltext, LK.s);
  await r.waitTurns(LT, LS);
  await lg.rename(LT, LS, 'legacy-title', LK.r);
  const ls2 = await lg.submit(LT, LS, r.directive({ n: 2, hold: 6000 }));
  await sleep(1200);
  await lg.cancel(LT, LS, ls2.json.turn_id, LK.x);
  await r.waitTurns(LT, LS);
  const ldel = await lg.del(LT, LS);
  const ldelOp = ldel.json?.id ? await waitOpAs(lg, LT, LS, ldel.json.id) : null;
  r.record('legacy.delete', { http: ldel.status, op: ldelOp?.json?.status ?? ldel.text.slice(0, 160), row: sessionTitle(r, LT, LS) });
  r.record('legacy.afterDelete', {
    get: (await lg.get(LT, LS)).status,
    submitReplay: brief(await lg.submit(LT, LS, ltext, LK.s)),
    freshSubmit: brief(await lg.submit(LT, LS, 'fresh after delete')),
    renameReplay: brief(await lg.rename(LT, LS, 'legacy-title', LK.r)),
    freshRename: brief(await lg.rename(LT, LS, 'fresh-title')),
    cancelReplay: brief(await lg.cancel(LT, LS, ls2.json.turn_id, LK.x)),
  });
  r.record('afterDelete', dead);
};

// --- 621d2c08: a rename key the recorder commits after the racer's pre-read ---
SC.race = async (r) => {
  r.cfg.springArgs = ['--qwen.managed-agent.dispatch.scan-delay=600s'];
  r.cfg.jdwpPort = 45100 + Math.floor(Math.random() * 800);
  await r.boot();
  const T = 'ws-tenant', W = 'rig-workspace';
  r.registerWorkspace(T, W, 'alice', 'OPERATOR');
  r.registerWorkspace(T, W, 'bob', 'OPERATOR');
  const al = asA(r, 'alice'), bo = asA(r, 'bob');
  const g = r.gate('com.alibaba.qwen.code.managedagent.store.ManagedAgentStore', 'beginSessionRename', 6);
  r.record('gate', await g.waitOut(/READY[^\n]*/));
  const N = Number(process.env.REPS ?? 3);
  for (let i = 0; i < N; i++) {
    const S = (await al.create(T, `race-${i}`, { workspace: { workspace_id: W } })).json.id;
    const K = randomUUID();
    const title = `alice-title-${i}`;
    g.send('arm');
    await g.waitOut(new RegExp(`ARMED(?:[\\s\\S]*ARMED){${i}}`));
    const bobP = bo.rename(T, S, title, K);
    const hit = await g.waitOut(new RegExp(`HIT[^\\n]*(?:[\\s\\S]*HIT[^\\n]*){${i}}`));
    const parked = { hit: hit.split('\n').filter((l) => l.startsWith('HIT')).at(-1).slice(0, 220), commandRowsForKey: cmdState(r, T, K).length };
    r.armRule('fail', /\/session\/[^/]+\/title$/, { status: 503 });
    const a1 = await al.rename(T, S, title, K);
    const afterAlice = { cmd: cmdState(r, T, K), delivery: deliveryState(r, T, S), session: sessionTitle(r, T, S) };
    const tc0 = titleCalls(r);
    g.send('release');
    const b = await bobP;
    const afterBob = { cmd: cmdState(r, T, K), delivery: deliveryState(r, T, S), session: sessionTitle(r, T, S), titleCallsByBob: titleCalls(r) - tc0 };
    const a2 = await al.rename(T, S, title, K);
    const final = { cmd: cmdState(r, T, K), delivery: deliveryState(r, T, S), session: sessionTitle(r, T, S) };
    r.record(`rep${i}`, { parked, alice1: brief(a1), afterAlice, bob: brief(b), bobMessage: b.json?.error?.message ?? null, afterBob, aliceRetry: brief(a2), final });
  }
  g.send('quit');
  await sleep(500);
};

// --- upgrade mb -> h2 on one database: V69/V70, legacy rows, rollback ---
SC.upgrade2 = async (r) => {
  const BASE = process.env.BASE_ARM ?? 'mb', HEAD = process.env.HEAD_ARM ?? 'h2';
  const isMy = r.cfg.engine === 'mysql';
  r.cfg.springArgs = ['--qwen.managed-agent.dispatch.scan-delay=600s'];
  const flyway = () => rows(r.sql(`SELECT version, description, success FROM flyway_schema_history WHERE version >= 66 ORDER BY installed_rank`));
  const indexes = () => rows(r.sql(`SELECT INDEX_NAME, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=${q(r.db)} AND TABLE_NAME='managed_agent_session' GROUP BY INDEX_NAME`)).map((x) => `${x[0]}(${x[1]})`);
  const captureListSql = async (T, cursor) => {
    r.sql(`SET GLOBAL log_output='TABLE'`, null);
    r.sql(`TRUNCATE TABLE mysql.general_log`, null);
    r.sql(`SET GLOBAL general_log='ON'`, null);
    await r.api(T, 'GET', `/v1/agents/sessions?limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
    r.sql(`SET GLOBAL general_log='OFF'`, null);
    const all = rows(r.sql(`SELECT REPLACE(REPLACE(CONVERT(argument USING utf8mb4), '\\n', ' '), '\\t', ' ') FROM mysql.general_log WHERE command_type IN ('Query','Execute') ORDER BY event_time`, null)).map((x) => x[0]);
    return all.find((s) => /FROM\s+managed_agent_session/i.test(s) && /ORDER BY (s\.)?(updated_at|created_at) DESC/i.test(s))?.replace(/^[\u0000-\u0002]+/, '') ?? null;
  };
  const explain = (stmt) => {
    if (!stmt) return null;
    const plan = isMy ? r.sql(`EXPLAIN FORMAT=TREE ${stmt}`) : rows(r.sql(`EXPLAIN ${stmt}`)).map((x) => x.join(' | ')).join('\n');
    const analyze = isMy ? r.sql(`EXPLAIN ANALYZE ${stmt}`) : rows(r.sql(`ANALYZE ${stmt}`)).map((x) => x.join(' | ')).join('\n');
    return { plan, analyze };
  };
  r.cfg.arm = BASE;
  await r.boot();
  const T = 'ws-tenant', W = 'rig-workspace', U = 't-upg', B = 't-bulk';
  r.registerWorkspace(T, W, 'alice', 'OPERATOR');
  r.registerWorkspace(T, W, 'bob', 'OPERATOR');
  const al = asA(r, 'alice'), bo = asA(r, 'bob'), lg = asA(r, 'rig-actor');
  const ids = [];
  for (let i = 0; i < 6; i++) { ids.push((await lg.create(U, `U${i}`)).json.id); await sleep(15); }
  const long = await lg.create(U, 'L'.repeat(300));
  r.record('base.createLegacy300', brief(long));
  const L = long.json?.id;
  const ws = await al.create(T, 'ws-pre', { workspace: { workspace_id: W } });
  const WS = ws.json.id;
  const Ka = randomUUID(), Kr = randomUUID();
  const preText = r.directive({ n: 2 });
  r.record('base.wsSubmit', brief(await al.submit(T, WS, preText, Ka)));
  await r.waitTurns(T, WS);
  r.record('base.wsRename', brief(await al.rename(T, WS, 'pre-title', Kr)));
  r.record('base.wsBobReplays', { submit: brief(await bo.submit(T, WS, preText, Ka)), rename: brief(await bo.rename(T, WS, 'pre-title', Kr)) });
  const bulkN = Number(process.env.BULK ?? 3000);
  for (let i = 0; i < bulkN; i += 25) await Promise.all(Array.from({ length: Math.min(25, bulkN - i) }, (_, j) => lg.create(B, `bulk-${i + j}`)));
  r.record('base.flyway', flyway());
  r.record('base.indexes', indexes());
  const bp1 = (await r.api(U, 'GET', '/v1/agents/sessions?limit=3')).json;
  r.record('base.page1', { titles: bp1.data.map((x) => x.metadata?.title?.slice(0, 8)), decoded: bp1.next_cursor ? Buffer.from(bp1.next_cursor, 'base64url').toString() : null });
  const baseSql = await captureListSql(B);
  r.record('base.explain', explain(baseSql));
  await r.stop(r.st.spring);
  r.record('head.bootMs', await r.startSpring({ arm: HEAD, label: 'spring-head' }));
  r.record('head.flyway', flyway());
  r.record('head.indexes', indexes());
  r.record('head.actorKeyOfPreUpgradeRows', { submit: cmdState(r, T, Ka), rename: cmdState(r, T, Kr) });
  const carried = (await r.api(U, 'GET', `/v1/agents/sessions?limit=3&cursor=${encodeURIComponent(bp1.next_cursor)}`)).json;
  const fresh1 = (await r.api(U, 'GET', '/v1/agents/sessions?limit=3')).json;
  r.record('head.cursorFromBase', { page2: carried?.data?.map((x) => x.metadata?.title?.slice(0, 8)) ?? carried, freshPage1: fresh1.data.map((x) => x.metadata?.title?.slice(0, 8)), freshDecoded: fresh1.next_cursor ? Buffer.from(fresh1.next_cursor, 'base64url').toString() : null });
  const headSql = await captureListSql(B);
  r.record('head.explain', explain(headSql));
  // V69 NULL actor_key rows: creator replays, another operator is refused.
  r.record('head.preUpgradeReplays', { aliceSubmit: brief(await al.submit(T, WS, preText, Ka)), bobSubmit: brief(await bo.submit(T, WS, preText, Ka)), aliceRename: brief(await al.rename(T, WS, 'pre-title', Kr)), bobRename: brief(await bo.rename(T, WS, 'pre-title', Kr)) });
  // A legacy 300-char title written by the base jar.
  if (L) {
    const tc0 = titleCalls(r);
    const echo = await lg.rename(U, L, 'L'.repeat(300));
    const tc1 = titleCalls(r);
    const other = await lg.rename(U, L, 'M'.repeat(300));
    const ok = await lg.rename(U, L, 'N'.repeat(256));
    r.record('head.legacy300', { echo: { ...brief(echo), titleLen: echo.json?.metadata?.title?.length ?? null }, echoTitleCalls: tc1 - tc0, other300: brief(other), rename256: { ...brief(ok), titleLen: ok.json?.metadata?.title?.length ?? null }, titleCallsTotal: titleCalls(r) - tc0, stored: sessionTitle(r, U, L).slice(0, 12) });
  }
  const s2 = await lg.submit(U, ids[1], r.directive({ n: 2 }));
  r.record('head.turnOnOldSession', { http: s2.status, turns: await r.waitTurns(U, ids[1]) });
  await r.stop(r.st.spring);
  let rollback;
  try { rollback = { bootMs: await r.startSpring({ arm: BASE, label: 'spring-rollback' }) }; } catch (e) { rollback = { error: String(e.message) }; }
  rollback.flywayLog = r.grepLog('spring-rollback', /Validate failed|not resolved locally|future|Successfully validated|ERROR/).map((l) => l.replace(/^.*?(INFO|WARN|ERROR)/, '$1').slice(0, 260)).slice(0, 6);
  if (!rollback.error) {
    const l = await r.api(U, 'GET', '/v1/agents/sessions?limit=3');
    rollback.list = { http: l.status, titles: l.json?.data?.map((x) => x.metadata?.title?.slice(0, 8)) };
    rollback.explain = explain(await captureListSql(B));
    rollback.bobReplay = brief(await bo.submit(T, WS, preText, Ka));
  }
  r.record('rollback', rollback);
};

// --- channel route Session title with control characters (R17-1/R18-1) ---
SC.channel = async (r) => {
  const IP = 46000 + Math.floor(Math.random() * 900);
  r.cfg.springEnv = { QWEN_MANAGED_AGENT_CHANNELS_ENABLED: 'true', QWEN_MANAGED_AGENT_SESSION_STORE_BASE_URL: `http://127.0.0.1:${IP}` };
  r.cfg.springArgs = [`--qwen.managed-agent.internal-server.port=${IP}`];
  await r.boot();
  const T = 'ws-tenant', W = 'rig-workspace';
  r.registerWorkspace(T, W, 'alice', 'OPERATOR');
  const base = (ch) => `/internal/managed-channels/v1/channels/${ch}`;
  const cases = [
    { name: 'platformTab', platform: 'ema\til', subject: 'Build status', sender: 'carol@example.com' },
    { name: 'senderTabNoSubject', platform: 'email', subject: null, sender: 'bob\t@example.com' },
    { name: 'subjectTab', platform: 'email', subject: 'Build\tstatus', sender: 'dan@example.com' },
    { name: 'subjectOnlyControls', platform: 'email', subject: '\t\u0007', sender: 'erin\u007f@example.com' },
  ];
  for (const [i, c] of cases.entries()) {
    const ch = `ch-${i}-${randomBytes(3).toString('hex')}`;
    const reg = await r.api(T, 'PUT', base(ch), { platform: c.platform, accountId: `acct-${i}`, accountGeneration: 1, actorId: 'alice', workspaceId: W, cwdRelative: '.', policy: { adapter: 'rig', senderPolicy: 'open', allowedSenders: [], dispatchMode: 'followup' } }, {}, { actor: null, port: IP });
    const inb = await r.api(T, 'POST', `${base(ch)}/inbound`, { accountGeneration: 1, platformEventId: `ev-${i}-1`, semanticRevision: 1, scope: { kind: 'user', senderId: c.sender }, senderId: c.sender, subject: c.subject, text: r.directive({ n: 1 }) }, {}, { actor: null, port: IP });
    const inb2 = await r.api(T, 'POST', `${base(ch)}/inbound`, { accountGeneration: 1, platformEventId: `ev-${i}-2`, semanticRevision: 1, scope: { kind: 'user', senderId: c.sender }, senderId: c.sender, subject: c.subject, text: r.directive({ n: 1 }) }, {}, { actor: null, port: IP });
    const sid = inb.json?.sessionId ?? inb.json?.session_id ?? null;
    const stored = sid ? r.sql(`SELECT REPLACE(REPLACE(REPLACE(title, CHAR(9), '<TAB>'), CHAR(7), '<BEL>'), CHAR(127), '<DEL>') FROM managed_agent_session WHERE tenant_id=${q(T)} AND session_id=${q(sid)}`) : null;
    r.record(c.name, { register: reg.status, inbound1: { http: inb.status, code: inb.code, body: inb.text.slice(0, 220) }, inbound2: { http: inb2.status, code: inb2.code }, storedTitle: stored, routes: r.sql(`SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=${q(r.db)} AND TABLE_NAME LIKE 'managed_channel%'`) });
  }
};

// --- can a co-OPERATOR tell a recorded key from an unused one? ---
SC.liveness = async (r) => {
  await r.boot();
  const T = 'ws-tenant', W = 'rig-workspace';
  r.registerWorkspace(T, W, 'alice', 'OPERATOR');
  r.registerWorkspace(T, W, 'bob', 'OPERATOR');
  r.registerWorkspace(T, W, 'carol', 'READER');
  const al = asA(r, 'alice'), bo = asA(r, 'bob'), ca = asA(r, 'carol');
  const S = (await al.create(T, 'live', { workspace: { workspace_id: W } })).json.id;
  const Kr = randomUUID(), Ks = randomUUID();
  await al.rename(T, S, 'alice-title', Kr);
  await al.submit(T, S, r.directive({ n: 1 }), Ks);
  await r.waitTurns(T, S);
  const over = 'x'.repeat(300);
  const rowsBefore = r.sql(`SELECT COUNT(*) FROM managed_agent_command WHERE tenant_id=${q(T)}`);
  const out = {
    bob_rename_recordedKey_overlongTitle: brief(await bo.rename(T, S, over, Kr)),
    bob_rename_unusedKey_overlongTitle: brief(await bo.rename(T, S, over, randomUUID())),
    carol_rename_recordedKey_overlongTitle: brief(await ca.rename(T, S, over, Kr)),
    carol_rename_unusedKey_overlongTitle: brief(await ca.rename(T, S, over, randomUUID())),
    bob_submit_recordedKey_emptyInput: brief(await r.api(T, 'POST', `/v1/agents/sessions/${S}/events`, { type: 'agent.session.input.message', input: [] }, { 'idempotency-key': Ks }, { actor: 'bob' })),
    bob_submit_unusedKey_emptyInput: brief(await r.api(T, 'POST', `/v1/agents/sessions/${S}/events`, { type: 'agent.session.input.message', input: [] }, { 'idempotency-key': randomUUID() }, { actor: 'bob' })),
  };
  out.commandRowsWritten = Number(r.sql(`SELECT COUNT(*) FROM managed_agent_command WHERE tenant_id=${q(T)}`)) - Number(rowsBefore);
  for (const [k, v] of Object.entries(out)) r.record(k, v);
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
