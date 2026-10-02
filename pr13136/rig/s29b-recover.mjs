// PR #13136, after s29-race: remove the phantom row (it stood in for a concurrent writer), then a new Harness process
// loads the refused Session once its writer lease lapses. If the refused commit left nothing behind, the next turn runs
// the once-key Hook exactly once and completes.  usage: DB=<db> ARM=<dist> node s29b-recover.mjs <ws> <sessionId>
import { Report, Harness, HSession, startModel, workspace, storeConnection, setControl, script, call, turn, hookLedger, sql, one, sleep } from './lib.mjs';
import { STORAGE } from './manifest.mjs';
const [WS, SID] = process.argv.slice(2);
const ARM = process.env.ARM ?? 'head';
const R = new Report(`s29b-recover-${WS}-${ARM}`);
const model = await startModel();
setControl({});
const h = await new Harness({ name: `s29b-${WS}`, modelUrl: model.url, arm: ARM }).start();
const onceCalls = () => hookLedger((e) => e.session === SID && e.name === 'once' && !e.kind).length;
try {
  sql(`DELETE FROM qwen_managed_session_extension_record WHERE session_id='${SID}' AND record_id='rig-phantom'`);
  R.note('rows holding the once key after removing the phantom', one(`SELECT COUNT(*) FROM qwen_managed_session_extension_record WHERE session_id='${SID}' AND hook_once_key_hash=SHA2('k-up-once',256)`));
  const w = await workspace(STORAGE[WS], WS);
  const s = new HSession(h, SID, storeConnection(h, w.workspaceId));
  let l;
  const t0 = Date.now();
  for (let k = 0; k < 30; k++) {
    l = await s.load();
    if (l.status === 200) break;
    await sleep(5000);
  }
  R.note('load on a new Harness process', `${l.status} ${l.json?.code ?? ''} after ${Math.round((Date.now() - t0) / 1000)} s`);
  const before = onceCalls();
  const p = await s.prompt(script([[call('write_file', { file_path: 'race-recovered.txt', content: 'z' })]], 'RACE-RECOVERED'));
  R.check('the refused Session recovers: turn completes and the once-key Hook runs exactly once', l.status === 200 && p.terminal?.[0]?.type === 'turn_complete' && onceCalls() - before === 1 && one(`SELECT COUNT(*) FROM qwen_managed_session_extension_record WHERE session_id='${SID}' AND hook_once_key_hash=SHA2('k-up-once',256)`) === '1',
    `${turn(p)}; once-key handler calls ${before} -> ${onceCalls()}; once-key rows ${one(`SELECT COUNT(*) FROM qwen_managed_session_extension_record WHERE session_id='${SID}' AND hook_once_key_hash=SHA2('k-up-once',256)`)}`);
  const p2 = await s.prompt(script([[call('write_file', { file_path: 'race-recovered-2.txt', content: 'z' })]], 'RACE-RECOVERED-2'));
  R.check('a later turn does not run the once-key Hook again', p2.terminal?.[0]?.type === 'turn_complete' && onceCalls() - before === 1, `${turn(p2)}; once-key handler calls ${onceCalls()}`);
  await s.detach();
} finally {
  await h.close();
  await model.close();
  R.done();
}
