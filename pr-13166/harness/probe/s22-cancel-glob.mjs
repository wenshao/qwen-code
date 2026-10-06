// VERIFICATION RIG ONLY: S22 the bounded glob under the round-4 wedge shapes: deadline, cancel, next Turn,
// Runtime worker CPU afterwards (a runaway matcher thread would keep a core busy).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import * as L from './lib.mjs';

const name = `s22-cancel-glob-${L.ARM}`;
L.openLog(name);
const st = process.env.ST ?? 'd';
const ws = `ws-${st}`;
const root = `${L.ROOTS}/${st}/w`;
fs.mkdirSync(`${root}/src`, { recursive: true });
for (const f of ['src/index.ts', 'package.json', 'package-lock.json', 'a-b-c-d-e-f-g-h-i-j-k-l-m-n-o.ts']) fs.writeFileSync(`${root}/${f}`, '{}\n');
L.seedRegistry(ws, `st-${st}`);
const G = (pattern) => ({ round }) => (round === 0 ? { calls: [['glob', { pattern }]] } : { text: 'DONE' });
const model = await L.startModel({
  extglob: G('+(?|?|?)Z'),
  stars: G('*?'.repeat(20) + 'Z'),
  normal: G('**/*.ts'),
});
const proxy = await L.startBrokerProxy();
const h = await new L.Harness({ name: `s22-${L.ARM}`, modelUrl: model.url, brokerUrl: proxy.url }).start();
const workerCpu = () =>
  execFileSync('/bin/ps', ['-axo', 'pid=,pcpu=,etime=,command='], { encoding: 'utf8' })
    .split('\n')
    .filter((l) => l.includes(`${L.RIG}/dist/`) && l.includes('managed-runtime-worker'))
    .map((l) => l.trim().split(/\s+/).slice(0, 3).join(' '));
try {
  const A = new L.HSession(h, await L.createWorkspaceSession(ws, 'w'), L.storeConnection(h, ws));
  await A.create({ toolProfile: 'hosted-workspace-files/2' });
  for (const k of ['extglob', 'normal', 'stars', 'normal']) {
    const t0 = Date.now();
    const r = await A.prompt(`[[S:${k}]] go`, 300_000);
    const resp = L.toolResponses(r.events)[0]?.response ?? {};
    L.say(k, `${L.summarizeTurn(r)} wall=${Date.now() - t0}ms result=${JSON.stringify(resp.output ?? resp.error ?? '').slice(0, 150)}`);
  }
  // Cancel while the matcher is busy.
  const t0 = Date.now();
  const sub = await A.submit('[[S:extglob]] go');
  await L.sleep(1500);
  const c = await h.json(`/session/${A.sessionId}/cancel`, {}, { clientId: A.clientId });
  const st2 = await A.waitIdle(60_000);
  const ev = (await A.transcript()).filter((e) => e.promptId === sub.promptId);
  const resp = L.toolResponses(ev)[0]?.response ?? {};
  L.say('cancel at 1.5 s', `cancel=${c.status} idle after ${Date.now() - t0}ms terminal=${JSON.stringify(ev.filter((e) => e.type.startsWith('turn_')).map((e) => e.type))} blocked=${st2.recoveryBlocked} result=${JSON.stringify(resp).slice(0, 160)}`);
  const r2 = await A.prompt('[[S:normal]] go');
  L.say('after cancel', `${L.summarizeTurn(r2)} ${JSON.stringify(L.toolResponses(r2.events)[0]?.response ?? {}).slice(0, 100)}`);
  await L.sleep(3000);
  L.say('runtime workers (pid %cpu etime)', JSON.stringify(workerCpu()));
  L.say('lease', JSON.stringify(L.holders().filter((x) => x[1] !== '<none>').map((x) => x[1].slice(0, 8))));
} finally {
  await h.stop();
  await proxy.close();
  await model.close();
}
process.exitCode = L.done(name);
