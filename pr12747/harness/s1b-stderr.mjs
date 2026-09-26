import { startWorker, BOOT_V2, PR_REPO, BASE_REPO } from './lib.mjs';
const [before, after] = JSON.stringify({ ...BOOT_V2, mountRoot: '/tmp/@@' }).split('@@');
for (const [arm, repo] of [['base', BASE_REPO], ['PR', PR_REPO]]) {
  for (const [label, raw] of [
    ['0xE9 in mountRoot', Buffer.concat([Buffer.from(before), Buffer.from([0xe9]), Buffer.from(after)])],
    ['malformed JSON (reference)', Buffer.from(JSON.stringify(BOOT_V2).slice(0, -1))],
  ]) {
    const w = await startWorker(BOOT_V2, { repo, raw });
    console.log(`=== ${arm} / ${label}: kind=${w.kind} code=${w.code} stdout=${JSON.stringify(w.stdout)} token-in-stderr=${w.stderr.includes('fixture-token')}`);
    console.log(w.stderr.trim().split('\n').slice(0, 4).join('\n'));
    await w.close();
  }
}
