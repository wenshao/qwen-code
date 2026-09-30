// S25b (round 8): MCP operations the Broker refuses before forwarding.
//   value  prompt_get arguments.topic = "a\uD800b"      (R4-9 guard)
//   key    prompt_get arguments key  "top\uDC00ic"      (R4-9 guard)
//   big    prompt_get arguments.topic of 300 KiB        (R4-8, 256 KiB limit)
//   S25_CASE=value|key|big ; control first: a well-formed astral character.
// Then: can the Session be recovered (cancel, detach, reload in a new Harness)?
import {
  Harness, brokerCalls, effects, leaseHeld, mcpProfile, newSession, randomUUID,
  result, setScript, startBrokerProxy, startModel,
} from './rig12946-lib.js';

const W = Number(process.env['S25_WS'] ?? 22);
const CASE = process.env['S25_CASE'] ?? 'value';
const model = await startModel();
const proxy = await startBrokerProxy();
let h = await new Harness().start(model.baseUrl, proxy.url);
setScript(() => ({ content: 'TEXT_ONLY_ANSWER' }));
const out: Record<string, unknown> = { W, case: CASE, arm: process.env['ARM'] };
const code = (r: { status: number; json: any }) =>
  `${r.status}:${r.json?.code ?? r.json?.state ?? ''}${r.json?.error?.code ? `/${r.json.error.code}` : ''}`;
const prompts = () => effects((e) => e['method'] === 'prompts/get');
const kinds = (from: number) => brokerCalls.slice(from).filter((c) => c.kind).map((c) => `${c.kind}:${c.status}`);
try {
  const s = await newSession(W);
  const profile = mcpProfile(W, [['remote']]);
  await h.open(s.sessionId, s.workspaceId, profile);
  const op = (request: unknown, id = randomUUID()) =>
    h.call(s.sessionId, `/session/${s.sessionId}/mcp/operations`, { operationId: id, serverId: 'remote', request });
  let p = prompts().length;
  const ok = await op({ kind: 'prompt_get', name: 'two', arguments: { topic: 'a\u{1F600}b' } });
  out['control'] = { post: code(ok), messages: ok.json?.response?.messages?.length, serverSawTopic: prompts().slice(p).map((e) => e['topic']) };
  const args = CASE === 'value' ? { topic: 'a\uD800b' }
    : CASE === 'key' ? { ['top\uDC00ic']: 'x', topic: 'y' }
    : { topic: 'x'.repeat(300 * 1024) };
  p = prompts().length;
  const k = brokerCalls.length;
  const id = randomUUID();
  const bad = await op({ kind: 'prompt_get', name: 'two', arguments: args }, id);
  out['case'] = {
    post: code(bad), messages: bad.json?.response?.messages?.length,
    serverSawTopic: prompts().slice(p).map((e) => String(e['topic']).slice(0, 12)),
    broker: kinds(k),
  };
  out['statusAfter'] = (await h.call(s.sessionId, `/session/${s.sessionId}/status`)).json;
  out['nextRead'] = code(await op({ kind: 'resource_read', uri: 'mem://text' }));
  out['cancel'] = code(await h.call(s.sessionId, `/session/${s.sessionId}/mcp/operations/${id}/cancel`, {}));
  out['opStatusAfterCancel'] = code(await h.call(s.sessionId, `/session/${s.sessionId}/mcp/operations/${id}`));
  out['detach'] = code(await h.call(s.sessionId, `/session/${s.sessionId}/detach`, {}));
  if (!String(out['detach']).startsWith('204')) {
    // A new Harness process loads the Session and tries again.
    await h.close();
    h = await new Harness().start(model.baseUrl, proxy.url);
    const l = await h.open(s.sessionId, s.workspaceId, profile, 'load');
    out['reloadInNewHarness'] = code(l);
    if (l.status === 200) {
      out['statusAfterReload'] = (await h.call(s.sessionId, `/session/${s.sessionId}/status`)).json;
      out['detachAfterReload'] = code(await h.call(s.sessionId, `/session/${s.sessionId}/detach`, {}));
    }
  }
  out['lease'] = await leaseHeld(W);
  out['sessionId'] = s.sessionId;
} finally {
  result(`s25b-${CASE}`, out);
  await h.close();
  await model.close();
  await proxy.close();
}
