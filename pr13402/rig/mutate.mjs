// Usage: node mutate.mjs <worktree> <mutant>
// Resets SessionEventHub.java to the trial-merge text, then applies one mutant.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const [wt, mutant] = process.argv.slice(2);
const MERGE = fs.readFileSync(new URL('./merge-commit.txt', import.meta.url), 'utf8').trim();
const MAIN = fs.readFileSync(new URL('./main-commit.txt', import.meta.url), 'utf8').trim();
const HUB = 'packages/sdk-java/managed-agent-server/src/main/java/com/alibaba/qwen/code/managedagent/service/SessionEventHub.java';
const show = (rev, p) => execFileSync('git', ['-C', wt, 'show', `${rev}:${p}`], { encoding: 'utf8', maxBuffer: 64 << 20 });
const once = (text, from, to) => {
  const n = text.split(from).length - 1;
  if (n !== 1) throw new Error(`${mutant}: expected exactly one match, got ${n}: ${from.slice(0, 80)}`);
  return text.replace(from, to);
};

const head = show(MERGE, HUB);
let t = head;
switch (mutant) {
  case 'NONE':
    break;
  // The whole pre-PR monitor shape (synchronized + Object.wait/notifyAll).
  case 'MONITOR':
    t = show(MAIN, HUB);
    break;
  // publish wakes one waiter instead of all.
  case 'SIGNAL_ONE':
    t = once(t, 'changed.signalAll();', 'changed.signal();');
    break;
  // publish wakes nobody: subscribers see events only at their timeout.
  case 'NO_SIGNAL':
    t = once(t, '                publishLocked(committed);\n                changed.signalAll();\n', '                publishLocked(committed);\n');
    break;
  // Subscription.close() loses its idempotency guard.
  case 'CLOSE_NOT_IDEMPOTENT':
    t = once(t, '            if (closed) {\n                return;\n            }\n            closed = true;\n', '            closed = true;\n');
    break;
  // release() never decrements: buffers leak forever.
  case 'NO_DECREMENT':
    t = once(t, '                references--;\n                return references == 0;', '                return references == 0;');
    break;
  // release() always reports the last reference: premature eviction.
  case 'ALWAYS_EVICT':
    t = once(t, '                references--;\n                return references == 0;', '                references--;\n                return true;');
    break;
  // await swallows interruption (Object.wait propagated it).
  case 'UNINTERRUPTIBLE':
    t = once(t, '                    changed.awaitNanos(Math.max(1, timeout.toNanos()));\n',
      '                    try {\n                        changed.awaitNanos(Math.max(1, timeout.toNanos()));\n                    } catch (InterruptedException ignored) {\n                        // swallowed\n                    }\n');
    break;
  // await ignores its timeout and waits for a publish forever.
  case 'NO_TIMEOUT':
    t = once(t, '                    changed.awaitNanos(Math.max(1, timeout.toNanos()));\n', '                    changed.await();\n');
    break;
  // await always waits, even when events are already buffered.
  case 'ALWAYS_WAIT':
    t = once(t, '                if (!hasAfter(afterSequence)) {\n                    changed.awaitNanos(Math.max(1, timeout.toNanos()));\n                }\n',
      '                changed.awaitNanos(Math.max(1, timeout.toNanos()));\n');
    break;
  // Drop the 1 ns floor (a zero timeout elapses at once).
  case 'NO_FLOOR':
    t = once(t, 'changed.awaitNanos(Math.max(1, timeout.toNanos()));', 'changed.awaitNanos(timeout.toNanos());');
    break;
  // Signal before mutating the buffer (still under the same lock).
  case 'SIGNAL_FIRST':
    t = once(t, '                publishLocked(committed);\n                changed.signalAll();\n', '                changed.signalAll();\n                publishLocked(committed);\n');
    break;
  default:
    throw new Error(`unknown mutant ${mutant}`);
}
fs.writeFileSync(`${wt}/${HUB}`, t);
const stat = execFileSync('git', ['-C', wt, 'diff', '--shortstat'], { encoding: 'utf8' }).trim();
console.log(`${mutant}: ${stat || 'no change'}`);
