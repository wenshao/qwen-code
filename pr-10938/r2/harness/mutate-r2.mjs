// Round-2 mutation check at head 5c4f1de: round-1 mutants (patterns updated for
// the `statesDependenciesVisibly` refactor) + mutants for fix commit 4860e0a7e6.
// Each mutant: one source swap, run the matching vitest file(s), restore the
// exact original bytes. "KILLED" = suite red. The worktree has no local edits,
// so the final `git status` must be empty.
import fs from 'node:fs';
import { execSync } from 'node:child_process';

const WS = '/var/tmp/pr10938-wt/packages/web-shell';
const C = `${WS}/client/components`;
const PEV = `${C}/messages/PlanExecutionView.tsx`;
const PEVCSS = `${C}/messages/PlanExecutionView.module.css`;
const T_PEV = 'client/components/messages/PlanExecutionView.test.tsx';
const T_PEVCSS = 'client/components/messages/PlanExecutionView.css.test.ts';
const T_INSP = 'client/components/workflow/SessionWorkflowInspector.test.tsx';
const T_INSPCSS = 'client/components/workflow/SessionWorkflowInspector.css.test.ts';

const MUTANTS = [
  // ---- round-1 set, re-run after the main merge ----
  ['M1 show-all selector loses the .activityList > prefix', `${C}/workflow/SessionWorkflowInspector.module.css`, /\.activityList > button\.showAllActivity \{/, '.showAllActivity {', [T_INSPCSS]],
  ['M2 show-all never expands', `${C}/workflow/SessionWorkflowInspector.tsx`, /setShowAllActivity\(true\)/, 'setShowAllActivity(false)', [T_INSP]],
  ['M3 inspector dependency link does not select', `${C}/workflow/SessionWorkflowInspector.tsx`, /onClick=\{\(\) => onSelectedTodoIdChange\(todoId\)\}/, 'onClick={() => undefined}', [T_INSP]],
  ['M4 inspector upstream back to joined ids', `${C}/workflow/SessionWorkflowInspector.tsx`, /<ul className=\{styles\.dependencyList\}>\s*\{upstream\.map\(\(id\) => dependencyLink\(id\)\)\}\s*<\/ul>/, "upstream.join(', ')", [T_INSP]],
  ['M5 step-details panel links do not select', PEV, /onClick=\{\(\) => updateSelectedTodoId\(id\)\}/g, 'onClick={() => undefined}', [T_PEV]],
  ['M6 node-face Depends-on row never renders', PEV, /\{statesDependenciesVisibly &&/, '{false &&', [T_PEV]],
  ['M7 documentMode term dropped from the gate', PEV, /!drawsDependencyEdges \|\| !showStepDetails \|\| documentMode;/, '!drawsDependencyEdges || !showStepDetails;', [T_PEV]],
  ['M8 node runtime hidden', PEV, /\{nodeRuntimeMs > 0 && \(/, '{false && (', [T_PEV]],
  ['M9 selection repaints the status rule (pin removed)', PEVCSS, /\n  border-left-color: var\(--node-rule\);/, '\n', [T_PEVCSS]],
  ['M10 lane pitch not published from TS', PEV, /'--plan-edge-lane-height': `\$\{EDGE_LANE_HEIGHT\}px`,/, '', [T_PEV, T_PEVCSS]],
  ['M11 480px lane tier disabled', PEVCSS, /@media \(max-width: 480px\)/, '@media (max-width: 1px)', [T_PEVCSS]],
  ['M12 accessible status word removed', PEV, /\{t\(statusKey\(state\.status\)\)\}\s*\{state\.attention/, '{state.attention', [T_PEV]],
  // ---- fix commit 4860e0a7e6 ----
  ['M13 R6-3 revert: 24px shoulder floor restored', PEV, /const controlX = startX \+ \(endX - startX\) \/ 2;/, 'const controlX = startX + Math.max(24, (endX - startX) / 2);', [T_PEV]],
  ['M14 R7-3 revert: sr-only dependency summary removed', PEV, /\{!statesDependenciesVisibly &&/, '{false &&', [T_PEV]],
  ['M15 sr-only summary loses the visually-hidden clip', PEVCSS, /\.nodeStatusText,\n\.nodeDependencyText \{/, '.nodeStatusText {', [T_PEVCSS]],
  ['M16 sr-only summary names raw ids, not number + title', PEV, /\.map\(\s*\(id\) =>\s*`\$\{\(stepNumberByTodo\.get\(id\) \?\? 0\) \|\| '\?'\} \$\{\s*todosById\.get\(id\)\?\.content \?\? id\s*\}`,?\s*\)/, '.map((id) => id)', [T_PEV]],
  ['M17 sr-only summary also rendered where the chip row states it (stated twice)', PEV, /\{!statesDependenciesVisibly &&/, '{true &&', [T_PEV]],
  ['M18 sr-only summary keeps self-references', PEV, /\[\s*\.\.\.new Set\(todo\.blockedBy \?\? \[\]\),\s*\]\.filter\(\(id\) => id !== todo\.id\)/, '[...new Set(todo.blockedBy ?? [])]', [T_PEV]],
];

const results = [];
for (const [name, file, re, rep, tests] of MUTANTS) {
  const orig = fs.readFileSync(file, 'utf8');
  const hits = (orig.match(new RegExp(re.source, 'g')) || []).length;
  const mutated = orig.replace(re, rep);
  if (mutated === orig) {
    results.push({ name, status: 'NOT-APPLIED (pattern missing)' });
    console.log(name, 'NOT-APPLIED');
    continue;
  }
  fs.writeFileSync(file, mutated);
  let out = '';
  let red = false;
  try {
    out = execSync(`npx vitest run ${tests.join(' ')} 2>&1`, { cwd: WS, encoding: 'utf8', timeout: 300000 });
  } catch (e) {
    out = String(e.stdout || '') + String(e.stderr || '');
    red = true;
  } finally {
    fs.writeFileSync(file, orig);
  }
  const clean = out.replace(/\x1b\[[0-9;]*m/g, '');
  const summary = (clean.match(/Tests\s+[^\n]+/) || [''])[0];
  const failed = [...clean.matchAll(/(?:✗|×|FAIL)\s+([^\n]+)/g)].map((m) => m[1].slice(0, 160)).slice(0, 4);
  const assertion = (clean.match(/AssertionError[^\n]*/) || [null])[0];
  results.push({ name, patternHits: hits, status: red ? 'KILLED' : 'SURVIVED', summary, failed, assertion: assertion?.slice(0, 220) });
  console.log(name, `(hits=${hits})`, red ? 'KILLED' : 'SURVIVED', summary, failed[0] || '');
}
fs.writeFileSync('/root/git/pr10938-harness/r2/out/mutants-r2.json', JSON.stringify(results, null, 2));
const dirty = execSync('git status --porcelain', { cwd: '/var/tmp/pr10938-wt', encoding: 'utf8' });
console.log('worktree clean after restore:', dirty.trim() === '' ? 'yes' : dirty);
