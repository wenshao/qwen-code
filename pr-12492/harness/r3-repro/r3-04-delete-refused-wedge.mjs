// R3-4: attempt.collected only after every remote DELETE succeeds; a persistent
// 403 on DELETE /files/<id> after a full harvest blocks retry/cancel/clean forever.
import { startFake, makeSandbox, writePlan, TWO_ITEMS, baseEnv, run, taskIdOf, readTask, verdict, finish, logLine } from './lib.mjs';

const fake = await startFake({
  resultFor: (line) => (line.custom_id === 'b#1' ? { finish_reason: 'content_filter' } : undefined),
  deleteStatus: () => 403,
});
try {
  const sb = makeSandbox('r3-04');
  writePlan(sb.project, 'plan.json', 'r3-04', TWO_ITEMS());
  const env = baseEnv(sb, fake);
  const r = await run(sb.project, env, ['run', 'plan.json']);
  const id = taskIdOf(r);
  const c1 = await run(sb.project, env, ['collect', id], { label: 'DELETE /files/* -> 403 always' });
  const c2 = await run(sb.project, env, ['collect', id], { label: 'again' });
  const retry = await run(sb.project, env, ['retry', id]);
  const cancel = await run(sb.project, env, ['cancel', id]);
  const clean = await run(sb.project, env, ['clean', id]);
  const list = await run(sb.project, env, ['list']);
  const t = readTask(sb, id);
  logLine(`task.json: items=${JSON.stringify(t.items.map((i) => [i.id, i.state]))} attempt1.collected=${t.attempts[0].collected} finalStatus=${t.attempts[0].finalStatus}`);
  logLine(`fake log (GET/DELETE counts): GET batch=${fake.log.filter((l) => /GET \/v1\/batches\/batch/.test(l)).length}, DELETE 403=${fake.log.filter((l) => /DELETE .* -> 403/.test(l)).length}, downloads=${fake.log.filter((l) => /content -> 200/.test(l)).length}`);
  verdict('collect succeeds (exit 0, a delivered, b failed) but attempt.collected=false',
    c1.code === 0 && c2.code === 0 && t.attempts[0].collected === false && /1 delivered, 0 held, 1 failed/.test(c1.stdout));
  verdict('retry of the failed item refuses: "not collected yet and may still be running"', retry.code === 1 && /not collected yet/.test(retry.stderr));
  verdict('cancel says "already settled"', /already settled/.test(cancel.stdout));
  verdict('clean refuses without --force', clean.code === 1 && /--force/.test(clean.stderr));
  // Would recovering the delete fix it? (transient vs persistent)
  fake.hooks.deleteStatus = () => undefined;
  const c3 = await run(sb.project, env, ['collect', id], { label: 'DELETE works again' });
  const retry2 = await run(sb.project, env, ['retry', id], { label: 'after deletes succeed' });
  verdict('once DELETE succeeds, the task unwedges (so only a PERSISTENT delete failure wedges)', /batch job:/.test(retry2.stdout));
} finally {
  finish();
  await fake.close();
}
