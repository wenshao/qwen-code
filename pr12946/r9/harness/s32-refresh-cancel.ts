// S32 (round 9, doudouOUC refresh-cancellation P1). The model calls
// `addtool`, so the server's tool list really changes; the next refresh in the
// same turn discovers a changed catalog and starts a replacement configuration.
// The Broker proxy holds either the replacement's acquire (before
// dispatch_started) or its mcp-configure (after dispatch_started); the turn
// is cancelled while held, and the hold is released 3 s later.
//   S32_WINDOW=acquire|dispatch
import {
  Harness, brokerCalls, delay, faults, fakeToolCall, leaseHeld, mcpProfile,
  newSession, result, setScript, startBrokerProxy, startModel,
} from './rig12946-lib.js';

const W = Number(process.env['S32_WS'] ?? 4);
const WINDOW = process.env['S32_WINDOW'] ?? 'acquire';
const model = await startModel();
const proxy = await startBrokerProxy();
const h = await new Harness().start(model.baseUrl, proxy.url);
const out: Record<string, unknown> = { W, window: WINDOW, arm: process.env['ARM'] };
const code = (r: { status: number; json: any }) => `${r.status}:${r.json?.code ?? ''}`;
try {
  setScript((ctx) => {
    if (ctx.marker.startsWith('ADD')) {
      if (!ctx.receipts.length) return { toolCalls: [fakeToolCall(ctx.tools.find((t) => t.description?.includes('Register one more tool on http '))!.name, {}, 'a')] };
      return { content: 'ADDED' };
    }
    if (ctx.marker.startsWith('WARM')) {
      if (!ctx.receipts.length) return { toolCalls: [fakeToolCall(ctx.tools.find((t) => t.description?.includes('side effect on server http.'))!.name, { tag: ctx.marker }, 'e')] };
      return { content: 'DONE' };
    }
    return { content: 'TEXT' };
  });
  const s = await newSession(W);
  await h.open(s.sessionId, s.workspaceId, mcpProfile(W, [['remote']]));
  out['warm'] = (await h.prompt(s.sessionId, 'WARM_1')).terminal?.map((x: any) => x.stopReason ?? x.type);
  // stage 0: wait for the addtool call; 1: wait for the next discover; 2: hold the target
  let stage = 0;
  let heldAt: number | undefined;
  let release!: () => void;
  const released = new Promise<void>((r) => (release = r));
  faults.push({
    label: `hold-${WINDOW}`, action: 'hold', remaining: 1, release: released,
    match: (url, body) => {
      if (stage === 0 && body.includes('addtool')) stage = 1;
      else if (stage === 1 && body.includes('"mcp-discover"')) stage = 2;
      else if (stage === 2 && (WINDOW === 'acquire' ? url.endsWith('tool-sessions:acquire') : body.includes('"mcp-configure"'))) {
        heldAt = Date.now();
        return true;
      }
      return false;
    },
  });
  const t0 = Date.now();
  const at = (t = Date.now()) => Number(((t - t0) / 1000).toFixed(2));
  const k = brokerCalls.length;
  const turn = await h.prompt(s.sessionId, 'ADD_1', { wait: false });
  out['admit'] = turn.admit.status;
  const holdDeadline = Date.now() + 30_000;
  while (!heldAt && Date.now() < holdDeadline) await delay(50);
  out['heldAt'] = heldAt ? at(heldAt) : 'never held';
  await delay(300);
  const cancelAt = Date.now();
  out['cancel'] = `${(await h.call(s.sessionId, `/session/${s.sessionId}/cancel`, {})).status}@${at()}`;
  let st: any;
  while (Date.now() - cancelAt < 20_000) {
    st = (await h.call(s.sessionId, `/session/${s.sessionId}/status`)).json;
    if (!st?.hasActivePrompt) break;
    await delay(100);
  }
  out['turnEndedAt'] = at();
  out['statusAtTurnEnd'] = st;
  if (process.env['S32_DETACH'] !== '0') out['detachWhileHeld'] = code(await h.call(s.sessionId, `/session/${s.sessionId}/detach`, {}));
  await delay(Math.max(0, cancelAt + 3000 - Date.now()));
  release();
  out['releasedAt'] = at();
  await delay(4000);
  out['turnTerminal'] = (await h.outcome(s.sessionId, turn.promptId).catch(() => ({ terminal: 'outcome-error' }))).terminal;
  out['broker'] = brokerCalls.slice(k).filter((c) => c.kind || c.url.endsWith(':acquire'))
    .map((c) => `${c.kind ?? 'acquire'}:${c.status}${c.fault ? '!hold' : ''}@${at(c.t)}`);
  out['configuresAfterCancel'] = brokerCalls.slice(k).filter((c) => c.kind === 'mcp-configure' && c.t > cancelAt).length;
  out['configuresTotal'] = brokerCalls.slice(k).filter((c) => c.kind === 'mcp-configure').length;
  out['statusAfterRelease'] = (await h.call(s.sessionId, `/session/${s.sessionId}/status`)).json;
  const next = await h.prompt(s.sessionId, 'TEXT_NEXT', { timeout: 90_000 }).catch((e) => ({ admit: { status: `error:${String(e).slice(0, 60)}` } as any, terminal: undefined }));
  out['nextTurn'] = { admit: next.admit.status, body: next.admit.status === 202 ? undefined : next.admit.json, terminal: next.terminal?.map((x: any) => x.stopReason ?? x.type) };
  out['catalog'] = (await h.call(s.sessionId, `/session/${s.sessionId}/mcp-catalog`)).json?.catalogs?.map((c: any) => [c.serverId, c.configRevision, c.catalogRevision]);
  out['detach'] = code(await h.call(s.sessionId, `/session/${s.sessionId}/detach`, {}));
  out['lease'] = await leaseHeld(W);
} finally {
  result(`s32-${WINDOW}`, out);
  await h.close();
  await model.close();
  await proxy.close();
}
