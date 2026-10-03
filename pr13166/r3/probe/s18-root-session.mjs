// VERIFICATION RIG ONLY: S18 can a Workspace Session be pinned at the Workspace root (or a sibling's
// directory) by any creator? If so, the per-Session directory is a working-directory scope, not a
// confidentiality boundary between Sessions of one Workspace.
import fs from 'node:fs';
import * as L from './lib.mjs';

const name = `s18-root-session-${L.ARM}`;
L.openLog(name);
const st = process.env.ST ?? 'c';
const ws = `ws-${st}`;
const root = `${L.ROOTS}/${st}`;
fs.mkdirSync(`${root}/services/web`, { recursive: true });
fs.mkdirSync(`${root}/services/api`, { recursive: true });
fs.writeFileSync(`${root}/services/web/secret.txt`, 'SIBLING_SECRET\n');
L.seedRegistry(ws, `st-${st}`, ['alice', 'carol']);
const model = await L.startModel({
  readWeb: ({ round }) => (round === 0 ? { calls: [['read_file', { file_path: 'services/web/secret.txt' }]] } : { text: 'DONE' }),
  readHere: ({ round }) => (round === 0 ? { calls: [['read_file', { file_path: 'secret.txt' }]] } : { text: 'DONE' }),
});
const proxy = await L.startBrokerProxy();
const h = await new L.Harness({ name: `s18-${L.ARM}`, modelUrl: model.url, brokerUrl: proxy.url }).start();
try {
  for (const [actor, cwd, script] of [['carol', '.', 'readWeb'], ['carol', 'services/web', 'readHere']]) {
    const created = await L.api('POST', '/v1/agents/sessions', {
      actor,
      idem: `${actor}-${cwd}-${Date.now()}`,
      body: { agent_id: 'qwen-code', workspace: { workspace_id: ws, cwd_relative: cwd } },
    });
    L.say(`${actor} creates cwd_relative=${JSON.stringify(cwd)}`, `${created.status} ${JSON.stringify(created.json).slice(0, 160)}`);
    if (created.status >= 300) continue;
    const id = created.json.id ?? created.json.session_id ?? created.json.sessionId;
    const s = new L.HSession(h, id, L.storeConnection(h, ws));
    await s.create({ toolProfile: 'hosted-workspace-files/2' });
    const r = await s.prompt(`[[S:${script}]] go`);
    L.say(`${actor} ${script}`, `${L.summarizeTurn(r)} ${JSON.stringify(L.toolResponses(r.events)[0]?.response ?? {}).slice(0, 160)}`);
  }
} finally {
  await h.stop();
  await proxy.close();
  await model.close();
}
process.exitCode = L.done(name);
