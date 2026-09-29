import fs from 'node:fs'; import { spawnSync } from 'node:child_process';
import mutants from './mutants.mjs';
const S = '/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/d5bc3015-0229-422e-acf8-bb58b65029ab/scratchpad';
const dir = S + '/mut/runtime-broker';
const only = process.env.ONLY ? process.env.ONLY.split(',') : null;
const tests = process.env.TESTS || 'TakeoverReconciliationTest,InMemoryRepositoryTest,JdbcRepositoryTest,RuntimeBrokerServiceTest,RuntimeRecoveryTest';
const extra = process.env.MVNX ? process.env.MVNX.split(' ') : [];
const out = process.env.OUT || S + '/mut/results.jsonl';
for (const m of mutants) {
  if (only && !only.includes(m.id)) continue;
  const f = dir + '/' + m.file; const src = fs.readFileSync(f, 'utf8');
  const n = src.split(m.find).length - 1;
  if (n !== 1) { console.log(`${m.id} MATCHES=${n} skip`); continue; }
  if (process.env.DRY) { console.log(`${m.id} ok`); continue; }
  fs.writeFileSync(f, src.replace(m.find, m.rep));
  const t0 = Date.now();
  const r = spawnSync(S + '/mvn.sh', ['-o', 'test', '-Dtest=' + tests, '-Dsurefire.failIfNoSpecifiedTests=false', ...extra], { cwd: dir, encoding: 'utf8', maxBuffer: 1 << 28 });
  fs.writeFileSync(f, src);
  const log = r.stdout + r.stderr;
  fs.writeFileSync(`${S}/mut/logs-${m.id}${process.env.TAG || ''}.log`, log);
  const total = (log.match(/^\[(?:INFO|WARNING|ERROR)\] Tests run: \d+, Failures: \d+, Errors: \d+, Skipped: \d+$/m) || ['?'])[0];
  const compileErr = /COMPILATION ERROR/.test(log);
  const failed = [...new Set([...log.matchAll(/^\[ERROR\]   ([A-Za-z]+\.[A-Za-z0-9_]+)/gm)].map(x => x[1]))];
  const verdict = compileErr ? 'COMPILE' : r.status === 0 ? 'SURVIVED' : 'KILLED';
  const rec = { id: m.id, what: m.what, verdict, secs: Math.round((Date.now() - t0) / 1000), total, failed: failed.slice(0, 6), tag: process.env.TAG || '' };
  fs.appendFileSync(out, JSON.stringify(rec) + '\n');
  console.log(`${m.id} ${verdict} ${rec.secs}s ${total} ${failed.slice(0, 3).join(' ')}`);
}
