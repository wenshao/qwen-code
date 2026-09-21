// READ-ONLY dry run of the PR's sweep predicate over a real debug dir.
// The validator regex is extracted verbatim from the PR's source file so
// there is no transcription risk.
import { readdir, stat, readFile, lstat, readlink } from 'node:fs/promises';
import { join } from 'node:path';

const srcPath = process.argv[2];
const root = process.argv[3];
const days = Number(process.argv[4] ?? 30);

const src = await readFile(srcPath, 'utf8');
const m = src.match(/const INTERNAL_SESSION_ID_REGEX\s*=\s*([\s\S]*?);\n/);
if (!m) throw new Error('regex not found');
const literal = m[1].trim();
console.log('extracted validator literal:', literal);
// eslint-disable-next-line no-eval
const INTERNAL_SESSION_ID_REGEX = eval(literal);
const isValidSessionId = (v) => INTERNAL_SESSION_ID_REGEX.test(v);

const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
const entries = await readdir(root, { withFileTypes: true });

const buckets = {
  total: entries.length,
  dirs: 0, symlinks: 0, otherType: 0,
  nonTxtFiles: 0,
  txtInvalidStem: 0,
  candidates: 0,
};
const invalidStems = [];
const candidates = [];

for (const e of entries) {
  if (e.isDirectory()) { buckets.dirs++; continue; }
  if (e.isSymbolicLink()) { buckets.symlinks++; continue; }
  if (!e.isFile()) { buckets.otherType++; continue; }
  if (!e.name.endsWith('.txt')) { buckets.nonTxtFiles++; continue; }
  const stem = e.name.slice(0, -4);
  if (!isValidSessionId(stem)) { buckets.txtInvalidStem++; invalidStems.push(e.name); continue; }
  buckets.candidates++;
  candidates.push(join(root, e.name));
}

let wouldRemove = 0, wouldRemoveBytes = 0, wouldKeep = 0, wouldKeepBytes = 0, errs = 0;
let invalidStale = 0, invalidStaleBytes = 0;
for (let i = 0; i < candidates.length; i += 20) {
  const batch = candidates.slice(i, i + 20);
  await Promise.all(batch.map(async (p) => {
    try {
      const s = await stat(p);
      if (s.mtime < cutoff) { wouldRemove++; wouldRemoveBytes += s.size; }
      else { wouldKeep++; wouldKeepBytes += s.size; }
    } catch { errs++; }
  }));
}
for (const n of invalidStems) {
  try { const s = await stat(join(root, n)); if (s.mtime < cutoff) { invalidStale++; invalidStaleBytes += s.size; } } catch {}
}

const mib = (b) => (b / 1024 / 1024).toFixed(1) + ' MiB';
console.log(JSON.stringify({ root, retentionDays: days, cutoff: cutoff.toISOString(), buckets,
  wouldRemove, wouldRemoveSize: mib(wouldRemoveBytes),
  wouldKeep, wouldKeepSize: mib(wouldKeepBytes),
  statErrors: errs,
  invalidStemStaleFiles: invalidStale, invalidStemStaleSize: mib(invalidStaleBytes),
  invalidStemSamples: invalidStems.slice(0, 10) }, null, 2));
