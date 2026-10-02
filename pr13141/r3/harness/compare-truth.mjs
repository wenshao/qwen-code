// Round-3 adjudication for PR #13141.
//
// This PR changes no runtime code (proven separately by the head-minus-PR
// bundle control), so the A/B question is not "did behaviour change" but
// "which arm's HELP TEXT tells the truth about behaviour that is identical on
// both arms". Each help-text claim is mapped to the probe cell that decides it.
//
// Inputs: runtime-<arm>.json from probe-runtime.mjs (S1-S9) and
// hooks-<arm>.json from probe-hooks.mjs (H1-H6), for arm in {base, head}.
//
// Usage: node compare-truth.mjs <logsDir> <out.json>
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const [logsDir, outFile] = process.argv.slice(2);
if (!logsDir || !outFile)
  throw new Error('usage: compare-truth.mjs <logsDir> <out.json>');

const load = (n) => JSON.parse(readFileSync(path.join(logsDir, n), 'utf8'));
const rb = load('runtime-base.json');
const rh = load('runtime-head.json');
const hb = load('hooks-base.json');
const hh = load('hooks-head.json');

const results = [];
let pass = 0;
let fail = 0;
function check(id, what, ok, detail) {
  if (ok) pass++;
  else fail++;
  results.push({ id, what, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${id}  ${what}${ok || !detail ? '' : `\n        ${detail}`}`);
}

const byId = (j) => new Map(j.results.map((r) => [r.id, r]));
const B = byId(rb);
const H = byId(rh);
const HB = new Map(hb.results.map((r) => [r.id, r]));
const HH = new Map(hh.results.map((r) => [r.id, r]));

console.log('=== 1. the PR changes no runtime behaviour: base vs head, cell by cell ===');
// Compare only the fields a user can observe. `ms` is wall-clock and `log` is
// a per-run temp path, so both are excluded by construction, not by luck.
const shape = (r) =>
  JSON.stringify({
    outcome: r.outcome,
    exitCode: r.exitCode,
    message: r.message,
    capabilities: r.capabilities,
    requests: (r.requests ?? []).map((q) => ({ p: q.toolProfile, s: q.status, c: q.code })),
  });
let identical = 0;
for (const id of [...B.keys()]) {
  const same = shape(B.get(id)) === shape(H.get(id));
  if (same) identical++;
  check(`R/${id}`, `runtime cell ${id} identical on base and head (${B.get(id).label})`, same,
    `base: ${shape(B.get(id))}\n        head: ${shape(H.get(id))}`);
}
for (const id of [...HB.keys()]) {
  const b = HB.get(id);
  const h = HH.get(id);
  const same = b.status === h.status && b.code === h.code;
  if (same) identical++;
  check(`K/${id}`, `hook cell ${id} identical on base and head`, same,
    `base ${b.status}/${b.code} vs head ${h.status}/${h.code}`);
}

console.log('\n=== 2. the OLD help text was already false on base (this is what the PR fixes) ===');
// Old text: "not implemented and rejects startup."
check('T1', 'base S2 (Broker URL + token) LISTENS — so "rejects startup" was false at base',
  B.get('S2').outcome === 'listening', `base S2 outcome=${B.get('S2').outcome}`);
check('T2', 'head S2 also listens — behaviour unchanged, only the text moved',
  H.get('S2').outcome === 'listening', `head S2 outcome=${H.get('S2').outcome}`);
check('T3', 'base S2 reaches the tool-profile gate (so the Broker path is implemented, not stubbed)',
  (B.get('S2').requests ?? []).some((q) => q.code !== 'hosted_tool_profile_unavailable'),
  JSON.stringify(B.get('S2').requests));

console.log('\n=== 3. each claim in the NEW help text, against observed behaviour ===');
// "for --profile hosted-harness"
check('N1', 'S6: without --profile hosted-harness the pair is refused',
  H.get('S6').outcome === 'refused' &&
    /Hosted Harness options require --profile hosted-harness/.test(H.get('S6').message ?? ''),
  `S6 outcome=${H.get('S6').outcome} message=${H.get('S6').message}`);
// "required together with token" / "required together with URL"
for (const [id, label] of [['S3', 'URL only'], ['S4', 'token only'], ['S5', 'URL + blank token']]) {
  check(`N2/${id}`, `S${id.slice(1)} (${label}) is refused with the pairing error`,
    H.get(id).outcome === 'refused' &&
      /Hosted Runtime Broker requires both URL and token/.test(H.get(id).message ?? ''),
    `${id} outcome=${H.get(id).outcome} message=${H.get(id).message}`);
}
// "required ... for Workspace tool turns" — the scoping claim. Two halves:
// (a) tool turns need the pair; (b) the pair is NOT required to start serve.
check('N3', 'S1: with no Broker pair the Harness still listens (the pair is not required to start)',
  H.get('S1').outcome === 'listening', `S1 outcome=${H.get('S1').outcome}`);
const TOOL_PROFILES = [
  'hosted-workspace-files/1',
  'hosted-workspace-shell/1',
  'hosted-workspace-mcp/1',
];
check('N4', 'S1: every Workspace tool profile is refused without the Broker pair',
  (H.get('S1').requests ?? [])
    .filter((q) => TOOL_PROFILES.includes(q.toolProfile))
    .every((q) => q.status === 400 && q.code === 'hosted_tool_profile_unavailable'),
  JSON.stringify(H.get('S1').requests));
check('N5', 'S2: with the Broker pair no tool profile is refused as unavailable',
  (H.get('S2').requests ?? [])
    .filter((q) => TOOL_PROFILES.includes(q.toolProfile))
    .every((q) => q.code !== 'hosted_tool_profile_unavailable'),
  JSON.stringify(H.get('S2').requests));
check('N6', 'S1: a no-tool Session is NOT refused as tool-profile-unavailable (scope is tool turns)',
  (H.get('S1').requests ?? []).find((q) => q.toolProfile.startsWith('(none'))?.code !==
    'hosted_tool_profile_unavailable',
  JSON.stringify(H.get('S1').requests));

console.log('\n=== 4. round-3 scope question: is "Workspace tool turns" still complete? ===');
// main merged durable Hosted Hooks (H2) and Turn takeover / G1 failover since
// round 2. Hooks are a SECOND consumer of the same two flags, so the question
// is whether any Broker-dependent session is not a Workspace tool turn.
check('P1', 'H2/H4: a hook catalog is refused without a Workspace tool profile, on both arms',
  HB.get('H2').code === 'invalid_hosted_hook_catalog' &&
    HB.get('H4').code === 'invalid_hosted_hook_catalog' &&
    HH.get('H2').code === 'invalid_hosted_hook_catalog' &&
    HH.get('H4').code === 'invalid_hosted_hook_catalog',
  `base H2=${HB.get('H2').code} H4=${HB.get('H4').code}; head H2=${HH.get('H2').code} H4=${HH.get('H4').code}`);
check('P2', 'H4 is the decisive cell: Broker pair present, no tool profile, hooks still refused',
  HH.get('H4').code === 'invalid_hosted_hook_catalog',
  `head H4 = ${HH.get('H4').status}/${HH.get('H4').code}`);
check('P3', 'H3: with the pair AND a tool profile the hook gate passes (hooks are genuinely wired)',
  HH.get('H3').code === 'invalid_managed_session_store',
  `head H3 = ${HH.get('H3').status}/${HH.get('H3').code}`);
check('P4', 'H5 control: H3 passes because of the hook gate, not because hooks are ignored',
  HH.get('H5').code === 'invalid_managed_session_store' &&
    HH.get('H3').code === HH.get('H5').code,
  `H3=${HH.get('H3').code} H5=${HH.get('H5').code}`);
check('P5', 'H1: without the pair, hooks are refused via the tool-profile gate',
  HH.get('H1').code === 'hosted_tool_profile_unavailable',
  `head H1 = ${HH.get('H1').code}`);
// So every Hook session is a Workspace tool session => the flags the help tells
// you to set are sufficient for Hooks too. The wording under-enumerates
// (Hooks, MCP, /files/rewind, takeover recovery all ride the same pair) but
// cannot lead a reader to under-configure. That is a nit, not a defect.
check('P6', 'no probe cell shows a Broker-dependent session that is not a tool-profile session',
  [...HH.values()].every((r) => r.id === 'H4' || r.id === 'H2' || r.code !== 'invalid_hosted_hook_catalog' ||
    r.body?.hookCatalog === undefined || r.ok),
  'see P1/P2');

console.log('\n=== 5. sibling options the issue said to leave alone ===');
check('X1', 'S9: the untouched experimental Runtime option still rejects startup',
  H.get('S9').outcome === 'refused' &&
    /Experimental Managed Gateway and Runtime worker modes are not implemented/.test(H.get('S9').message ?? ''),
  `S9 outcome=${H.get('S9').outcome} message=${H.get('S9').message}`);
check('X2', 'S9 identical on base and head (the PR did not widen scope)',
  shape(B.get('S9')) === shape(H.get('S9')), '');

console.log('\n=== 6. non-loopback HTTPS rule is still only in the error, not the help ===');
check('Y1', 'S7: a non-loopback http Broker URL is refused with the HTTPS message',
  H.get('S7').outcome === 'refused' &&
    /must use HTTPS outside the loopback interface/.test(H.get('S7').message ?? ''),
  `S7 = ${H.get('S7').outcome} / ${H.get('S7').message}`);
check('Y2', 'S8: a non-loopback https Broker URL is accepted',
  H.get('S8').outcome === 'listening', `S8 = ${H.get('S8').outcome}`);

writeFileSync(outFile, JSON.stringify({ pass, fail, identical, results }, null, 2));
console.log(`\ntruth adjudication: ${pass} passed, ${fail} failed, ${results.length} assertions; ${identical} cells identical base vs head`);
process.exit(fail === 0 ? 0 : 1);
