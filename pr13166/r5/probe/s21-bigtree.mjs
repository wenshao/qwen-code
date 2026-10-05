// VERIFICATION RIG ONLY: S21 does the 5 s Hosted glob deadline cut off a legitimate full walk?
// A Session directory holds FILES synthetic files (20 per directory); `**/needle.md` must visit all of them.
import fs from 'node:fs';
import * as L from './lib.mjs';

const FILES = Number(process.env.FILES ?? 50000);
const name = `s21-bigtree-${L.ARM}-${FILES}`;
L.openLog(name);
const st = process.env.ST ?? 'g';
const ws = `ws-${st}`;
const root = `${L.ROOTS}/${st}/w`;
const marker = `${root}/.tree-${FILES}`;
if (!fs.existsSync(marker)) {
  const t0 = Date.now();
  for (let d = 0; d < FILES / 20; d++) {
    const dir = `${root}/tree/g${String(Math.floor(d / 100)).padStart(3, '0')}/d${String(d).padStart(5, '0')}`;
    fs.mkdirSync(dir, { recursive: true });
    for (let f = 0; f < 20; f++) fs.writeFileSync(`${dir}/file-${f}.ts`, '');
  }
  fs.writeFileSync(`${root}/tree/needle.md`, 'needle\n');
  fs.writeFileSync(marker, '');
  L.say('setup', `${FILES} files written in ${Date.now() - t0} ms`);
}
L.seedRegistry(ws, `st-${st}`);
const model = await L.startModel({
  walk: ({ round }) => (round === 0 ? { calls: [['glob', { pattern: '**/needle.md' }]] } : { text: 'DONE walk' }),
  narrow: ({ round }) => (round === 0 ? { calls: [['glob', { pattern: 'needle.md', path: 'tree' }]] } : { text: 'DONE narrow' }),
});
const proxy = await L.startBrokerProxy();
const h = await new L.Harness({ name: `s21-${L.ARM}-${FILES}`, modelUrl: model.url, brokerUrl: proxy.url }).start();
try {
  const A = new L.HSession(h, await L.createWorkspaceSession(ws, 'w'), L.storeConnection(h, ws));
  await A.create({ toolProfile: 'hosted-workspace-files/2' });
  for (const k of ['walk', 'walk', 'narrow']) {
    const t0 = Date.now();
    const r = await A.prompt(`[[S:${k}]] go`, 300_000);
    const resp = L.toolResponses(r.events)[0]?.response ?? {};
    L.say(k, `${L.summarizeTurn(r)} wall=${Date.now() - t0}ms load=${(await import('node:os')).loadavg()[0].toFixed(0)} result=${JSON.stringify(resp.output ?? resp.error ?? '').slice(0, 160)}`);
  }
  L.say('lease', JSON.stringify(L.holders().filter((x) => x[1] !== '<none>').map((x) => x[1].slice(0, 8))));
} finally {
  await h.stop();
  await proxy.close();
  await model.close();
}
process.exitCode = L.done(name);
