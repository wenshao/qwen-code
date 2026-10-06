// VERIFICATION RIG ONLY (PR #13174 round 7): summary card for head 7e95fdcc7c (merge of main b2c95e04 / H3).
import { writeFileSync } from 'node:fs';
const cards = [{
  file: '09-round7.png',
  title: 'PR #13174 round 7 @ 7e95fdcc7c (= 257e6b08 + main b2c95e04, H3 background Shell/Monitor)',
  subtitle: 'Clean merge (empty remerge-diff). Both hosts clean: 0 leftover processes before/after, Linux load 2-5. macOS / MySQL 8.4.7, Linux arm64 / MySQL 8.0.46.',
  accent: '#e3b341',
  blocks: [[
    '## unchanged from round 6',
    '-- B. cancel after a mid-model-round death      macOS 2/2, Linux 1/1  CANCELLING forever, close 409',
    '++ C. D4 lost reply + cancel                      macOS 2/2, Linux 1/1  turn.completed "D4_TURN_ANSWER", Turn 3 completes',
    '++ A. same death, no cancel                       macOS 1/1             recovery_blocked, close 202',
    '++ D4 lost reply 1/1;  rollback as designed',
  ], [
    '## arms (Linux, clean)                            result',
    '++ --session-failover --harness-only             2/2 Linux, 2/2 macOS',
    '++ --inflight / --continuation --harness-only    3/3, 5/5',
    '++ existing --inflight / --continuation / --session   2/2, 3/3, 2/2',
    '!! --continuation-failover --freeze (D7)         2/3: the failure is the post-takeover lease lapse',
    '!!   (replacement stops renewing; writer grant stale) -- the F5 shape, now seen on a clean host',
  ], [
    '## CI and units',
    '++ CI: Hosted MySQL (all failover arms), Test, Lint green; 27 checks pass',
    '!! windows-latest / Java 21 red: ManagedCsiAcknowledgementHttpTransportTest (main #13289, timing);',
    '!!   passes on main\'s last 6 runs incl. b2c95e04 -> re-run',
    '++ Java 33/33 + 86/86;  TS hosted suites 257/257',
  ]],
  note: 'The main merge changes nothing for this PR. One blocker remains (B); F5 stays a watch item.',
}];
writeFileSync(new URL('./cards.json', import.meta.url), JSON.stringify(cards, null, 1));
console.log('cards.json (r7) written');
