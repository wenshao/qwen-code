// What the planned follow-up ("exclude the notice from the count") would do to
// writer-generated indexes: real S4 file + census.
import fs from 'node:fs';
const Hd = '/root/verify/pr14841/wt-head/packages/core/dist/src/memory';
const head = await import(`${Hd}/prompt.js`);
const sim = await import(`${Hd}/prompt.followup-sim.js`);
const { buildManagedAutoMemoryIndex } = await import(`${Hd}/indexer.js`);
const warnOf = (ctx) => ctx.split('\n').filter((l) => l.startsWith('> WARNING')).join(' | ') || '(none)';
const s4 = fs.readFileSync(process.argv[2], 'utf8');
console.log(JSON.stringify({ s4File: { head: warnOf(head.buildAutoMemoryIndexContext('/m', s4)), followUpSim: warnOf(sim.buildAutoMemoryIndexContext('/m', s4)) } }, null, 2));
let seed = 7; const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff); const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const words = 'deploy runbook staging cluster rollback flaky retry budget schema migration lease token cache index review release sandbox gateway timeout quota'.split(' ');
const phrase = (len) => { let s = ''; while (s.length < len) s += (s ? ' ' : '') + words[ri(0, words.length - 1)]; return s.slice(0, len).trim(); };
const t = { overBudget: 0, head_readerWarning: 0, sim_readerWarning: 0, sim_writerNoticeOnly: 0 };
for (let k = 0; k < 2000; k++) {
  const N = ri(160, 320); const docs = [];
  for (let i = 0; i < N; i++) { const type = ['feedback', 'project', 'reference', 'user'][ri(0, 3)]; docs.push({ title: phrase(ri(8, 60)), description: phrase(ri(20, 240)), type, relativePath: `${type}/${phrase(ri(6, 40)).replace(/ /g, '-')}-${i}.md`, filename: `x${i}.md`, mtimeMs: N - i }); }
  const w = buildManagedAutoMemoryIndex(docs);
  if (!w.includes('only part of it was written')) continue;
  t.overBudget++;
  const h = warnOf(head.buildAutoMemoryIndexContext('/m', w)), s = warnOf(sim.buildAutoMemoryIndexContext('/m', w));
  if (h.includes('Only part of it was loaded')) t.head_readerWarning++;
  if (s.includes('Only part of it was loaded')) t.sim_readerWarning++;
  else if (s.includes('only part of it was written')) t.sim_writerNoticeOnly++;
}
console.log(JSON.stringify({ census: t }));
