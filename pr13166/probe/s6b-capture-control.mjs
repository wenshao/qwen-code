// VERIFICATION RIG ONLY: S6b control — Shell with captureBytes (publisher mode) on this rig, /1 vs /2.
// The rig's Spring has no tool-publication backend (it requires a regional HTTPS OSS endpoint).
import fs from 'node:fs';
import * as L from './lib.mjs';

const name = `s6b-capture-control-${L.ARM}`;
L.openLog(name);
const st = process.env.ST ?? 'i';
const ws = `ws-${st}`;
fs.mkdirSync(`${L.ROOTS}/${st}/w/src`, { recursive: true });
fs.writeFileSync(`${L.ROOTS}/${st}/w/src/a.ts`, 'export {};\n');
L.seedRegistry(ws, `st-${st}`);
const model = await L.startModel({
  sh: ({ round }) => (round === 0 ? { calls: [['run_shell_command', { command: 'ls -1 src' }]] } : { text: 'DONE sh' }),
});
const proxy = await L.startBrokerProxy();
const h = await new L.Harness({ name: `s6b-${L.ARM}`, modelUrl: model.url, brokerUrl: proxy.url }).start();
try {
  for (const profile of ['hosted-workspace-shell/1', 'hosted-workspace-shell/2']) {
    const A = new L.HSession(h, await L.createWorkspaceSession(ws, 'w'), L.storeConnection(h, ws));
    const c = await A.create({ toolProfile: profile, captureBytes: 1048576 });
    const r = await A.prompt('[[S:sh]] go');
    const line = h.log().split('\n').filter((l) => /recovery blocked/.test(l)).at(-1)?.replace(/^.*qwen serve: /, '') ?? '<none>';
    L.say(profile, `create ${c.status}; ${L.summarizeTurn(r)}; last blocked line: ${line.slice(0, 200)}`);
  }
} finally {
  await h.stop();
  await proxy.close();
  await model.close();
}
process.exitCode = L.done(name);
