// R3-10: `collect --wait` aborts on a single transient GET /batches/<id> failure.
import { startFake, makeSandbox, writePlan, TWO_ITEMS, baseEnv, run, taskIdOf, readTask, verdict, finish, logLine } from './lib.mjs';

for (const failure of [503, 429]) {
  logLine(`\n######## one transient HTTP ${failure} on the 2nd status poll`);
  const fake = await startFake({
    getStatus: (jobId, pollNo) => {
      if (pollNo === 2) {
        fake.behavior = 'auto'; // the batch finishes right after the blip
        fake.settleAt = 3;
        return failure;
      }
      return undefined;
    },
  });
  fake.behavior = 'stay';
  const sb = makeSandbox(`r3-10-${failure}`);
  writePlan(sb.project, 'plan.json', `r3-10-${failure}`, TWO_ITEMS());
  const env = baseEnv(sb, fake);
  try {
    const id = taskIdOf(await run(sb.project, env, ['run', 'plan.json']));
    const w = await run(sb.project, env, ['collect', id, '--wait', '--timeout', '120'], { label: 'background waiter the skill starts' });
    const t = readTask(sb, id);
    logLine(`after waiter: items=${JSON.stringify(t.items.map((i) => [i.id, i.state]))} fake log: ${fake.log.filter((l) => /batches\/batch/.test(l)).join(' ; ')}`);
    const again = await run(sb.project, env, ['collect', id], { label: 'plain collect afterwards' });
    verdict(`[${failure}] waiter exits 1 after ONE transient ${failure} (no retry), nothing delivered`,
      w.code === 1 && new RegExp(`HTTP ${failure}`).test(w.stderr) && t.items.every((i) => i.state === 'submitted'));
    verdict(`[${failure}] a plain collect afterwards delivers everything (nothing lost)`, again.code === 0 && /2 delivered/.test(again.stdout));
  } finally {
    await fake.close();
  }
}
finish();
