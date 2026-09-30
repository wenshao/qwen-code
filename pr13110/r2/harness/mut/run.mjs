// Mutation runner. usage: node run.mjs <tree> <label> <ids...|ALL> ; `check` as label only validates anchors.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { MUTANTS } from './mutants.mjs';
const [tree, label, ...ids] = process.argv.slice(2);
const NODE_BIN = '/opt/node22/bin';
const CLI = process.env.FILES === 'worker' ? ['src/serve/managed-runtime-file-history.test.ts', 'src/serve/managed-runtime-provider-protocol.test.ts', 'src/serve/managed-runtime-provider-worker.test.ts'] : ['src/serve/hosted-harness-session.test.ts', 'src/serve/hosted-workspace-tool-turn.test.ts', 'src/serve/hosted-file-history.test.ts', 'src/serve/hosted-workspace-broker.test.ts', 'src/serve/managed-runtime-file-history.test.ts', 'src/serve/managed-runtime-provider-protocol.test.ts', 'src/serve/managed-runtime-provider-worker.test.ts'];
const CORE = ['src/services/fileHistoryService.test.ts', 'src/tools/managed-tool-file-history.test.ts'];
const out = `/rig/out/mut-${label}.log`;
const say = (l) => (console.log(l), fs.appendFileSync(out, l + '\n'));
// Tests that fail under host load on head AND base and pass alone (see the report); a run failing only these is repeated.
const FLAKY_LIST = ['asks again in the next Turn after an approval expired unanswered', 'retries load after workspace_', 'recovers a proven unstarted Shell', 'serves MCP cancel during dispatch', 'serves MCP status during dispatch', 'refuses a cold load when a settled file tool outcome is missing', 'preserves the original Shell receipt and continuation across', 'settles a turn after one managed-'];
const isFlaky = (f) => FLAKY_LIST.some((p) => f.includes(p));
function run(pkg, files) {
  const r = spawnSync('npx', ['vitest', 'run', '--retry=2', '--testTimeout=30000', '--hookTimeout=30000', ...files], { cwd: path.join(tree, 'packages', pkg), encoding: 'utf8', env: { ...process.env, PATH: `${NODE_BIN}:${process.env.PATH}`, NO_COLOR: '1' }, maxBuffer: 256 * 1024 * 1024 });
  const text = r.stdout + r.stderr;
  const summary = (text.match(/^ *Tests .*$/m) ?? ['<no summary>'])[0].trim().replace(/\s+/g, ' ');
  const failed = [...text.matchAll(/^ *(?:×|FAIL) +(.*)$/gm)].map((m) => m[1].replace(/ \d+ms$/, '').trim());
  return { rc: r.status, summary, failed: [...new Set(failed)], text };
}
const chosen = MUTANTS.filter(([id]) => ids.includes('ALL') || ids.includes(id));
for (const [id, file, search] of chosen) {
  const s = fs.readFileSync(path.join(tree, file), 'utf8');
  const n = s.split(search).length - 1;
  if (n !== 1) {
    console.log(`ANCHOR ${id}: ${n} occurrences in ${file}`);
    process.exitCode = 1;
  }
}
if (label === 'check' || process.exitCode) process.exit();
fs.writeFileSync(out, '');
const needCli = chosen.some(([id]) => id.startsWith('M'));
const needCore = chosen.some(([id]) => id.startsWith('C'));
if (needCli) {
  const b = run('cli', CLI);
  say(`BASELINE cli: rc=${b.rc} ${b.summary}${b.failed.length ? ' failed=' + JSON.stringify(b.failed.slice(0, 3)) : ''}`);
  if (b.rc !== 0 && !(b.failed.length && b.failed.every(isFlaky))) process.exit(2);
}
if (needCore) {
  const b = run('core', CORE);
  say(`BASELINE core: rc=${b.rc} ${b.summary}`);
  if (b.rc !== 0) process.exit(2);
}
for (const [id, file, search, replace, note] of chosen) {
  const abs = path.join(tree, file);
  const original = fs.readFileSync(abs, 'utf8');
  fs.writeFileSync(abs, original.replace(search, replace));
  let verdict;
  try {
    let r = id.startsWith('C') ? run('core', CORE) : run('cli', CLI);
    // a "kill" that is only the known load-sensitive test, or a run without a summary, is repeated once
    if (r.rc !== 0 && (r.summary === '<no summary>' || (r.failed.length && r.failed.every(isFlaky)))) r = id.startsWith('C') ? run('core', CORE) : run('cli', CLI);
    if (r.rc !== 0 && r.failed.length && r.failed.every(isFlaky)) r = { ...r, rc: 0, summary: r.summary + ' (only load-sensitive tests failed)' };
    const typeError = /error TS\d+|SyntaxError|Transform failed/.test(r.text) && r.summary === '<no summary>';
    verdict = r.rc === 0 ? 'SURVIVED' : typeError ? 'INVALID(compile)' : `KILLED by ${r.failed.filter((f) => !f.startsWith('src/')).length || r.failed.length} test(s): ${r.failed.filter((f) => !/^src\/.*\.ts$/.test(f)).slice(0, 2).map((f) => f.slice(0, 110)).join(' | ')}`;
    say(`${id} ${verdict}  [${note}]  ${r.summary}`);
  } finally {
    fs.writeFileSync(abs, original);
  }
}
say('DONE');
