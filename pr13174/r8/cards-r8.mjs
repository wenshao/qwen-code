// VERIFICATION RIG ONLY (PR #13174 round 8): summary card for head 275f934824.
import { writeFileSync } from 'node:fs';
const cards = [{
  file: '10-round8.png',
  title: 'PR #13174 round 8 @ 275f934824 ("settle the no-tool cancellation takeover", Arm B)',
  subtitle: 'Harness SIGKILLed mid-Turn, replacement adopted. macOS / MySQL 8.4.7 and Linux arm64 / MySQL 8.0.46. 0 leftover processes on both hosts.',
  accent: '#f85149',
  blocks: [[
    '## B. no-tool Session: cancel after a mid-model-round death      FIXED   macOS 4/4, Linux 2/2',
    '++ Turn 2 turn.cancelled (~6 s);  Turns 3, 4 turn.completed;  close 202',
    '++ later model context: no cancelled prompt, no partial fragment',
  ], [
    '## re-review P1s, reproduced on the real stack (Workspace Session, Linux)',
    '-- P1-1  model round before the first tool call, cancel while the Harness is down     3/3 wedged',
    '--       every load 409 "Checkpoint names a different Turn (null)";  CANCELLING 125 s+;  close 409',
    '         (same death, no cancel: turn.failed recovery_blocked, close 202)',
    '-- P1-2  approval pending when the Harness dies (approval mode "default", write_file)',
    '--       allow after takeover   Action decided, Turn RUNNING 120 s+, file never written    2/2',
    '--       cancel                 CANCELLING; replacement /cancel -> 409 on every retry      1/1',
    '--       do nothing             RUNNING past turn deadline (60 s) and Action expiry (45 s)  2/2',
    '--       all: next prompt 409 turn_active, close 409 turn_active',
  ], [
    '## unchanged and holding',
    '   A (no-tool, no cancel): recovery_blocked, close 202 as documented',
    '++ C (D4 + cancel) completes with gen-1 answer;  D4 2/2;  rollback as designed',
    '++ freeze, harness-only, existing arms pass (3 lease lapses during a host load spike; calm re-run 5/5)',
    '++ CI: 31 checks green incl. Hosted MySQL and windows-latest / Java 21;  unit tests green',
  ]],
  note: 'Not ready to merge: two Workspace-Session paths still leave a Session that can never be closed. By the same criterion as B.',
}];
writeFileSync(new URL('./cards.json', import.meta.url), JSON.stringify(cards, null, 1));
console.log('cards.json (r8) written');
