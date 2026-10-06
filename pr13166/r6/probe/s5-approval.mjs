// VERIFICATION RIG ONLY: S5 approval modes — glob must not wait for an approval under default/auto-edit.
import fs from 'node:fs';
import * as L from './lib.mjs';
// The glob check must finish well inside the approval window; a waiting glob would time out unanswered.
const APPROVAL_MS = Number(process.env.APPROVAL_MS ?? 3000);

const name = `s5-approval-${L.ARM}`;
L.openLog(name);
const st = process.env.ST ?? 'g';
const ws = `ws-${st}`;
fs.mkdirSync(`${L.ROOTS}/${st}/w/src`, { recursive: true });
fs.writeFileSync(`${L.ROOTS}/${st}/w/src/a.ts`, 'export {};\n');
L.seedRegistry(ws, `st-${st}`);
const one = (call) => ({ round }) => (round === 0 ? { calls: [call] } : { text: 'DONE' });
const model = await L.startModel({
  glob: one(['glob', { pattern: '**/*.ts' }]),
  read: one(['read_file', { file_path: 'src/a.ts' }]),
  write: one(['write_file', { file_path: 'src/b.ts', content: 'export const b = 1;\n' }]),
});
const proxy = await L.startBrokerProxy();
const h = await new L.Harness({ name: `s5-${L.ARM}`, modelUrl: model.url, brokerUrl: proxy.url }).start();
try {
  for (const mode of ['default', 'auto-edit']) {
    const A = new L.HSession(h, await L.createWorkspaceSession(ws, 'w'), L.storeConnection(h, ws));
    const c = await A.create({ toolProfile: 'hosted-workspace-files/2', approvalMode: mode, approvalTimeoutMs: APPROVAL_MS });
    L.say(mode, `create ${c.status} ${JSON.stringify(c.json?.approvalMode)}`);
    for (const k of ['glob', 'read', 'write']) {
      const r = await A.prompt(`[[S:${k}]] go`);
      const asked = r.events.filter((e) => /permission|action|approval/i.test(JSON.stringify(e.data?.update?.sessionUpdate ?? e.type))).map((e) => e.data?.update?.sessionUpdate ?? e.type);
      const resp = L.toolResponses(r.events)[0]?.response ?? {};
      L.say(`${mode} ${k}`, `${L.summarizeTurn(r)} asked=${JSON.stringify([...new Set(asked)])} result=${JSON.stringify(resp).slice(0, 160)}`);
      if (k === 'glob') L.check(`${mode}: glob runs without waiting for approval`, resp.executionStatus === 'success' && asked.length === 0 && r.ms < APPROVAL_MS, `${r.ms}ms asked=${asked.length}`);
      if (k === 'write' && mode === 'default') L.check('default: write_file still waits for approval (control)', asked.length > 0 || r.ms >= 3000, `${r.ms}ms asked=${asked.length}`);
    }
  }
} finally {
  await h.stop();
  await proxy.close();
  await model.close();
}
process.exitCode = L.done(name);
