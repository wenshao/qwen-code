// VERIFICATION RIG ONLY (PR #13168 R6, head 6e151e6): the boot-v2 file-tool boundary (merged from
// #13166) "excludes directories owned by another Session installed in the same worker" and leaves
// "shared locations owned by no sibling" reachable (search-profile doc :96-110). This discriminator
// checks whether an UNINSTALLED sibling (created, never ran a tool) is protected, and whether
// running one tool (installing it) flips the caller's read of its files from allowed to refused.
//   Session S bound at services/ (ancestor) ; Session A bound at services/api/ ; api/up -> ..
import fs from 'node:fs';
import * as L from './lib.mjs';

const st = process.env.ST ?? 'h';
const ws = `ws-${st}`;
const name = `p13-install-order-${L.ARM}-${st}`;
L.openLog(name);
const root = `${L.ROOTS}/${st}`;
fs.mkdirSync(`${root}/services/api`, { recursive: true });
fs.writeFileSync(`${root}/services/ancestor-notes.md`, 'ANCESTOR-SESSION-MARKER\n');
fs.writeFileSync(`${root}/services/own-probe.md`, 'S-OWN\n');
fs.writeFileSync(`${root}/services/api/own.md`, 'API-OWN\n');
fs.rmSync(`${root}/services/api/up`, { force: true });
fs.symlinkSync('..', `${root}/services/api/up`);
L.seedRegistry(ws, `st-${st}`);

const model = await L.startModel({
  readUp: ({ round }) => (round === 0 ? { calls: [['read_file', { file_path: 'up/ancestor-notes.md' }]] } : { text: 'DONE' }),
  sInstall: ({ round }) => (round === 0 ? { calls: [['read_file', { file_path: 'own-probe.md' }]] } : { text: 'DONE' }),
});
const h = await new L.Harness({ name: `p13-${L.ARM}-${st}`, modelUrl: model.url, brokerUrl: L.BROKER }).start();
const out = {};
try {
  const sAnc = new L.HSession(h, await L.createWorkspaceSession(ws, 'services'), L.storeConnection(h, ws));
  await sAnc.create({ toolProfile: 'hosted-workspace-files/1' });
  const sApi = new L.HSession(h, await L.createWorkspaceSession(ws, 'services/api'), L.storeConnection(h, ws));
  await sApi.create({ toolProfile: 'hosted-workspace-files/1' });

  const readUp = async (phase) => {
    const r = await sApi.prompt('[[S:readUp]] read it');
    const resp = L.toolResponses(r.events)[0]?.response ?? {};
    out[phase] = { status: resp.executionStatus ?? (resp.error ? 'error' : '?'), leaked: JSON.stringify(resp).includes('ANCESTOR-SESSION-MARKER') };
    L.say(phase, `A read_file up/ancestor-notes.md -> ${JSON.stringify(out[phase])}`);
  };

  // Phase A: ancestor Session S created but never ran a tool (not installed on any worker).
  await readUp('A-ancestor-never-ran');
  // Install S by having it read its own file once.
  const si = await sAnc.prompt('[[S:sInstall]] install me');
  out.sInstallTurn = L.summarizeTurn(si);
  L.say('S install turn', out.sInstallTurn);
  // Phase B: ancestor S has now run a tool (installed).
  await readUp('B-ancestor-installed');

  const a = out['A-ancestor-never-ran'];
  const b = out['B-ancestor-installed'];
  L.say('VERDICT', `uninstalled: ${a.leaked ? 'LEAKED' : 'refused'} | after install: ${b.leaked ? 'LEAKED' : 'refused'}`);
  L.say('DOC-CHECK', b.leaked
    ? 'doc "excludes installed sibling" is NOT upheld even after install'
    : a.leaked
      ? 'doc holds only after install; an uninstalled sibling is readable (install-order gap)'
      : 'both refused');
  fs.writeFileSync(`${L.RIG}/out/${L.DB}/${name}.json`, JSON.stringify(out, null, 1));
} finally {
  await h.stop();
  await model.close();
}
