// Close an ACTIVE unbound Session whose Harness is gone (SIGKILL). The writer
// lease (20 s) expires on its own; every settle attempt fails.
import { opProbe, sample } from './close-common.mjs';
export default async function (ctx) {
  ctx.springEnvExtra.QWEN_MANAGED_AGENT_SESSION_STORE_WRITER_LEASE_DURATION = '20s';
  await ctx.startSpring(ctx.FAST_RETRY);
  ctx.seedWorkspace();
  await ctx.startHarness();
  const sid = await ctx.createSession('[OK] session to close');
  ctx.result.sessionId = sid;
  await ctx.waitTurnTerminal(sid, 60000);
  await ctx.stopHarness('SIGKILL');
  const probe = opProbe(ctx, sid);
  const close = await ctx.api('POST', `/v1/agents/sessions/${sid}/close`, {}, { 'idempotency-key': 'close-k1' });
  ctx.result.close = { status: close.status, body: close.json ?? close.text };
  ctx.mark('close', ctx.result.close);
  ctx.result.samples = await sample(ctx, probe, 60000, 500);
  const opId = close.json?.operation_id ?? close.json?.id;
  if (opId) ctx.result.publicOp = (await ctx.api('GET', `/v1/agents/sessions/${sid}/operations/${opId}`)).json;
  ctx.result.session = (await ctx.api('GET', `/v1/agents/sessions/${sid}`)).json;
  // What can the caller do now? Harness back, same key, then a new key.
  await ctx.startHarness();
  const replay = await ctx.api('POST', `/v1/agents/sessions/${sid}/close`, {}, { 'idempotency-key': 'close-k1' });
  const fresh = await ctx.api('POST', `/v1/agents/sessions/${sid}/close`, {}, { 'idempotency-key': 'close-k2' });
  ctx.result.afterRecovery = { replay: { status: replay.status, body: replay.json ?? replay.text }, fresh: { status: fresh.status, body: fresh.json ?? fresh.text } };
  ctx.mark('afterRecovery', ctx.result.afterRecovery);
  ctx.result.samplesAfter = await sample(ctx, probe, 15000, 500);
  await ctx.stopSpring();
  await ctx.startSpring(ctx.FAST_RETRY);
  ctx.result.samplesAfterSpringRestart = await sample(ctx, probe, 20000, 500);
  const fresh3 = await ctx.api('POST', `/v1/agents/sessions/${sid}/close`, {}, { 'idempotency-key': 'close-k3' });
  ctx.result.freshAfterSpringRestart = { status: fresh3.status, body: fresh3.json ?? fresh3.text };
  const del = await ctx.api('DELETE', `/v1/agents/sessions/${sid}`, undefined, { 'idempotency-key': 'delete-k1' });
  ctx.result.deleteAfter = { status: del.status, body: del.json ?? del.text };
  ctx.result.samplesDelete = await sample(ctx, probe, 10000, 500);
  ctx.result.exhaustedLog = ctx.logLines('spring', /operation exhausted retries/).map((l) => l.replace(/.*Coordinator\s+:\s*/, '').slice(0, 200));
  ctx.mark('summary', { afterSpringRestart: ctx.result.samplesAfterSpringRestart.at(-1), fresh3: ctx.result.freshAfterSpringRestart, close: ctx.result.close.status, last: ctx.result.samples.at(-1), afterRecovery: ctx.result.afterRecovery, deleteAfter: ctx.result.deleteAfter, lastDelete: ctx.result.samplesDelete.at(-1) });
}
