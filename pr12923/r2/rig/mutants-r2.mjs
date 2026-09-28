// R2: M10 / M13 against the new head's tests, plus M10b (a rejected over-cap
// create leaks one staging reservation). Usage: node mutants-r2.mjs <worktree> <label>
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const [WT, label] = process.argv.slice(2);
const S = 'packages/acp-bridge/src/sessionAttachments.ts';
const CP = 'packages/acp-bridge/src/session-control-plane.ts';
const cap = "if (metadata.size > SESSION_ATTACHMENT_MAX_ITEM_BYTES) {\n      throw new RangeError('Session attachment must be at most 8 MiB');";
const M = [
  ['M10', S, 'if (metadata.size > SESSION_ATTACHMENT_MAX_ITEM_BYTES) {', 'if (false) {', ['src/sessionAttachments.test.ts', '-t', 'oversized chunked upload']],
  ['M10b', S, cap, "if (metadata.size > SESSION_ATTACHMENT_MAX_ITEM_BYTES) {\n      this.uploads.create({ ...metadata, name, size: 1 }, clientId);\n      throw new RangeError('Session attachment must be at most 8 MiB');", ['src/sessionAttachments.test.ts', '-t', 'oversized chunked upload']],
  ['M13', CP, '      entry.attachments.cancelClientUploads(clientId);\n', '', ['src/bridge.test.ts', '-t', 'staged uploads while another client']],
];
const run = (args) => {
  const r = spawnSync('npx', ['vitest', 'run', ...args], { cwd: path.join(WT, 'packages/acp-bridge'), encoding: 'utf8' });
  const out = r.stdout + r.stderr;
  return { ok: r.status === 0, summary: (out.match(/Tests\s+\d+[^\n]*/) || [''])[0].trim() };
};
const out = [];
for (const [id, file, from, to, args] of M) {
  const abs = path.join(WT, file);
  const orig = fs.readFileSync(abs, 'utf8');
  if (orig.split(from).length !== 2) throw new Error(`${id} anchor`);
  const clean = run(args);
  fs.writeFileSync(abs, orig.replace(from, to));
  let mut;
  try { mut = run(args); } finally { fs.writeFileSync(abs, orig); }
  out.push({ label, id, cleanPasses: clean.ok, cleanSummary: clean.summary, killed: !mut.ok, mutantSummary: mut.summary });
  console.log(`${label} ${id}: clean ${clean.ok ? 'PASS' : 'FAIL'} (${clean.summary}) | mutant ${mut.ok ? 'SURVIVED' : 'KILLED'} (${mut.summary})`);
}
const f = path.join(WT, '..', 'runs', 'mutants-r2.json');
const prev = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')).filter((r) => r.label !== label) : [];
fs.writeFileSync(f, JSON.stringify([...prev, ...out], null, 2));
