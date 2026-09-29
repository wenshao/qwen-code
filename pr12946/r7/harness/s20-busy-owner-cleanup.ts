// S20 (round 7): 9957facb lets a refused Session B detach (204) while A holds
// the Workspace. That path releases an incomplete acquisition through
// WorkspaceExecutionStore. It must not release A's storage lease.
import { createHash } from 'node:crypto';
import {
  Harness, effects, fakeToolCall, mcpProfile, newSession, result, rig,
  setScript, sql, startBrokerProxy, startModel,
} from './rig12946-lib.js';
import { readFile } from 'node:fs/promises';

const W = Number(process.env['S20_WS'] ?? 6);
const model = await startModel();
const proxy = await startBrokerProxy();
const h = await new Harness().start(model.baseUrl, proxy.url);
const out: Record<string, unknown> = {};
const key = createHash('sha256').update(`${rig.tenantId}\u0000storage-${W}`).digest('hex');
const holder = async () => (await sql('SELECT holder_key, runtime_session_id, binding_id, runtime_generation FROM managed_workspace_execution_lease WHERE storage_key = ?', [key]))[0] ?? null;
try {
  setScript((ctx) => {
    if (ctx.marker.startsWith('MCP')) {
      if (!ctx.receipts.length) return { toolCalls: [fakeToolCall(ctx.tools.find((t) => t.description?.includes('side effect on server http.'))!.name, { tag: ctx.marker }, 'e')] };
      return { content: 'DONE' };
    }
    if (ctx.marker.startsWith('FILE')) {
      if (!ctx.receipts.length) return { toolCalls: [fakeToolCall('write_file', { file_path: `${ctx.marker}.txt`, content: ctx.marker }, 'w')] };
      return { content: 'DONE' };
    }
    return { content: 'TEXT' };
  });
  const t = async (sid: string, m: string) => { const e0 = effects().length; const r = await h.prompt(sid, m, { timeout: 120_000 }); return { admit: r.admit.status, terminal: r.terminal?.map((x: any) => x.stopReason ?? x.type), effects: effects().length - e0 }; };
  const a = await newSession(W), b = await newSession(W), c = await newSession(W);
  await h.open(a.sessionId, a.workspaceId, mcpProfile(W, [['remote']]));
  await h.open(b.sessionId, b.workspaceId, mcpProfile(W, [['remote']]));
  await h.open(c.sessionId, c.workspaceId, { toolProfile: 'hosted-workspace-files/1' });
  out['A1'] = await t(a.sessionId, 'MCP_A1');
  const h0 = await holder();
  out['holderAfterA1'] = h0 && { runtime: h0['runtime_session_id'], binding: h0['binding_id'] };
  out['B_prompt'] = await t(b.sessionId, 'MCP_B1');
  out['B_detach'] = (await h.call(b.sessionId, `/session/${b.sessionId}/detach`, {})).status;
  const h1 = await holder();
  out['holderAfterBDetach'] = h1 && { runtime: h1['runtime_session_id'], binding: h1['binding_id'] };
  out['holderUnchanged'] = !!h0 && !!h1 && h0['holder_key'] === h1['holder_key'] && h0['runtime_generation'] === h1['runtime_generation'];
  out['A2_after_B_detach'] = await t(a.sessionId, 'MCP_A2');
  out['C_files_while_A'] = { ...(await t(c.sessionId, 'FILE_C1')), file: await readFile(`${c.directory}/FILE_C1.txt`, 'utf8').catch(() => null) };
  out['A_detach'] = (await h.call(a.sessionId, `/session/${a.sessionId}/detach`, {})).status;
  out['holderAfterADetach'] = (await holder())?.['holder_key'] ?? null;
  out['C_files_after_A'] = { ...(await t(c.sessionId, 'FILE_C2')), file: await readFile(`${c.directory}/FILE_C2.txt`, 'utf8').catch(() => null) };
  out['C_detach'] = (await h.call(c.sessionId, `/session/${c.sessionId}/detach`, {})).status;
} finally {
  result('s20', out);
  await h.close();
  await model.close();
  await proxy.close();
}
