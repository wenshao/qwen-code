// S15 (#13110 file history merged into H2): Write → Write → undo → Write with PreToolUse/PostToolUse Hooks vs a no-Hook
// control; Hooks run once per write, undo restores, the Workspace is usable by another Session afterwards.
import fs from 'node:fs';
import { repairLeak, Report, Harness, HSession, startModel, workspace, createWorkspaceSession, storeConnection, script, call, turn, pin, hookLedger, setControl, sql, j } from './lib.mjs';
import { STORAGE } from './manifest.mjs';
const arm = process.env.ARM ?? 'head';
const R = new Report(`s15-history-hooks-${arm}`);
const model = await startModel();
const h = await new Harness({ name: `s15-${arm}`, modelUrl: model.url, arm }).start();
setControl({});
const leaseOf = (ws) => sql(`SELECT IFNULL(runtime_session_id,'<free>') FROM managed_workspace_execution_lease WHERE storage_key=SHA2(CONCAT('t-rig', CHAR(0), 'st-${STORAGE[ws]}'),256)`)[0]?.[0] ?? '<no row>';
try {
  for (const [ws, hooks] of [['ws-hist', true], ['ws-hist0', false]]) {
    const tag = hooks ? 'with Hooks' : 'no Hooks';
    const w = await workspace(STORAGE[ws], ws);
    await repairLeak(STORAGE[ws]);
    const id = await createWorkspaceSession(w.workspaceId);
    const s = new HSession(h, id, storeConnection(h, w.workspaceId));
    await s.create(hooks ? { hookCatalog: pin(ws) } : {});
    const f = `${w.dir}/h.txt`;
    const l0 = hookLedger().length;
    const w1 = await s.prompt(script([[call('write_file', { file_path: 'h.txt', content: 'one' })]], 'W1'));
    const w2 = await s.prompt(script([[call('write_file', { file_path: 'h.txt', content: 'two' })]], 'W2'));
    const hist = await s.history();
    const snaps = hist.json?.history?.state?.snapshots ?? [];
    const rw = await s.rewind(w2.promptId);
    const afterUndo = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '<missing>';
    const w3 = await s.prompt(script([[call('write_file', { file_path: 'h.txt', content: 'three' })]], 'W3'));
    const hooksRun = hookLedger().slice(l0).filter((e) => e.session === id && !e.kind);
    const pre = hooksRun.filter((e) => e.event === 'PreToolUse').length;
    const post = hooksRun.filter((e) => e.event === 'PostToolUse').length;
    R.check(`${tag}: Write, Write, undo of the second Write, Write`, [w1, w2, w3].every((p) => p.terminal?.[0]?.type === 'turn_complete') && rw.status === 200 && afterUndo === 'one' && fs.readFileSync(f, 'utf8') === 'three', `turns=${[w1, w2, w3].map((p) => p.terminal?.[0]?.type).join(',')} history=${hist.status} snapshots=${snaps.length} undo=${rw.status} ${rw.json?.code ?? ''} afterUndo=${j(afterUndo)} final=${j(fs.readFileSync(f, 'utf8'))}`);
    if (hooks) R.check(`${tag}: PreToolUse and PostToolUse ran once per write (3 each)`, pre === 3 && post === 3, `pre=${pre} post=${post}`);
    const d = await s.detach();
    const o = new HSession(h, await createWorkspaceSession(w.workspaceId), storeConnection(h, w.workspaceId));
    await o.create();
    const po = await o.prompt(script([[call('write_file', { file_path: 'other.txt', content: 'o' })]], 'OTHER'), 60_000);
    R.check(`${tag}: after detach, another Session uses the Workspace`, d.status === 204 && po.terminal?.[0]?.type === 'turn_complete', `detach=${d.status} ${turn(po)} lease=${leaseOf(ws)}`);
    await o.detach();
  }
} finally {
  await h.close();
  await model.close();
  R.done();
}
