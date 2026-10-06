// VERIFICATION RIG ONLY (PR #13174 round 8): summary card for head 275f934824.
import { writeFileSync } from 'node:fs';
const cards = [{
  file: '10-round8.png',
  title: 'PR #13174 round 8 @ 275f934824 ("settle the no-tool cancellation takeover", Arm B)',
  subtitle: 'Harness SIGKILLed while Turn 2\'s model stream is open; the user cancels Turn 2 while it is down. macOS / MySQL 8.4.7 and Linux arm64 / MySQL 8.0.46. 0 leftover processes on both hosts.',
  accent: '#56d364',
  blocks: [[
    '## B. cancel after a mid-model-round death        FIXED   macOS 4/4, Linux 2/2',
    '++ Turn 2   turn.cancelled  after ~6 s (macOS) / ~13 s (Linux, loaded host)',
    '++ Turn 3, Turn 4   turn.completed "LATER_TURN_OK"   -- the Session keeps serving',
    '++ their model context: no cancelled prompt, no "MODEL_ROUND_PARTIAL" fragment',
    '++ POST /close -> 202 "closed";  new Session -> turn.completed',
    '== rounds 4-7: FAILED generation_mismatch / CANCELLING forever / 409 forever, close 409',
  ], [
    '## unchanged and holding',
    '   A. same death, no cancel (documented slice boundary): recovery_blocked, Turn 3 refused, close 202  (macOS 2/2, Linux 1/1)',
    '++ C. D4 lost reply + cancel: turn.completed with gen-1 answer, Turn 3 completes (macOS 2/2, Linux 1/1 *)',
    '++ D4 lost reply 2/2;  rollback as designed',
  ], [
    '## arms (Linux)                                   result',
    '++ freeze (D7) 4/6 *, harness-only session 2/2+2/2, inflight 3/3, continuation 5/5',
    '++ existing inflight / continuation / session 2/2, 3/3, 2/2',
    '== * 2 freeze runs and 1 D4+cancel run hit writer-lease lapses during an external load spike on the host',
    '==   (load 11-12; both freeze failures died in phase 1, before any takeover code runs); re-run at load ~5: freeze 3/3, D4 2/2',
    '++ CI: 31 checks green incl. Hosted MySQL (all failover arms) and windows-latest / Java 21',
    '++ Java 34/34 + 86/86;  TS hosted suites 258/258',
  ]],
  note: 'No blocker found this round. Remaining watch item: the occasional post-takeover writer-lease lapse (F5), last seen on a clean host in round 7.',
}];
writeFileSync(new URL('./cards.json', import.meta.url), JSON.stringify(cards, null, 1));
console.log('cards.json (r8) written');
