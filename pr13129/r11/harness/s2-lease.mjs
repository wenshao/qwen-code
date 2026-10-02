// S2: does an attached, idle Hook-enabled Session hold the Workspace execution lease between turns?
// usage: DB=hk ARM=head node s2-lease.mjs <workspace> <storageLetter> <hooks:yes|no> [staleSessionToRelease]
import { Report, Harness, HSession, startModel, workspace, createWorkspaceSession, storeConnection, script, call, turn, pin, sql, j, sleep } from './lib.mjs';
const [WS, LETTER, HOOKS, STALE] = process.argv.slice(2);
const arm = process.env.ARM ?? 'head';
const R = new Report(`s2-lease-${arm}-${WS}-${HOOKS}`);
const model = await startModel();
const h = await new Harness({ name: `s2-${arm}-${WS}`, modelUrl: model.url, arm }).start();
const lease = () => sql(`SELECT IFNULL(runtime_session_id,'<none>') FROM managed_workspace_execution_lease`).map((r) => r[0]).join(',') || '<no rows>';
try {
  const w = await workspace(LETTER, WS);
  if (STALE) {
    const old = new HSession(h, STALE, storeConnection(h, w.workspaceId));
    const l = await old.load();
    R.say(`load stale ${STALE}: ${l.status} ${l.json?.code ?? ''}  lease=${lease()}`);
    const d = await old.detach();
    R.say(`detach stale: ${d.status} ${d.json?.code ?? ''}  lease=${lease()}`);
  }
  const mk = async (hooks) => {
    const id = await createWorkspaceSession(w.workspaceId);
    const s = new HSession(h, id, storeConnection(h, w.workspaceId));
    const c = await s.create(hooks ? { hookCatalog: pin(WS) } : {});
    if (c.status !== 200) throw new Error(`create ${c.status} ${j(c.json)}`);
    return s;
  };
  const A = await mk(HOOKS === 'yes');
  const pa = await A.prompt(script([[call('write_file', { file_path: `a-${Date.now()}.txt`, content: 'A' })]], 'A_DONE'));
  R.check(`Session A (hooks=${HOOKS}) turn completes`, pa.terminal?.[0]?.type === 'turn_complete', turn(pa));
  await sleep(500);
  R.note('lease holder while A is attached and idle', lease());
  const B = await mk(false);
  const pb = await B.prompt(script([[call('write_file', { file_path: `b-${Date.now()}.txt`, content: 'B' })]], 'B_DONE'), 60_000);
  R.check('Session B (no hooks, same Workspace) turn completes while A is attached+idle', pb.terminal?.[0]?.type === 'turn_complete', turn(pb));
  const d = await A.detach();
  R.note('A detached', `status=${d.status} lease=${lease()}`);
  const pb2 = await B.prompt(script([[call('write_file', { file_path: `b2-${Date.now()}.txt`, content: 'B2' })]], 'B2_DONE'), 60_000);
  R.check('Session B turn after A detached', pb2.terminal?.[0]?.type === 'turn_complete', turn(pb2));
  await B.detach();
  R.note('final lease', lease());
} finally {
  await h.stop();
  await model.close();
  R.done();
}
