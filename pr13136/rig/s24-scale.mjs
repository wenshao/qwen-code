// PR #13136 (F2 follow-up): one long-lived Hook Session runs Notification operations that fire 8 function Hooks each
// (9 hook_execution records per operation). Per operation: client latency and the SELECTs the Session Store issued,
// counted per MySQL user (performance_schema), so the probe's own root queries and other DBs do not count.
// Every LOAD_EVERY operations: detach, stop the Harness process, start a new one, cold-load with no client timeout,
// then time the first operation after the load. The handler ledger shows whether the load re-ran any Hook.
// usage: DB=<db> ARM=<dist> node s24-scale.mjs <ws> <ops> <loadEvery> <dbUser>
import fs from 'node:fs';
import http from 'node:http';
import { Report, Harness, HSession, startModel, workspace, createWorkspaceSession, storeConnection, pin, hookLedger, setControl, RUN, RIG, DB, j, sleep, sql, one } from './lib.mjs';
import { STORAGE } from './manifest.mjs';
const [WS, OPS, EVERY, USER] = process.argv.slice(2);
const ARM = process.env.ARM ?? 'head';
const R = new Report(`s24-scale-${WS}-${ARM}-${OPS}`);
const model = await startModel();
setControl({});
const stmt = () => {
  const rows = sql(`SELECT EVENT_NAME, COUNT_STAR FROM performance_schema.events_statements_summary_by_user_by_event_name WHERE USER='${USER}' AND EVENT_NAME IN ('statement/sql/select','statement/sql/insert','statement/sql/update','statement/sql/delete')`);
  const o = { select: 0, write: 0 };
  for (const [e, n] of rows) e.endsWith('select') ? (o.select = Number(n)) : (o.write += Number(n));
  return o;
};
const post = (h, route, body, clientId) =>
  new Promise((resolve, reject) => {
    const u = new URL(h.baseUrl + route);
    const data = JSON.stringify(body);
    const req = http.request({ host: u.hostname, port: u.port, path: u.pathname, method: 'POST', headers: { ...h.headers(clientId), 'content-length': Buffer.byteLength(data) }, timeout: 0 }, (res) => {
      let t = '';
      res.on('data', (c) => (t += c));
      res.on('end', () => {
        let json;
        try {
          json = t ? JSON.parse(t) : undefined;
        } catch {
          json = t;
        }
        resolve({ status: res.statusCode, json });
      });
    });
    req.on('error', reject);
    req.end(data);
  });
const opsCsv = [];
const loadCsv = [];
const w = await workspace(STORAGE[WS], WS);
let h = await new Harness({ name: `s24-${WS}-0`, modelUrl: model.url, arm: ARM }).start();
const sid = await createWorkspaceSession(w.workspaceId);
let s = new HSession(h, sid, storeConnection(h, w.workspaceId));
const records = () => Number(one(`SELECT COUNT(*) FROM qwen_managed_session_extension_record WHERE session_id='${sid}' AND domain='hook_execution'`));
const resources = () => Number(one(`SELECT COUNT(*) FROM qwen_managed_session_resource WHERE session_id='${sid}'`));
const physical = () => hookLedger((e) => e.session === sid && !e.kind).length;
let nonOk = 0;
try {
  const c = await s.create({ hookCatalog: pin(WS) });
  R.check('create Hook Session', c.status === 200, `${c.status} session=${sid} arm=${ARM} db=${DB} user=${USER}`);
  const t0 = Date.now();
  for (let i = 1; i <= Number(OPS); i++) {
    const c0 = stmt();
    const a = Date.now();
    const op = await s.hookOp('Notification', { message: `n${i}`, notification_type: 'rig' }, undefined, { timeoutMs: 900_000 });
    const ms = Date.now() - a;
    const c1 = stmt();
    if (op.status !== 200) nonOk++;
    const execs = i % 25 === 0 || i === 1 ? records() : '';
    opsCsv.push([i, ms, c1.select - c0.select, c1.write - c0.write, execs, op.status].join(','));
    if (i % 50 === 0 || i === 1) R.say(`  op ${i}: ${ms} ms, SELECT +${c1.select - c0.select}, writes +${c1.write - c0.write}, hook_execution=${execs || records()}, status=${op.status}`);
    if (i % Number(EVERY) === 0) {
      const recs = records();
      const res = resources();
      const phys0 = physical();
      const d0 = Date.now();
      const d = await post(h, `/session/${sid}/detach`, {}, s.clientId);
      const detachMs = Date.now() - d0;
      await h.stop();
      h = await new Harness({ name: `s24-${WS}-${i}`, modelUrl: model.url, arm: ARM }).start();
      s = new HSession(h, sid, storeConnection(h, w.workspaceId));
      const l0 = stmt();
      let l;
      let loadMs;
      let waited = 0;
      for (let k = 0; k < 40; k++) {
        const a2 = Date.now();
        l = await post(h, `/session/${sid}/load`, { managedSessionStore: s.connection, toolProfile: s.profile });
        loadMs = Date.now() - a2;
        if (l.status === 200) break;
        waited++;
        await sleep(5000);
      }
      const l1 = stmt();
      if (l.status === 200) s.clientId = l.json.clientId;
      const phys1 = physical();
      const f0 = stmt();
      const fa = Date.now();
      const first = await s.hookOp('Notification', { message: `after-load-${i}`, notification_type: 'rig' }, undefined, { timeoutMs: 900_000 });
      const firstMs = Date.now() - fa;
      const f1 = stmt();
      const phys2 = physical();
      loadCsv.push([recs, res, d.status, detachMs, l.status, loadMs, waited, l1.select - l0.select, phys1 - phys0, first.status, firstMs, f1.select - f0.select, phys2 - phys1].join(','));
      R.check(
        `cold load at ${recs} records / ${res} resources`,
        (d.status === 200 || d.status === 204) && l.status === 200 && phys1 === phys0 && first.status === 200,
        `detach ${d.status} ${detachMs} ms; load ${l.status}${l.json?.code ? ' ' + l.json.code : ''} ${loadMs} ms (retries ${waited}, SELECT +${l1.select - l0.select}); Hook calls during load ${phys1 - phys0}; first op ${first.status} ${firstMs} ms (SELECT +${f1.select - f0.select}, Hook calls +${phys2 - phys1})`,
      );
    }
  }
  R.note('elapsed', `${Math.round((Date.now() - t0) / 1000)} s; non-200 operations: ${nonOk}`);
  R.check('every operation returned 200', nonOk === 0, String(nonOk));
  const recs = records();
  R.check('9 hook_execution records per operation', recs === 9 * (Number(OPS) + Math.floor(Number(OPS) / Number(EVERY))), `${recs} records for ${Number(OPS) + Math.floor(Number(OPS) / Number(EVERY))} operations`);
  const phys = physical();
  R.check('8 physical Hook calls per operation (no re-run on load)', phys === 8 * (Number(OPS) + Math.floor(Number(OPS) / Number(EVERY))), `${phys}`);
} finally {
  fs.writeFileSync(`${R.file}-ops.csv`, 'op,ms,select,writes,hook_execution,status\n' + opsCsv.join('\n') + '\n');
  fs.writeFileSync(`${R.file}-loads.csv`, 'records,resources,detach_status,detach_ms,load_status,load_ms,load_retries,load_select,hook_calls_during_load,first_status,first_ms,first_select,first_hook_calls\n' + loadCsv.join('\n') + '\n');
  if (s.clientId) await post(h, `/session/${sid}/detach`, {}, s.clientId).catch(() => undefined);
  await h.stop();
  await model.close();
  R.done({ session: sid, arm: ARM, ops: opsCsv.length, loads: loadCsv.length });
}
