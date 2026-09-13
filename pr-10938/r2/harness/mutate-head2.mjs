// Mutation check for 5f70a13866 (R8-2 fix): does the new test pin the union tally?
// Same restore discipline as mutate-r2.mjs: exact original bytes written back,
// worktree must be clean at the end (it is at a commit with no local edits).
import fs from 'node:fs';
import { execSync } from 'node:child_process';

const WS = '/var/tmp/pr10938-wt/packages/web-shell';
const PEV = `${WS}/client/components/messages/PlanExecutionView.tsx`;
const T_PEV = 'client/components/messages/PlanExecutionView.test.tsx';
const MUTANTS = [
  ['M19 tally back to transcript-only (the R8-2 bug)', PEV, /liveNested\.length \+\s*transcriptOnly\.length/, 'nestedAgentToolsForTool(tool).length'],
  ['M20 toolUseId dedup dropped (overlap counted twice)', PEV, /nestedAgentToolsForTool\(tool\)\.filter\(\s*\(\{ tool: nested \}\) => !liveCallIds\.has\(nested\.callId\),\s*\)/, 'nestedAgentToolsForTool(tool)'],
  ['M21 live child tasks not counted', PEV, /liveNested\.length \+\s*transcriptOnly\.length/, 'transcriptOnly.length'],
];
const results = [];
for (const [name, file, re, rep] of MUTANTS) {
  const orig = fs.readFileSync(file, 'utf8');
  const mutated = orig.replace(re, rep);
  if (mutated === orig) {
    results.push({ name, status: 'NOT-APPLIED' });
    console.log(name, 'NOT-APPLIED');
    continue;
  }
  fs.writeFileSync(file, mutated);
  let out = '';
  let red = false;
  try {
    out = execSync(`npx vitest run ${T_PEV} 2>&1`, { cwd: WS, encoding: 'utf8', timeout: 300000 });
  } catch (e) {
    out = String(e.stdout || '') + String(e.stderr || '');
    red = true;
  } finally {
    fs.writeFileSync(file, orig);
  }
  const clean = out.replace(/\x1b\[[0-9;]*m/g, '');
  const summary = (clean.match(/Tests\s+[^\n]+/) || [''])[0];
  const failed = [...clean.matchAll(/FAIL\s+([^\n]+)/g)].map((m) => m[1].slice(0, 160)).slice(0, 4);
  const assertion = (clean.match(/AssertionError[^\n]*/) || [null])[0];
  results.push({ name, status: red ? 'KILLED' : 'SURVIVED', summary, failed, assertion: assertion?.slice(0, 200) });
  console.log(name, red ? 'KILLED' : 'SURVIVED', summary, failed[0] || '', assertion || '');
}
fs.writeFileSync('/root/git/pr10938-harness/r2/out/mutants-head2.json', JSON.stringify(results, null, 2));
const dirty = execSync('git status --porcelain', { cwd: '/var/tmp/pr10938-wt', encoding: 'utf8' });
console.log('worktree clean after restore:', dirty.trim() === '' ? 'yes' : dirty);
