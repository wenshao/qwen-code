import { mkdirSync } from 'node:fs';
import { compose } from './compose.mjs';

const R = '/root/verify/pr9466/runs';
const O = '/root/verify/pr9466/publish/pr-9466';
mkdirSync(O, { recursive: true });
const BASE = 'base d63a5ed61c (merge-base)';
const HEAD = 'head 35f9500588 (this PR)';

await compose(`${O}/01-live-notification-ab.png`,
  'S1 · Live session: a background-shell notification shifts the rewind boundary',
  'Same scripted model, same keystrokes. T1 starts a background shell whose completion notification enters model history as a user entry. Rewind to T3 → "Restore code and conversation", then T4 asks the fake model to list the user prompts it still receives.',
  [
    { label: `${BASE}`, tone: 'bad', img: `${R}/s1-base/shots/05-context-check.png`, top: 150, height: 455, note: 'Screen keeps T2 and b.txt, but the model no longer receives T2 — truncated one turn early' },
    { label: `${HEAD}`, tone: 'good', img: `${R}/s1-head/shots/05-context-check.png`, top: 150, height: 455, note: 'Model context = [T1, T2] — matches the screen and the file state' },
  ]);

await compose(`${O}/02-resume-ab.png`,
  'S2 · After quit + --continue: rewind into the resumed range (to T3)',
  'T1 (background shell) · T2 writes b.txt · T3 writes c.txt · /quit · qwen --continue · T4 writes d.txt · rewind to T3 · T5 asks what the model still sees.',
  [
    { label: `${BASE} — restore options`, tone: 'bad', img: `${R}/s2-base/shots/03-options.png`, top: 0, height: 368, note: 'Resumed turn has no identity: only "Restore conversation only" — c.txt and d.txt stay on disk' },
    { label: `${HEAD} — restore options`, tone: 'good', img: `${R}/s2-head/shots/03-options.png`, top: 0, height: 368, note: 'Resumed turn keeps its checkpoint: "Restore code and conversation (+2 -0 in 2 files)"' },
    { label: `${BASE} — after rewind`, tone: 'bad', img: `${R}/s2-base/shots/05-context-check.png`, top: 150, height: 445, note: 'Model context = [T1] (T2 dropped); files b, c, d all still present' },
    { label: `${HEAD} — after rewind`, tone: 'good', img: `${R}/s2-head/shots/05-context-check.png`, top: 150, height: 445, note: 'Model context = [T1, T2]; "Restored 2 file(s)" → only b.txt remains' },
  ]);

await compose(`${O}/03-fork-session-ab.png`,
  'S6 · qwen --continue --fork-session: rewind inside the forked range (to T3)',
  'Same script as S2, but the second process forks the session. On head the forked records and snapshots are remapped into the new session namespace (verified in the transcript: ########0..2, then ########4 for the first post-fork turn — no collision).',
  [
    { label: `${BASE}`, tone: 'bad', img: `${R}/s6-base/shots/05-context-check.png`, top: 150, height: 445, note: 'Conversation-only restore offered; context [T1]; c.txt, d.txt not restored' },
    { label: `${HEAD}`, tone: 'good', img: `${R}/s6-head/shots/05-context-check.png`, top: 150, height: 445, note: 'Code + conversation restored; context [T1, T2]; only b.txt remains' },
  ]);

await compose(`${O}/04-retry-tradeoff.png`,
  'S4 · Documented trade-off: a turn re-sent with Ctrl+Y can no longer be conversation-rewound',
  'T2 fails once with HTTP 400 and is retried with Ctrl+Y. Rewind to T3 first (works on both), send T4, then rewind to the retried T2 itself, then T5 asks what the model sees.',
  [
    { label: `${BASE}`, tone: 'neutral', img: `${R}/s4-base/shots/05-final.png`, top: 150, height: 330, note: 'Rewind to the retried T2 succeeds positionally → context [T1] (correct here)' },
    { label: `${HEAD}`, tone: 'neutral', img: `${R}/s4-head/shots/05-final.png`, top: 150, height: 430, note: 'Rewind to T3 after the retry resolves; rewind to T2 itself is refused, nothing truncated' },
  ]);

await compose(`${O}/05-restore-checkpoint.png`,
  'S3 · /restore a JSON checkpoint (default approval mode), then rewind to T2 inside the restored range',
  'Left: checkpoint written by this build (promptIds parallel to clientHistory, re-marked on /restore). Right: the same checkpoint with promptIds deleted — i.e. a checkpoint written before this PR. Base (not shown) rewinds positionally to [T1] in this simple case.',
  [
    { label: `${HEAD} — checkpoint from this build`, tone: 'good', img: `${R}/s3-head/shots/05-context-check.png`, top: 150, height: 500, note: 'Rewound; "Restored 2 file(s)" → only a.txt; context [T1]' },
    { label: `${HEAD} — legacy checkpoint (no promptIds)`, tone: 'neutral', img: `${R}/s3legacy-head/shots/05-context-check.png`, top: 150, height: 500, note: 'Fails closed before touching files; conversation and files unchanged' },
  ]);

await compose(`${O}/06-resumed-custom-command-ab.png`,
  'S7 · Resumed session: rewind to the prompt submitted by a custom slash command',
  'T1 · /greet (a .qwen/commands/greet.md that submits "T2: greeting…") · T3 · /quit · --continue · rewind to the "T2: greeting…" entry · T4 asks what the model sees. The resumed picker lists both "/greet" and the expanded prompt on both arms (pre-existing).',
  [
    { label: `${BASE}`, tone: 'bad', img: `${R}/s7-base/shots/02-check.png`, top: 150, height: 245, note: 'Model context = [T1, T2] — the selected turn was NOT removed (one turn too few truncated)' },
    { label: `${HEAD}`, tone: 'good', img: `${R}/s7-head/shots/02-check.png`, top: 150, height: 245, note: 'Model context = [T1] — exact boundary' },
  ]);
