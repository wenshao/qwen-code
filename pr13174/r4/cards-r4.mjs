// VERIFICATION RIG ONLY (PR #13174 round 4): summary card for head 98cb1e8598.
import { writeFileSync } from 'node:fs';
const cards = [{
  file: '06-round4.png',
  title: 'PR #13174 round 4 @ 98cb1e8598 (merged main 6136786; real Spring + Harness + MySQL)',
  subtitle: 'Probe = --session-failover --harness-only; the Harness is SIGKILLed while Turn 2\'s model stream is open. Linux arm64 / MySQL 8.0.46 and macOS arm64 / MySQL 8.4.7.',
  accent: '#f85149',
  blocks: [[
    '## A. no cancel (README path)                                  macOS 2/2, Linux 2/2',
    '   Turn 2  FAILED  managed_runtime_recovery_blocked (model_start)',
    '   Turn 3, Turn 4  FAILED  managed_runtime_recovery_blocked     in 232-678 ms, 0 model calls',
    '++ POST /close -> 202, session "closed";  new Session -> turn.completed "LATER_TURN_OK"',
    '== matches the README: "close it and start a new Session"',
  ], [
    '## B. user cancels Turn 2 while the Harness is dead (new cancellation-only plain attach)   macOS 3/3, Linux 2/2',
    '-- Turn 2  FAILED  hosted_harness_generation_mismatch          (not cancelled)',
    '-- Turn 3  ACCEPTED forever: POST /prompt -> 409 every retry, backoff capped at 60 s, submission mark set so no budget',
    '-- Turn 4  submit -> 409 turn_active',
    '-- POST /close -> 409, session stays "active"',
    '-- escape: cancel Turn 3 -> stays CANCELLING for 90 s+;  close again -> 409',
    '== by code: r3 (7fe5050d) declined every no-tool takeover load model_start; r4 plain-attaches the passive one,',
    '== then the coordinator bind refuses (turn carries an epoch) and the attached session is blocked',
  ], [
    '## rest of round 4                                             result',
    '++ freeze arm head 5/5 (M1 2/2 pass, accepted as optional)   harness-only session 3/3+3/3, inflight 3/3, continuation 10/10',
    '++ existing inflight / continuation / session                3/3 / 5/5 / 2/2',
    '++ D4 lost reply 2/2;  rollback probe as designed;  CI green; Java 31/31 + 72/72; TS 1601/1601 x2',
    '== D4 + cancel in window: still diverges (2/2), recorded as Step 3 scope by the author',
  ]],
  note: 'New in this round: cancelling a mid-model-round Turn after a Harness death wedges the Session with no public escape (cannot close). Without the cancel, the behavior now matches the README exactly.',
}];
writeFileSync(new URL('./cards.json', import.meta.url), JSON.stringify(cards, null, 1));
console.log('cards.json (r4) written');
