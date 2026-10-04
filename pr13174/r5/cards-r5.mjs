// VERIFICATION RIG ONLY (PR #13174 round 5): summary card for head 4b6c7b1a60.
import { writeFileSync } from 'node:fs';
const cards = [{
  file: '07-round5.png',
  title: 'PR #13174 round 5 @ 4b6c7b1a60 ("settle a cancel first on a plain-attached replacement")',
  subtitle: 'Same probe as round 4: Harness SIGKILLed mid model round, user cancels Turn 2 while it is down. Linux arm64 / MySQL 8.0.46 and macOS arm64 / MySQL 8.4.7.',
  accent: '#f85149',
  blocks: [[
    '## B. cancel after a mid-model-round death                macOS 3/3, Linux 3/3: still wedged',
    '-- Turn 2  CANCELLING forever (was FAILED generation_mismatch in round 4)',
    '-- replacement route log, every retry:  POST /cancel -> 204   GET /events -> 409 hosted_event_epoch_mismatch',
    '-- Turn 3 / Turn 4 submit -> 409 turn_active;  POST /close -> 409;  escape (cancel again, wait 90 s, close) -> 409',
    '== why: the daemon cancel is  session.active?.abort.abort(); res.sendStatus(204)  -> a no-op on a plain attach;',
    '==      nothing settles the parked prompt, and the stream then reads with the OLD generation\'s epoch',
  ], [
    '## C. D4 lost reply + cancel in the window                macOS 2/2, Linux 2/2: NEW wedge (round 4: ended turn.cancelled)',
    '-- the new CANCELLING branch pre-empts withdraw + fast-cancel (0 "Withdrew" lines); stream with a null epoch',
    '-- -> IllegalStateException every retry; Turn 2 CANCELLING forever; Turn 3 submit -> 409',
  ], [
    '## experiment (verification-only patch, not proposed as-is)',
    '++ guard the new branch with harnessEventEpoch != null      -> C back to round-4 behavior (turn.cancelled, Turn 3 completes) 1/1',
    '!! + re-key the Turn onto the attachment\'s epoch            -> B still wedged 2/2 (no terminal event ever comes)',
  ], [
    '## unchanged and green',
    '++ A. no-cancel model-round restart: matches README, close + new Session work (macOS 2/2, Linux 2/2)',
    '++ D4 lost reply 2/2 + 2/2;  freeze arm 3/3;  harness-only session 2/2+2/2, continuation 5/5;  rollback as designed',
    '== harness-only inflight 2/3: one writer-lease lapse (the known F5 shape, no cancel involved)',
  ]],
  note: 'The round-4 wedge is not fixed, and the same change wedges the D4 cancel path that used to end cancelled. The unit witness passes only because harness.stream is mocked.',
}];
writeFileSync(new URL('./cards.json', import.meta.url), JSON.stringify(cards, null, 1));
console.log('cards.json (r5) written');
