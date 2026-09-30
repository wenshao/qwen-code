// S25d (round 8): the model calls write_file (files profile) with a lone surrogate in its
// arguments (the durable tool-call path, not the raw operation route).
import {
  Harness, effects, fakeToolCall, leaseHeld, mcpProfile, newSession, result,
  setScript, sql, startBrokerProxy, startModel,
} from './rig12946-lib.js';

const W = Number(process.env['S25_WS'] ?? 9);
const model = await startModel();
const proxy = await startBrokerProxy();
const h = await new Harness().start(model.baseUrl, proxy.url);
const out: Record<string, unknown> = { W, arm: process.env['ARM'] };
try {
  setScript((ctx) => {
    const effect = 'write_file';
    if (ctx.marker.startsWith('LONE') || ctx.marker.startsWith('OK')) {
      if (!ctx.receipts.length)
        return { toolCalls: [fakeToolCall(effect, { file_path: `${ctx.marker}.txt`, content: ctx.marker.startsWith('LONE') ? 'a\uD800b' : ctx.marker }, 'e')] };
      out[`${ctx.marker}_receipt`] = String(JSON.stringify(ctx.receipts[0].content)).slice(0, 200);
      return { content: 'DONE' };
    }
    return { content: 'TEXT_ONLY_ANSWER' };
  });
  const s = await newSession(W);
  await h.open(s.sessionId, s.workspaceId, { toolProfile: 'hosted-workspace-files/1' });
  const saw = (m: string) => effects((e) => String(e['tag'] ?? '').startsWith(m)).map((e) => [...String(e['tag'])].map((c) => c.codePointAt(0)!.toString(16)).slice(-4).join(' '));
  const ok = await h.prompt(s.sessionId, 'OK_1');
  out['control'] = { terminal: ok.terminal?.map((x: any) => x.stopReason ?? x.type), serverSaw: saw('OK_1').length };
  const t0 = Date.now();
  const r0 = await h.prompt(s.sessionId, 'LONE_1', { wait: false });
  const samples: string[] = [];
  let st: any;
  while (Date.now() - t0 < 700_000) {
    await new Promise((res) => setTimeout(res, 15_000));
    st = (await h.call(s.sessionId, `/session/${s.sessionId}/status`)).json;
    const ex = await sql('SELECT execution_state, execution_status FROM qwen_tool_execution WHERE harness_session_id = ? ORDER BY 1', [s.sessionId]);
    const line = `active=${st.hasActivePrompt} blocked=${st.recoveryBlocked} exec=${ex.map((e: any) => e.execution_state).join("|")}`;
    if (samples.at(-1)?.split("@")[0] !== line) samples.push(`${line}@${((Date.now() - t0) / 1000).toFixed(0)}s`);
    if (!st.hasActivePrompt) break;
  }
  const r: any = { admit: r0.admit, ...(await h.outcome(s.sessionId, r0.promptId).catch((e: unknown) => ({ terminal: [{ type: `outcome-error:${String(e).slice(0, 80)}` }] }))) };
  out['lone'] = { admit: r.admit.status, terminal: r.terminal?.map((x: any) => x.stopReason ?? x.type), samples, serverSawTailCodepoints: saw('LONE_1') };
  const n = await h.prompt(s.sessionId, 'TEXT_AFTER', { timeout: 60_000 });
  out['nextPrompt'] = { admit: n.admit.status, body: n.admit.status === 202 ? undefined : n.admit.json, terminal: n.terminal?.map((x: any) => x.stopReason ?? x.type) };
  out['detach'] = (await h.call(s.sessionId, `/session/${s.sessionId}/detach`, {})).status;
  out['lease'] = await leaseHeld(W);
} finally {
  result('s25d', out);
  await h.close();
  await model.close();
  await proxy.close();
}
