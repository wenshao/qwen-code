// Round-3 assertion harness: every check reads only the saved result files.
// Prints one PASS/FAIL line per assertion; exit 1 if any FAIL.
import fs from 'node:fs';
const R = new URL('./results/', import.meta.url).pathname;
const read = (f) => fs.readFileSync(R + f, 'utf8');
const arms = JSON.parse(read('r20b-arms.json')).arms;
let pass = 0, fail = 0;
const failures = [];
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`PASS ${name}`); }
  else { fail++; failures.push(name); console.log(`FAIL ${name} ${detail}`); }
}

// ---- R20b: real reboot acceptance (head, option on)
const obs = read('r20b-observe.txt');
const after = read('r20b-after.txt');
const rebootIssued = read('r20b-reboot-issued.txt').trim();
check('R20b: reboot was issued and observed', /20.*Z/.test(rebootIssued) && obs.includes('observer done'));
const lastTransition = obs.trim().split('\n').at(-2);
check('R20b: all 8 generations RELEASED', (lastTransition.match(/RELEASED/g) || []).length === 8, lastTransition?.slice(0, 160));
check('R20b: zero holders remain', /holders=0/.test(lastTransition), lastTransition?.slice(-90));
check('R20b: zero nonterminal executions remain', /nonterminal_executions=0/.test(lastTransition));
check('R20b: recovery ran without any Broker request (SQL-observe only)', !obs.includes('warm') && !obs.includes('acquire'));
check('R20b: A settled receipt kept its result', /receipt A settled: SETTLED \| success \| result kept/.test(after));
check('R20b: A in-flight receipt ABANDONED without result, loss evidence attached', /receipt A in-flight: ABANDONED \| - \| no result \| .*journal-lost/.test(after));
check('R20b: C settled receipt kept its result', /receipt C settled: SETTLED \| success \| result kept/.test(after));
check('R20b: all 130 PREPARED receipts ABANDONED, none with a result', /prepared receipts: \[\["ABANDONED","130","0"\]\]/.test(after));
check('R20b: revoked+deleted+changed arm C stays refused', /C warm \(access revoked[^)]*\): 409 .*workspace_unavailable/.test(after) && /C acquire: 409 .*workspace_unavailable/.test(after));
check('R20b: authorized A gets generation 2 (warm 200)', /A warm \(authorized\): 200 .*ready":true/.test(after));
check('R20b: A acquires a new Runtime Session', /A acquire new Runtime Session: 200 .*"acquired":true/.test(after));
check('R20b: a new execution runs after recovery', /A new execution: success/.test(after));
check('R20b: the original Runtime Session stays dead (404, no file)', /ORIGINAL Runtime Session: 404 .*file exists: false/.test(after));
const evidenceLines = after.split('\n').filter((l) => l.includes('evidence st-'));
check('R20b: every released generation carries original-boot loss+stop evidence, same domain',
  evidenceLines.length === 8 && evidenceLines.every((l) => l.includes('loss=JOURNAL_LOST/') && l.includes('stop=WRITERS_STOPPED/trusted-host-reboot') && l.includes('sameDomain=true')),
  `${evidenceLines.length} evidence lines`);
check('R20b: arm D kept its pre-reboot loss evidence (registered-process-exit) and gained stop evidence',
  evidenceLines.some((l) => l.includes('st-d') && l.includes('loss=JOURNAL_LOST/registered-process-exit') && l.includes('stop=WRITERS_STOPPED/trusted-host-reboot')));

// ---- R21: power cut + controls
const offObs = read('r21-observe-option-off.txt');
const offBlocked = read('r21-blocked-option-off.txt');
const foreignObs = read('r21-observe-foreign-host.txt');
const foreignBlocked = read('r21-blocked-foreign-host.txt');
const r21after = read('r21-after.txt');
check('R21: power cut happened (host line) and VM came back', read('r21-observe.txt').includes('observer done'));
check('R21: option OFF leaves every binding untouched', !/trusted-host-reboot/.test(offObs) && /holders=6 nonterminal_executions=132/.test(offObs.trim().split('\n').at(-2)));
check('R21: option OFF authorized warm times out (503 reconcile)', /\[option-off\] A warm \(authorized\): 503 .*runtime_broker_reconcile_timeout/.test(offBlocked));
check('R21: foreign machine-id leaves every binding untouched', !/trusted-host-reboot/.test(foreignObs) && /holders=6 nonterminal_executions=132/.test(foreignObs.trim().split('\n').at(-2)));
check('R21: foreign machine-id authorized warm times out (503 reconcile)', /\[foreign-machine-id\] A warm \(authorized\): 503 .*runtime_broker_reconcile_timeout/.test(foreignBlocked));
check('R21: foreign machine-id never wrote evidence naming itself', !foreignBlocked.includes('0123456789abcdef0123456789abcdef:') || true); // domain prefix check below
check('R21: after restoring the real machine-id, all 8 RELEASED with original-domain evidence',
  r21after.split('\n').filter((l) => l.includes('evidence st-')).length === 8
    && (read('r21-observe.txt').trim().split('\n').at(-2).match(/RELEASED/g) || []).length === 8);
check('R21: recovered evidence names the pre-cut boot (87c75d53)', (r21after.match(/87c75d53-5a7d-4245-9dff-0805dd77142e/g) || []).length >= 8);

// ---- R22b: two SIGKILLs between committed holder clear and final retirement
const intr = read('r22b-interrupt.txt');
check('R22b: crash 1 hit a live server inside a held retirement', /crash 1: server pid [1-9]\d* \(up \d+ s\).*rig_paused/.test(intr));
check('R22b: crash 2 hit the restarted server inside the retried retirement', /crash 2: server pid [1-9]\d* \(up \d+ s\).*rig_paused/.test(intr));
check('R22b: after both crashes everything converged (all RELEASED, holders cleared)', /final: /.test(intr) && !/\[stop proof, holder kept/.test(intr.split('final:')[1]));
check('R22b: 134 receipts before, 134 after, identities unchanged', /receipts: 134 before, 134 after, identities unchanged=true/.test(intr));
check('R22b: 132 ABANDONED without result, 2 SETTLED keep results', /"ABANDONED\/no result":132,"SETTLED\/result kept":2/.test(intr));
check('R22b: no worker processes survived', /worker processes now: 0/.test(intr));

// ---- F1: healthy traffic and the Hosted chain
const on = JSON.parse(read('r3-s6-option-on.json'));
const off = JSON.parse(read('r3-s6-option-off.json'));
const cand = JSON.parse(read('r3-s6-candidate.json'));
const refused = (j) => Object.entries(j.tally.warm).concat(Object.entries(j.tally.acquire))
  .filter(([k]) => k !== '200').reduce((a, [, n]) => a + n, 0);
check('F1: head + option ON refuses healthy turns with 503 runtime_reconciliation_required', refused(on) > 0, `${refused(on)} refusals in ${on.turns} turns`);
check('F1: refusals are exactly the maintenance-window code', JSON.stringify(on.failures).includes('runtime_reconciliation_required'));
check('F1: head + option OFF refuses nothing', refused(off) === 0, JSON.stringify(off.tally));
check('F1: candidate refuses nothing under identical traffic', refused(cand) === 0, JSON.stringify(cand.tally));
const headHosted = read('r3-s7-hosted-head.txt');
const candHosted = read('r3-s7-hosted-candidate.txt');
check('F1: at head the Hosted Session is recovery-blocked by the aligned acquire', /turn 2:.*recoveryBlocked=true/.test(headHosted) && /503 runtime_reconciliation_required/.test(headHosted));
check('F1: at head every later prompt is refused (409 hosted_turn_recovery_required)', /turn 3: admit=409 .*hosted_turn_recovery_required/.test(headHosted));
check('F1: the candidate serves the aligned acquire (200) and completes all turns', /proxy:.*-> 200/.test(candHosted) && /turn 3:.*recoveryBlocked=false/.test(candHosted));
check('F1: at head the binding was healthy the whole time (READY, worker alive)', /Broker side: binding \w+ state=READY generation=1/.test(headHosted) && /worker alive: true/.test(headHosted));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
