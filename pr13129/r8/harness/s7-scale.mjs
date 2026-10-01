// S7: one long-lived Hook Session. Notification operations with 8 function Hooks each (= 8 Runtime executions),
// measuring latency and MySQL Com_select per operation as hook_execution records grow; past 4096 Runtime receipts,
// check what a fail-open / fail-closed PreToolUse guard does.   usage: node s7-scale.mjs <ws> <ops>
import fs from 'node:fs';
import { repairLeak, Report, Harness, HSession, startModel, workspace, createWorkspaceSession, storeConnection, script, call, turn, toolTrace, pin, hookLedger, setControl, RUN, j, sleep, sql, one } from './lib.mjs';
import { STORAGE } from './manifest.mjs';
const [WS, OPS] = process.argv.slice(2);
const R = new Report(`s7-scale-${WS}-${process.env.ARM ?? 'head'}`);
const model = await startModel();
const h = await new Harness({ name: `s7-${WS}`, modelUrl: model.url, arm: process.env.ARM ?? 'head' }).start();
const w = await workspace(STORAGE[WS], WS);
R.note('rig repair', String(await repairLeak(STORAGE[WS])));
setControl({});
const selects = () => Number(sql(`SHOW GLOBAL STATUS LIKE 'Com_select'`)[0][1]);
const csv = [];
try {
  const id = await createWorkspaceSession(w.workspaceId);
  const s = new HSession(h, id, storeConnection(h, w.workspaceId));
  await s.create({ hookCatalog: pin(WS) });
  const guard = async (tag) => {
    const f = `blocked-${tag}.txt`;
    const p = await s.prompt(script([[call('write_file', { file_path: f, content: 'SHOULD-BE-DENIED' })]], `G-${tag}`));
    return { p, written: fs.existsSync(`${w.dir}/${f}`), result: toolTrace(p.events).filter((x) => x.startsWith('result')).join(' ') };
  };
  let g = await guard('before');
  R.check('guard denies blocked-*.txt before the quota is reached', !g.written && g.p.terminal?.[0]?.type === 'turn_complete', `${turn(g.p)} written=${g.written} ${g.result.slice(0, 100)}`);
  const t0 = Date.now();
  let failedAt = null;
  for (let i = 1; i <= Number(OPS); i++) {
    const c0 = selects();
    const a = Date.now();
    const op = await s.hookOp('Notification', { message: `n${i}`, notification_type: 'rig' });
    const ms = Date.now() - a;
    const dSel = selects() - c0;
    const execs = Number(one(`SELECT COUNT(*) FROM qwen_managed_session_extension_record WHERE session_id='${id}' AND domain='hook_execution'`));
    const ledger = hookLedger((e) => e.session === id && !e.kind).length;
    csv.push([i, ms, dSel, execs, ledger, op.status].join(','));
    if (op.status !== 200 && failedAt === null) failedAt = `${i}: ${op.status} ${j(op.json)}`;
    if (i % 32 === 0 || i === 1) R.say(`  op ${i}: ${ms} ms, Com_select +${dSel}, hook_execution rows=${execs}, physical calls=${ledger}, status=${op.status}`);
  }
  fs.writeFileSync(`${RUN}/s7-${WS}.csv`, 'op,ms,com_select,exec_rows,physical_calls,status\n' + csv.join('\n') + '\n');
  R.note('elapsed', `${Math.round((Date.now() - t0) / 1000)} s; first non-200: ${failedAt ?? 'none'}`);
  const phys = hookLedger((e) => e.session === id && !e.kind).length;
  R.note('physical handler calls for this Session', String(phys));
  g = await guard('after');
  R.check('guard after the quota: blocked-*.txt still denied', !g.written && g.p.terminal?.[0]?.type === 'turn_complete' && !/SHOULD/.test(g.result), `${turn(g.p)} written=${g.written} ${g.result.slice(0, 160)}`);
  const pn = await s.prompt(script([[call('write_file', { file_path: 'normal-after.txt', content: 'ok' })]], 'NORMAL'));
  const u = await s.prompt(script([], 'TEXT_ONLY'));
  R.note('text-only prompt after the quota', turn(u));
  R.note('ordinary write after the quota', `${turn(pn)} written=${fs.existsSync(`${w.dir}/normal-after.txt`)} ${toolTrace(pn.events).filter((x) => x.startsWith('result')).join(' ').slice(0, 160)}`);
  const d = await s.detach();
  const l = await s.load();
  const pn2 = await s.prompt(script([[call('write_file', { file_path: 'normal-after-reload.txt', content: 'ok' })]], 'NORMAL2'));
  R.note('ordinary write after detach + load', `detach=${d.status} load=${l.status} ${turn(pn2)} written=${fs.existsSync(`${w.dir}/normal-after-reload.txt`)} ${toolTrace(pn2.events).filter((x) => x.startsWith('result')).join(' ').slice(0, 160)}`);
  await s.detach();
  const fresh = new HSession(h, await createWorkspaceSession(w.workspaceId), storeConnection(h, w.workspaceId));
  await fresh.create({ hookCatalog: pin(WS) });
  const pf = await fresh.prompt(script([[call('write_file', { file_path: 'fresh-session.txt', content: 'ok' })]], 'FRESH'));
  R.note('a new Session (new worker) in the same Workspace', `${turn(pf)} written=${fs.existsSync(`${w.dir}/fresh-session.txt`)}`);
} finally {
  await h.close();
  await model.close();
  R.done();
}
