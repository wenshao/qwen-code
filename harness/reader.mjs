// A concurrent reader: samples the installed tree while the swap runs and
// classifies every sample as v1-consistent, v2-consistent, or MIXED.
import * as fs from 'node:fs';
import * as path from 'node:path';
const [dest, out, deadlineMs] = process.argv.slice(2);
const end = Date.now() + Number(deadlineMs);
const counts = { v1: 0, v2: 0, mixed: 0, unreadable: 0, samples: 0 };
const examples = [];
let firstMixedAt = 0, lastMixedAt = 0;
const flush = () => {
  fs.writeFileSync(out, JSON.stringify({ ...counts, mixedWindowMs: lastMixedAt && firstMixedAt ? lastMixedAt - firstMixedAt : 0, examples }, null, 2));
};
process.on('SIGTERM', () => { flush(); process.exit(0); });
while (Date.now() < end) {
  counts.samples += 1;
  if (counts.samples % 5000 === 0) flush(); // the loop is synchronous, so signals cannot preempt it
  let manifest, keep, dropped, added;
  try {
    manifest = JSON.parse(fs.readFileSync(path.join(dest, 'qwen-extension.json'), 'utf8')).version;
    keep = fs.readFileSync(path.join(dest, 'skills', 'keep.md'), 'utf8').trim();
    dropped = fs.existsSync(path.join(dest, 'dropped-by-v2.md'));
    added = fs.existsSync(path.join(dest, 'added-by-v2.md'));
  } catch (e) { counts.unreadable += 1; if (examples.length < 6) examples.push(`unreadable: ${e.code}`); continue; }
  const shape = `${manifest}|${keep}|dropped=${dropped}|added=${added}`;
  if (shape === '1.0.0|keep@1.0.0|dropped=true|added=false') counts.v1 += 1;
  else if (shape === '2.0.0|keep@2.0.0|dropped=false|added=true') counts.v2 += 1;
  else {
    counts.mixed += 1;
    const now = Date.now();
    if (!firstMixedAt) firstMixedAt = now;
    lastMixedAt = now;
    if (examples.length < 6) examples.push(shape);
  }
}
flush();
