// Round 5 (head 26de3752: W1b validates Hosted file history with the live record parser, incl. #13144 undo receipts).
// Real Hosted undo sequences that stress the stricter parser, written by whichever runtime the service runs
// (DIST: dist-26d = head, dist-d8b = previous head without #13144 = "legacy" records), then captured/verified with
// CLI_DIST (always the head) and cold-loaded again by a fresh Harness of the head.
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import * as L from './lib.mjs';
import * as W from './w1b.mjs';
import * as P from './pop.mjs';
const TAG = process.env.TAG ?? 'r5';
L.openLog(`r5-undo-${TAG}`);
const { say } = L;
const R = `${L.root('a')}/project`;
const results = { tag: TAG, steps: [] };
say(L.hostFacts()); say(`   writer runtime dist=${L.env().DIST} | maint jar=${W.BUNDLE_JAR} cli=${W.CLI()} db=${L.DB()}`);
await P.rollout(['a']);
L.seedWs('ws-a1', 'a');
const rig = await L.startRig(`r5-${TAG}`);
const U = new L.HSession(rig.h, await L.createSession('ws-a1'), 'ws-a1');
say(`   U ${U.sessionId} create=${(await U.create(L.FILES)).status}`);
const read = (f) => { try { return fs.readFileSync(`${R}/${f}`, 'utf8').trim(); } catch (e) { return `<${e.code}>`; } };
const prompts = {};
const write = async (label, text) => { const p = await U.prompt(text); prompts[label] = p.promptId; say(`     ${label} ${text}: ${P.term(p)} | a.txt=${read('a.txt')} b.txt=${read('b.txt')}`); };
const latest = () => {
  const rows = L.sql(`SELECT CAST(inline_bytes AS CHAR) FROM qwen_managed_session_resource WHERE session_id='${U.sessionId}' AND kind='managed-file_history'`);
  let best = null;
  for (const [t] of rows) { try { const b = JSON.parse(t); if (!best || b.revision > best.revision) best = b; } catch { /* not inline */ } }
  return best;
};
const rewind = async (label, promptLabel, requestId = randomUUID()) => {
  const r = await rig.h.json(`/session/${U.sessionId}/files/rewind`, { promptId: prompts[promptLabel], requestId }, { clientId: U.clientId });
  const rec = latest();
  const step = { label, prompt: promptLabel, requestId: requestId.slice(0, 8), status: r.status, code: r.json?.code, filesChanged: r.json?.filesChanged, conflict: r.json?.conflict, a: read('a.txt'), b: read('b.txt'), receipts: rec?.undoReceipts?.length, tracked: rec ? Object.keys(rec.state?.files ?? {}).sort().join(',') : '?' };
  results.steps.push(step);
  say(`     ${label.padEnd(44)} -> ${r.status}${r.json?.code ? ` ${r.json.code}` : ''} filesChanged=${JSON.stringify(r.json?.filesChanged)} conflict=${r.json?.conflict} | a.txt=${step.a} b.txt=${step.b} | receipts=${step.receipts} tracked=[${step.tracked}]`);
  return requestId;
};

say('== undo sequences through the real Harness route');
await write('p1', 'WRITE a.txt one');
await write('p2', 'WRITE b.txt one');
await write('p3', 'WRITE a.txt two');
await rewind('undo p3 (restore a.txt=one)', 'p3');
const rid = await rewind('undo p2 (b.txt created by p2 -> deleted)', 'p2');
await rewind('retry the same requestId (lost-reply retry)', 'p2', rid);
await rewind('undo p2 again with a new requestId', 'p2');
await write('p4', 'WRITE a.txt three');
fs.writeFileSync(`${R}/a.txt`, 'changed outside the Session\n');
await rewind('undo p4 after an out-of-band edit (conflict)', 'p4');
fs.writeFileSync(`${R}/a.txt`, 'three\n');
await rewind('undo p1 (earliest prompt)', 'p1');
const rec = latest();
results.final = { revision: rec?.revision, receipts: rec?.undoReceipts, pendingUndo: rec?.pendingUndo, tracked: Object.keys(rec?.state?.files ?? {}) };
say(`   final record rev=${rec?.revision} pendingUndo=${JSON.stringify(rec?.pendingUndo)} receipts=${JSON.stringify(rec?.undoReceipts?.map((x) => ({ r: x.requestId.slice(0, 8), p: Object.entries(prompts).find(([, v]) => v === x.promptId)?.[0], f: x.filesChanged, c: x.conflict })))}`);
await U.detach();

say('== cold load by a fresh head Harness (does the live runtime read its own record?)');
if (process.env.RELOAD_DIST) {
  // Upgrade the whole stack to the head before the reload: service (Broker + workers) and the Harness.
  await rig.h.stop();
  say(`   upgrade service to DIST=${process.env.RELOAD_DIST}: ${L.svc(`DIST=${process.env.RELOAD_DIST}`, "restart").split("\n").at(-1).slice(0, 80)}`);
  rig.h = await new L.Harness({ name: `r5-${TAG}-reload`, modelUrl: rig.model.baseUrl, brokerUrl: rig.proxy.url, dist: process.env.RELOAD_DIST }).start();
} else await rig.restartHarness(`r5-${TAG}-reload`);
U.bind(rig.h);
const ld = await U.load(L.FILES);
const st = await U.status();
results.coldLoad = { status: ld.status, code: ld.json?.code, recoveryBlocked: st?.recoveryBlocked };
say(`   load=${ld.status}${ld.json?.code ? ` ${ld.json.code}` : ''} recoveryBlocked=${st?.recoveryBlocked}`);
const after = await U.prompt('WRITE c.txt after-reload');
results.turnAfterLoad = P.term(after);
say(`   next turn after reload: ${P.term(after)}`);
await U.detach();

const { fence, revision } = await P.offlineAndFence(rig, 'a');
await rig.stop();
const b = W.prepareBundle(`r5-${TAG}`, { sessions: W.members('a').map((m) => m.id) }).bundle;
const q = W.captureRequest({ fence, revision, bundle: b });
const c = await W.w1b('capture', q, { label: `${TAG}-capture` });
const c2 = await W.w1b('capture', q, { label: `${TAG}-replay`, quiet: true });
const v = await W.w1b('verify', W.verifyRequest(q), { label: `${TAG}-verify` });
results.capture = W.summary(c); results.replayIdentical = c.stdout === c2.stdout; results.verify = W.summary(v);
results.stderr = c.stderr.split('\n').find((l) => /^[a-z_]+: /.test(l)) ?? '';
say(`   capture: ${W.summary(c).slice(0, 120)} ${results.stderr}`);
say(`   replay identical=${results.replayIdentical}; verify: ${W.summary(v).slice(0, 120)}`);
fs.writeFileSync(`${L.OUT}/r5-undo-${TAG}.json`, JSON.stringify(results, null, 1));
L.sh(`rm -rf ${b}`);
say('R5-DONE');
