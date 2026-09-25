// R3-8: api.downloadFile has no failure handling in collectAttempt; a permanently
// failing download (404: file expired / deleted in console) aborts every collect.
import { startFake, makeSandbox, writePlan, TWO_ITEMS, baseEnv, run, taskIdOf, readTask, verdict, finish, logLine } from './lib.mjs';

const fake = await startFake({ downloadStatus: () => 404 });
try {
  const sb = makeSandbox('r3-08');
  writePlan(sb.project, 'plan.json', 'r3-08', TWO_ITEMS());
  const env = baseEnv(sb, fake);
  const id = taskIdOf(await run(sb.project, env, ['run', 'plan.json']));
  const c1 = await run(sb.project, env, ['collect', id], { label: 'GET /files/<output>/content -> 404 always' });
  const c2 = await run(sb.project, env, ['collect', id, '--wait', '--timeout', '30'], { label: 'again, with --wait' });
  const retry = await run(sb.project, env, ['retry', id]);
  const cancel = await run(sb.project, env, ['cancel', id]);
  const clean = await run(sb.project, env, ['clean', id]);
  const t = readTask(sb, id);
  logLine(`task.json: items=${JSON.stringify(t.items.map((i) => [i.id, i.state]))} collected=${t.attempts[0].collected} finalStatus=${t.attempts[0].finalStatus}`);
  verdict('every collect exits 1 ("GET /files/file-2/content -> HTTP 404"), items stay "submitted"',
    [c1, c2].every((c) => c.code === 1 && /HTTP 404/.test(c.stderr)) && t.items.every((i) => i.state === 'submitted'));
  verdict('retry has nothing to retry (items are "submitted", never failed)', /nothing to retry/.test(retry.stdout));
  verdict('cancel: already settled; clean: refuses without --force',
    /already settled/.test(cancel.stdout) && clean.code === 1);
  const forced = await run(sb.project, env, ['clean', id, '--force']);
  verdict('only exit is clean --force (loses the record)', forced.code === 0);
} finally {
  finish();
  await fake.close();
}
