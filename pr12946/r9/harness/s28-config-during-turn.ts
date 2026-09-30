// S28 (round 9): R5-1 + R5-4 on the real stack.
// A turn is active (slow tool on `remote`) when an explicit replacement of
// the `sticky` server (rev 1 -> 2) arrives. Retiring the old sticky stdio
// connection takes > 5 s because a grandchild keeps its stdout open.
//   R5-1: the turn's refresh collides with the in-flight configuration.
//   R5-4: the old connection's drain failure must not destroy the new one.
import {
  Harness, brokerCalls, delay, effects, fakeToolCall, leaseHeld, mcpProfile,
  newSession, pin, randomUUID, result, setScript, sql, startBrokerProxy, startModel,
} from './rig12946-lib.js';

const W = Number(process.env['S28_WS'] ?? 1);
const model = await startModel();
const proxy = await startBrokerProxy();
const h = await new Harness().start(model.baseUrl, proxy.url);
const out: Record<string, unknown> = { W, arm: process.env['ARM'] };
const code = (r: { status: number; json: any }) =>
  `${r.status}:${r.json?.code ?? r.json?.state ?? ''}${r.json?.error?.code ? `/${r.json.error.code}` : ''}`;
try {
  setScript((ctx) => {
    const stickyEffect = ctx.tools.find((t) => t.description?.includes('Record one physical side effect on server sticky-'));
    const slow = ctx.tools.find((t) => t.description?.includes('milliseconds on server http,'));
    if (ctx.marker.startsWith('WARM') || ctx.marker.startsWith('AFTER')) {
      if (!ctx.receipts.length) return { toolCalls: [fakeToolCall(stickyEffect!.name, { tag: ctx.marker }, 'e')] };
      out[`${ctx.marker}_receipt`] = String(JSON.stringify(ctx.receipts[0].content)).slice(-80);
      return { content: 'DONE' };
    }
    if (ctx.marker.startsWith('SLOWTURN')) {
      if (!ctx.receipts.length) return { toolCalls: [fakeToolCall(slow!.name, { ms: 3000, tag: ctx.marker }, 's')] };
      return { content: 'DONE' };
    }
    return { content: 'TEXT' };
  });
  const s = await newSession(W);
  const opened = await h.open(s.sessionId, s.workspaceId, mcpProfile(W, [['sticky'], ['remote']]));
  out['open'] = opened.status;
  const warm = await h.prompt(s.sessionId, 'WARM_1', { timeout: 90_000 });
  out['warm'] = warm.terminal?.map((x: any) => x.stopReason ?? x.type);
  const t0 = Date.now();
  const at = () => Number(((Date.now() - t0) / 1000).toFixed(2));
  const k = brokerCalls.length;
  const turn = await h.prompt(s.sessionId, 'SLOWTURN_1', { wait: false });
  out['turnAdmit'] = turn.admit.status;
  await delay(500);
  let config: string | undefined;
  const configP = h.call(s.sessionId, `/session/${s.sessionId}/mcp/configurations`,
    { operationId: randomUUID(), expectedRevision: 1, server: pin(W, 'sticky', 2) }, 'POST', 120_000)
    .then((r) => { config = `${code(r)}@${at()}`; }, (e) => { config = `error:${e?.name}@${at()}`; });
  out['configPostedAt'] = at();
  let st: any;
  const until = Date.now() + 90_000;
  while (Date.now() < until) {
    st = (await h.call(s.sessionId, `/session/${s.sessionId}/status`)).json;
    if (!st?.hasActivePrompt) break;
    await delay(250);
  }
  out['turnEndedAt'] = at();
  out['statusAtTurnEnd'] = st;
  out['turnTerminal'] = (await h.outcome(s.sessionId, turn.promptId).catch(() => ({ terminal: 'outcome-error' }))).terminal;
  await Promise.race([configP, delay(60_000)]);
  out['config'] = config ?? `pending at ${at()}`;
  out['broker'] = brokerCalls.slice(k).filter((c) => c.kind).map((c) => `${c.kind}:${c.status}@${((c.t - t0) / 1000).toFixed(1)}`);
  out['stickyProcesses'] = effects((e) => e['method'] === 'process-start' && String(e['server']).startsWith(`sticky-${W}`)).map((e) => `${e['server']}@${((Number(e['t']) - t0) / 1000).toFixed(1)}`);
  out['statusAfterConfig'] = (await h.call(s.sessionId, `/session/${s.sessionId}/status`)).json;
  const after = await h.prompt(s.sessionId, 'AFTER_1', { timeout: 90_000 }).catch((e) => ({ admit: { status: `error:${String(e).slice(0, 60)}` } as any, terminal: undefined }));
  out['afterTurn'] = { admit: after.admit.status, body: after.admit.status === 202 ? undefined : after.admit.json, terminal: after.terminal?.map((x: any) => x.stopReason ?? x.type) };
  out['catalog'] = (await h.call(s.sessionId, `/session/${s.sessionId}/mcp-catalog`)).json?.catalogs?.map((c: any) => [c.serverId, c.serverRevision, c.configRevision, c.catalogRevision]);
  const tries: string[] = [];
  for (let i = 0; i < Number(process.env['S28_TRIES'] ?? 9); i++) {
    const kd = brokerCalls.length;
    const d = await h.call(s.sessionId, `/session/${s.sessionId}/detach`, {});
    tries.push(`${code(d)}@${at()} [${brokerCalls.slice(kd).filter((c) => c.kind === 'mcp-release' || c.kind === 'mcp-status').map((c) => { const r = String(c.response ?? ''); const st = r.match(/"state":"([a-z_]+)"/)?.[1]; const er = r.match(/"error":\{"code":"([a-z_]+)"/)?.[1]; return `${c.kind}:${c.status}:${st ?? '?'}${er ? '/' + er : ''}`; }).filter((x, n, a) => a.indexOf(x) === n).join(', ')}]`);
    if (d.status === 204 || d.status === 404) break;
    await delay(15_000);
  }
  out['detachTries'] = tries;
  out['records'] = (await sql("SELECT CAST(r.inline_bytes AS CHAR) AS body FROM qwen_managed_session_extension_record e JOIN qwen_managed_session_resource r ON r.session_scope_key = e.session_scope_key AND r.resource_id = e.record_resource_id WHERE e.session_id = ? AND e.domain = 'mcp_configuration'", [s.sessionId]))
    .map((x: any) => { const b = JSON.parse(x.body); const r = b.record ?? b; return `rev${r.configRevision}/${r.serverRevision}:${r.run.state}/${r.run.execution}/${r.releaseState}`; });
  out['lease'] = await leaseHeld(W);
} finally {
  result('s28', out);
  await h.close();
  await model.close();
  await proxy.close();
}
