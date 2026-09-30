// S24 (round 8, R4-1): a server answers a raw resource_read with a
// schema-invalid result. What does the Session see, and do such answered
// requests keep occupying the Runtime's live in-flight quota (32)?
//   S24_WS   first Workspace; S24_N Sessions on S24_N Workspaces (default 1)
import {
  Harness, effects, leaseHeld, mcpProfile, newSession, randomUUID, result,
  setScript, sql, startBrokerProxy, startModel,
} from './rig12946-lib.js';

const W0 = Number(process.env['S24_WS'] ?? 12);
const N = Number(process.env['S24_N'] ?? 1);
const model = await startModel();
const proxy = await startBrokerProxy();
const h = await new Harness().start(model.baseUrl, proxy.url);
setScript(() => ({ content: 'TEXT_ONLY_ANSWER' }));
const out: Record<string, unknown> = { W0, N };
const code = (r: { status: number; json: any }) =>
  `${r.status}:${r.json?.code ?? r.json?.state ?? ''}${r.json?.error?.code ? `/${r.json.error.code}` : ''}`;
const read = (sid: string, uri: string, server = 'remote', op = randomUUID()) =>
  h.call(sid, `/session/${sid}/mcp/operations`, { operationId: op, serverId: server, request: { kind: 'resource_read', uri } });
try {
  const sessions: Array<{ sessionId: string; workspaceId: string; W: number }> = [];
  for (let i = 0; i < N; i++) {
    const W = W0 + i;
    const s = await newSession(W);
    const o = await h.open(s.sessionId, s.workspaceId, mcpProfile(W, [['remote'], ['plain']]));
    if (o.status !== 200) throw new Error(`open ${W} ${o.status}`);
    sessions.push({ ...s, W });
  }
  const a = sessions[0]!;
  const e0 = effects((e) => e['phase'] === 'bad').length;
  const opBad = randomUUID();
  const bad = await read(a.sessionId, 'mem://bad', 'remote', opBad);
  out['badRead'] = code(bad);
  out['badServerRequests'] = effects((e) => e['phase'] === 'bad').length - e0;
  out['badStatus'] = code(await h.call(a.sessionId, `/session/${a.sessionId}/mcp/operations/${opBad}`));
  out['badRetrySameId'] = code(await read(a.sessionId, 'mem://bad', 'remote', opBad));
  out['sessionStatus'] = (await h.call(a.sessionId, `/session/${a.sessionId}/status`)).json;
  out['nextReadSameServer'] = code(await read(a.sessionId, 'mem://text'));
  out['nextReadOtherServer'] = code(await read(a.sessionId, 'mem://text', 'plain'));
  out['prompt'] = code((await h.prompt(a.sessionId, 'TEXT_AFTER_BAD', { wait: false })).admit);
  // Other Sessions: one bad read each, then a healthy read on another server.
  const perSession: string[] = [];
  for (const s of sessions.slice(1)) {
    const b = code(await read(s.sessionId, 'mem://bad'));
    perSession.push(`${s.W}:${b}`);
  }
  if (N > 1) {
    out['otherSessionsBad'] = perSession;
    const fresh = await newSession(W0 + N);
    const o = await h.open(fresh.sessionId, fresh.workspaceId, mcpProfile(W0 + N, [['plain']]));
    out['freshSessionOpen'] = o.status;
    out['freshSessionHealthyRead'] = code(await read(fresh.sessionId, 'mem://text', 'plain'));
    out['freshDetach'] = code(await h.call(fresh.sessionId, `/session/${fresh.sessionId}/detach`, {}));
    sessions.push({ ...fresh, W: W0 + N });
  }
  const ids = sessions.map((s) => s.sessionId);
  const eps = await sql(
    `SELECT DISTINCT b.runtime_endpoint AS ep FROM qwen_runtime_session s JOIN qwen_runtime_binding b ON b.binding_id = s.binding_id WHERE s.harness_session_id IN (${ids.map(() => '?').join(',')})`,
    ids,
  );
  out['distinctRuntimeEndpoints'] = eps.length;
  out['detachA'] = code(await h.call(a.sessionId, `/session/${a.sessionId}/detach`, {}));
  out['leaseA'] = await leaseHeld(a.W);
  out['sessionA'] = a.sessionId;
} finally {
  result('s24', out);
  await h.close();
  await model.close();
  await proxy.close();
}
