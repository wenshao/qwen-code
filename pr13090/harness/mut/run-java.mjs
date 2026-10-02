// usage: node run-java.mjs <worktree> <ids,...|all> <mode: unit|o4>
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { FILE, MUTANTS } from './mutants.mjs';
const [W, which, mode] = process.argv.slice(2);
const S = '/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/9d84bca0-c4ea-4895-80e3-553468b6983a/scratchpad';
const path = `${W}/${FILE}`;
const original = fs.readFileSync(path, 'utf8');
const out = `${S}/mut/results-${mode}.jsonl`;
const pick = which === 'all' ? MUTANTS : MUTANTS.filter((m) => which.split(',').includes(m[0]));
try {
  for (const [id, desc, from, to] of pick) {
    const n = original.split(from).length - 1;
    if (n !== 1) { console.log(`${id} anchor matched ${n} times — NOT RUN`); fs.appendFileSync(out, JSON.stringify({ id, desc, result: 'anchor', n }) + '\n'); continue; }
    fs.writeFileSync(path, original.replace(from, to));
    const log = `${S}/mut/${mode}-${id}.log`;
    const t0 = Date.now();
    const args = mode === 'unit'
      ? ['-o', '-f', `${W}/packages/sdk-java/managed-agent-server/pom.xml`, 'clean', 'test']
      : ['-o', '-f', `${W}/packages/sdk-java/managed-agent-server/pom.xml`, '-Po4-mysql-gates',
         '-Dqwen.o4.mysql.url=jdbc:mysql://127.0.0.1:33090/qwen_o4_gate?allowPublicKeyRetrieval=true&useSSL=false',
         '-Dqwen.o4.mysql.user=root', '-Dsurefire.skip=true', '-DskipTests=false', 'clean', 'verify'];
    const r = spawnSync(`${S}/rig/mvn.sh`, args, { encoding: 'utf8', env: { ...process.env, M2: 'm2b', QWEN_O4_MYSQL_PASSWORD: 'pw13090' }, maxBuffer: 1 << 28 });
    fs.writeFileSync(log, r.stdout + r.stderr);
    const text = r.stdout + r.stderr;
    const compileFail = /COMPILATION ERROR/.test(text);
    const failing = [...new Set([...text.matchAll(/\[ERROR\]\s+(?:Failures|Errors|Tests).*?|\[ERROR\]\s+([A-Za-z0-9_]+Test[A-Za-z0-9_]*\.[A-Za-z0-9_]+)/g)].map((m) => m[1]).filter(Boolean))];
    const summary = [...text.matchAll(/Tests run: (\d+), Failures: (\d+), Errors: (\d+), Skipped: (\d+)\s*$/gm)].map((m) => m.slice(1).join('/')).pop();
    const result = compileFail ? 'compile-error' : r.status === 0 ? 'SURVIVED' : 'killed';
    const rec = { id, desc, mode, result, exit: r.status, summary, failing: failing.slice(0, 8), secs: Math.round((Date.now() - t0) / 1000) };
    console.log(JSON.stringify(rec));
    fs.appendFileSync(out, JSON.stringify(rec) + '\n');
  }
} finally {
  fs.writeFileSync(path, original);
}
