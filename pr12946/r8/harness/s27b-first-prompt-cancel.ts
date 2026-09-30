// S27b (round 8b, 67c908ea "Honor cancellation during initial MCP setup").
// The first mcp-configure is held at the Broker proxy for 8 s; the first
// prompt is cancelled at 1 s (or given deadlineMs 200). Then, while that
// configure is still in flight:
//   S27_AFTER=none    only observe
//   S27_AFTER=detach  detach at once
//   S27_AFTER=prompt  send a second prompt at once
import { createHash } from 'node:crypto';
import {
  Harness, brokerCalls, delay, faults, leaseHeld, mcpProfile, modelRequests,
  newSession, randomUUID, result, setScript, startBrokerProxy, startModel,
} from './rig12946-lib.js';

const W = Number(process.env['S27_WS'] ?? 1);
const MODE = process.env['S27_MODE'] ?? 'cancel';
const AFTER = process.env['S27_AFTER'] ?? 'none';
const HOLD_MS = 8000;
const model = await startModel();
const proxy = await startBrokerProxy();
const h = await new Harness().start(model.baseUrl, proxy.url);
setScript(() => ({ content: 'TEXT_ONLY_ANSWER' }));
const out: Record<string, unknown> = { mode: MODE, after: AFTER, W, arm: process.env['ARM'] };
const code = (r: { status: number; json: any }) => `${r.status}:${r.json?.code ?? ''}`;
const body = (text: string, deadlineMs?: number) => {
  const blocks = [{ type: 'text', text }];
  return { promptId: randomUUID(), prompt: blocks,
    payloadDigest: `sha256:${createHash('sha256').update(JSON.stringify(blocks)).digest('hex')}`,
    ...(deadlineMs ? { deadlineMs } : {}) };
};
try {
  const s = await newSession(W);
  await h.open(s.sessionId, s.workspaceId, mcpProfile(W, [['remote'], ['legacy']]));
  let release!: () => void;
  faults.push({ label: 'hold-configure', action: 'hold', remaining: 1, release: new Promise<void>((r) => (release = r)),
    match: (_u, b) => b.includes('"mcp-configure"') });
  const t0 = Date.now();
  const at = () => Number(((Date.now() - t0) / 1000).toFixed(2));
  const k1 = brokerCalls.length;
  const m0 = modelRequests.length;
  const first = body('TEXT_FIRST', MODE === 'deadline' ? 200 : undefined);
  let firstReturned: string | undefined;
  const pending = h.call(s.sessionId, `/session/${s.sessionId}/prompt`, first, 'POST', 120_000)
    .then((r) => { firstReturned = `${code(r)}@${at()}`; }, (e) => { firstReturned = `error:${e?.name}@${at()}`; });
  await delay(1000);
  let abortAt = 0.2;
  if (MODE === 'cancel') {
    out['cancel'] = `${(await h.call(s.sessionId, `/session/${s.sessionId}/cancel`, {})).status}@${at()}`;
    abortAt = at();
  }
  await delay(300);
  out['firstPromptPostBy1.3s'] = firstReturned ?? 'still pending';
  out['statusAt1.3s'] = (await h.call(s.sessionId, `/session/${s.sessionId}/status`)).json;
  if (AFTER === 'detach') {
    out['detachWhileHeld'] = `${code(await h.call(s.sessionId, `/session/${s.sessionId}/detach`, {}))}@${at()}`;
    out['leaseAfterDetachWhileHeld'] = await leaseHeld(W);
  } else if (AFTER === 'prompt') {
    const r = await h.call(s.sessionId, `/session/${s.sessionId}/prompt`, body('TEXT_SECOND'), 'POST', 3000)
      .then((x) => `${code(x)}@${at()}`, (e) => `no answer in 3 s (${e?.name})@${at()}`);
    out['secondPromptWhileHeld'] = r;
  }
  const brokerBeforeRelease = brokerCalls.slice(k1).filter((c) => c.kind).map((c) => `${c.kind}:${c.status || 'pending'}${c.fault ? '!hold' : ''}@${((c.t - t0) / 1000).toFixed(2)}`);
  out['brokerBeforeRelease'] = brokerBeforeRelease;
  await delay(Math.max(0, HOLD_MS - (Date.now() - t0)));
  out['releasedAt'] = at();
  release();
  await delay(3000);
  await Promise.race([pending, delay(30_000)]);
  out['firstPromptPost'] = firstReturned ?? 'still pending 3 s after release';
  let st: any;
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    st = (await h.call(s.sessionId, `/session/${s.sessionId}/status`)).json;
    if (!st?.hasActivePrompt) break;
    await delay(500);
  }
  out['statusAfterRelease'] = st;
  out['brokerAll'] = brokerCalls.slice(k1).filter((c) => c.kind)
    .map((c) => `${c.kind}:${c.status}${c.fault ? '!hold' : ''}@${((c.t - t0) / 1000).toFixed(2)}`);
  out['configuresAfterAbort'] = brokerCalls.slice(k1).filter((c) => c.kind === 'mcp-configure' && (c.t - t0) / 1000 > abortAt).length;
  out['abortAt'] = abortAt;
  out['modelRequestsDuringHold'] = modelRequests.filter((m) => m.t - t0 < HOLD_MS).length;
  out['modelRequestsTotal'] = modelRequests.length - m0;
  const t = await h.prompt(s.sessionId, 'TEXT_THIRD', { timeout: 60_000 }).catch((e) => ({ admit: { status: `error:${String(e).slice(0, 60)}` } as any, terminal: undefined }));
  out['nextPrompt'] = { admit: t.admit.status, body: t.admit.status === 202 ? undefined : t.admit.json, terminal: t.terminal?.map((x: any) => x.stopReason ?? x.type) };
  out['detach'] = code(await h.call(s.sessionId, `/session/${s.sessionId}/detach`, {}));
  out['lease'] = await leaseHeld(W);
} finally {
  result(`s27b-${MODE}-${AFTER}`, out);
  await h.close();
  await model.close();
  await proxy.close();
}
