// Delta probe for 56f06075's waitForSettled retry: an error WITHOUT an HTTP
// status is now treated as transient. The local BATCH_ROUTE guard's refusal
// ("refusing a request outside the Batch API paths") carries no status either,
// so a batch id the guard refuses (e.g. one with ':' from a non-DashScope
// provider — any non-empty string passes submitAttempt) is retried until
// --timeout instead of failing at once. The skill starts the waiter with no
// --timeout at all.
import fs from 'node:fs';
import path from 'node:path';
import { startFake, makeSandbox, writePlan, TWO_ITEMS, baseEnv, run, logLine, verdict, finish, taskIdOf } from './lib.mjs';
const fake = await startFake({});
fake.behavior = 'stay';
try {
  const sb = makeSandbox('r2-01-guard');
  writePlan(sb.project, 'plan.json', 'r2-01', TWO_ITEMS());
  const env = baseEnv(sb, fake);
  const r = await run(sb.project, env, ['run', 'plan.json']);
  const id = taskIdOf(r);
  const file = path.join(sb.batchHome, 'tasks', id, 'task.json');
  const task = JSON.parse(fs.readFileSync(file, 'utf8'));
  task.attempts[0].batchId = 'batch-1:x';
  fs.writeFileSync(file, JSON.stringify(task, null, 2));
  logLine(`ledger batchId set to ${task.attempts[0].batchId}`);
  const w = await run(sb.project, env, ['collect', id, '--wait', '--timeout', '25'], { label: '--wait --timeout 25 on a guard-refused id' });
  const warns = (w.stderr.match(/warning: polling/g) ?? []).length;
  logLine(`RESULT exit=${w.code} elapsed_ms=${w.ms} retry_warnings=${warns}`);
  verdict('waiter fails at once on a guard-refused id (no retry loop)', w.code !== 0 && warns === 0 && w.ms < 5000);
} finally {
  finish();
  await fake.close();
}
