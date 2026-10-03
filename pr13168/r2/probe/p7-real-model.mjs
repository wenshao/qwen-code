// VERIFICATION RIG ONLY (PR #13168 R2) P7: does a REAL model follow the Session's QWEN.md?
// QWEN.md sets a house rule (end every answer with a fixed token). Turn 1 needs read_file (the
// context arrives with that tool batch); Turn 2 is a plain question (context already latched).
import fs from 'node:fs';
import * as L from './lib.mjs';
import { startGateProxy, ctxOps } from './lib2.mjs';

const MODEL = process.env.REAL_MODEL ?? 'qwen3.8-max';
const REPS = Number(process.env.REPS ?? 2);
const st = process.env.ST ?? 'i';
const ws = `ws-${st}`;
const name = `p7-real-${L.ARM}-${st}`;
L.openLog(name);
const TOKEN = 'ZEBRA-7731';
const proxy = await startGateProxy();
const h = await new L.Harness({ name: `p7-${L.ARM}-${st}`, realModel: MODEL, brokerUrl: proxy.url }).start();
const out = { arm: L.ARM, model: MODEL, reps: [] };
try {
  for (let rep = 0; rep < REPS; rep++) {
    const cwd = `repo${rep}`;
    const dir = `${L.ROOTS}/${st}/${cwd}`;
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(`${dir}/QWEN.md`, `# Repository rules\n\nHouse rule: every reply you write in this repository must end with the exact final line \`-- checked ${TOKEN}\`. Never omit it.\n`);
    fs.writeFileSync(`${dir}/AGENTS.md`, '# Agent notes\n\nKeep answers to one or two sentences.\n');
    fs.writeFileSync(`${dir}/proof.txt`, 'The deployment region for this service is cn-hangzhou-k.\n');
    L.seedRegistry(ws, `st-${st}`);
    const s = new L.HSession(h, await L.createWorkspaceSession(ws, cwd), L.storeConnection(h, ws));
    L.say(`rep${rep} create`, (await s.create({ toolProfile: 'hosted-workspace-files/1' })).status);
    const t0 = Date.now();
    const r1 = await s.prompt('Read proof.txt and tell me the deployment region.', 240_000);
    const a1 = L.assistantText(r1.events);
    const tr1 = L.toolTrace(r1.events, 120);
    const r2 = await s.prompt('What is 17 + 25?', 240_000);
    const a2 = L.assistantText(r2.events);
    const rec = { cwd, t1: { summary: L.summarizeTurn(r1), tools: tr1, answer: a1, token: a1.includes(TOKEN) }, t2: { summary: L.summarizeTurn(r2), answer: a2, token: a2.includes(TOKEN) }, ctxOps: ctxOps(proxy.ledger, t0).length };
    out.reps.push(rec);
    L.say(`rep${rep} T1`, `${rec.t1.summary} tools=${JSON.stringify(tr1)}`);
    L.say(`rep${rep} T1 answer`, JSON.stringify(a1));
    L.say(`rep${rep} T2`, rec.t2.summary);
    L.say(`rep${rep} T2 answer`, JSON.stringify(a2));
    L.say(`rep${rep} workspace-context ops`, rec.ctxOps);
  }
  const t1 = out.reps.filter((r) => r.t1.token).length;
  const t2 = out.reps.filter((r) => r.t2.token).length;
  L.say('SUMMARY', `${L.ARM}: T1 answers with ${TOKEN}: ${t1}/${REPS}; T2: ${t2}/${REPS}`);
  if (L.ARM === 'base') L.check('base: the model never sees the rule', t1 === 0 && t2 === 0, `${t1}/${t2}`);
  else L.check('head: the model follows QWEN.md once context is fetched (T1 final + T2)', t1 === REPS && t2 === REPS, `${t1}/${t2}`);
  fs.writeFileSync(`${L.RIG}/out/${L.DB}/${name}.json`, JSON.stringify(out, null, 1));
} finally {
  await h.stop();
  await proxy.close();
}
process.exitCode = L.done(name);
