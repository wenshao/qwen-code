// S7c: cold load time of a Session with a long Hook history (no client-side timeout).  usage: node s7c-load.mjs <ws> <sessionId>
import http from 'node:http';
import { Report, Harness, HSession, startModel, workspace, storeConnection, one, sleep, j } from './lib.mjs';
import { STORAGE } from './manifest.mjs';
const [WS, SID] = process.argv.slice(2);
const R = new Report(`s7c-load-${SID.slice(0, 8)}`);
const model = await startModel();
const h = await new Harness({ name: `s7c-${SID.slice(0, 8)}`, modelUrl: model.url }).start();
const post = (route, body) =>
  new Promise((resolve, reject) => {
    const u = new URL(h.baseUrl + route);
    const data = JSON.stringify(body);
    const req = http.request({ host: u.hostname, port: u.port, path: u.pathname, method: 'POST', headers: { ...h.headers(), 'content-length': Buffer.byteLength(data) }, timeout: 0 }, (res) => {
      let t = '';
      res.on('data', (c) => (t += c));
      res.on('end', () => resolve({ status: res.statusCode, json: t ? JSON.parse(t) : undefined }));
    });
    req.on('error', reject);
    req.end(data);
  });
try {
  const w = await workspace(STORAGE[WS], WS);
  const rows = one(`SELECT COUNT(*) FROM qwen_managed_session_extension_record WHERE session_id='${SID}' AND domain='hook_execution'`);
  const resources = one(`SELECT COUNT(*) FROM qwen_managed_session_resource WHERE session_id='${SID}'`);
  const s = new HSession(h, SID, storeConnection(h, w.workspaceId));
  let l;
  const t0 = Date.now();
  for (let i = 0; i < 40; i++) {
    const a = Date.now();
    l = await post(`/session/${SID}/load`, { managedSessionStore: s.connection, toolProfile: s.profile });
    if (l.status === 200) {
      R.note('cold load', `${Date.now() - a} ms (hook_execution records=${rows}, Store resources=${resources})`);
      s.clientId = l.json.clientId;
      break;
    }
    await sleep(5000);
  }
  R.note('total incl. waiting for the old writer lease', `${Date.now() - t0} ms, final status ${l.status} ${l.json?.code ?? ''}`);
  if (l.status === 200) {
    const a = Date.now();
    const op = await s.hookOp('Notification', { message: 'after-load', notification_type: 'rig' }, undefined, { timeoutMs: 900_000 });
    R.note('first operation after the load', `${op.status} ${Date.now() - a} ms`);
    await s.detach();
  }
} finally {
  await h.close();
  await model.close();
  R.done();
}
