// Round 3 A/B on the SAME populated + fenced database as m3-hooks.mjs (w1b_m3h): capture st-a (plain + Hooks
// Session), st-b (plain only) and st-c (MCP) with new UUIDs, using the CLI child given by CLI_DIST
// (dist-m3 = merged tree, dist-m3c = merged tree + the two H2 model resource kinds in the W1b allowlist).
import fs from 'node:fs';
import * as L from './lib.mjs';
import * as W from './w1b.mjs';
const TAG = process.env.TAG ?? 'ab';
L.openLog(`m3-hooks-${TAG}`);
const { say } = L;
const results = {};
say(L.hostFacts()); say(`   jar=${W.BUNDLE_JAR} cli=${W.CLI()} db=${L.DB()}`);
const a0 = W.authoritySnapshot(`m3h-${TAG}-before`);
const cap = async (st, label) => {
  const m = L.mountRow(st);
  const ids = W.members(st).map((x) => x.id);
  const { bundle } = W.prepareBundle(`m3h-${TAG}-${label}`, { storage: st, sessions: ids });
  const q = W.captureRequest({ fence: m.operation, revision: m.revision, storage: st, bundle });
  const r = await W.w1b('capture', q, { label: `m3h-${TAG}-${label}-capture` });
  const o = W.opRow(q.operationId);
  const line = r.stderr.split('\n').find((l) => /^[a-z_]+: /.test(l)) ?? r.cause ?? '';
  const out = { exit: r.code, ms: r.ms, summary: W.summary(r), state: o?.state, lastError: o?.error, sessions: o ? `${o.complete}/${o.sessions}` : '-', stderr: line.slice(0, 300), bundle: W.bundleFacts(bundle) };
  say(`   capture ${st} (${label}): exit=${r.code} ${o?.state}/${o?.error} sessions=${out.sessions} | ${line.slice(0, 200) || out.summary.slice(0, 160)}`);
  if (o?.state === 'SEALED') {
    const v = await W.w1b('verify', W.verifyRequest(q), { label: `m3h-${TAG}-${label}-verify` });
    out.verify = W.summary(v);
    const replay = await W.w1b('capture', q, { label: `m3h-${TAG}-${label}-replay`, quiet: true });
    out.replayIdentical = replay.stdout === r.stdout;
    say(`     verify: ${out.verify.slice(0, 160)}; same-UUID replay identical=${out.replayIdentical}`);
  }
  return out;
};
results.a = await cap('a', 'hooks');
results.b = await cap('b', 'plain');
results.c = await cap('c', 'mcp');
const a1 = W.authoritySnapshot(`m3h-${TAG}-after`);
results.authorityIdentical = a0.digest === a1.digest;
results.authorityDiff = W.diffSnapshots(a0, a1);
say(`   authority (${Object.keys(a0.tables).length} tables) identical=${results.authorityIdentical} diff=${results.authorityDiff.join(',') || '-'}`);
fs.writeFileSync(`${L.OUT}/m3-hooks-${TAG}.json`, JSON.stringify(results, null, 1));
say('M3AB-DONE');
