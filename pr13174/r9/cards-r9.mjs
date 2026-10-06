// VERIFICATION RIG ONLY (PR #13174 round 9): summary card for head 0ea6f18afe.
import { writeFileSync } from 'node:fs';
const cards = [{
  file: '11-round9.png',
  title: 'PR #13174 round 9 @ 0ea6f18afe ("converge P1-1 and P1-2")',
  subtitle: 'Harness SIGKILLed mid-Turn, replacement adopted. Linux arm64 / MySQL 8.0.46 (+ macOS for B). Java unchanged (same jar as round 8). 0 leftover processes.',
  accent: '#f85149',
  blocks: [[
    '## Cancel while the Harness is down, mid model round                  first Turn      a later Turn',
    '!! Workspace Session (P1-1)                                            FIXED 5/5       wedged 2/2',
    '-- no-tool Session (B)                                                 not probed      REGRESSED 4/4',
    '   later Turn: every load 409 ("Checkpoint names a different Turn" / "takeover_unavailable");',
    '   CANCELLING 90-125 s+, next prompt 409, close 409.  Same death without cancel: failed, close 202.',
    '== unit witness (author test, parked Turn = Turn 2):  no-tool passes on 275f9348 sources, fails on 0ea6f18a',
  ], [
    '## P1-2  approval pending when the Harness dies (Workspace Session)       still wedged',
    '-- allow 2/2:  Action decided, Turn RUNNING 120 s+, write_file never runs',
    '-- cancel 2/2, allow-then-cancel 1/1:  CANCELLING; replacement /cancel -> 409 on every retry',
    '-- do nothing 1/1:  RUNNING past turn deadline and Action expiry',
    '   Java never sends the cancellationTakeover load: the Turn stays on its live plain-attach',
    '   coordination, so cancel goes cancelAdmittedTurn -> harness.cancel -> 409 ("awaits lease renewal")',
  ], [
    '## unchanged',
    '   A (no-tool, no cancel): recovery_blocked, close 202;  C (D4 + cancel) completes',
    '++ existing inflight / continuation / session, harness-only session and continuation pass',
    '!! F5 post-takeover writer-lease lapse: 3 of 7 takeover runs at host load 5-8 (freeze 1/3, harness-inflight 1/2)',
    '++ CI 31 green;  TS hosted suites 266/266 (CI does not run any cancel-after-death arm)',
  ]],
  note: 'Not ready to merge: the round-8 fix for B regressed, and P1-1 / P1-2 still wedge a Session that can never be closed.',
}];
writeFileSync(new URL('./cards.json', import.meta.url), JSON.stringify(cards, null, 1));
console.log('cards.json (r9) written');
