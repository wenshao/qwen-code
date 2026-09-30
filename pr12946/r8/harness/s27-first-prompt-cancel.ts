// S27 (round 8, doudouOUC P1 on 06c1df7f): the first prompt waits for the
// initial MCP configuration without the turn's AbortSignal. Hold the first
// mcp-configure at the Broker proxy for 8 s, then cancel (or let a 200 ms
// deadline expire) and watch the prompt POST, the Session and the Broker.
//   S27_MODE=cancel|deadline
import { createHash } from 'node:crypto';
import {
  Harness, brokerCalls, delay, faults, leaseHeld, mcpProfile, modelRequests,
  newSession, randomUUID, result, setScript, startBrokerProxy, startModel,
} from './rig12946-lib.js';

const W = Number(process.env['S27_WS'] ?? 1);
const MODE = process.env['S27_MODE'] ?? 'cancel';
const HOLD_MS = 8000;
const model = await startModel();
const proxy = await startBrokerProxy();
const h = await new Harness().start(model.baseUrl, proxy.url);
setScript(() => ({ content: 'TEXT_ONLY_ANSWER' }));
const out: Record<string, unknown> = { mode: MODE, W, arm: process.env['ARM'] };
const code = (r: { status: number; json: any }) => `${r.status}:${r.json?.code ?? ''}`;
try {
  const s = await newSession(W);
  const k0 = brokerCalls.length;
  await h.open(s.sessionId, s.workspaceId, mcpProfile(W, [['remote'], ['legacy']]));
  out['brokerAtOpen'] = brokerCalls.slice(k0).filter((c) => c.kind).map((c) => `${c.kind}:${c.status}`);
  let release!: () => void;
  faults.push({ label: 'hold-configure', action: 'hold', remaining: 1, release: new Promise<void>((r) => (release = r)),
    match: (_u, b) => b.includes('"mcp-configure"') });
  const t0 = Date.now();
  const at = () => Number(((Date.now() - t0) / 1000).toFixed(2));
  const k1 = brokerCalls.length;
  const m0 = modelRequests.length;
  const blocks = [{ type: 'text', text: 'TEXT_FIRST' }];
  const promptId = randomUUID();
  const body: Record<string, unknown> = { promptId, prompt: blocks,
    payloadDigest: `sha256:${createHash('sha256').update(JSON.stringify(blocks)).digest('hex')}` };
  if (MODE === 'deadline') body['deadlineMs'] = 200;
  let promptReturned: string | undefined;
  const pending = h.call(s.sessionId, `/session/${s.sessionId}/prompt`, body, 'POST', 120_000)
    .then((r) => { promptReturned = `${code(r)}@${at()}`; }, (e) => { promptReturned = `error:${e?.name}@${at()}`; });
  await delay(1000);
  let abortAt = at();
  if (MODE === 'cancel') {
    out['cancel'] = `${(await h.call(s.sessionId, `/session/${s.sessionId}/cancel`, {})).status}@${at()}`;
    abortAt = at();
  } else abortAt = 0.2;
  await delay(250);
  out['afterAbort'] = {
    at: at(),
    promptPostReturned: promptReturned ?? 'still pending',
    status: (await h.call(s.sessionId, `/session/${s.sessionId}/status`)).json,
    newPrompt: code((await h.prompt(s.sessionId, 'TEXT_SECOND', { wait: false })).admit),
    detach: code(await h.call(s.sessionId, `/session/${s.sessionId}/detach`, {})),
  };
  await delay(HOLD_MS - 1250);
  const releasedAt = at();
  release();
  await pending;
  out['promptPost'] = promptReturned;
  out['releasedAt'] = releasedAt;
  const deadline = Date.now() + 60_000;
  let st: any;
  while (Date.now() < deadline) {
    st = (await h.call(s.sessionId, `/session/${s.sessionId}/status`)).json;
    if (!st.hasActivePrompt) break;
    await delay(500);
  }
  out['settledAt'] = at();
  out['statusAfter'] = st;
  out['brokerAfterPrompt'] = brokerCalls.slice(k1).filter((c) => c.kind)
    .map((c) => `${c.kind}:${c.status}${c.fault ? '!hold' : ''}@${((c.t - t0) / 1000).toFixed(2)}`);
  out['configuresSentAfterAbort'] = brokerCalls.slice(k1)
    .filter((c) => c.kind === 'mcp-configure' && (c.t - t0) / 1000 > abortAt).length;
  out['abortAt'] = abortAt;
  out['modelRequestsForPrompt'] = modelRequests.length - m0;
  try {
    const o = await h.outcome(s.sessionId, promptId);
    out['terminal'] = o.terminal;
  } catch (e) { out['terminal'] = `outcome-error:${String(e).slice(0, 80)}`; }
  const t = await h.prompt(s.sessionId, 'TEXT_THIRD', { timeout: 60_000 });
  out['nextPrompt'] = { admit: t.admit.status, terminal: t.terminal?.map((x: any) => x.stopReason ?? x.type) };
  out['detach'] = code(await h.call(s.sessionId, `/session/${s.sessionId}/detach`, {}));
  out['lease'] = await leaseHeld(W);
} finally {
  result(`s27-${MODE}`, out);
  await h.close();
  await model.close();
  await proxy.close();
}
