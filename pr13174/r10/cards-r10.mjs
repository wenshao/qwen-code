// VERIFICATION RIG ONLY (PR #13174 round 10): summary card for heads e469476cb1 -> 8fefd4c9b8 -> 5a2c594913.
import { writeFileSync } from 'node:fs';
const cards = [{
  file: '12-round10.png',
  title: 'PR #13174 round 10 @ 5a2c594913 (R9 + R9-2 + R9-3, verified head by head)',
  subtitle: 'Harness SIGKILLed mid-Turn, replacement adopted. Linux arm64 / MySQL 8.0.46 (load-gated) + macOS. Three heads pushed during this round; each one rebuilt and re-probed. 0 leftover processes.',
  accent: '#e3b341',
  blocks: [[
    '## Cancel while the Harness is down, mid model round              first Turn     later Turn     next Turn',
    '++ no-tool Session (B)                                             -              FIXED 7/7      completes',
    '++ Workspace Session (P1-1)                                        FIXED 3/3      FIXED 4/4      completes',
  ], [
    '## P1-2  approval pending when the Harness dies             e469476cb1        8fefd4c9b8              5a2c594913',
    '!! allow (or deny), then cancel                             wedged 2/2        old Turn ends,          FIXED 3/3: cancelled,',
    '                                                            (attached load)   next Turn FAILS 4/4     next Turn completes,',
    '                                                                                                      approved write never runs',
    '-- cancel while still requested                             wedged            wedged                  wedged (author: B2)',
    '!!   new since R9: /cancel 409 + takeover load 200 every ~500 ms (~4 req/s per wedged Session) while CANCELLING',
    '-- allow only / let it expire                               wedged            wedged                  wedged (author: B2)',
  ], [
    '## unchanged / other',
    '++ A, C (D4 + cancel), D4, rollback as designed;  freeze 6/6, existing and harness-only arms pass',
    '!! F5 post-takeover lease lapse: 1 of 19 takeover runs (plus 1 phase-1 lapse at load ~10)',
    '== duplicate cancellation load after the settle answers 409 "event id ... already committed" (benign, 3/3)',
    '== CI Test red: 2 ACP Session tests that fail identically on main fd4af700c4 (PR does not touch acp-integration)',
  ]],
  note: 'Still not ready: the cancel-while-requested and allow/expiry rows of P1-2 still wedge the Session (author defers them to B2), and the first one now hot-loops.',
}];
writeFileSync(new URL('./cards.json', import.meta.url), JSON.stringify(cards, null, 1));
console.log('cards.json (r10) written');
