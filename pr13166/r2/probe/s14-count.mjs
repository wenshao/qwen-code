// VERIFICATION RIG ONLY: S14 R1-1 — output containment checks only the <=100 displayed hits, while the
// header/trailer count every collected hit. Session services/api: 105 recent .md; sibling services/web:
// 300 .md aged 3 days, so they sort after the Session's own files.
import fs from 'node:fs';
import * as L from './lib.mjs';

const name = `s14-count-${L.ARM}`;
L.openLog(name);
const st = process.env.ST ?? 'l';
const ws = `ws-${st}`;
const root = `${L.ROOTS}/${st}`;
for (const d of ['services/api/docs', 'services/web/docs']) fs.mkdirSync(`${root}/${d}`, { recursive: true });
const old = new Date(Date.now() - 3 * 24 * 3600 * 1000);
for (let i = 0; i < 105; i++) fs.writeFileSync(`${root}/services/api/docs/api-${String(i).padStart(3, '0')}.md`, '# api\n');
for (let i = 0; i < 300; i++) {
  const f = `${root}/services/web/docs/web-${String(i).padStart(3, '0')}.md`;
  fs.writeFileSync(f, '# web\n');
  fs.utimesSync(f, old, old);
}
L.seedRegistry(ws, `st-${st}`);
const one = (pattern) => ({ round }) => (round === 0 ? { calls: [['glob', { pattern }]] } : { text: 'DONE' });
const model = await L.startModel({ own: one('**/*.md'), braced: one('{.,..}/**/*.md') });
const proxy = await L.startBrokerProxy();
const h = await new L.Harness({ name: `s14-${L.ARM}`, modelUrl: model.url, brokerUrl: proxy.url }).start();
try {
  const A = new L.HSession(h, await L.createWorkspaceSession(ws, 'services/api'), L.storeConnection(h, ws));
  L.say('create', (await A.create({ toolProfile: 'hosted-workspace-files/2' })).status);
  for (const k of ['own', 'braced']) {
    const r = await A.prompt(`[[S:${k}]] go`);
    const resp = L.toolResponses(r.events)[0]?.response ?? {};
    const text = String(resp.output ?? resp.error ?? '');
    const lines = text.split('\n');
    L.say(k, `${L.summarizeTurn(r)} status=${resp.executionStatus}`);
    L.say(`${k} header`, lines[0]);
    L.say(`${k} trailer`, lines.at(-1));
    L.say(`${k} listed`, `${lines.filter((l) => /\.md$/.test(l)).length} paths; any web-*.md listed: ${/web-\d+\.md/.test(text)}`);
  }
} finally {
  await h.stop();
  await proxy.close();
  await model.close();
}
process.exitCode = L.done(name);
