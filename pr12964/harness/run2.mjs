import fs from 'node:fs'; import { spawnSync } from 'node:child_process';
const S = '/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/d5bc3015-0229-422e-acf8-bb58b65029ab/scratchpad';
const dir = S + '/mut/runtime-broker';
const list = (await import(process.env.LIST || './combos.mjs')).default;
const only = process.env.ONLY ? process.env.ONLY.split(',') : null;
const tests = process.env.TESTS || 'TakeoverReconciliationTest,InMemoryRepositoryTest,JdbcRepositoryTest,RuntimeBrokerServiceTest,RuntimeRecoveryTest';
const out = process.env.OUT || S + '/mut/results.jsonl';
for (const m of list) {
  if (only && !only.includes(m.id)) continue;
  const edits = m.edits || [{ file: m.file, find: m.find, rep: m.rep }];
  const originals = new Map();
  let bad = false;
  for (const e of edits) {
    const f = dir + '/' + e.file; const src = originals.get(f) ?? fs.readFileSync(f, 'utf8'); originals.set(f, src);
  }
  const current = new Map(originals);
  for (const e of edits) {
    const f = dir + '/' + e.file; const s = current.get(f); const n = s.split(e.find).length - 1;
    if (n !== 1) { console.log(`${m.id} MATCHES=${n} skip`); bad = true; break; }
    current.set(f, s.replace(e.find, e.rep));
  }
  if (bad) continue;
  for (const [f, s] of current) fs.writeFileSync(f, s);
  const t0 = Date.now();
  const r = spawnSync(S + '/mvn.sh', ['-o', 'test', '-Dtest=' + tests, '-Dsurefire.failIfNoSpecifiedTests=false'], { cwd: dir, encoding: 'utf8', maxBuffer: 1 << 28 });
  for (const [f, s] of originals) fs.writeFileSync(f, s);
  const log = r.stdout + r.stderr; fs.writeFileSync(`${S}/mut/logs-${m.id}${process.env.TAG || ''}.log`, log);
  const total = (log.match(/^\[(?:INFO|WARNING|ERROR)\] Tests run: \d+, Failures: \d+, Errors: \d+, Skipped: \d+$/m) || ['?'])[0];
  const failed = [...new Set([...log.matchAll(/^\[ERROR\]   ([A-Za-z]+\.[A-Za-z0-9_]+)/gm)].map(x => x[1]))];
  const verdict = /COMPILATION ERROR/.test(log) ? 'COMPILE' : r.status === 0 ? 'SURVIVED' : 'KILLED';
  const rec = { id: m.id, what: m.what, verdict, secs: Math.round((Date.now() - t0) / 1000), total, failed: failed.slice(0, 6), tag: process.env.TAG || '' };
  fs.appendFileSync(out, JSON.stringify(rec) + '\n');
  console.log(`${m.id} ${verdict} ${rec.secs}s ${total} ${failed.slice(0, 3).join(' ')}`);
}
