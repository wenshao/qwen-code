// S23 (4dbdd48736 "preserve recovery owners and diagnostics"), run with PUNCT=1 manifests:
// E1: an HTTP Hook whose URL uses an allowed env var (RIG_HOOK_PATH, set in the worker env) — the Runtime URL
//     allowlist now interpolates allowedEnvVars like the HTTP runner does.
// I1: a Hook Session in a Workspace whose id starts with '_'.  I2: a hookId that starts with '.'.
import fs from 'node:fs';
import { startHookHttp, Report, Harness, HSession, startModel, workspace, createWorkspaceSession, storeConnection, script, call, turn, pin, hookRecords, hookLedger, setControl, j } from './lib.mjs';
import { STORAGE, HTTP_PORT } from './manifest.mjs';
if (!process.env.DB || !process.env.PUNCT) throw new Error('DB and PUNCT=1 are required');
const arm = process.env.ARM ?? 'head';
const R = new Report(`s23-owner-diagnostics-${arm}${process.env.ONLY ? `-only${process.env.ONLY}` : ''}`);
setControl({});
const web = await startHookHttp(HTTP_PORT);
const model = await startModel();
const h = await new Harness({ name: `s23-${arm}`, modelUrl: model.url, arm }).start();
try {
  for (const [WS, label, hookId, kind] of [
    ['ws-ue1', 'E1 HTTP Hook URL with an allowed env var (http://…/${RIG_HOOK_PATH})', 'ue-pre', 'http'],
    ['_lead-ws', 'I1 Hook Session in Workspace "_lead-ws"', 'lead-pre', 'fn'],
    ['ws-dot', 'I2 hookId ".dot-pre"', '.dot-pre', 'fn'],
  ].filter(([WS]) => !process.env.ONLY || WS === process.env.ONLY)) {
    let detail = '';
    let ok = false;
    try {
      const w = await workspace(STORAGE[WS], WS);
      const id = await createWorkspaceSession(w.workspaceId);
      const s = new HSession(h, id, storeConnection(h, w.workspaceId));
      const cr = await s.create({ hookCatalog: pin(WS) });
      const h0 = web.ledger.length;
      const l0 = hookLedger().length;
      const f = `id-${Date.now()}.txt`;
      const p = cr.status === 200 ? await s.prompt(script([[call('write_file', { file_path: f, content: 'x' })]], `ID-${WS}`), 60_000) : { status: '-' };
      const rec = hookRecords(id, 'hook_execution').filter((r) => r.rec.hookId === hookId).at(-1)?.rec;
      const hits = web.ledger.slice(h0).map((e) => e.path);
      const ran = kind === 'http' ? hits.length : hookLedger().slice(l0).filter((e) => e.session === id && e.name === 'pre' && !e.kind).length;
      const st = cr.status === 200 ? await s.status() : {};
      ok = cr.status === 200 && p.terminal?.[0]?.type === 'turn_complete' && rec?.run.state === 'settled' && ran >= 1 && fs.existsSync(`${w.dir}/${f}`);
      detail = `create=${cr.status}${cr.json?.code ? ` ${cr.json.code}` : ''} turn=${turn(p)} hook=${rec?.run.state}/${j(rec?.run.execution)} hookRuns=${ran}${kind === 'http' ? ` paths=${j(hits)}` : ''} fileWritten=${fs.existsSync(`${w.dir}/${f}`)} status.recoveryBlocked=${st.recoveryBlocked}`;
      if (cr.status === 200) await s.detach();
    } catch (e) {
      detail = `error: ${String(e.message ?? e).slice(0, 300)}`;
    }
    R.check(label, ok, detail);
  }
} finally {
  await h.close();
  await model.close();
  await web.close();
  R.done();
}
