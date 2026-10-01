// S1: the documented W1b runbook on the deployed Linux stack.
//  populate st-a (two Workspaces, files/Shell/O2 Sessions, archived/closed/deleted/uninitialized) and st-b
//  -> offline boundary + W1a fence -> operator copies -> capture (packaged jar) -> replay -> inspect -> fresh verify
//  -> authority unchanged -> lift the fence -> original Sessions continue -> verify again (no longer compatible).
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import * as L from './lib.mjs';
import * as W from './w1b.mjs';
import * as P from './pop.mjs';
L.openLog('s1-capture');
const { say } = L;
say(L.hostFacts());
L.sh('o2-ctl() { bash /Users/wenshao/pr13138-rig/vm/o2-ctl.sh "$@"; }; o2-ctl down; o2-ctl up > /dev/null');
say('== rollout: migrate, register st-a and st-b offline, enable verified recovery');
await P.rollout(['a', 'b']);
let rig = await L.startRig('s1');
say('== populate through the deployed stack');
const { S, U1 } = await P.populate(rig);
say(`   model calls=${rig.model.state.calls}; file-history root ${W.historyRoot()}: ${fs.existsSync(W.historyRoot()) ? fs.readdirSync(W.historyRoot()).join(',') : '<absent>'}`);
say('== offline boundary and fence');
const { fence, revision } = await P.offlineAndFence(rig);
say('   members of st-a:'); P.memberTable('a');
say('   members of st-b:'); P.memberTable('b');
const auth0 = W.authoritySnapshot('before');
const tree0 = W.treeDigest(L.root('a')); const hist0 = W.treeDigest(W.historyRoot());
say(`   authority digest ${auth0.digest.slice(0, 16)} over ${Object.keys(auth0.tables).length} tables; source tree ${tree0}; history tree ${hist0}`);
const ids = W.members('a').map((m) => m.id);
const { bundle, copied } = W.prepareBundle('s1', { sessions: ids });
say(`   operator copy: ${bundle} (file-history copied for ${copied.length} Sessions)`);
say('== capture');
const cap = W.captureRequest({ fence, revision, bundle });
const c1 = await W.w1b('capture', cap, { oss: true, label: 'capture' });
say(`   ${W.opStr(W.opRow(cap.operationId))}`);
say(`   bundle: ${W.bundleFacts(bundle)}`);
if (c1.json) {
  const man = JSON.parse(fs.readFileSync(`${bundle}/.w1-recovery/manifest.json`, 'utf8'));
  say(`   manifest: provider=${man.provider} sessions=${man.sessionCount} assets=${man.assets.count} activation=${man.activation} fence=${man.fenceOperationId === fence} revision=${man.mountRevision} digest(sql)=${c1.json.manifestDigest === W.sha(fs.readFileSync(`${bundle}/.w1-recovery/manifest.json`))}`);
  const sessions = fs.readFileSync(`${bundle}/.w1-recovery/sessions.ndjson`, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  for (const s of sessions) say(`     pinned ${s.sessionId} ${s.binding.workspaceId} status=${s.publicSession.status} head=${s.head ? `${s.head.state} rev=${s.head.journalRevision} seq=${s.head.committedSequence}` : 'null (uninitialized)'}`);
  const summaries = L.sql(`SELECT session_id, summary_json FROM managed_workspace_recovery_session WHERE operation_id='${cap.operationId}' ORDER BY session_id`);
  say(`   summaries: ${summaries.map((r) => `${r[0].slice(0, 8)}=${r[1]}`).join(' ')}`);
  const kinds = {}; for (const l of fs.readFileSync(`${bundle}/.w1-recovery/assets.ndjson`, 'utf8').trim().split('\n')) { const t = JSON.parse(l).metadata.type; kinds[t] = (kinds[t] ?? 0) + 1; }
  say(`   asset kinds: ${JSON.stringify(kinds)}`);
}
say('== same-ID replay of the completed capture');
const c2 = await W.w1b('capture', cap, { oss: true, label: 'capture-replay' });
say(`   receipt identical: ${c1.stdout === c2.stdout}`);
const conflict = await W.w1b('capture', { ...cap, bundleRoot: `${bundle}-other` }, { oss: true, label: 'capture-conflict', rawFile: undefined });
say('== inspect (no offline flag needed, read-only)');
const ins = await W.w1b('inspect', W.inspectRequest(cap.operationId), { label: 'inspect' });
say(`   inspect: sessions page=${ins.json?.sessions?.length} next=${ins.json?.nextSessionId} registration.root=${ins.json?.registration?.root}`);
say('== fresh verification');
const ver = W.verifyRequest(cap);
const v1 = await W.w1b('verify', ver, { label: 'verify' });
const v1b = await W.w1b('verify', ver, { label: 'verify-replay' });
say(`   verify replay identical: ${v1.stdout === v1b.stdout}`);
const auth1 = W.authoritySnapshot('after-capture');
say(`   authority after capture+verify: ${auth1.digest === auth0.digest ? 'IDENTICAL' : `CHANGED ${W.diffSnapshots(auth0, auth1).join(', ')}`}; source tree ${W.treeDigest(L.root('a')) === tree0 ? 'identical' : 'CHANGED'}; history tree ${W.treeDigest(W.historyRoot()) === hist0 ? 'identical' : 'CHANGED'}`);
say(`   ${L.mstr(L.mountRow('a'))}`);
say('== lift the fence (W1a restore-original), restart, original Sessions continue');
L.sayMaint('restore-original-a', L.maint(['restore-original', L.TENANT, 'st-a', L.root('a'), String(revision), fence, '--offline-confirmed']));
say('  ', L.svc('start'));
await rig.restartHarness('s1-after');
const next = { F1: 'WRITE notes.txt v3', S1: L.shell64('cat src/a.ts && ls bin'), O1: L.o2sh('echo after-capture'), F2: 'READ other.txt' };
for (const [name, text] of Object.entries(next)) {
  const s = S[name].bind(rig.h); const l = await s.load();
  const r = l.status === 200 ? await s.prompt(text) : null;
  say(`   ${name} cold load=${l.status}${l.status !== 200 ? ` ${JSON.stringify(l.json).slice(0, 120)}` : ''} next Turn: ${r ? P.term(r) : '-'}`);
  await s.detach();
}
say('== offline again, verify the old bundle against the advanced authority');
const again = await P.offlineAndFence(rig);
const v2 = await W.w1b('verify', W.verifyRequest({ ...cap, fenceOperationId: fence, mountRevision: revision }), { label: 'verify-after-advance' });
say('== summary');
say(`   capture: ${W.summary(c1)}`); say(`   replay identical=${c1.stdout === c2.stdout}; conflict: ${W.summary(conflict)}`);
say(`   verify: ${W.summary(v1)}`); say(`   verify after the Sessions advanced: ${W.summary(v2)}`);
fs.writeFileSync(`${L.OUT}/s1.json`, JSON.stringify({ fence, revision, again, cap, ver, sessions: Object.fromEntries(Object.entries(S).map(([k, v]) => [k, v.sessionId])), U1 }, null, 1));
await rig.stop(); say('S1-DONE');
