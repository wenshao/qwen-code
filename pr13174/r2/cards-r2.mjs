// VERIFICATION RIG ONLY (PR #13174 round 2): one summary card for head 5ffd2ed4ed.
import { writeFileSync } from 'node:fs';
const cards = [{
  file: '04-round2.png',
  title: 'PR #13174 round 2 @ 5ffd2ed4ed (merged main 8eaaa13; real Spring + Harness + MySQL)',
  subtitle: 'Linux arm64 / MySQL 8.0.46 (idle rk3588) and macOS arm64 / MySQL 8.4.7. PR runner arms unmodified; M1 = ManagedSessionStore.requireWriter returns immediately.',
  accent: '#e3b341',
  blocks: [[
    '## D7 frozen former-owner arm (F1)                      head jar          M1 jar (fencing OFF)',
    '++ PR arm, new old-generation-tx assertion              5/5 pass          ',
    '!! PR arm, same run                                                       3/3 PASS = still blind',
    '== output head: "fencedFormerWriter": true, "oldGenerationTx": "24" (unchanged across wake)',
    '== output M1:   "fencedFormerWriter": true, "oldGenerationTx": "25" (unchanged across wake)',
    '++ candidate forwarder patch (rebased, +143/-31)        2/2 pass (+1 F5)  2/2 FAIL: renew -> 200 detected',
  ], [
    '## Harness restart mid model round, then Turns 3-4 (F2)   unchanged',
    '-- macOS 2/2, Linux 2/2: Turn 2 recovery_blocked (model_start); Turns 3-4 refused in 116-583 ms, 0 model calls',
  ], [
    '## arms (Linux unless noted)                            round 2',
    '++ --session-failover --harness-only                    3/3 Linux, 3/3 macOS',
    '++ --inflight-failover --harness-only                   3/3',
    '!! --continuation-failover --harness-only               9/10',
    '++ --inflight / --continuation / --session (existing)   3/3 / 5/5 / 2/2',
    '++ D9c rollback probe (macOS)                           base-build Harness: protocol_error, journal untouched; roll-forward: 2 Turns complete',
    '== F5 post-takeover lease lapse: 2/28 continuation-scenario runs this round (6/54 head total, 0/10 base)',
  ], [
    '## merge with #13129 (F3)',
    '++ takeover = !session.hooks && takeoverFlags     runtimeLeaseHeld = executions[0]?.runtimeSessionId ?? promptId',
    '!! originalRuntimeBroker RecoveryDeclined (incl. Shell under mcpServers) -> terminal "batch_not_durable"',
    '++ CI on 5ffd2ed4: SDK Java (steps 14-20), Test, Lint all green;  TS units 1546/1546 x2 on idle Linux',
  ]],
  note: 'Fixed: the D7 false failure and the merge conflict. Still open: the D7 gate prints fencedFormerWriter: true with writer fencing disabled (it never reaches a store), and a mid-model-round restart still bricks the Session.',
}];
writeFileSync(new URL('./cards.json', import.meta.url), JSON.stringify(cards, null, 1));
console.log('cards.json (r2) written');
