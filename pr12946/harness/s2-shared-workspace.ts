// S2: an attached MCP Session holds the Workspace execution lease between
// turns. What happens to a second Session (MCP or file profile) in the same
// Workspace, and to the same Session's own file tools?
import {
  Harness, effects, fakeToolCall, mcpProfile, newSession, result, say,
  setScript, sql, startBrokerProxy, startModel, toolFor, brokerCalls,
} from './rig12946-lib.js';
import { readFile } from 'node:fs/promises';

const W = Number(process.env['S2_WS'] ?? 1);
const model = await startModel();
const proxy = await startBrokerProxy();
const h = await new Harness().start(model.baseUrl, proxy.url);
const out: Record<string, unknown> = {};
const lease = async () =>
  (await sql('SELECT runtime_session_id FROM managed_workspace_execution_lease')).map((r) => r['runtime_session_id']);
try {
  setScript((ctx) => {
    if (ctx.marker.startsWith('MCP_EFFECT')) {
      if (!ctx.receipts.length)
        return { toolCalls: [fakeToolCall(toolFor(ctx, 'server http.'), { tag: ctx.marker }, 'c1')] };
      return { content: `DONE ${String(JSON.stringify(ctx.receipts[0].content)).slice(0, 160)}` };
    }
    if (ctx.marker.startsWith('WRITE_FILE')) {
      if (!ctx.receipts.length)
        return { toolCalls: [fakeToolCall('write_file', { file_path: `${ctx.marker}.txt`, content: ctx.marker }, 'w1')] };
      return { content: `DONE ${String(JSON.stringify(ctx.receipts[0].content)).slice(0, 160)}` };
    }
    return { content: 'TEXT' };
  });
  const a = await newSession(W);
  const b = await newSession(W);
  const c = await newSession(W);
  await h.open(a.sessionId, a.workspaceId, mcpProfile(W, [['remote']]));
  await h.open(b.sessionId, b.workspaceId, mcpProfile(W, [['remote']]));
  await h.open(c.sessionId, c.workspaceId, { toolProfile: 'hosted-workspace-files/1' });
  const ra = await h.prompt(a.sessionId, 'MCP_EFFECT_A1');
  out['A1'] = ra.terminal;
  out['leaseAfterA1'] = await lease();
  // A's own file tool in the same MCP Session.
  const raf = await h.prompt(a.sessionId, 'WRITE_FILE_A');
  out['A_file'] = { terminal: raf.terminal, fileExists: await readFile(`${a.directory}/WRITE_FILE_A.txt`, 'utf8').catch(() => null) };
  const e0 = effects().length;
  const callsBeforeB = brokerCalls.length;
  const rb = await h.prompt(b.sessionId, 'MCP_EFFECT_B1');
  out['B1_while_A_attached'] = { admit: rb.admit.status, admitBody: rb.admit.json, terminal: rb.terminal, status: rb.status, effects: effects().length - e0,
    broker: brokerCalls.slice(callsBeforeB).map((x) => `${x.url.split('/').pop()?.slice(0, 40)}:${x.kind ?? ''}:${x.status}`) };
  const rc = await h.prompt(c.sessionId, 'WRITE_FILE_C1');
  out['C1_files_while_A_attached'] = { terminal: rc.terminal, status: rc.status, file: await readFile(`${c.directory}/WRITE_FILE_C1.txt`, 'utf8').catch(() => null) };
  out['leaseWhileA'] = await lease();
  say('detach A', (await h.call(a.sessionId, `/session/${a.sessionId}/detach`, {})).status);
  out['leaseAfterADetach'] = await lease();
  const rb2 = await h.prompt(b.sessionId, 'MCP_EFFECT_B2');
  out['B2_after_A_detach'] = { admit: rb2.admit.status, terminal: rb2.terminal, status: rb2.status };
  const rc2 = await h.prompt(c.sessionId, 'WRITE_FILE_C2');
  out['C2_after_A_detach_while_B_attached'] = { terminal: rc2.terminal, status: rc2.status };
  out['detachB'] = (await h.call(b.sessionId, `/session/${b.sessionId}/detach`, {})).status;
  const rc3 = await h.prompt(c.sessionId, 'WRITE_FILE_C3');
  out['C3_after_B_detach'] = { terminal: rc3.terminal, status: rc3.status };
  out['detachC'] = (await h.call(c.sessionId, `/session/${c.sessionId}/detach`, {})).status;
  out['leaseEnd'] = await lease();
} finally {
  result('s2', out);
  await h.close();
  await model.close();
  await proxy.close();
}
