// S7e: a Session whose Runtime is at 4096 receipts: reload it (no client timeout) on a new Harness, try a guarded write;
// then a fresh Session in the same Workspace.  usage: node s7e-after-cap.mjs <ws> <sessionId>
import fs from 'node:fs';
import http from 'node:http';
import { Report, Harness, HSession, startModel, workspace, createWorkspaceSession, storeConnection, script, call, turn, toolTrace, pin, sleep, one } from './lib.mjs';
import { STORAGE } from './manifest.mjs';
const [WS, SID] = process.argv.slice(2);
const R = new Report(`s7e-after-cap-${process.env.ARM ?? 'head'}`);
const model = await startModel();
const h = await new Harness({ name: 's7e', modelUrl: model.url, arm: process.env.ARM ?? 'head' }).start();
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
const write = async (s, f) => {
  const w = await workspace(STORAGE[WS], WS);
  const p = await s.prompt(script([[call('write_file', { file_path: f, content: 'x' })]], `W-${f}`), 600_000);
  return `${turn(p)} written=${fs.existsSync(`${w.dir}/${f}`)} ${toolTrace(p.events).filter((x) => x.startsWith('result')).join(' ').slice(0, 120)}`;
};
try {
  const w = await workspace(STORAGE[WS], WS);
  const s = new HSession(h, SID, storeConnection(h, w.workspaceId));
  let l;
  const t0 = Date.now();
  for (let i = 0; i < 40; i++) {
    const a = Date.now();
    l = await post(`/session/${SID}/load`, { managedSessionStore: s.connection, toolProfile: s.profile });
    if (l.status === 200) {
      s.clientId = l.json.clientId;
      R.note('cold load of the capped Session', `${Date.now() - a} ms (${one(`SELECT COUNT(*) FROM qwen_managed_session_extension_record WHERE session_id='${SID}' AND domain='hook_execution'`)} records)`);
      break;
    }
    await sleep(5000);
  }
  R.note('guarded write after reload on a new Harness', await write(s, 'after-reload-cap.txt'));
  await s.detach();
  const fresh = new HSession(h, await createWorkspaceSession(w.workspaceId), storeConnection(h, w.workspaceId));
  await fresh.create({ hookCatalog: pin(WS) });
  R.note('fresh Session (new worker) in the same Workspace', await write(fresh, 'fresh-after-cap.txt'));
  await fresh.detach();
} finally {
  await h.close();
  await model.close();
  R.done();
}
