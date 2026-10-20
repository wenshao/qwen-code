// (1) Differential fuzz: head trimIndexToBudget vs base trimIndexToBudget, plus
//     partition invariants of head trimIndexToBudgetDetailed.
// (2) Census: real writer (buildManagedAutoMemoryIndex) -> real reader
//     (buildAutoMemoryIndexContext) over random over-budget stores.
const B = '/root/verify/pr14841/wt-base/packages/core/dist/src/memory';
const Hd = '/root/verify/pr14841/wt-head/packages/core/dist/src/memory';
const base = await import(`${B}/index-budget.js`);
const head = await import(`${Hd}/index-budget.js`);
const { buildManagedAutoMemoryIndex } = await import(`${Hd}/indexer.js`);
const headPrompt = await import(`${Hd}/prompt.js`);
const basePrompt = await import(`${B}/prompt.js`);

let seed = 14841;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));

// ---- (1) fuzz
let cases = 0, mismatch = 0, partitionBad = 0;
const alphabet = ['a', 'é', '中', '😀', ' ', '-', '['];
for (let t = 0; t < 20000; t++) {
  const n = ri(0, 260);
  const lines = [];
  for (let i = 0; i < n; i++) {
    const mode = rnd();
    const len = mode < 0.8 ? ri(0, 150) : mode < 0.97 ? ri(151, 600) : ri(5000, 26000);
    let s = '';
    while (s.length < len) s += alphabet[ri(0, alphabet.length - 1)];
    lines.push(s.slice(0, len));
  }
  cases++;
  const a = base.trimIndexToBudget(lines), b = head.trimIndexToBudget(lines);
  if (a !== b) mismatch++;
  const d = head.trimIndexToBudgetDetailed(lines);
  // every input line lands in exactly one of content/dropped, in index order
  const kept = d.content === '' ? [] : d.content.split('\n');
  let ki = 0, di = 0, ok = d.content === b;
  for (const line of lines) {
    if (ki < kept.length && kept[ki] === line && !(di < d.dropped.length && d.dropped[di] === line && false)) ki++;
    else if (di < d.dropped.length && d.dropped[di] === line) di++;
    else { ok = false; break; }
  }
  if (!ok || ki !== kept.length || di !== d.dropped.length) partitionBad++;
}
console.log(JSON.stringify({ fuzz: { cases, trimIndexToBudgetMismatchBaseVsHead: mismatch, detailedPartitionViolations: partitionBad } }));

// ---- (2) census over writer-generated stores
const types = ['feedback', 'project', 'reference', 'user'];
const words = 'deploy runbook staging cluster rollback flaky retry budget schema migration lease token cache index review release sandbox gateway timeout quota'.split(' ');
const phrase = (len) => { let s = ''; while (s.length < len) s += (s ? ' ' : '') + words[ri(0, words.length - 1)]; return s.slice(0, len).trim(); };
const tally = { storesOverBudget: 0, readerSilent_writerNoticeOnly: 0, readerWarns_noDropNames: 0, readerWarns_withDropNames: 0,
  headSaysTooManyEntries: 0, headSaysTooLong: 0, writerDroppedTotal: 0 };
const examples = [];
for (let t = 0; t < 3000; t++) {
  const N = ri(160, 320);
  const docs = [];
  for (let i = 0; i < N; i++) {
    const type = types[ri(0, 3)];
    docs.push({ title: phrase(ri(8, 60)), description: phrase(ri(20, 220)), type,
      relativePath: `${type}/${phrase(ri(6, 40)).replace(/ /g, '-')}-${i}.md`, filename: `x-${i}.md`, mtimeMs: N - i });
  }
  const written = buildManagedAutoMemoryIndex(docs);
  if (!written.endsWith(head.INDEX_TRUNCATION_NOTICE)) continue; // writer kept everything
  tally.storesOverBudget++;
  const survivors = written.split('\n').filter((l) => l.startsWith('- [')).length;
  tally.writerDroppedTotal += N - survivors;
  const ctx = headPrompt.buildAutoMemoryIndexContext('/m', written);
  const warn = ctx.split('\n').find((l) => l.startsWith('> WARNING: MEMORY.md is '));
  if (warn === undefined || warn.includes('only part of it was written')) {
    tally.readerSilent_writerNoticeOnly++;
  } else {
    if (warn.includes(' Dropped ')) tally.readerWarns_withDropNames++; else tally.readerWarns_noDropNames++;
    if (warn.includes('too many index entries')) tally.headSaysTooManyEntries++;
    if (warn.includes('index entries are too long')) tally.headSaysTooLong++;
    if (examples.length < 2) examples.push({ N, survivors, writtenLength: written.length, headWarning: warn,
      baseWarning: basePrompt.buildAutoMemoryIndexContext('/m', written).split('\n').find((l) => l.startsWith('> WARNING: MEMORY.md is ')) });
  }
}
console.log(JSON.stringify({ census: tally, examples }, null, 2));
