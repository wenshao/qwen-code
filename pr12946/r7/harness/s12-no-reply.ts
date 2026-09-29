// S12 (round 3): an MCP tool call whose reply can never arrive.
//   S12_MODE=conn-lost  SSE server restarted while the call runs
//   S12_MODE=hung       'short' server (timeoutMs 5000), tool never returns
// Records the timeline until the turn ends (up to 720 s) and the aftermath.
import { execFileSync } from 'node:child_process';
import {
  Harness, RUN, delay, fakeToolCall, ledger, mcpProfile, newSession, randomUUID,
  result, say, setScript, sql, startBrokerProxy, startModel, toolFor, waitUntil,
  leaseHeld,
} from './rig12946-lib.js';

const MODE = process.env['S12_MODE'] ?? 'conn-lost';
const W = Number(process.env['S12_WS'] ?? 12);
const [server, needle, ms] =
  MODE === 'conn-lost' ? ['legacy', 'on server sse,', 20_000] : ['short', 'on server http2,', 1_000_000_000];
const srv = (...args: string[]) => execFileSync(`${process.env['RIG_DIR']}/srv.sh`, [RUN, ...args]);
const model = await startModel();
const proxy = await startBrokerProxy();
const h = await new Harness().start(model.baseUrl, proxy.url);
const tag = `${MODE}-${randomUUID().slice(0, 6)}`;
const out: Record<string, unknown> = { mode: MODE, server, tag };
const t0 = Date.now();
const at = () => Number(((Date.now() - t0) / 1000).toFixed(1));
try {
  setScript((ctx) => {
    if (ctx.marker === 'SLOW') {
      if (!ctx.receipts.length) return { toolCalls: [fakeToolCall(toolFor(ctx, needle), { ms, tag }, 's')] };
      out['slowReceipt'] = String(JSON.stringify(ctx.receipts[0].content)).slice(0, 200);
      return { content: 'SLOW_DONE' };
    }
    if (ctx.marker === 'NEXT') {
      if (!ctx.receipts.length) return { toolCalls: [fakeToolCall(toolFor(ctx, needle.replace(/^on /, '').replace('server ', 'side effect on server ').replace(/,$/, '.')), { tag: `${tag}-next` }, 'n')] };
      out['nextReceipt'] = String(JSON.stringify(ctx.receipts[0].content)).slice(0, 160);
      return { content: 'NEXT_DONE' };
    }
    return { content: 'TEXT' };
  });
  const s = await newSession(W);
  await h.open(s.sessionId, s.workspaceId, mcpProfile(W, [[server]]));
  const run = h.prompt(s.sessionId, 'SLOW', { wait: false });
  await waitUntil(() => ledger().some((e) => e['tag'] === tag && e['phase'] === 'start'), 60_000);
  out['toolStartAt'] = at();
  if (MODE === 'conn-lost') {
    await delay(2000);
    srv('stop', 'sse', 'sse', '18812');
    out['serverStoppedAt'] = at();
    await delay(2000);
    srv('start', 'sse', 'sse', '18812', '--token', 'sse-secret-token');
    out['serverRestartedAt'] = at();
  }
  const { promptId } = await run;
  const samples: string[] = [];
  let ended: number | undefined;
  while (at() < 720) {
    const st = (await h.call(s.sessionId, `/session/${s.sessionId}/status`)).json;
    const ex = await sql('SELECT execution_state, execution_status FROM qwen_tool_execution WHERE harness_session_id = ?', [s.sessionId]);
    const sample = `${at()}s active=${st.hasActivePrompt} blocked=${st.recoveryBlocked} exec=${ex.map((r) => `${r['execution_state']}/${r['execution_status']}`).join(',')}`;
    if (samples.at(-1)?.replace(/^[\d.]+s /, '') !== sample.replace(/^[\d.]+s /, '')) { samples.push(sample); say(sample); }
    if (!st.hasActivePrompt) { ended = at(); break; }
    await delay(5000);
  }
  out['samples'] = samples;
  out['turnEndedAt'] = ended ?? null;
  const o = await h.outcome(s.sessionId, promptId);
  out['terminal'] = o.terminal;
  out['status'] = o.status;
  out['serverLedger'] = ledger().filter((e) => e['tag'] === tag).map((e) => `${e['phase']}@${((Number(e['t']) - t0) / 1000).toFixed(1)}`);
  const next = await h.prompt(s.sessionId, 'NEXT', { timeout: 60_000 });
  out['nextPrompt'] = { admit: next.admit.status, body: next.admit.json, terminal: next.terminal };
  const d = await h.call(s.sessionId, `/session/${s.sessionId}/detach`, {});
  out['detach'] = { status: d.status, body: d.json, at: at() };
  out['lease'] = await leaseHeld(W);
  out['execution'] = await sql('SELECT execution_state, execution_status, dispatch_generation FROM qwen_tool_execution WHERE harness_session_id = ?', [s.sessionId]);
  out['sessionId'] = s.sessionId;
} finally {
  result(`s12-${MODE}`, out);
  await h.close();
  await model.close();
  await proxy.close();
}
