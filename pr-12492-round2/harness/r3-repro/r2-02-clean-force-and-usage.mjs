// Delta probe for 206a444b (R2-11, R2-20), real bundle + fake DashScope.
// A) R2-20: after a completed collect, the local attempt-001/output.jsonl
//    disappears (disk cleanup / half-copied batch home); a re-collect must not
//    overwrite the recorded billed usage with zeros.
// B) R2-11: item a fails (HTTP 500 line), item b is held (target occupied);
//    `retry` submits attempt 2, which stays uncollected, so `clean` meets the
//    open-batch refusal first ("… or pass --force"); the forced clean must say
//    it destroyed b's only copy, as it already says for the uncancelled batch.
import fs from 'node:fs';
import path from 'node:path';
import { startFake, makeSandbox, writePlan, TWO_ITEMS, baseEnv, run, logLine, verdict, finish, taskIdOf, readTask } from './lib.mjs';
const fake = await startFake({});
try {
  // ---- A
  logLine('######## A: re-collect after the local result copy is gone');
  const a = makeSandbox('r2-02-usage');
  writePlan(a.project, 'plan.json', 'r2-02a', TWO_ITEMS());
  const envA = baseEnv(a, fake);
  const idA = taskIdOf(await run(a.project, envA, ['run', 'plan.json']));
  await run(a.project, envA, ['collect', idA]);
  const before = readTask(a, idA).attempts[0].usage;
  logLine(`usage after first collect: ${JSON.stringify(before)}`);
  fs.rmSync(path.join(a.batchHome, 'tasks', idA, 'attempt-001', 'output.jsonl'));
  logLine('deleted attempt-001/output.jsonl');
  const re = await run(a.project, envA, ['collect', idA]);
  const after = readTask(a, idA).attempts[0].usage;
  logLine(`usage after re-collect:    ${JSON.stringify(after)}`);
  logLine(`"Batch usage" line printed on re-collect: ${/Batch usage/.test(re.stdout)}`);
  verdict('billed usage survives a re-collect without the local copy', after?.requests === 2 && after?.promptTokens === before?.promptTokens);

  // ---- B
  logLine('\n######## B: forced clean after the open-batch refusal');
  const b = makeSandbox('r2-02-clean');
  writePlan(b.project, 'plan.json', 'r2-02b', TWO_ITEMS());
  fs.mkdirSync(path.join(b.project, 'docs', 'en'), { recursive: true });
  fs.writeFileSync(path.join(b.project, 'docs', 'en', 'b.md'), 'user edits\n');
  fake.hooks.resultFor = (line) => (line.custom_id === 'a#1' ? { status_code: 500, body: { error: 'boom' } } : undefined);
  const envB = baseEnv(b, fake);
  const idB = taskIdOf(await run(b.project, envB, ['run', 'plan.json']));
  await run(b.project, envB, ['collect', idB]);
  fake.hooks.resultFor = undefined;
  fake.behavior = 'stay';
  await run(b.project, envB, ['retry', idB]);
  const plain = await run(b.project, envB, ['clean', idB]);
  const forced = await run(b.project, envB, ['clean', idB, '--force']);
  logLine(`record still on disk: ${fs.existsSync(path.join(b.batchHome, 'tasks', idB))}`);
  verdict('forced clean names the destroyed held result', /undelivered result\(s\) \(b\)/.test(forced.stderr) && /only copy/.test(forced.stderr));
  verdict('forced clean still warns about the uncancelled batch', /was not cancelled/.test(forced.stderr));
} finally {
  finish();
  await fake.close();
}
