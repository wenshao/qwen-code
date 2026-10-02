// one-off: what recovery path does the refused Session accept? status, cancel, then a turn.
process.chdir('/Users/wenshao/pr13129-rig/probe');
const L = await import('/Users/wenshao/pr13129-rig/probe/lib.mjs');
const { STORAGE } = await import('/Users/wenshao/pr13129-rig/probe/manifest.mjs');
const SID = process.argv[2];
const R = new L.Report('s29c-recover-cancel-ws-up8-pr36');
const model = await L.startModel();
const h = await new L.Harness({ name: 's29c', modelUrl: model.url, arm: 'pr36' }).start();
const once = () => L.hookLedger((e) => e.session === SID && e.name === 'once' && !e.kind).length;
try {
  const w = await L.workspace(STORAGE['ws-up8'], 'ws-up8');
  const s = new L.HSession(h, SID, L.storeConnection(h, w.workspaceId));
  let l; for (let k = 0; k < 30; k++) { l = await s.load(); if (l.status === 200) break; await L.sleep(5000); }
  R.note('load', `${l.status} ${l.json?.code ?? ''}`);
  R.note('status', JSON.stringify(await s.status()).slice(0, 400));
  const c = await s.cancel();
  R.note('cancel', `${c.status} ${String(JSON.stringify(c.json)).slice(0, 200)}`);
  await L.sleep(1500);
  R.note('status after cancel', JSON.stringify(await s.status()).slice(0, 300));
  const p = await s.prompt(L.script([[L.call('write_file', { file_path: 'race-after-cancel.txt', content: 'z' })]], 'AFTER-CANCEL'));
  R.check('turn after cancel', p.terminal?.[0]?.type === 'turn_complete', `${L.turn(p)}; once-key handler calls ${once()}; once-key rows ${L.one(`SELECT COUNT(*) FROM qwen_managed_session_extension_record WHERE session_id='${SID}' AND hook_once_key_hash=SHA2('k-up-once',256)`)}`);
  const p2 = await s.prompt(L.script([[L.call('write_file', { file_path: 'race-after-cancel-2.txt', content: 'z' })]], 'AFTER-CANCEL-2'));
  R.check('next turn: once-key Hook not run again', p2.terminal?.[0]?.type === 'turn_complete' && once() <= 1, `${L.turn(p2)}; once-key handler calls ${once()}`);
  await s.detach();
} finally { await h.close(); await model.close(); R.done(); }
