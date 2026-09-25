// R3-5 / R3-6: a retry whose create is refused (HTTP 400) marks items failed but
// leaves item.lastAttempt and heldReason/sourceChanged/truncated from the old attempt.
import fs from 'node:fs';
import path from 'node:path';
import { startFake, makeSandbox, writePlan, TWO_ITEMS, baseEnv, run, taskIdOf, readTask, verdict, finish, logLine } from './lib.mjs';

const itemB = (sb, id) => {
  const b = readTask(sb, id).items.find((i) => i.id === 'b');
  return { state: b.state, lastAttempt: b.lastAttempt, lastError: b.lastError, heldReason: b.heldReason, sourceChanged: b.sourceChanged, truncated: b.truncated };
};

// ---- R3-5: b failed (content_filter) -> retry refused -> collect replays attempt 1
{
  logLine('\n######## R3-5: failed item, retry create refused, then collect');
  const fake = await startFake({
    resultFor: (line) => (line.custom_id === 'b#1' ? { finish_reason: 'content_filter' } : undefined),
    createStatus: (n) => (n === 2 ? 400 : undefined),
  });
  const sb = makeSandbox('r3-05');
  writePlan(sb.project, 'plan.json', 'r3-05', TWO_ITEMS());
  const env = baseEnv(sb, fake);
  try {
    const id = taskIdOf(await run(sb.project, env, ['run', 'plan.json']));
    await run(sb.project, env, ['collect', id]);
    const retry = await run(sb.project, env, ['retry', id], { label: 'create #2 -> HTTP 400' });
    const afterRefusal = itemB(sb, id);
    logLine(`item b after refusal: ${JSON.stringify(afterRefusal)}`);
    const col = await run(sb.project, env, ['collect', id], { label: 'collect after refusal' });
    const afterCollect = itemB(sb, id);
    logLine(`item b after collect: ${JSON.stringify(afterCollect)}`);
    logLine(`attempts: ${JSON.stringify(readTask(sb, id).attempts.map((a) => [a.attempt, a.submitState, a.error ?? null]))}`);
    verdict('refusal: b failed with "create refused", but lastAttempt still 1',
      retry.code === 1 && /create refused/.test(afterRefusal.lastError) && afterRefusal.lastAttempt === 1);
    verdict('next collect replays attempt-1 line: b.lastError reverts to the old content_filter reason (refusal reason erased)',
      /content_filter/.test(afterCollect.lastError) && afterCollect.state === 'failed');
    const retry2 = await run(sb.project, env, ['retry', id], { label: 'retry again (create now accepted)' });
    verdict('a later retry still works (no billing/lock-out consequence)', /batch job: batch-2/.test(retry2.stdout));
  } finally {
    await fake.close();
  }
}

// ---- R3-6: b held (source changed) -> retry refused -> flags stay, collect flips it back to held
{
  logLine('\n######## R3-6: held+sourceChanged item, retry create refused');
  const fake = await startFake({ createStatus: (n) => (n === 2 ? 400 : undefined) });
  const sb = makeSandbox('r3-06');
  writePlan(sb.project, 'plan.json', 'r3-06', TWO_ITEMS());
  const env = baseEnv(sb, fake);
  try {
    const id = taskIdOf(await run(sb.project, env, ['run', 'plan.json']));
    fs.appendFileSync(path.join(sb.project, 'docs/zh/b.md'), '\n新增一段。\n');
    await run(sb.project, env, ['collect', id], { label: 'b source edited after submission' });
    logLine(`item b after collect: ${JSON.stringify(itemB(sb, id))}`);
    const retry = await run(sb.project, env, ['retry', id], { label: 'create #2 -> HTTP 400' });
    const afterRefusal = itemB(sb, id);
    logLine(`item b after refusal: ${JSON.stringify(afterRefusal)}`);
    const col = await run(sb.project, env, ['collect', id], { label: 'collect after refusal' });
    const afterCollect = itemB(sb, id);
    logLine(`item b after collect: ${JSON.stringify(afterCollect)}`);
    verdict('after refusal b is "failed" yet still carries heldReason + sourceChanged=true + lastAttempt=1',
      afterRefusal.state === 'failed' && afterRefusal.sourceChanged === true && Boolean(afterRefusal.heldReason) && afterRefusal.lastAttempt === 1);
    verdict('next collect flips b back to "held" (source changed) — refusal no longer reported',
      afterCollect.state === 'held' && !/create refused/.test(col.stdout));
  } finally {
    await fake.close();
  }
}

// ---- truncated variant: flag kept on refusal -> does it block anything?
{
  logLine('\n######## truncated variant');
  const fake = await startFake({
    resultFor: (line) => (line.custom_id === 'b#1' ? { finish_reason: 'length' } : undefined),
    createStatus: (n) => (n === 2 ? 400 : undefined),
  });
  const sb = makeSandbox('r3-06t');
  writePlan(sb.project, 'plan.json', 'r3-06t', TWO_ITEMS());
  const env = baseEnv(sb, fake);
  try {
    const id = taskIdOf(await run(sb.project, env, ['run', 'plan.json']));
    await run(sb.project, env, ['collect', id]);
    await run(sb.project, env, ['retry', id, '--max-output-tokens', '8192'], { label: 'create #2 -> HTTP 400' });
    logLine(`item b after refusal: ${JSON.stringify(itemB(sb, id))}`);
    await run(sb.project, env, ['collect', id]);
    const r3 = await run(sb.project, env, ['retry', id, '--max-output-tokens', '8192'], { label: 'retry again' });
    verdict('truncated flag kept, but a retry with the larger limit still goes through', /batch job: batch-2/.test(r3.stdout));
  } finally {
    await fake.close();
  }
}
finish();
