// VERIFICATION RIG ONLY: S25b the same in-Session directory read as S25 rDir, under files/1 (the public profile).
import * as L from './lib.mjs';

const name = `s25b-read-dir-${L.ARM}`;
L.openLog(name);
const st = process.env.ST ?? 'a';
const ws = `ws-${st}`;
L.seedRegistry(ws, `st-${st}`);
const model = await L.startModel({ rDir: ({ round }) => (round === 0 ? { calls: [['read_file', { file_path: 'src' }]] } : { text: 'DONE' }) });
const proxy = await L.startBrokerProxy();
const h = await new L.Harness({ name: `s25b-${L.ARM}`, modelUrl: model.url, brokerUrl: proxy.url }).start();
const top = `${L.ROOTS}/${st}`;
try {
  for (const profile of ['hosted-workspace-files/1', 'hosted-workspace-files/2']) {
    const A = new L.HSession(h, await L.createWorkspaceSession(ws, 'services/api'), L.storeConnection(h, ws));
    await A.create({ toolProfile: profile });
    const r = await A.prompt('[[S:rDir]] go', 120_000);
    const text = JSON.stringify(L.toolResponses(r.events)[0]?.response ?? {});
    L.say(profile, `${L.summarizeTurn(r)} hostPath=${text.includes(top)} ${text.split(top).join('<HOST>').slice(0, 260)}`);
    await A.detach();
  }
} finally {
  await h.stop();
  await proxy.close();
  await model.close();
}
process.exitCode = L.done(name);
