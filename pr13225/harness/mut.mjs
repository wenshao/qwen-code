// Mutation runner (PR #13225). Each mutant: exact single-occurrence replace in the mut worktree, full
// managed-agent-server unit suite, failing tests from surefire XML, restore with git checkout.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const W = `${process.env.HOME}/git/qwen-code-pr13225-mut`;
const MOD = `${W}/packages/sdk-java/managed-agent-server`;
const SRC = `${MOD}/src/main/java/com/alibaba/qwen/code/managedagent`;
const MVN = '/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/04b34643-e8fb-486a-9fe8-2fb38ee689ef/scratchpad/rig/mvn.sh';
const OUT = process.argv[3] ?? '/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/04b34643-e8fb-486a-9fe8-2fb38ee689ef/scratchpad/mut/results.jsonl';
const mutants = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const only = process.env.ONLY ? process.env.ONLY.split(',') : null;
function runTests() {
  fs.rmSync(`${MOD}/target/surefire-reports`, { recursive: true, force: true });
  const t0 = Date.now();
  const r = spawnSync(MVN, ['-o', '-q', '-f', `${MOD}/pom.xml`, 'test', '-Dcheckstyle.skip=true', '-Dsurefire.printSummary=true'], { encoding: 'utf8', env: { ...process.env, TZ: 'UTC' }, maxBuffer: 512 << 20 });
  const dir = `${MOD}/target/surefire-reports`;
  const failed = []; let total = 0;
  if (fs.existsSync(dir)) for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.xml'))) {
    const x = fs.readFileSync(path.join(dir, f), 'utf8');
    total += (x.match(/<testcase /g) ?? []).length;
    for (const m of x.matchAll(/<testcase name="([^"]+)" classname="([^"]+)"[^>]*?(?:\/>|>([\s\S]*?)<\/testcase>)/g)) {
      if (m[3] && /<(failure|error)/.test(m[3])) failed.push(`${m[2].split('.').pop()}#${m[1]}`);
    }
  }
  const compileError = /COMPILATION ERROR|cannot find symbol/.test(r.stdout + r.stderr);
  return { exit: r.status, total, failed, compileError, s: Math.round((Date.now() - t0) / 1000) };
}
for (const m of mutants) {
  if (only && !only.includes(m.id)) continue;
  let res;
  if (m.id !== 'BASELINE') {
    const edits = m.edits ?? [{ file: m.file, from: m.from, to: m.to }];
    const files = [...new Set(edits.map((e) => path.join(SRC, e.file)))];
    let bad = null;
    for (const e of edits) {
      const file = path.join(SRC, e.file); const text = fs.readFileSync(file, 'utf8');
      const n = text.split(e.from).length - 1;
      if (n !== 1) { bad = `occurrences=${n} in ${e.file}`; break; }
      fs.writeFileSync(file, text.replace(e.from, e.to));
    }
    if (bad) { for (const file of files) spawnSync('git', ['-C', W, 'checkout', '--', file]); fs.appendFileSync(OUT, JSON.stringify({ id: m.id, error: bad }) + '\n'); console.log(m.id, 'SKIP', bad); continue; }
    try { res = runTests(); } finally { for (const file of files) spawnSync('git', ['-C', W, 'checkout', '--', file]); }
  } else res = runTests();
  const verdict = m.id === 'BASELINE' ? (res.failed.length ? 'RED' : 'GREEN') : res.compileError ? 'COMPILE' : res.failed.length || res.exit !== 0 ? 'KILLED' : 'SURVIVED';
  const row = { id: m.id, what: m.what, verdict, ...res, failed: res.failed.slice(0, 8), nFailed: res.failed.length };
  fs.appendFileSync(OUT, JSON.stringify(row) + '\n');
  console.log(`${m.id} ${verdict} total=${res.total} failed=${res.failed.length} ${res.failed.slice(0, 3).join(' ')} (${res.s}s)`);
}
