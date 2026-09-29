// Round 9 mutants on 19f19c67 (R2-3 cleanup, R2-5 unstarted Shell).
import fs from 'node:fs';
import { execSync } from 'node:child_process';
const W = `${process.env.HOME}/git/qwen-code-pr12894-mut3`;
const HS = 'packages/cli/src/serve/hosted-harness-session.ts';
const TT = 'packages/cli/src/serve/hosted-workspace-tool-turn.ts';
const T = `cd ${W}/packages/cli && npx vitest run src/serve/hosted-workspace-tool-turn.test.ts src/serve/hosted-harness-session.test.ts 2>&1`;
const mutants = [
  ['Q1 R2-3: cleanup failure no longer blocks the Session', HS, `    toolTurn?.close().catch((cause: unknown) => {\n      session.blocked = true;\n`, `    toolTurn?.close().catch((cause: unknown) => {\n`],
  ['Q2 R2-3: cleanup failure rethrown again (old behaviour)', HS, `  await running.finally(() =>\n    toolTurn?.close().catch((cause: unknown) => {`, `  await running.finally(() =>\n    toolTurn?.close().then(undefined, (cause: unknown) => { throw cause;`],
  ['Q3 R2-5: recovery no longer resolves an unstarted receipt', HS, `      (decision === 'committed' ||\n        envelope.executionStatus === 'not_started') &&`, `      decision === 'committed' &&`],
  ['Q4 R2-5: recovery ACKs an unstarted receipt', HS, `    if (\n      receiptPromptId !== promptId ||\n      envelope.executionStatus === 'not_started'\n    )\n      continue;`, `    if (receiptPromptId !== promptId) continue;`],
  ['Q5 R2-5: unstarted history id not derived from the call', TT, `        messageId = shellHistoryId(executionCallId);\n        timestamp = new Date(originalIntent.occurredAt).toISOString();`, `        messageId = shellHistoryId(executionCallId + '-x');\n        timestamp = new Date(originalIntent.occurredAt).toISOString();`],
  ['Q6 R2-5: unstarted replay ignores the saved envelope', TT, `          !isDeepStrictEqual(saved['envelope'], brokerResult) ||\n          saved['manifestRef'] !== null ||`, `          saved['manifestRef'] !== null ||`],
];
const run = () => { let out = '', ok = true; try { out = execSync(T, { encoding: 'utf8', maxBuffer: 64 << 20, shell: '/bin/bash' }); } catch (e) { ok = false; out = (e.stdout ?? '') + (e.stderr ?? ''); } const failed = [...out.matchAll(/ (?:FAIL|×) [^\n]*/g)].map((m) => m[0].trim()).slice(0, 3); return { ok, line: (out.match(/Tests\s+\d+[^\n]*/g) ?? ['? ' + out.slice(-300)]).at(-1), failed }; };
const b = run(); console.log(`baseline: ${b.ok ? 'PASS' : 'FAIL'} ${b.line}`);
if (!b.ok) { console.log(b.failed.join('\n')); process.exit(1); }
for (const [label, file, from, to] of mutants) {
  const p = `${W}/${file}`; const src = fs.readFileSync(p, 'utf8');
  if (!src.includes(from)) { console.log(`${label}: anchor not found`); continue; }
  fs.writeFileSync(p, src.replace(from, to)); const r = run(); fs.writeFileSync(p, src);
  console.log(`${label}: ${r.ok ? 'SURVIVED' : 'KILLED'} (${r.line})${r.ok ? '' : '\n    ' + r.failed.join('\n    ')}`);
}
execSync(`cd ${W} && git status --short`, { stdio: 'inherit' });
