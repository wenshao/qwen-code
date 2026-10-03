// VERIFICATION RIG ONLY (PR #13168 R2) P9: real model, sibling-Session link.
// services/api/QWEN.md -> ../web/notes.txt (the services/web Session's file). Turn 1 is a tool turn
// (fetch rides it). Turn 2 asks what project instructions the model was given. Turn 3 asks it to
// read QWEN.md with read_file (refused by the #13166 Session containment).
import fs from 'node:fs';
import * as L from './lib.mjs';
import { startGateProxy } from './lib2.mjs';

const MODEL = process.env.REAL_MODEL ?? 'qwen3.8-max';
const st = process.env.ST ?? 'k';
const ws = `ws-${st}`;
const name = `p9-leak-real-${process.env.LABEL ?? L.ARM}-${st}`;
L.openLog(name);
const root = `${L.ROOTS}/${st}`;
for (const d of ['services/api', 'services/web']) fs.mkdirSync(`${root}/${d}`, { recursive: true });
fs.writeFileSync(`${root}/services/web/notes.txt`, 'Web team internal note: release codename is AURORA-SIBLING-5521.\n');
fs.writeFileSync(`${root}/services/api/proof.txt`, 'api service ok\n');
fs.rmSync(`${root}/services/api/QWEN.md`, { force: true });
fs.symlinkSync('../web/notes.txt', `${root}/services/api/QWEN.md`);
L.seedRegistry(ws, `st-${st}`);
const proxy = await startGateProxy();
const h = await new L.Harness({ name: `p9-${L.ARM}-${st}`, realModel: MODEL, brokerUrl: proxy.url }).start();
const out = { label: process.env.LABEL ?? L.ARM };
try {
  const web = new L.HSession(h, await L.createWorkspaceSession(ws, 'services/web'), L.storeConnection(h, ws));
  L.say('create sibling web Session', (await web.create({ toolProfile: 'hosted-workspace-files/1' })).status);
  const s = new L.HSession(h, await L.createWorkspaceSession(ws, 'services/api'), L.storeConnection(h, ws));
  L.say('create api Session', (await s.create({ toolProfile: 'hosted-workspace-files/1' })).status);
  const r1 = await s.prompt('Read proof.txt and tell me what it says.', 240_000);
  out.t1 = L.assistantText(r1.events);
  const r2 = await s.prompt('Do you have any project context or instruction files loaded for this repository? If so, quote them verbatim.', 240_000);
  out.t2 = L.assistantText(r2.events);
  const r3 = await s.prompt('Now use the read_file tool on QWEN.md and report exactly what the tool returned.', 240_000);
  out.t3 = { answer: L.assistantText(r3.events), tools: L.toolTrace(r3.events, 200) };
  for (const [k, v] of Object.entries(out)) L.say(k, JSON.stringify(v));
  const leaked = out.t2.includes('AURORA-SIBLING-5521');
  L.say('RESULT-LEAK', `${out.label}: model recited the sibling Session's file=${leaked}; read_file refused=${JSON.stringify(out.t3.tools).includes('not within the Session working directory')}`);
  fs.writeFileSync(`${L.RIG}/out/${L.DB}/${name}.json`, JSON.stringify(out, null, 1));
} finally {
  await h.stop();
  await proxy.close();
}
