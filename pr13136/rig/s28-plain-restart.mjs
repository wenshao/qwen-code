// PR #13136 control: does a plain Session (no Hook catalog) run a write_file turn after the Spring server restarts?
// seed: create + one write_file turn + detach. reuse: load + one write_file turn, with a Broker request ledger.
// usage: DB=<db> ARM=<dist> PHASE=seed|reuse node s28-plain-restart.mjs
import fs from 'node:fs';
import { Report, Harness, HSession, startModel, startBrokerProxy, ledgerLines, workspace, createWorkspaceSession, storeConnection, setControl, script, call, turn, RUN, j } from './lib.mjs';
const PHASE = process.env.PHASE;
const ARM = process.env.ARM ?? 'head';
const R = new Report(`s28-plain-restart-${PHASE}-${ARM}`);
const STATE = `${RUN}/s28-session.json`;
const model = await startModel();
const proxy = await startBrokerProxy();
setControl({});
const h = await new Harness({ name: `s28-${PHASE}`, modelUrl: model.url, arm: ARM, brokerUrl: proxy.url }).start();
try {
  let s;
  if (PHASE === 'seed') {
    const w = await workspace('n', 'ws-plain-rc');
    const sid = await createWorkspaceSession(w.workspaceId);
    s = new HSession(h, sid, storeConnection(h, w.workspaceId));
    const c = await s.create();
    fs.writeFileSync(STATE, j({ sid, workspaceId: w.workspaceId }));
    R.note('create', String(c.status));
  } else {
    const st = JSON.parse(fs.readFileSync(STATE, 'utf8'));
    s = new HSession(h, st.sid, storeConnection(h, st.workspaceId));
    const l = await s.load();
    R.note('load', `${l.status} ${l.json?.code ?? ''}`);
  }
  const p = await s.prompt(script([[call('write_file', { file_path: `plain-${PHASE}.txt`, content: 'x' })]], `PLAIN-${PHASE}`));
  R.check(`plain Session write_file turn (${PHASE})`, p.terminal?.[0]?.type === 'turn_complete', turn(p));
  for (const line of ledgerLines(proxy.ledger)) R.say(`  broker: ${line}`);
  await s.detach();
} finally {
  await h.close();
  await proxy.close();
  await model.close();
  R.done();
}
