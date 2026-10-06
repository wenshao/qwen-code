// R7-1 follow-up on the same database: does the rest of the runbook notice the Session admitted after the census?
import fs from 'node:fs';
import * as L from './lib.mjs';
import * as W from './w1bc.mjs';
import * as M from './w1c.mjs';
const TAG = process.env.TAG; L.openLog(`s10-${TAG}-after`); const { say } = L;
const file = `/var/lib/pr13260/requests/mig-${TAG}.json`; const req = JSON.parse(fs.readFileSync(file, 'utf8'));
const MENV = { extraEnv: { QWEN_HOME: M.homeOf() } };
L.sayMaint(`${TAG}-fence`, L.maint(['fence', L.TENANT, 'st-a', req.sourceRoot, String(req.mountRevision), req.fenceOperationId, '--offline-confirmed'], MENV));
W.prepareBundle(TAG, { sessions: W.members('a').map((m) => m.id) });
const cap = await W.w1b('capture', W.captureRequest({ op: req.captureOperationId, fence: req.fenceOperationId, revision: req.mountRevision, bundle: req.bundleRoot }), { label: `${TAG}-capture` });
L.sh(`rm -rf ${req.targetRoot} && cp -a ${req.sourceRoot} ${req.targetRoot}`);
const p = await M.mig('prepare', file, { label: `${TAG}-prepare` });
say(`   members: ${W.members('a').map((m) => `${m.id.slice(0, 8)}:${m.status}:head=${m.head}`).join(' ')}`);
fs.writeFileSync(`${L.OUT}/s10-${TAG}-after.json`, JSON.stringify({ capture: W.summary(cap), prepare: M.migSummary(p) }, null, 1));
