import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { pathToFileURL } from 'node:url';
const ROOT = process.env.TREE_ROOT;
const imp = (r) => import(pathToFileURL(path.join(ROOT, r)).href);
const { SessionService, Storage } = await imp('packages/core/dist/index.js');
const { archiveDaemonSessions, unarchiveDaemonSessions, SessionArchiveCoordinator } = await imp('packages/cli/dist/src/serve/server/session-archive.js');
const rt = fs.mkdtempSync(path.join(os.tmpdir(), 'cost-rt-'));
Storage.setRuntimeBaseDir(rt);
const w0 = () => fs.mkdtempSync(path.join(os.tmpdir(), 'cost-ws-'));
function seed(w, id, state) {
  const chats = path.join(new Storage(w).getProjectDir(), 'chats');
  const dir = state === 'archived' ? path.join(chats, 'archive') : chats;
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${id}.jsonl`), JSON.stringify({ uuid: 'r1', parentUuid: null, sessionId: id, timestamp: '2024-01-01T00:00:00.000Z', type: 'user', message: { role: 'user', parts: [{ text: 'hi' }] }, cwd: w, version: '1.0.0' }) + '\n');
}
const ids = (n, tag) => Array.from({ length: n }, (_, i) => `550e8400-e29b-41d4-a716-4${tag}${String(i).padStart(7, '0')}`);
async function timeIt(fn) { const t = process.hrtime.bigint(); await fn(); return Number(process.hrtime.bigint() - t) / 1e6; }

const N = 30;
// no-op archive: every id is already archived
const wa = w0(); const ia = ids(N, '1');
const sa = new SessionService(wa); ia.forEach((id) => seed(wa, id, 'archived'));
const tA = await timeIt(() => archiveDaemonSessions({ sessionIds: ia, service: sa, bridge: { closeSession: async () => {} }, coordinator: new SessionArchiveCoordinator() }));
// no-op unarchive: every id is already active
const wu = w0(); const iu = ids(N, '2');
const su = new SessionService(wu); iu.forEach((id) => seed(wu, id, 'active'));
const tU = await timeIt(() => unarchiveDaemonSessions({ sessionIds: iu, service: su, coordinator: new SessionArchiveCoordinator() }));
Storage.setRuntimeBaseDir(null);
console.log(JSON.stringify({ arm: process.env.ARM_LABEL, ids: N,
  noopArchiveMs: Math.round(tA), noopUnarchiveMs: Math.round(tU),
  perIdArchiveMs: +(tA / N).toFixed(2), perIdUnarchiveMs: +(tU / N).toFixed(2) }));
