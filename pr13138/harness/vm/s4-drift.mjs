// S4: the offline boundary is not enforced by the fence alone. While a capture runs on a fenced storage, something that the
// runbook says must stay stopped does work anyway; the capture must not seal. Each case is a new recovery UUID on the same
// fence. Workspace = the populated S1-style tree plus 3,000 generated files so a capture lasts long enough to interfere with.
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import * as L from './lib.mjs';
import * as W from './w1b.mjs';
import * as P from './pop.mjs';
L.openLog('s4-drift');
const { say } = L;
say(L.hostFacts());
L.sh('bash /Users/wenshao/pr13138-rig/vm/o2-ctl.sh down; bash /Users/wenshao/pr13138-rig/vm/o2-ctl.sh up > /dev/null');
await P.rollout(['a', 'b']);
let rig = await L.startRig('s4');
const { S } = await P.populate(rig, { extraShell: ['mkdir -p gen && python3 -c "import os\nfor i in range(3000): open(f\'gen/f{i:05d}.txt\',\'w\').write(str(i))" && ls gen | wc -l'] });
const { fence, revision } = await P.offlineAndFence(rig);
P.memberTable('a');
const progress = (op) => Number(L.one(`SELECT COUNT(*) FROM managed_workspace_recovery_work WHERE operation_id='${op}' AND work_kind='ASSET'`) ?? 0);
const rows = [];
async function drift(id, what, inject, { at = 1500, before } = {}) {
  say(`== ${id}: ${what}`);
  if (before) say(`   before capture: ${await before()}`);
  const { bundle } = W.prepareBundle(`s4-${id}`, { sessions: W.members('a').map((m) => m.id) });
  const req = W.captureRequest({ fence, revision, bundle });
  const auth0 = W.authoritySnapshot(`s4-${id}-before`);
  let injected = null; let t0 = Date.now();
  const run = W.w1b('capture', req, { oss: true, label: `capture-${id}` });
  if (inject) {
    while (Date.now() - t0 < 600000) {
      const state = L.one(`SELECT state FROM managed_workspace_recovery_operation WHERE operation_id='${req.operationId}'`);
      if (state && state !== 'CAPTURING') break;
      if (state === 'CAPTURING' && progress(req.operationId) >= at) { injected = `${await inject()} (at ${progress(req.operationId)} assets, ${Date.now() - t0} ms)`; break; }
      await L.sleep(100);
    }
    say(`   injected: ${injected ?? '<capture ended before the injection point>'}`);
  }
  const r = await run;
  const row = W.opRow(req.operationId);
  say(`   ${W.opStr(row)} | sealed manifest present: ${fs.existsSync(`${bundle}/.w1-recovery/manifest.json`)}`);
  // A same-UUID retry must not resurrect the invalidated cut.
  const retry = r.code !== 0 ? await W.w1b('capture', req, { oss: true, label: `capture-${id}-retry` }) : null;
  rows.push({ id, what, injected, exit: r.code, outcome: W.summary(r), state: row?.state ?? '<no row>', lastError: row?.error, retry: retry ? W.summary(retry) : '-', authorityChangedByCapture: W.diffSnapshots(auth0, W.authoritySnapshot(`s4-${id}-after`)) });
  return r;
}
await drift('control', 'nothing interferes (duration baseline)', null);
await drift('late-create', 'service restarted mid-capture; a new Session is created in ws-a1 through the public route', async () => {
  L.svc('start'); const id = await L.createSession('ws-a1').catch((e) => `create failed ${e.message}`); L.svc('stop');
  return `public create -> ${id}`;
});
await drift('model-commit', 'service + Harness restarted mid-capture; F1 is cold-loaded and runs a text-only Turn', async () => {
  L.svc('start'); await rig.restartHarness('s4-mc'); const s = S.F1.bind(rig.h); const l = await s.load(); const r = l.status === 200 ? await s.prompt('PLAIN') : null; await s.detach(); await rig.h.stop(); L.svc('stop');
  return `load=${l.status}${l.status !== 200 ? ` ${JSON.stringify(l.json).slice(0, 100)}` : ''} turn=${r ? P.term(r) : '-'}`;
});
await drift('escaped-writer', 'a process appends to a Workspace file in the original tree mid-capture', async () => { fs.appendFileSync(`${L.root('a')}/project/notes.txt`, 'late\n'); return 'appended to project/notes.txt'; }, { at: 10 });
await (async () => {
  say("== live-writer: Harness holds F1 (60 s writer lease) when the capture starts");
  L.svc("start"); await rig.restartHarness("s4-lw"); const s = S.F1.bind(rig.h); const l = await s.load();
  say(`   F1 cold load=${l.status}; live leases: ${L.one("SELECT COUNT(*) FROM qwen_managed_session_journal_head WHERE state='ACTIVE' AND writer_lease_until > CURRENT_TIMESTAMP(6)")}`);
  await rig.h.stop(); L.svc("stop");
  const { bundle } = W.prepareBundle("s4-live-writer", { sessions: W.members("a").map((m) => m.id) });
  const req = W.captureRequest({ fence, revision, bundle });
  const r = await W.w1b("capture", req, { oss: true, label: "capture-live-writer" });
  const row = W.opRow(req.operationId);
  say(`   ${W.opStr(row)}`);
  rows.push({ id: "live-writer", what: "Harness stopped without detaching; its 60 s writer lease is still live", exit: r.code, outcome: W.summary(r), state: row?.state ?? "<no row>", lastError: row?.error, retry: "-", authorityChangedByCapture: [] });
  say(`   writer leases lapsed after ${await W.waitLeasesExpired("a")} ms`);
})();
await drift('fence-lifted', 'another operator runs W1a restore-original mid-capture', async () => {
  const r = L.maint(['restore-original', L.TENANT, 'st-a', L.root('a'), String(revision), fence, '--offline-confirmed']); return `restore-original exit=${r.code} -> ${L.mstr(L.mountRow('a'))}`;
});
say('== summary');
for (const x of rows) say(`   ${x.id.padEnd(14)} exit=${x.exit} state=${String(x.state).padEnd(12)} lastError=${String(x.lastError).padEnd(14)} retry: ${x.retry.slice(0, 80)} | authority changed during case: ${x.authorityChangedByCapture.join(',') || 'no'}`);
fs.writeFileSync(`${L.OUT}/s4-drift.json`, JSON.stringify({ rows, fence, revision, sessions: Object.fromEntries(Object.entries(S).map(([k, v]) => [k, v.sessionId])) }, null, 1));
await rig.stop(); say('S4-DONE');
