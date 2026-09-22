// Scripted assertion checker for the PR12475 round-2 E2E matrices.
// Reads the harness result JSONs and asserts the full expected cell matrix.
// Expected base-arm failures are encoded as expectations (a base cell that
// unexpectedly WORKS is a fail, same as a head cell that unexpectedly fails).
// Prints one PASS/FAIL line per assertion; exits 1 if any FAIL.
import fs from 'node:fs';

const A = '/root/git/qwen-code-x3/tmp/pr12475-verify-20260923-071935';
const dtFile = process.argv[2];
const ghFile = process.argv[3];
const dt = JSON.parse(fs.readFileSync(dtFile, 'utf8'));
const gh = ghFile ? JSON.parse(fs.readFileSync(ghFile, 'utf8')) : [];

let pass = 0, fail = 0;
const fails = [];
function assert(id, cond, note) {
  if (cond) { pass++; console.log(`PASS ${id} ${note}`); }
  else { fail++; fails.push(id); console.log(`FAIL ${id} ${note}`); }
}

const dtCell = (arm, id) => dt.find((r) => r.arm === arm && r.id === id);
const verdicts = (r) => r.probes.map((p) => `${p.kind}:${p.sender}${p.extra ? '(' + p.extra + ')' : ''}=${p.verdict}${p.modelSawHistory ? '[hist]' : ''}`);
const v = (r, kind, sender, extra) => r.probes.find((p) => p.kind === kind && p.sender === sender && (p.extra ?? null) === (extra ?? null))?.verdict;
const sawHist = (r, kind, sender, extra) => r.probes.find((p) => p.kind === kind && p.sender === sender && (p.extra ?? null) === (extra ?? null))?.modelSawHistory;

// ---- DingTalk base arm: keys are inert, single-gate behavior everywhere ----
for (const id of ['S0', 'S1', 'S2', 'S3']) {
  const r = dtCell('base', id);
  assert(`base-${id}-startup`, r.startup === 'connected', `base ${id} starts`);
}
{
  const r = dtCell('base', 'S0');
  assert('base-S0-alice-G', v(r, 'G', 'alice') === 'ANSWERED', 'allowlisted member answered in group');
  assert('base-S0-bob-G', v(r, 'G', 'bob')?.startsWith('REJECTED'), 'stranger rejected in group');
  assert('base-S0-alice-D', v(r, 'D', 'alice') === 'ANSWERED', 'allowlisted user answered in DM');
  assert('base-S0-bob-D', v(r, 'D', 'bob')?.startsWith('REJECTED'), 'stranger rejected in DM');
}
{
  // base S1/S2 must behave exactly like S0: the new keys are inert at base
  for (const id of ['S1', 'S2', 'S3']) {
    const r = dtCell('base', id);
    assert(`base-${id}-inert`, v(r, 'G', 'bob')?.startsWith('REJECTED'), `base ${id}: group bob still rejected (keys inert)`);
  }
}
{
  const r = dtCell('base', 'S4');
  assert('base-S4-starts', r.startup === 'connected', 'base starts with unknown groupSenderPolicy value (key inert at base)');
}
{
  const r = dtCell('base', 'S5');
  assert('base-S5-group-pairing-leak', v(r, 'G', 'dave') === 'PAIRING_CODE', 'base leaks DM pairing code into the group chat');
}
{
  const r = dtCell('base', 'S6b');
  assert('base-S6b-no-history', sawHist(r, 'G', 'alice') !== true, 'base records no unmentioned line from non-allowlisted bob');
}
{
  const r = dtCell('base', 'S8');
  assert('base-S8-inert', r.probes.every((p) => p.verdict !== 'COMMAND_DENIED'), 'base: no group-axis narrowing exists (keys inert)');
}

// ---- DingTalk head arm: the new axis works, default unchanged, fail-closed ----
{
  const r = dtCell('head', 'S0');
  assert('head-S0-default-unchanged', v(r, 'G', 'alice') === 'ANSWERED' && v(r, 'G', 'bob')?.startsWith('REJECTED') && v(r, 'D', 'alice') === 'ANSWERED' && v(r, 'D', 'bob')?.startsWith('REJECTED'), 'head S0 identical to base S0');
}
{
  const r = dtCell('head', 'S1');
  assert('head-S1-open-group', v(r, 'G', 'bob') === 'ANSWERED' && v(r, 'G', 'carol') === 'ANSWERED' && v(r, 'G', 'alice') === 'ANSWERED', 'groupSenderPolicy=open answers any group member');
  assert('head-S1-dm-unchanged', v(r, 'D', 'bob')?.startsWith('REJECTED') && v(r, 'D', 'alice') === 'ANSWERED', 'DM axis still governed by senderPolicy');
}
{
  const r = dtCell('head', 'S2');
  assert('head-S2-group-allowlist', v(r, 'G', 'carol') === 'ANSWERED', 'allowedGroupUsers member answered');
  assert('head-S2-alice-group-denied', v(r, 'G', 'alice') === 'REJECTED(group_sender_denied)', 'DM-only alice denied in group, logged as group_sender_denied (R1-13 observable end-to-end)');
  assert('head-S2-bob-group-denied', v(r, 'G', 'bob') === 'REJECTED(group_sender_denied)', 'stranger denied in group with group axis reason');
  assert('head-S2-dm-axis', v(r, 'D', 'carol') === 'REJECTED(sender_denied)' && v(r, 'D', 'alice') === 'ANSWERED', 'DM axis unchanged and keeps sender_denied reason');
}
{
  const r = dtCell('head', 'S3');
  assert('head-S3-explicit-inherit', v(r, 'G', 'bob')?.startsWith('REJECTED') && v(r, 'G', 'alice') === 'ANSWERED', 'explicit inherit == default');
}
{
  const r = dtCell('head', 'S4');
  assert('head-S4-fail-closed', r.startup !== 'connected' && (r.startupLog ?? []).some((l) => /groupSenderPolicy/.test(l)), "groupSenderPolicy:'pairing' refuses to start, naming the field");
}
{
  const r = dtCell('head', 'S5');
  assert('head-S5-group-open', r.probes.filter((p) => p.kind === 'G').every((p) => p.verdict === 'ANSWERED'), 'dave answered in group under open axis despite DM pairing');
  assert('head-S5-dm-pairs', v(r, 'D', 'dave') === 'PAIRING_CODE', 'same sender still gets a pairing code in DM');
  assert('head-S5-pairing-store-dm-only', (r.pairingFiles ?? []).length >= 1 && (r.pairingFiles ?? []).every((f) => !/cid-grp-1/.test(f.content)), 'pairing store holds only the DM-created request');
}
{
  const a = dtCell('head', 'S6a'), b = dtCell('head', 'S6b');
  assert('head-S6a-no-history', sawHist(a, 'G', 'alice') !== true, 'inherit: unmentioned bob line not recorded');
  assert('head-S6b-history-on-axis', sawHist(b, 'G', 'alice') === true, 'open axis: unmentioned bob line reaches the next prompt (record+replay on the new axis)');
}
{
  const r = dtCell('head', 'S7');
  assert('head-S7-tool-gated', v(r, 'G', 'bob', 'TOOL-TOUCH') === 'PERMISSION_PROMPTED', 'group-axis member triggers a tool call in shared session');
  assert('head-S7-bob-cannot-approve', v(r, 'G', 'bob', '/approve') === 'COMMAND_DENIED', 'bob (not in allowedUsers) cannot approve in shared session');
  assert('head-S7-alice-approves', v(r, 'G', 'alice', '/approve') === 'APPROVED_AND_ANSWERED', 'alice (allowedUsers) approves');
}
{
  const r = dtCell('head', 'S7u');
  assert('head-S7u-bob-approves-own', v(r, 'G', 'bob', '/approve') === 'APPROVED_AND_ANSWERED', 'per-user scope: bob approves his own turn');
}
{
  const r = dtCell('head', 'S8');
  assert('head-S8-tool-gated', v(r, 'G', 'bob', 'TOOL-TOUCH') === 'PERMISSION_PROMPTED', 'R1-1: empty allowedUsers + open axis still runs the turn');
  assert('head-S8-fail-closed-approve', v(r, 'G', 'bob', '/approve') === 'COMMAND_DENIED', 'R1-1: empty allowedUsers no longer means unrestricted in a decoupled shared session');
}

// ---- GitHub matrix ----
const ghCell = (arm, id) => gh.find((r) => r.arm === arm && r.id === id);
const gv = (r, login) => r?.probes.find((p) => p.login === login)?.verdict;
assert('gh-G0-base', gv(ghCell('base', 'G0'), 'Alice') === 'ANSWERED', 'base: mixed-case allowedUsers works (pre-existing normalization)');
assert('gh-G0-head', gv(ghCell('head', 'G0'), 'Alice') === 'ANSWERED', 'head: mixed-case allowedUsers still works');
assert('gh-G1-base-inert', gv(ghCell('base', 'G1'), 'Alice') !== 'ANSWERED', 'base: allowedGroupUsers key inert, Alice unanswered');
assert('gh-G1-head-fixed', gv(ghCell('head', 'G1'), 'Alice') === 'ANSWERED', 'B2 fixed end-to-end: mixed-case allowedGroupUsers answered at head');
assert('gh-G2-head', gv(ghCell('head', 'G2'), 'Alice') === 'ANSWERED', 'lowercase allowedGroupUsers answered at head');
assert('gh-G3-base', gv(ghCell('base', 'G3'), 'stranger') !== 'ANSWERED', 'base: stranger denied (keys inert)');
assert('gh-G3-head-open', gv(ghCell('head', 'G3'), 'stranger') === 'ANSWERED', 'head: open admits any commenter (N3 behavior, documented)');
assert('gh-G4-head-aggregate', gv(ghCell('head', 'G4'), 'stranger') === 'ANSWERED', 'head: aggregate lane unmentioned comment admitted under open (N3 boundary)');
assert('gh-G5-both-inert', gv(ghCell('base', 'G5'), 'stranger') !== 'ANSWERED' && gv(ghCell('head', 'G5'), 'stranger') !== 'ANSWERED', 'keys absent: aggregate lane quiet on both arms');

console.log(`\nTOTAL pass=${pass} fail=${fail}`);
fs.writeFileSync(`${A}/logs/e2e-assertions.json`, JSON.stringify({ pass, fail, fails }, null, 1));
process.exit(fail ? 1 : 0);
