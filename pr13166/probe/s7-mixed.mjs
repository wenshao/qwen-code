// VERIFICATION RIG ONLY: S7 mixed versions during a rollout — head Harness offers glob (/2),
// the Runtime worker is the main build (does not admit glob); both report managed-runtime-tools/1.
import fs from 'node:fs';
import * as L from './lib.mjs';

const name = `s7-mixed-${L.ARM}`;
L.openLog(name);
const st = process.env.ST ?? 'm';
const ws = `ws-${st}`;
fs.mkdirSync(`${L.ROOTS}/${st}/w/src`, { recursive: true });
fs.writeFileSync(`${L.ROOTS}/${st}/w/src/a.ts`, 'export {};\n');
L.seedRegistry(ws, `st-${st}`);
const launches = () => (fs.existsSync(`${L.RUN}/workers/launches.log`) ? fs.readFileSync(`${L.RUN}/workers/launches.log`, 'utf8').trim().split('\n') : []);
const model = await L.startModel({
  glob: ({ round }) => (round === 0 ? { calls: [['glob', { pattern: '**/*.ts' }]] } : { text: 'DONE glob' }),
  read: ({ round }) => (round === 0 ? { calls: [['read_file', { file_path: 'src/a.ts' }]] } : { text: 'DONE read' }),
});
const proxy = await L.startBrokerProxy();
const h = await new L.Harness({ name: `s7-${L.ARM}`, modelUrl: model.url, brokerUrl: proxy.url }).start();
try {
  L.say('setup', `Harness=${L.ARM}; worker launches so far: ${launches().length}; worker entry: ${(launches().at(-1) ?? '').replace(/^.* (\/\S+cli\.js).*$/, '$1')}`);
  const A = new L.HSession(h, await L.createWorkspaceSession(ws, 'w'), L.storeConnection(h, ws));
  L.say('create', (await A.create({ toolProfile: 'hosted-workspace-files/2' })).status);
  const t0 = Date.now();
  const r = await A.prompt('[[S:glob]] go');
  L.say('glob turn', L.summarizeTurn(r));
  for (const t of L.toolTrace(r.events, 400)) L.say('glob trace', t);
  L.say('broker', L.ledgerSince(proxy.ledger, t0).join(' | '));
  L.say('worker entry', (launches().at(-1) ?? '').replace(/^.* (\/\S+cli\.js).*$/, '$1'));
  L.say('status', JSON.stringify(await A.status()));
  L.say('holders', JSON.stringify(L.holders().filter((x) => x[1] !== '<none>')));
  L.say('executions', JSON.stringify(L.sql("SELECT execution_state, IFNULL(execution_status,'-'), LEFT(IFNULL(result_json,''),200) FROM qwen_tool_execution ORDER BY settled_at DESC LIMIT 1")));
  const r2 = await A.prompt('[[S:read]] go');
  L.say('next turn (read_file)', L.summarizeTurn(r2));
  for (const t of L.toolTrace(r2.events, 200)) L.say('read trace', t);
  L.say('harness log', h.log().split('\n').filter((l) => /blocked|failed|refus|unavailable/i.test(l)).map((l) => l.replace(/^.*qwen serve: /, '')).join(' || ').slice(0, 800) || '<none>');
} finally {
  await h.stop();
  await proxy.close();
  await model.close();
}
process.exitCode = L.done(name);
