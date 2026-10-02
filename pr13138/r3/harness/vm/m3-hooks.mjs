// Round 3 (merged tree = PR head 0919b9d8 + main 3f56f74a, V28 candidate jar): W1b against Sessions that used the
// Stage H domains enabled on main. st-a: one plain Session + one Hosted Hooks Session (H2, new on main);
// st-b: plain Sessions only (control); st-c: one Hosted MCP Session (H1, already enabled at the PR base).
// Expects: reset.sh <db> HOOKS=1 MCP=1 STORAGES="a b c" PUB=0, and node m3-manifests.mjs.
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import * as L from './lib.mjs';
import * as W from './w1b.mjs';
import * as P from './pop.mjs';
import * as MF from './m3-manifests.mjs';
L.openLog('m3-hooks');
const { say } = L;
const results = {};
say(L.hostFacts()); say(`   jar=${W.BUNDLE_JAR} cli=${W.CLI()} db=${L.DB()}`);
const LEDGER = '/var/lib/qwen-w1b/hook-ledger.jsonl';
fs.rmSync(LEDGER, { force: true });
const records = (sid) => L.sql(`SELECT domain, COUNT(*) FROM qwen_managed_session_extension_record WHERE session_id='${sid}' GROUP BY domain ORDER BY domain`).map((r) => `${r[0]}=${r[1]}`).join(' ') || 'none';
const domainsInJournal = (sid) => L.sql(`SELECT COUNT(*) FROM qwen_managed_session_journal_tx WHERE session_id='${sid}'`)[0]?.[0];

await P.rollout(['a', 'b', 'c']);
const rig = await L.startRig('m3h');
L.seedWs('ws-a1', 'a'); L.seedWs('ws-b1', 'b'); L.seedWs('ws-c1', 'c');
const S = {};
const open = async (name, ws, profile, extra) => {
  const s = new L.HSession(rig.h, await L.createSession(ws), ws);
  const c = await s.create(profile, extra);
  say(`   ${name} ${s.sessionId} (${ws}, ${profile}${extra ? ` ${JSON.stringify(extra).slice(0, 90)}` : ''}) create=${c.status}${c.status !== 200 ? ` ${JSON.stringify(c.json).slice(0, 200)}` : ''}`);
  S[name] = s; return s;
};
const run = async (name, text) => { const r = await S[name].prompt(text); say(`     ${name} ${text.slice(0, 40)}: ${P.term(r)}`); return r; };

say('== populate');
await open('P1', 'ws-a1', L.FILES); await run('P1', 'WRITE plain.txt p1');
await open('H1', 'ws-a1', L.FILES, { hookCatalog: MF.hookPin('ws-a1') });
const l0 = fs.existsSync(LEDGER) ? fs.readFileSync(LEDGER, 'utf8').split('\n').filter(Boolean).length : 0;
const hr = await run('H1', 'WRITE hooked.txt h1');
const ledger = fs.existsSync(LEDGER) ? fs.readFileSync(LEDGER, 'utf8').split('\n').filter(Boolean).slice(l0).map((l) => JSON.parse(l)) : [];
say(`     H1 hook ledger: ${ledger.map((e) => `${e.name}:${e.event}${e.tool ? `/${e.tool}` : ''}`).join(' ') || '<none>'}; tool trace: ${L.toolTrace(hr.events).join(' | ').slice(0, 200)}`);
await open('B1', 'ws-b1', L.FILES); await run('B1', 'WRITE b.txt b1');
await open('B2', 'ws-b1', L.FILES); await run('B2', 'WRITE b2.txt b2');
await open('M1', 'ws-c1', L.MCPP, { mcpServers: L.MCP_PINS }); await run('M1', 'MCP hello-from-w1b');
for (const s of Object.values(S)) await s.detach();
for (const [n, s] of Object.entries(S)) say(`   ${n} extension records: ${records(s.sessionId)}; journal tx=${domainsInJournal(s.sessionId)}`);
results.population = Object.fromEntries(Object.entries(S).map(([n, s]) => [n, { id: s.sessionId, records: records(s.sessionId) }]));
results.hookLedger = ledger.map((e) => `${e.name}:${e.event}`);

say('== offline + fence a, b, c');
const fences = {};
for (const st of ['a', 'b', 'c']) fences[st] = await P.offlineAndFence(rig, st);
for (const st of ['a', 'b', 'c']) P.memberTable(st);
const a0 = W.authoritySnapshot('m3h-before');

const cap = async (st, label) => {
  const ids = W.members(st).map((m) => m.id);
  const { bundle } = W.prepareBundle(`m3h-${label}`, { storage: st, sessions: ids });
  const q = W.captureRequest({ fence: fences[st].fence, revision: fences[st].revision, storage: st, bundle });
  const t0 = Date.now();
  const r = await W.w1b('capture', q, { label: `m3h-${label}-capture` });
  const o = W.opRow(q.operationId);
  const line = r.stderr.split('\n').find((l) => /^[a-z_]+: /.test(l)) ?? r.cause ?? '';
  const retry = await W.w1b('capture', q, { label: `m3h-${label}-same-uuid`, quiet: true });
  const o2 = W.opRow(q.operationId);
  const out = { exit: r.code, ms: Date.now() - t0, summary: W.summary(r), state: o?.state, lastError: o?.error, sessions: o ? `${o.complete}/${o.sessions}` : '-', stderr: line.slice(0, 300), retry: W.summary(retry), retryState: o2?.state, bundle: W.bundleFacts(bundle), q };
  say(`   capture ${st} (${label}): exit=${r.code} ${o?.state}/${o?.error} sessions=${out.sessions} | ${line.slice(0, 200)}`);
  say(`     same UUID retry: ${out.retry.slice(0, 120)} row=${o2?.state}/${o2?.error}; bundle: ${out.bundle}`);
  return out;
};

say('== capture each storage on the merged build');
results.a = await cap('a', 'hooks');
results.b = await cap('b', 'plain');
if (results.b.state === 'SEALED') {
  const v = await W.w1b('verify', W.verifyRequest(results.b.q), { label: 'm3h-plain-verify' });
  results.bVerify = W.summary(v);
}
results.c = await cap('c', 'mcp');
const a1 = W.authoritySnapshot('m3h-after');
results.authorityIdentical = a0.digest === a1.digest;
results.authorityTables = Object.keys(a0.tables).length;
results.authorityDiff = W.diffSnapshots(a0, a1);
say(`   authority (${results.authorityTables} tables) identical=${results.authorityIdentical} diff=${results.authorityDiff.join(',') || '-'}`);
for (const k of ['a', 'b', 'c']) delete results[k].q;
fs.writeFileSync(`${L.OUT}/m3-hooks.json`, JSON.stringify(results, null, 1));
await rig.stop();
say('M3H-DONE');
