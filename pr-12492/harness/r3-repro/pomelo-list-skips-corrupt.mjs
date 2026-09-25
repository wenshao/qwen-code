// pomelo-nwu: BatchTaskStore.list() silently skips unreadable task records.
import fs from 'node:fs';
import path from 'node:path';
import { startFake, makeSandbox, writePlan, TWO_ITEMS, baseEnv, run, taskIdOf, verdict, finish, logLine } from './lib.mjs';

const fake = await startFake();
fake.behavior = 'stay'; // keep the batches running, i.e. the case that matters
try {
  const sb = makeSandbox('pomelo');
  writePlan(sb.project, 'plan.json', 'healthy', TWO_ITEMS());
  writePlan(sb.project, 'plan2.json', 'corrupt', TWO_ITEMS('2'));
  writePlan(sb.project, 'plan3.json', 'newer-schema', TWO_ITEMS('3'));
  const env = baseEnv(sb, fake);
  const healthy = taskIdOf(await run(sb.project, env, ['run', 'plan.json']));
  const corrupt = taskIdOf(await run(sb.project, env, ['run', 'plan2.json']));
  const newer = taskIdOf(await run(sb.project, env, ['run', 'plan3.json']));
  // corrupt JSON (e.g. disk full / manual edit) and a record written by a newer build
  const cf = path.join(sb.batchHome, 'tasks', corrupt, 'task.json');
  fs.writeFileSync(cf, fs.readFileSync(cf, 'utf8').slice(0, 200));
  const nf = path.join(sb.batchHome, 'tasks', newer, 'task.json');
  const nt = JSON.parse(fs.readFileSync(nf, 'utf8'));
  nt.schemaVersion = 2;
  fs.writeFileSync(nf, JSON.stringify(nt, null, 2));
  logLine(`task dirs on disk: ${fs.readdirSync(path.join(sb.batchHome, 'tasks')).join(', ')}`);
  const list = await run(sb.project, env, ['list']);
  const col = await run(sb.project, env, ['collect', corrupt]);
  const colNew = await run(sb.project, env, ['collect', newer]);
  verdict('list shows only the healthy task, with no warning about the 2 unreadable ones',
    list.stdout.trim().split('\n').length === 1 && list.stdout.includes(healthy) && !list.stderr.trim());
  verdict('the skipped tasks still hold running batches (collect by id reports the load error)',
    /cannot load task/.test(col.stderr) && /schema version 2/.test(colNew.stderr));
} finally {
  finish();
  await fake.close();
}
