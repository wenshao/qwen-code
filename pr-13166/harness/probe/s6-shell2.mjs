// VERIFICATION RIG ONLY: S6 hosted-workspace-shell/2 through the Harness route (R1-11 has no route test).
import fs from 'node:fs';
import * as L from './lib.mjs';

const name = `s6-shell2-${L.ARM}`;
L.openLog(name);
const st = process.env.ST ?? 'h';
const ws = `ws-${st}`;
fs.mkdirSync(`${L.ROOTS}/${st}/w/src`, { recursive: true });
fs.writeFileSync(`${L.ROOTS}/${st}/w/src/a.ts`, 'export {};\n');
L.seedRegistry(ws, `st-${st}`);
const model = await L.startModel({
  mix: ({ round }) =>
    round === 0
      ? { calls: [['glob', { pattern: '**/*.ts' }]] }
      : round === 1
        ? { calls: [['run_shell_command', { command: 'ls -1 src && pwd | sed "s#.*/##"' }]] }
        : { text: 'DONE mix' },
  plain: () => ({ text: 'PLAIN_OK' }),
});
const proxy = await L.startBrokerProxy();
const h = await new L.Harness({ name: `s6-${L.ARM}`, modelUrl: model.url, brokerUrl: proxy.url }).start();
try {
  for (const extra of [{}, { captureBytes: 1048576 }]) {
    const A = new L.HSession(h, await L.createWorkspaceSession(ws, 'w'), L.storeConnection(h, ws));
    const c = await A.create({ toolProfile: 'hosted-workspace-shell/2', ...extra });
    L.say('create', `shell/2 ${JSON.stringify(extra)} -> ${c.status}`);
    const n = model.requests.length;
    const r = await A.prompt('[[S:mix]] go');
    L.say('turn', L.summarizeTurn(r));
    for (const t of L.toolTrace(r.events, 300)) L.say('trace', t);
    const resps = L.toolResponses(r.events).map((x) => `${x.name}:${x.response?.executionStatus ?? '-'}`);
    L.check(`shell/2 ${JSON.stringify(extra)}: glob and run_shell_command both execute`, r.terminal?.[0]?.type === 'turn_complete' && resps.join() === 'glob:success,run_shell_command:success', resps.join());
    L.check(`shell/2 ${JSON.stringify(extra)}: advertised`, JSON.stringify(model.requests[n]?.tools) === JSON.stringify(['read_file', 'write_file', 'edit', 'run_shell_command', 'glob']), JSON.stringify(model.requests[n]?.tools));
    await A.detach();
    const re = await A.load({});
    const n2 = model.requests.length;
    const r2 = re.status === 200 ? await A.prompt('[[S:plain]] hi') : null;
    L.check(`shell/2 ${JSON.stringify(extra)}: reload keeps shell/2`, re.status === 200 && JSON.stringify(model.requests[n2]?.tools).includes('glob') && JSON.stringify(model.requests[n2]?.tools).includes('run_shell_command'), `${re.status} ${JSON.stringify(model.requests[n2]?.tools)}`);
    const bad = await A.detach().then(() => A.load({ toolProfile: 'hosted-workspace-shell/1' }));
    L.check(`shell/2 ${JSON.stringify(extra)}: load as shell/1 -> 409`, bad.status === 409, `${bad.status} ${JSON.stringify(bad.json)}`);
  }
} finally {
  await h.stop();
  await proxy.close();
  await model.close();
}
process.exitCode = L.done(name);
