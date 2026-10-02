// VERIFICATION RIG ONLY (PR #13174 round 3): summary card for head 7fe5050d6d.
import { writeFileSync } from 'node:fs';
const cards = [{
  file: '05-round3.png',
  title: 'PR #13174 round 3 @ 7fe5050d6d (merged main f5c9bf8; real Spring + Harness + MySQL)',
  subtitle: 'Linux arm64 / MySQL 8.0.46 (rk3588) and macOS arm64 / MySQL 8.4.7. PR runner arms unmodified; M1 = ManagedSessionStore.requireWriter returns immediately.',
  accent: '#e3b341',
  blocks: [[
    '## D7 frozen former-owner arm (replacement now inherits the original Spring port)   head jar     M1 jar (store fencing OFF)',
    '++ PR arm                                                                            5/5 pass     ',
    '!! PR arm                                                                                         3/3 pass',
    '== woken Harness A, head: "The Managed Session writer grant is stale or unavailable."   <- the STORE refused it',
    '== woken Harness A, M1:   "writer generation changed during renewal."               <- the CLIENT refused it',
    '   -> the end-to-end fence is now proven; the store-side fence alone is still not pinned by the gate',
  ], [
    '## D4 lost reply (new probe: proxy drops the 202 of an admitted prompt, Harness restarted, retry released)',
    '++ macOS 3/3: withdraw logged, resubmit -> 202 replay, Turn completes "D4_TURN_ANSWER", 1 model call, 0 gen-2 admissions',
    '-- + user cancel inside the window (2/2): Spring turn CANCELLED (no output), but gen 1 had admitted + answered it;',
    '--   Turn 3\'s model request contains that "cancelled" prompt AND its answer',
  ], [
    '## Harness restart mid model round, then Turns 3-4 (F2)     unchanged',
    '-- macOS 2/2, Linux 2/2: Turn 2 recovery_blocked (model_start); Turns 3-4 refused in 228-674 ms, 0 model calls',
  ], [
    '## arms this round                                          result',
    '++ --session-failover --harness-only                        3/3 Linux, 3/3 macOS',
    '++ --inflight-failover --harness-only                       3/3',
    '++ --continuation-failover --harness-only                   10/10',
    '++ --inflight / --continuation / --session (existing)       3/3 / 5/5 / 2/2',
    '++ D9c rollback probe (macOS)                               fails closed on base build, recovers on roll-forward',
    '== F5 post-takeover lease lapse: 1 of 31 continuation-scenario runs (was 2/28, then 4/26)',
    '++ CI on 7fe5050d: SDK Java, Test, Lint, Serve A/B green; Java units 24/24 + 42/42',
  ]],
  note: 'Much better: the D7 gate now meets a live store and D4 holds end to end. Left: the mid-model-round brick (README claim), and a cancel inside the lost-reply window diverging the transcript from the model context.',
}];
writeFileSync(new URL('./cards.json', import.meta.url), JSON.stringify(cards, null, 1));
console.log('cards.json (r3) written');
