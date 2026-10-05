// VERIFICATION RIG ONLY (PR #13168 R5, head d2b1845): bot R6-2 — a sibling Session bound at a
// non-root ANCESTOR of the caller. Before 9d53f984d6 the file-tool boundary exempted any ancestor
// directory, so a caller at services/api could read the files of a Session bound at services. The
// fix confines file tools to the caller's own Session directory by realpath.
//   Session S bound at services/ ; Session A bound at services/api/ ; services/api/up -> ..
import fs from 'node:fs';
import * as L from './lib.mjs';

const st = process.env.ST ?? 'g';
const ws = `ws-${st}`;
const name = `p12-ancestor-${L.ARM}-${st}`;
L.openLog(name);
const root = `${L.ROOTS}/${st}`;
fs.mkdirSync(`${root}/services/api`, { recursive: true });
fs.writeFileSync(`${root}/services/ancestor-notes.md`, 'ANCESTOR-SESSION-MARKER\n');
fs.writeFileSync(`${root}/services/api/own.md`, 'API-OWN\n');
fs.rmSync(`${root}/services/api/up`, { force: true });
fs.symlinkSync('..', `${root}/services/api/up`);
L.seedRegistry(ws, `st-${st}`);

const model = await L.startModel({
  readUp: ({ round }) => (round === 0 ? { calls: [['read_file', { file_path: 'up/ancestor-notes.md' }]] } : { text: 'DONE' }),
  readOwn: ({ round }) => (round === 0 ? { calls: [['read_file', { file_path: 'own.md' }]] } : { text: 'DONE' }),
});
const h = await new L.Harness({ name: `p12-${L.ARM}-${st}`, modelUrl: model.url, brokerUrl: L.BROKER }).start();
const out = {};
try {
  // Session S occupies the ancestor directory (services).
  const sAnc = new L.HSession(h, await L.createWorkspaceSession(ws, 'services'), L.storeConnection(h, ws));
  L.say('create S (services)', (await sAnc.create({ toolProfile: 'hosted-workspace-files/1' })).status);
  const sApi = new L.HSession(h, await L.createWorkspaceSession(ws, 'services/api'), L.storeConnection(h, ws));
  L.say('create A (services/api)', (await sApi.create({ toolProfile: 'hosted-workspace-files/1' })).status);

  const r = await sApi.prompt('[[S:readUp]] read it');
  const resp = L.toolResponses(r.events)[0]?.response ?? {};
  out.throughLink = { status: resp.executionStatus ?? (resp.error ? 'error' : '?'), leaked: JSON.stringify(resp).includes('ANCESTOR-SESSION-MARKER'), raw: JSON.stringify(resp).slice(0, 220) };
  L.say('A read_file up/ancestor-notes.md', JSON.stringify(out.throughLink));

  const own = await sApi.prompt('[[S:readOwn]] read own');
  const ownResp = L.toolResponses(own.events)[0]?.response ?? {};
  out.own = { status: ownResp.executionStatus, ok: JSON.stringify(ownResp).includes('API-OWN') };
  L.say('A read_file own.md (control)', JSON.stringify(out.own));

  L.check('R6-2: read_file through the link to the ancestor Session is refused, no leak', out.throughLink.status === 'error' && !out.throughLink.leaked, JSON.stringify(out.throughLink));
  L.check('control: the caller reads its own file', out.own.ok, JSON.stringify(out.own));
  fs.writeFileSync(`${L.RIG}/out/${L.DB}/${name}.json`, JSON.stringify(out, null, 1));
} finally {
  await h.stop();
  await model.close();
}
process.exitCode = L.done(name);
