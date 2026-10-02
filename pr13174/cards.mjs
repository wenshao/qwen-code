// VERIFICATION RIG ONLY (PR #13174): figure card content. Usage: node cards.mjs '<json of counts>'
import { writeFileSync } from 'node:fs';
const c = JSON.parse(process.argv[2]);
const n = (label) => { const x = c[label] ?? { pass: 0, fail: 0, other: 0 }; return `${x.pass}/${x.pass + x.fail + x.other}`; };
const hcPass = (c['lx-harness-continuation']?.pass ?? 0) + (c['lx-hc-rep']?.pass ?? 0);
const hcAll = ['lx-harness-continuation', 'lx-hc-rep'].reduce((s, k) => s + (c[k] ? c[k].pass + c[k].fail + c[k].other : 0), 0);
const freezeFail = ['lx-freeze', 'lx-freeze-orig', 'lx-freeze-orig2'].reduce((s, k) => s + (c[k]?.fail ?? 0), 0);
const freezeAll = ['lx-freeze', 'lx-freeze-orig', 'lx-freeze-orig2'].reduce((s, k) => s + (c[k] ? c[k].pass + c[k].fail + c[k].other : 0), 0);
const cards = [
  {
    file: '01-adoption.png',
    title: 'PR #13174 G3 adoption: base a7deb01 vs head dcfa0b8 (real Spring + Harness + MySQL)',
    subtitle: 'PR runner arms, unmodified. macOS arm64 / MySQL 8.4.7 (host load 20-37) and Linux arm64 / MySQL 8.0.46 (idle rk3588). Harness SIGKILLed, Spring kept alive.',
    accent: '#56d364',
    blocks: [[
      '## arm                                         base a7deb01             head dcfa0b8',
      '   --session-failover --harness-only          0/2 macOS (gen mismatch)  6/6 macOS, 3/3 Linux',
      '   --inflight-failover --harness-only         -                        3/3 Linux',
      '   --continuation-failover --harness-only     -                        9/13 Linux  (flaky, see note)',
      '   --inflight-failover (pre-existing)         -                        3/3 Linux',
      '   --continuation-failover (pre-existing)     9/10 Linux               12/13 Linux',
      '   --session-failover (newly wired)           -                        2/2 Linux, 3/3 macOS',
      '-- --continuation-failover --freeze (D7)      -                        0/5 Linux',
      '== continuation failures = writer grant lapses, Turn stuck RUNNING: before the restart (base 1, head 1)',
      '==   or the replacement stops renewing ~1 s after takeover (head 4/26, base 0/10)',
    ], [
      '## base: Turn 2 after the Harness restart (the documented before-state)',
      '-- turn_e8e12fd2...  FAILED  hosted_harness_generation_mismatch',
      '## head: the same arm',
      '   "firstHarnessBootId":       "ce82f11d-9870-4acb-b71e-b0396b8388ff",',
      '   "replacementHarnessBootId": "ae2a8bf8-5f98-4505-b3d4-daba26b3005f",',
      '++ "writerGeneration": "1 -> 2",  "journalRevision": "8 -> 14",  "committedSequence": "9 -> 17",',
      '++ "terminalTurns": 2,  "restoredFirstTurnContext": true,  "oldHarnessDiskDeleted": true',
    ], [
      '## D9c probe: Harness restarted onto the base build, then rolled forward (same Session)',
      '   turn2 on base-build Harness   turn.failed  hosted_harness_protocol_error   1307 ms  journal 1/8/9 untouched',
      '   turn3 on base-build Harness   turn.failed  hosted_harness_protocol_error    140 ms  journal 1/8/9 untouched',
      '== Spring log: DaemonProtocolException: Endpoint does not advertise managed_session_journal_delta_v1',
      '++ turn4 after roll-forward      turn.completed  "LATER_TURN_OK"               771 ms  writer gen 1 -> 2',
      '++ turn5 after roll-forward      turn.completed  "LATER_TURN_OK"               448 ms',
    ]],
    note: 'Adoption works: the boot ID moves with no Spring restart and Turn 1 context survives. A rolled-back Harness fails closed per Turn and the Session recovers on roll-forward. The D7 arm is red on every run (card 3). The continuation scenario flakes on this arm64 host on both builds; the post-takeover shape was seen only on head.',
  },
  {
    file: '02-model-round-restart.png',
    title: 'Harness restart during a model round leaves the Session unusable',
    subtitle: 'Probe = --session-failover --harness-only, but the Harness is SIGKILLed while the fake model holds Turn 2\'s stream open; then Turns 3 and 4 are new prompts on the same Session.',
    accent: '#f85149',
    blocks: [[
      '## head dcfa0b8 (no-tool Session; 3/3 macOS, 2/2 Linux)',
      '   turn_b225ffef  COMPLETED                                   (Turn 1)',
      '!! turn_6007b8bb  FAILED  managed_runtime_recovery_blocked    (Turn 2, interrupted)  after 6255 ms',
      '-- turn_08dce8b5  FAILED  managed_runtime_recovery_blocked    (Turn 3, new prompt)   after  241 ms',
      '-- turn_c84ecc22  FAILED  managed_runtime_recovery_blocked    (Turn 4, new prompt)   after  122 ms',
      '== error_message (all three): The prior Harness generation parked a Turn this Harness cannot take over (model_start).',
      '-- model requests for Turns 3-4: 0      writer generation 2 -> 3 -> 4 (each refused takeover load re-acquires and leaves)',
    ], [
      '## base a7deb01 (same probe)',
      '   turn_ea07bfcd  COMPLETED                                   (Turn 1)',
      '   turn_1b15dd18  FAILED  hosted_harness_generation_mismatch  (Turn 2)  after 113 ms',
      '-- turn_568f581e  ACCEPTED                                    (Turn 3)  no terminal event in 150 s',
    ], [
      '## why',
      '   every Turn on a bound Session attaches via the takeover load  (HarnessCoordinator.java:251-255)',
      '   the load finds the dead Turn\'s prompt still unsettled (unsettledPromptId) and declines',
      '     no-tool Session: hosted-harness-session.ts:1181-1185 -> recoveryDeclined(res, \'model_start\')',
      '   nothing settles that prompt, so the decline repeats for every later Turn',
    ]],
    note: 'Not a regression (base hangs), but the README now says a live control plane adopts the new generation and Turns continue. Settling the declined prompt in the journal would return the Session to idle.',
  },
  {
    file: '03-d7-freeze-arm.png',
    title: 'D7 frozen former-owner arm: red on every run, and blind to a fencing regression',
    subtitle: 'Linux arm64, MySQL 8.0.46, host load 2-4. Original arm = npm run test:e2e:managed-continuation-frozen-owner-failover at dcfa0b8.',
    accent: '#e3b341',
    blocks: [[
      `-- original arm: 0/${freezeAll}   Frozen former Harness mutated the takeover after waking: head=2 36 37->2 52 53`,
      '## journal tx after the wake (probe dump): all written by the REPLACEMENT, about every 330 ms',
      '   rev  gen  writer_id (= replacement boot id)       command_id',
      '   37   2    e8e6410e-4e5e-4f7c-9ca0-32bb4426a419    7bf88244-...:active:renewal:10',
      '   38   2    e8e6410e-4e5e-4f7c-9ca0-32bb4426a419    7bf88244-...:active:renewal:11',
      '   ...  (16 renewals in 5 s)',
      '!! control: same run WITHOUT SIGCONT fails identically (2 36 37 -> 2 52 53)',
    ], [
      '## why a corrected assertion is still blind: the woken Harness has no store to talk to',
      '   Spring A = the former Harness\'s Session Store endpoint; the arm SIGKILLs it',
      '   woken Harness A: "Managed Session Store request failed: fetch failed" -> stops; 0 requests reach a store',
      '',
      '## mutation matrix (M1 = ManagedSessionStore.requireWriter returns immediately)',
      '                     arm topology (Spring A dead)       store reachable via forwarder',
      '   head jar          pass (0 store calls)               pass: woken writers:renew -> 409, 0 tx',
      '!! M1 jar            PASS = blind                       FAIL: woken writers:renew -> 200 (detected)',
    ], [
      '## candidate fix (runner only): forwarder in front of Spring A\'s store URL, assert on writer_id + store status',
      `++ head jar: ${n('cand2-head')} pass (woken writers:renew -> 409)      M1 jar: ${c['cand2-m1'].fail}/${c['cand2-m1'].pass + c['cand2-m1'].fail} fail (renew -> 200 detected)`,
    ]],
    note: 'The writer-level fence itself works (409 to the woken owner). The gate as written cannot pass and cannot detect a regression; step 20 would turn hosted-harness-mysql red.',
  },
];
writeFileSync(new URL('./cards.json', import.meta.url), JSON.stringify(cards, null, 1));
console.log('cards.json written');
