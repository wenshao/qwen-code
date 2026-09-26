// Applies one mutation at a time to merged/packages/core/src/core/prompts.ts, runs
// prompts.test.ts, and records which tests fail. The original file is restored from a
// byte copy after every mutation, and each mutation must change the file (self-check).
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
const ROOT = '/Users/wenshao/git/v12784/merged/packages/core';
const F = `${ROOT}/src/core/prompts.ts`;
const orig = fs.readFileSync(F, 'utf8');
const M = [
  ['M1 restore Adapt restatement',
    "obstacles.${todoAdaptationGuidance} If an approach", null,
    (s) => s.replace('encounter obstacles. If an approach fails', "encounter obstacles. ${todoWriteEnabled ? 'If a todo list exists, keep it current as the scope or approach changes. ' : ''}If an approach fails")],
  ['M2 restore old Plan bullet', null, null,
    (s) => s.replace("`Track complex, ambiguous, or multi-step work with '${ToolNames.TODO_WRITE}'; skip it for simple tasks unless the user explicitly requests a plan.`",
      "`Use '${ToolNames.TODO_WRITE}' for complex, ambiguous, or multi-step work when visible progress tracking adds value. Keep the plan short and outcome-oriented; skip it for simple tasks unless the user explicitly requests a plan.`")],
  ['M3 restore old tool-guidance bullet', null, null,
    (s) => s.replace("to keep user-visible progress on multi-step work; '# Task Management' governs its use.",
      'only when explicit tracking adds value. Keep plans concise, outcome-oriented, and current; do not create a todo list for simple or single-step work unless the user explicitly requests one.')],
  ['M4 restore "NEVER talk to the user…" sentence', null, null,
    (s) => s.replace('separate from the code you are changing.\n', 'separate from the code you are changing. *NEVER* talk to the user or describe your changes through comments.\n')],
  ['M5 restore "Do not narrate…" sentence', null, null,
    (s) => s.replace('a workaround for a specific bug. Do not edit comments', 'a workaround for a specific bug. Do not narrate what the code does. Do not edit comments')],
  ['M6 pointer names a heading that does not exist', null, null,
    (s) => s.replace("'# Task Management' governs its use", "'# Todo Rules' governs its use")],
  ['M7 drop the section\'s "keep current / revise on scope change" rule (sole home of the removed Adapt sentence)', null, null,
    (s) => s.replace(' Keep the list current, mark finished work completed, and revise it when the scope or approach changes.', '')],
  ['M8 drop the section\'s "at most one in_progress" rule', null, null,
    (s) => s.replace('- Keep at most one item in_progress. Keep the list current', '- Keep the list current')],
  ['M9 drop the section\'s "do not use for simple/single-step" rule', null, null,
    (s) => s.replace(' Do not use it for simple or single-step queries that you can answer or complete immediately unless the user explicitly asks for a plan.', '')],
];
const results = [];
try {
  for (const [name, , , fn] of M) {
    const mutated = fn(orig);
    if (mutated === orig) { results.push({ name, error: 'mutation did not apply' }); continue; }
    fs.writeFileSync(F, mutated);
    let out = '';
    try {
      out = execFileSync('npx', ['vitest', 'run', 'src/core/prompts.test.ts', '--reporter=json', '--coverage.enabled=false', '--outputFile=/Users/wenshao/git/v12784/mut.json'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 1 << 28 });
    } catch (e) { out = e.stdout; }
    const j = JSON.parse(fs.readFileSync('/Users/wenshao/git/v12784/mut.json', 'utf8'));
    const failed = j.testResults.flatMap((f) => f.assertionResults.filter((a) => a.status === 'failed').map((a) => a.title));
    const snap = failed.filter((t) => /snapshot|matches/i.test(t)).length;
    results.push({ name, failed: failed.length, total: j.numTotalTests, failingTests: failed.slice(0, 6), snapshotMismatches: j.snapshot?.unmatched ?? null });
    fs.writeFileSync(F, orig);
  }
} finally {
  fs.writeFileSync(F, orig);
}
console.log(JSON.stringify(results, null, 1));
