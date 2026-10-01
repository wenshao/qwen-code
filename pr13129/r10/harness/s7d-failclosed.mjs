// S7d: fail-closed guard in a long Hook Session: load time vs history size (detach + load at checkpoints), and what the
// fail-closed PreToolUse guard does once the Session's Runtime holds 4096 receipts.  usage: node s7d-failclosed.mjs <ws> <ops>
import fs from 'node:fs';
import { repairLeak, Report, Harness, HSession, startModel, workspace, createWorkspaceSession, storeConnection, script, call, turn, toolTrace, pin, hookLedger, setControl, RUN, one } from './lib.mjs';
import { STORAGE } from './manifest.mjs';
const [WS, OPS] = process.argv.slice(2);
const R = new Report(`s7d-failclosed-${WS}`);
const model = await startModel();
const h = await new Harness({ name: `s7d-${WS}`, modelUrl: model.url }).start();
const w = await workspace(STORAGE[WS], WS);
R.note('rig repair', String(await repairLeak(STORAGE[WS])));
setControl({});
const csv = [];
try {
  const id = await createWorkspaceSession(w.workspaceId);
  const s = new HSession(h, id, storeConnection(h, w.workspaceId));
  await s.create({ hookCatalog: pin(WS) });
  const rows = () => Number(one(`SELECT COUNT(*) FROM qwen_managed_session_extension_record WHERE session_id='${id}' AND domain='hook_execution'`));
  const write = async (f) => {
    const p = await s.prompt(script([[call('write_file', { file_path: f, content: 'x' })]], `W-${f}`));
    return `${turn(p)} written=${fs.existsSync(`${w.dir}/${f}`)} ${toolTrace(p.events).filter((x) => x.startsWith('result')).join(' ').slice(0, 140)}`;
  };
  R.note('ordinary write before the quota', await write('normal-before.txt'));
  const checkpoints = [1000, 2500];
  for (let i = 1; i <= Number(OPS); i++) {
    const a = Date.now();
    const op = await s.hookOp('Notification', { message: `n${i}`, notification_type: 'rig' }, undefined, { timeoutMs: 600_000 });
    const n = rows();
    csv.push([i, Date.now() - a, n, op.status].join(','));
    if (checkpoints.length && n >= checkpoints[0]) {
      checkpoints.shift();
      const d = await s.detach();
      const b = Date.now();
      const l = await s.load();
      R.note(`detach + load at ${n} records`, `detach=${d.status} load=${l.status} ${Date.now() - b} ms`);
    }
    if (i % 64 === 0) R.say(`  op ${i}: ${Date.now() - a} ms rows=${n} physical=${hookLedger((e) => e.session === id && !e.kind).length}`);
  }
  fs.writeFileSync(`${RUN}/s7d-${WS}.csv`, 'op,ms,exec_rows,status\n' + csv.join('\n') + '\n');
  R.note('physical handler calls for this Session', String(hookLedger((e) => e.session === id && !e.kind).length));
  R.note('ordinary write after the quota (fail-closed guard)', await write('normal-after.txt'));
  R.note('second ordinary write after the quota', await write('normal-after2.txt'));
} finally {
  await h.close();
  await model.close();
  R.done();
}
