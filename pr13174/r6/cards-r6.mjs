// VERIFICATION RIG ONLY (PR #13174 round 6): summary card for head 257e6b0812.
import { writeFileSync } from 'node:fs';
const cards = [{
  file: '08-round6.png',
  title: 'PR #13174 round 6 @ 257e6b0812 (R8-R11 rounds + main merges)',
  subtitle: 'Harness SIGKILLed mid model round (B) or after a dropped 202 (C). macOS arm64 / MySQL 8.4.7 and Linux arm64 / MySQL 8.0.46.',
  accent: '#e3b341',
  blocks: [[
    '## C. D4 lost reply + user cancel in the window             FIXED   macOS 4/4, Linux 2/2',
    '++ the cancelled Turn ends turn.completed with generation 1\'s own answer "D4_TURN_ANSWER";',
    '++ Turn 3\'s model context carries the same answer, so transcript == context (the round-3 divergence is gone too)',
  ], [
    '## B. user cancels while the Harness is dead mid model round  STILL WEDGED   macOS 3/3, Linux 2/2',
    '-- cancellation-only load -> 409 hosted_turn_recovery_required  ("load refused (takeover_unavailable): profile=none")',
    '-- Spring: DaemonHttpException, submission mark set -> retried forever at the 60 s cap (retry 11+)',
    '-- Turn 2 CANCELLING forever; Turn 3/4 -> 409 turn_active; POST /close -> 409; escape (cancel, wait 90 s, close) -> 409',
    '== hosted-harness-session.ts:2027-2034 calls it a placeholder: "the cancel path re-issues when the tools to settle exist"',
    '== -- on a no-tool Session they never exist',
  ], [
    '## the asymmetry',
    '++ A. same death, NO cancel: Turn 2 recovery_blocked (model_start), Turn 3 refused fast, close 202, new Session OK',
    '-- B. same death, user cancels: the Session can never be closed',
  ], [
    '## rest of round 6',
    '++ D4 lost reply 5/5;  rollback as designed;  harness-only session 2/2 + 2/2;  CI on 257e6b08 all green (Hosted MySQL 7 failover steps)',
    '++ Java units 33/33 + 86/86 (coordinator 52/52);  TS hosted suites 244/244 on a clean macOS rerun',
    '!! Linux arm timing this round is not usable: my D4/rollback probes leaked their stacks (process.exit before the runner',
    '!! teardown, since round 3; now fixed, 0 leftovers) and a JDK build drove the Linux host to load 12. Lease lapses hit',
    '!! pre-existing arms too (session, continuation phase 1) -- the 1 s test lease, not this PR.',
  ]],
  note: 'C is fixed and consistent. B still needs the no-tool cancellation load to end the Turn (typed decline as in round 3) instead of parking it forever.',
}];
writeFileSync(new URL('./cards.json', import.meta.url), JSON.stringify(cards, null, 1));
console.log('cards.json (r6) written');
