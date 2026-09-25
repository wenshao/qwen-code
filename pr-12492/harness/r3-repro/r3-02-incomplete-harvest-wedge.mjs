// R3-2: incomplete-harvest guard `seen.size < request_counts.completed`.
//  (A) one malformed output line -> task wedged forever
//  (B) one line with an unmappable custom_id -> same
//  (C) numerator counts output+error matches, denominator only `completed`:
//      a missing SUCCESS line is masked by an error-file line -> item failed, remote deleted
import fs from 'node:fs';
import path from 'node:path';
import { startFake, makeSandbox, writePlan, TWO_ITEMS, baseEnv, run, taskIdOf, readTask, verdict, finish, logLine } from './lib.mjs';

const downloads = (fake) => fake.log.filter((l) => /GET \/v1\/files\/.*\/content -> 200/.test(l)).length;

async function wedgeScenario(label, transformOutput) {
  logLine(`\n######## (${label})`);
  // item c fails for an ordinary reason (content_filter), so `retry` has work
  const fake = await startFake({
    transformOutput,
    resultFor: (line) => (line.custom_id === 'c#1' ? { finish_reason: 'content_filter' } : undefined),
  });
  const sb = makeSandbox(`r3-02-${label}`);
  fs.writeFileSync(path.join(sb.project, 'docs/zh/c.md'), '# C\n\n丙文档。\n');
  writePlan(sb.project, 'plan.json', `r3-02-${label}`, [...TWO_ITEMS(), { id: 'c', source: 'docs/zh/c.md', target: 'docs/en/c.md' }]);
  const env = baseEnv(sb, fake);
  try {
    const r = await run(sb.project, env, ['run', 'plan.json']);
    const id = taskIdOf(r);
    const c1 = await run(sb.project, env, ['collect', id], { label: 'first collect' });
    const d1 = downloads(fake);
    const c2 = await run(sb.project, env, ['collect', id], { label: 'second collect' });
    const c3 = await run(sb.project, env, ['collect', id], { label: 'third collect' });
    const d3 = downloads(fake);
    logLine(`output-file downloads after collect #1: ${d1}; after #3: ${d3}; remote deletes: ${fake.deleted.length}`);
    const retry = await run(sb.project, env, ['retry', id]);
    const cancel = await run(sb.project, env, ['cancel', id]);
    const list = await run(sb.project, env, ['list']);
    const clean = await run(sb.project, env, ['clean', id]);
    const t = readTask(sb, id);
    logLine(`task.json: items=${JSON.stringify(t.items.map((i) => [i.id, i.state]))} attempt1.collected=${t.attempts[0].collected} outputPath=${t.attempts[0].outputPath}`);
    verdict(`(${label}) every collect exits 1 with "result files account for 2 of 3"`,
      [c1, c2, c3].every((c) => c.code === 1 && /account for 2 of 3/.test(c.stdout + c.stderr)));
    verdict(`(${label}) every collect re-downloads the output file (${d3} downloads for 3 collects)`, d3 === 3 && d1 === 1);
    verdict(`(${label}) good item a delivered on first pass; b stuck "submitted"`,
      fs.existsSync(path.join(sb.project, 'docs/en/a.md')) && t.items.find((i) => i.id === 'b').state === 'submitted');
    verdict(`(${label}) retry refuses (not collected), cancel no-ops (already settled), clean refuses without --force`,
      retry.code === 1 && /not collected yet/.test(retry.stderr) && /already settled/.test(cancel.stdout) && clean.code === 1);
    verdict(`(${label}) remote files never deleted`, fake.deleted.length === 0);
  } finally {
    await fake.close();
  }
}

// (A) b's line cut mid-JSON
await wedgeScenario('A-malformed', (lines) =>
  lines.map((l) => (l.includes('"b#1"') ? l.slice(0, 60) : l)).join('\n') + '\n');
// (B) b's line carries a custom_id the task cannot map
await wedgeScenario('B-unmappable', (lines) =>
  lines.map((l) => (l.includes('"b#1"') ? l.replace('"b#1"', '"b-1"') : l)).join('\n') + '\n');

// (C) three items: a ok, b ok but its line missing from output, c failed (in error file).
{
  logLine('\n######## (C-masked-missing-success)');
  const fake = await startFake({
    transformOutput: (lines) => lines.filter((l) => l.includes('"a#1"')).join('\n') + '\n',
    errorLinesFor: () => [JSON.stringify({ custom_id: 'c#1', error: { code: 'InternalError', message: 'boom' } })],
    requestCounts: () => ({ total: 3, completed: 2, failed: 1 }),
  });
  const sb = makeSandbox('r3-02-C');
  fs.writeFileSync(path.join(sb.project, 'docs/zh/c.md'), '# C\n\n丙文档。\n');
  writePlan(sb.project, 'plan.json', 'r3-02-C', [...TWO_ITEMS(), { id: 'c', source: 'docs/zh/c.md', target: 'docs/en/c.md' }]);
  const env = baseEnv(sb, fake);
  try {
    const r = await run(sb.project, env, ['run', 'plan.json']);
    const id = taskIdOf(r);
    const c1 = await run(sb.project, env, ['collect', id], { label: 'completed=2 failed=1; output has only a, error has c' });
    const t = readTask(sb, id);
    logLine(`remote deletes: ${fake.deleted.join(',')}; items=${JSON.stringify(t.items.map((i) => [i.id, i.state, i.lastError]))}`);
    verdict('(C) guard passes (seen=2 >= completed=2) although a completed request (b) has no line: b failed + remote files deleted',
      c1.code === 0 && t.items.find((i) => i.id === 'b').state === 'failed' && fake.deleted.length >= 2);
  } finally {
    await fake.close();
  }
}
finish();
