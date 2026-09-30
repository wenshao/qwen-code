// S1: happy path across stdio + Streamable HTTP + SSE, resource/prompt
// operations, duplicate/conflicting IDs, catalogs, detach/load.
import {
  Harness, assert, brokerCalls, effects, fakeToolCall, mcpProfile, newSession,
  publicCatalog, randomUUID, result, say, setScript, sql, startBrokerProxy,
  startModel, toolFor, modelRequests,
} from './rig12946-lib.js';

const model = await startModel();
const proxy = await startBrokerProxy();
const h = await new Harness().start(model.baseUrl, proxy.url);
const out: Record<string, unknown> = {};
try {
  const W1 = Number(process.env['S1_WS'] ?? 0);
  const s = await newSession(W1);
  const profile = mcpProfile(W1, [['local'], ['remote'], ['legacy']]);
  const opened = await h.open(s.sessionId, s.workspaceId, profile);
  say('open', opened.status, opened.json);
  assert.equal(opened.status, 200);
  let phaseAtSecondRequest: unknown;
  setScript(async (ctx) => {
    if (ctx.marker === 'RUN_MCP') {
      if (ctx.receipts.length === 0) {
        out['advertised'] = ctx.tools.map((t) => `${t.name}: ${t.description?.slice(0, 40)}`);
        return {
          content: 'Calling three servers.',
          toolCalls: [
            fakeToolCall(toolFor(ctx, `server stdio-${W1}.`), { tag: 't-stdio' }, 'c-stdio'),
            fakeToolCall(toolFor(ctx, 'server http.'), { tag: 't-http' }, 'c-http'),
            fakeToolCall(toolFor(ctx, 'server sse.'), { tag: 't-sse' }, 'c-sse'),
          ],
        };
      }
      const rows = await sql(
        "SELECT JSON_UNQUOTE(JSON_EXTRACT(CONVERT(r.inline_bytes USING utf8mb4), '$.continuation.phase')) AS phase" +
          ' FROM qwen_managed_session_journal_head h JOIN qwen_managed_session_resource r' +
          ' ON r.tenant_id = h.tenant_id AND r.session_id = h.session_id AND r.resource_id = h.latest_checkpoint_resource_id' +
          ' WHERE h.session_id = ?',
        [s.sessionId],
      );
      phaseAtSecondRequest = rows[0]?.['phase'];
      out['receipts'] = ctx.receipts.map((r) => [r.tool_call_id, String(JSON.stringify(r.content)).slice(0, 90)]);
      return { content: 'MCP_DONE' };
    }
    if (ctx.marker === 'WHOAMI') {
      if (ctx.receipts.length === 0)
        return { toolCalls: [fakeToolCall(toolFor(ctx, `environment of server stdio-${W1}.`), {}, 'c-who')] };
      out['whoami'] = String(JSON.stringify(ctx.receipts[0].content));
      return { content: 'WHO_DONE' };
    }
    if (ctx.marker === 'AFTER_LOAD') {
      if (ctx.receipts.length === 0)
        return { toolCalls: [fakeToolCall(toolFor(ctx, 'server http.'), { tag: 't-after-load' }, 'c-al')] };
      out['afterLoadReceipt'] = String(JSON.stringify(ctx.receipts[0].content)).slice(0, 90);
      out['afterLoadTools'] = ctx.tools.map((t) => t.name);
      return { content: 'AL_DONE' };
    }
    return { content: 'TEXT' };
  });
  const before = effects().length;
  const run = await h.prompt(s.sessionId, 'RUN_MCP');
  say('RUN_MCP', run.terminal, run.status);
  out['runTerminal'] = run.terminal;
  out['phaseAtSecondModelRequest'] = phaseAtSecondRequest;
  out['effectsRun'] = effects().slice(before).map((e) => `${e['server']}:${e['name']}:${e['tag']}`);
  out['modelRequests'] = modelRequests.length;

  const who = await h.prompt(s.sessionId, 'WHOAMI');
  out['whoTerminal'] = who.terminal;

  // Private and public catalogs must not leak recipes or credentials.
  const privateCatalog = await h.call(s.sessionId, `/session/${s.sessionId}/mcp-catalog`);
  const pub = await publicCatalog(s.sessionId);
  const leaks = (text: string) =>
    ['secret-token', 'Bearer', '18811', '18812', 'mcp-server.mjs', 'MCP_TOKEN', 'RIG_SDK', '127.0.0.1', 'command', 'headers']
      .filter((needle) => text.includes(needle));
  out['privateCatalog'] = { status: privateCatalog.status, servers: privateCatalog.json?.catalogs?.map((c: any) => [c.serverId, c.catalogRevision, c.connectionGeneration, c.discovery]), leaks: leaks(JSON.stringify(privateCatalog.json)) };
  out['publicCatalog'] = { status: pub.status, leaks: leaks(pub.text), servers: JSON.parse(pub.text).servers?.map((x: any) => [x.server_id, x.catalog_revision, x.tools.length, x.resources.length, x.prompts.length, x.discovery]) };

  // Resource/prompt operations on each transport.
  const op = async (operationId: string, serverId: string, request: unknown) =>
    h.call(s.sessionId, `/session/${s.sessionId}/mcp/operations`, { operationId, serverId, request });
  const blobId = randomUUID();
  const e0 = effects().length;
  const blob = await op(blobId, 'remote', { kind: 'resource_read', uri: 'mem://blob' });
  const expected = Buffer.from(Array.from({ length: 300 }, (_, i) => (i * 37 + 11) & 0xff)).toString('base64');
  out['blob'] = { status: blob.status, state: blob.json?.state, exact: blob.json?.response?.contents?.[0]?.blob === expected };
  const promptId = randomUUID();
  const prompt = await op(promptId, 'legacy', { kind: 'prompt_get', name: 'two', arguments: { topic: 'sse' } });
  out['prompt'] = { status: prompt.status, messages: prompt.json?.response?.messages?.map((m: any) => `${m.role}:${m.content.text}`) };
  const text = await op(randomUUID(), 'local', { kind: 'resource_read', uri: 'mem://text' });
  out['stdioText'] = { status: text.status, text: text.json?.response?.contents?.[0]?.text };
  const e1 = effects().length;
  const replay = await op(blobId, 'remote', { kind: 'resource_read', uri: 'mem://blob' });
  const conflict = await op(blobId, 'remote', { kind: 'resource_read', uri: 'mem://text' });
  const conflictServer = await op(blobId, 'local', { kind: 'resource_read', uri: 'mem://blob' });
  out['replay'] = { status: replay.status, same: JSON.stringify(replay.json) === JSON.stringify(blob.json) };
  out['conflict'] = { status: conflict.status, body: conflict.json, serverConflict: conflictServer.status };
  out['opEffects'] = { ops: e1 - e0, replayAndConflict: effects().length - e1 };
  const status = await h.call(s.sessionId, `/session/${s.sessionId}/mcp/operations/${promptId}`);
  out['statusAfter'] = { status: status.status, state: status.json?.state };

  // Detach releases the connections; load installs a new configuration.
  const callsBeforeDetach = brokerCalls.length;
  const detach = await h.call(s.sessionId, `/session/${s.sessionId}/detach`, {});
  out['detach'] = { status: detach.status, brokerCalls: brokerCalls.slice(callsBeforeDetach).map((c) => `${c.url.replace(/[0-9a-f-]{36}/g, '<id>')}:${c.kind ?? ''}:${c.status}`) };
  const records = await sql(
    'SELECT domain, record_id, revision, task_kind FROM qwen_managed_session_extension_record WHERE session_id = ? ORDER BY domain, record_id',
    [s.sessionId],
  );
  out['recordsAfterDetach'] = records.map((r) => `${r['domain']}:${r['revision']}:${r['task_kind']}`);
  const tasks = await fetch(`${(await import('./rig12946-lib.js')).rig.storeUrl}/v1/agents/sessions/${s.sessionId}/tasks`, { headers: { 'X-Qwen-Tenant-Id': 't-rig', 'X-Rig-Actor': 'actor' } });
  out['publicTasks'] = { status: tasks.status, body: (await tasks.text()).slice(0, 200) };
  const loaded = await h.open(s.sessionId, s.workspaceId, profile, 'load');
  out['load'] = loaded.status;
  const al = await h.prompt(s.sessionId, 'AFTER_LOAD');
  out['afterLoad'] = al.terminal;
  const replayAfterLoad = await op(promptId, 'legacy', { kind: 'prompt_get', name: 'two', arguments: { topic: 'sse' } });
  out['replayAfterLoad'] = { status: replayAfterLoad.status, same: JSON.stringify(replayAfterLoad.json) === JSON.stringify(prompt.json) };
  const pub2 = await publicCatalog(s.sessionId);
  out['publicCatalogAfterLoad'] = JSON.parse(pub2.text).servers?.map((x: any) => [x.server_id, x.catalog_revision, x.discovery.tools]);
  const finalDetach = await h.call(s.sessionId, `/session/${s.sessionId}/detach`, {});
  out['finalDetach'] = finalDetach.status;
  out['totalEffects'] = effects().length;
  out['brokerSummary'] = Object.entries(
    brokerCalls.reduce<Record<string, number>>((acc, c) => {
      const key = `${c.url.replace(/[0-9a-f-]{36}/g, '<id>').replace(/mcp:[^/:]+(:[0-9a-f]+)?/g, 'mcp:<sid>')} ${c.kind ?? ''} ${c.status}`;
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {}),
  );
} finally {
  result('s1', out);
  await h.close();
  await model.close();
  await proxy.close();
}
