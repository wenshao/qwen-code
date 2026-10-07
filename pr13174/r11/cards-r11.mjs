// VERIFICATION RIG ONLY (PR #13174 round 11): summary card for head 17482a3794 (2e94066d66 adds main merges only).
import { writeFileSync } from 'node:fs';
const cards = [{
  file: '13-round11.png',
  title: 'PR #13174 round 11 @ 17482a3794 (R9-4: paced forced loads, idempotent settle)',
  subtitle: 'Harness SIGKILLed mid-Turn, replacement adopted. Linux arm64 / MySQL 8.0.46 on a quiet host (load 1-4) + macOS. 2e94066d66 only adds main merges outside the PR paths. 0 leftover processes.',
  accent: '#e3b341',
  blocks: [[
    '## R9-4, measured on the replacement Harness                     5a2c594913 (r10)     17482a3794 (r11)',
    '++ forced takeover loads while CANCELLING on a live approval      every 0.5 s (2/s)    every 5.0-5.5 s (0.2/s)',
    '   cheap /cancel retries (409)                                     2/s                  2/s (pre-R9 behaviour)',
    '++ duplicate load after the settle                                 409 already committed  200, 0 conflicts (3/3)',
  ], [
    '## still fixed',
    '++ B and P1-1, every Turn: cancelled, next Turn completes, close 202   (B 2/2, Workspace later 1/1, first 1/1)',
    '++ P1-2 allow / deny -> cancel 3/3: cancelled, next Turn completes, close 202, approved write never runs',
    '++ A, C (D4 + cancel), D4, rollback as designed;  freeze 3/3, all 8 other arms pass (F5: 0 of 11 on a quiet host)',
    '++ CI on 17482a3794: 33/33 green incl. Hosted MySQL, MariaDB, Test, windows-latest / Java 21',
  ], [
    '## still open (author: B2, next slice)',
    '-- cancel while the approval is still requested     CANCELLING, close 409   (2/2, now paced)',
    '-- allow only / let the approval expire             RUNNING, close 409      (1/1 + 1/1)',
    '   only reachable with QWEN_MANAGED_AGENT_APPROVAL_MODE=default|auto-edit (default is yolo)',
  ]],
  note: 'No new defect this round. Remaining gap: the three B2 rows, opt-in approval modes only. Merge now with B2 as a tracked follow-up, or wait for B2: maintainer call.',
}];
writeFileSync(new URL('./cards.json', import.meta.url), JSON.stringify(cards, null, 1));
console.log('cards.json (r11) written');
