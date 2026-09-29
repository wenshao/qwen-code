// S8: limits. (a) repeated reconfiguration of one stdio server: are retired
// connections closed, and when does the 16-connection quota bite?
// (b) 16 KiB catalog category and 60 KiB raw result limits.
import { execFileSync } from 'node:child_process';
import {
  Harness, effects, fakeToolCall, mcpProfile, newSession, randomUUID, result,
  say, setScript, sql, startBrokerProxy, startModel, toolFor,
} from './rig12946-lib.js';

const model = await startModel();
const proxy = await startBrokerProxy();
const h = await new Harness().start(model.baseUrl, proxy.url);
const out: Record<string, unknown> = {};
const procs = (name: string) =>
  execFileSync('ps', ['-axo', 'pid=,command=']).toString().split('\n')
    .filter((l) => l.includes('mcp-server.mjs') && l.includes(`--name ${name} `) && l.includes(process.env['RIG_RUN']!)).length;
try {
  setScript((ctx) => {
    if (ctx.marker.startsWith('EFFECT')) {
      if (!ctx.receipts.length)
        return { toolCalls: [fakeToolCall(toolFor(ctx, `server stdio-${Number(process.env.S8_A ?? 9)}.`), { tag: ctx.marker }, 'e')] };
      out[`${ctx.marker}`] = String(JSON.stringify(ctx.receipts[0].content)).slice(0, 120);
      return { content: 'DONE' };
    }
    if (ctx.marker === 'MANY') {
      if (!ctx.receipts.length) {
        out['manyAdvertised'] = ctx.tools.filter((t) => t.name.startsWith('mcp_')).length;
        out['manyHasEffect'] = ctx.tools.some((t) => t.description?.includes('side effect'));
        out['manyToolsBytes'] = JSON.stringify(ctx.tools).length;
        return { toolCalls: [fakeToolCall(toolFor(ctx, `requested byte size from stdio-${Number(process.env.S8_B ?? 10)}.`), { bytes: 70_000 }, 'b')] };
      }
      out['bigReceipt'] = String(JSON.stringify(ctx.receipts[0].content)).slice(0, 200);
      return { content: 'DONE' };
    }
    return { content: 'TEXT' };
  });
  // (a) reconfiguration churn
  const s = await newSession(Number(process.env.S8_A ?? 9));
  const profile = mcpProfile(Number(process.env.S8_A ?? 9), [['local']]);
  await h.open(s.sessionId, s.workspaceId, profile);
  out['first'] = (await h.prompt(s.sessionId, 'EFFECT_0')).terminal;
  out['procsAfterFirst'] = procs(`stdio-${Number(process.env.S8_A ?? 9)}`);
  const history: string[] = [];
  for (let rev = 1; rev <= 17; rev++) {
    const r = await h.call(s.sessionId, `/session/${s.sessionId}/mcp/configurations`, {
      operationId: randomUUID(), expectedRevision: rev, server: profile.mcpServers[0],
    });
    history.push(`${rev + 1}:${r.status}:${procs(`stdio-${Number(process.env.S8_A ?? 9)}`)}`);
    if (r.status !== 202) break;
  }
  out['reconfigure(rev:status:liveStdioProcs)'] = history;
  const after = await h.prompt(s.sessionId, 'EFFECT_AFTER');
  out['promptAfterChurn'] = after.terminal;
  out['statusAfterChurn'] = after.status;
  const k = Date.now();
  const d = await h.call(s.sessionId, `/session/${s.sessionId}/detach`, {});
  out['detach'] = { status: d.status, ms: Date.now() - k, procsAfter: procs(`stdio-${Number(process.env.S8_A ?? 9)}`) };
  // (b) catalog and result limits
  const m = await newSession(Number(process.env.S8_B ?? 10));
  await h.open(m.sessionId, m.workspaceId, mcpProfile(Number(process.env.S8_B ?? 10), [['many']]));
  const mr = await h.prompt(m.sessionId, 'MANY');
  out['manyTerminal'] = mr.terminal;
  out['manyCatalog'] = (await h.call(m.sessionId, `/session/${m.sessionId}/mcp-catalog`)).json?.catalogs?.map((c: any) => [c.tools.length, c.discovery]);
  out['manyStatus'] = mr.status;
  out['manyDetach'] = (await h.call(m.sessionId, `/session/${m.sessionId}/detach`, {})).status;
} finally {
  result('s8', out);
  await h.close();
  await model.close();
  await proxy.close();
}
