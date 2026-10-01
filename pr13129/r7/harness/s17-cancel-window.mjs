// S17 (af89ec27ac, review 5379504700 item 3): a user cancel lands after the assistant tool call is committed but before
// a new PreToolUse occurrence is planned. (a) the Store reply to the assistant commit is delayed and the cancel lands
// inside it; (b) a two-call batch where the cancel lands during the first call's PreToolUse Hook, so the second call's
// occurrence is planned after the abort. Every case runs on its own Workspace (SET selects a disjoint Workspace set).
import fs from 'node:fs';
import { startHookHttp, startStoreProxy, Report, Harness, HSession, startModel, workspace, createWorkspaceSession, storeConnection, script, call, turn, pin, hookLedger, hookRecords, setControl, toolTrace, sleep } from './lib.mjs';
import { STORAGE, HTTP_PORT } from './manifest.mjs';
if (!process.env.DB || !process.env.SET) throw new Error('DB and SET are required');
const SET = process.env.SET;
const arm = process.env.ARM ?? 'head';
const R = new Report(`s17-cancel-window-${arm}`);
const web = await startHookHttp(HTTP_PORT);
web.state.mode['/slowpre2'] = { delayMs: 4000 };
const model = await startModel();
const proxy = await startStoreProxy();
let delay = null;
proxy.state.hook = async (entry, parsed, body) => {
  if (!delay || delay.seenAt) return 'forward';
  let hay = body.toString();
  for (const m of hay.matchAll(/"bytesBase64"\s*:\s*"([A-Za-z0-9+/=]+)"/g)) hay += Buffer.from(m[1], 'base64').toString();
  if (hay.includes(delay.marker) && hay.includes('functionCall') && !hay.includes('functionResponse')) {
    delay.seenAt = Date.now();
    delay.entry = entry;
    return { delayReplyMs: 3000 };
  }
  return 'forward';
};
const h = await new Harness({ name: `s17-${arm}`, modelUrl: model.url, arm }).start();
const CASES = [
  { ws: 'w2h', label: '(b) 2 calls, cancel during call 1 PreToolUse HTTP Hook (server answers after 4 s)', calls: 2, kind: 'http' },
  { ws: 'w2f', label: '(b) 2 calls, cancel during call 1 PreToolUse function Hook (honours the abort)', calls: 2, kind: 'fn', control: { cxPre: { sleepMs: 8000 } } },
  { ws: 'w2g', label: '(b) 2 calls, cancel during call 1 PreToolUse function Hook (finishes 0.5 s later, inside the grace)', calls: 2, kind: 'fn', control: { cxPre: { sleepMs: 700, ignoreAbort: true } }, cancelAfter: 200 },
  { ws: 'wa', label: '(a) cancel while the assistant tool-call commit is in flight, PreToolUse function Hook', calls: 1, kind: 'a' },
  { ws: 'wa0', label: '(a) control: same timing, no Hooks', calls: 1, kind: 'a', noHooks: true },
];
try {
  for (const sc of CASES.filter((c) => !process.env.ONLY || c.ws === process.env.ONLY)) {
    const WS = `ws-${sc.ws}-${SET}`;
    const w = await workspace(STORAGE[WS], WS);
    setControl(sc.control ?? {});
    const id = await createWorkspaceSession(w.workspaceId);
    const s = new HSession(h, id, storeConnection(h, w.workspaceId, sc.kind === 'a' ? proxy.url : undefined));
    const cr = await s.create(sc.noHooks ? undefined : { hookCatalog: pin(WS) });
    const stamp = Date.now();
    const files = Array.from({ length: sc.calls }, (_, i) => `w${i + 1}-${sc.ws}-${stamp}.txt`);
    delay = sc.kind === 'a' ? { marker: files[0], seenAt: null } : null;
    const l0 = hookLedger().length;
    const h0 = web.ledger.length;
    const t0 = Date.now();
    const sub = await s.submit(script([files.map((f) => call('write_file', { file_path: f, content: 'x' }))], `W-${WS}`));
    const fired = () => (sc.kind === 'a' ? !!delay.seenAt : sc.kind === 'http' ? web.ledger.length > h0 : hookLedger().slice(l0).some((e) => e.name === 'cxPre' && e.session === id && !e.kind));
    for (let i = 0; i < 600 && !fired(); i++) await sleep(25);
    const trig = Date.now() - t0;
    await sleep(sc.cancelAfter ?? 1000);
    const cAt = Date.now() - t0;
    const c = await s.cancel();
    const st = await s.waitIdle(120_000);
    const idleAt = Date.now() - t0;
    const events = (await s.transcript()).filter((e) => e.promptId === sub.promptId);
    const term = events.filter((e) => e.type.startsWith('turn_')).map((e) => `${e.type}${e.data?.stopReason ? `(${e.data.stopReason})` : ''}`).join(',') || '<none>';
    const tr = toolTrace(events);
    const calls = tr.filter((x) => x.startsWith('call ')).length;
    const results = tr.filter((x) => x.startsWith('result '));
    const recs = hookRecords(id, 'hook_execution').filter((r) => r.rec.eventName === 'PreToolUse' && r.rec.ordinal > 0).map((r) => `${r.rec.run.state}/${r.rec.run.execution}`);
    const hookRuns = sc.kind === 'http' ? web.ledger.length - h0 : hookLedger().slice(l0).filter((e) => e.name === 'cxPre' && e.session === id && !e.kind).length;
    const written = files.filter((f) => fs.existsSync(`${w.dir}/${f}`)).length;
    const next = await s.prompt(script([], `NEXT-${WS}`), 60_000);
    R.check(`${sc.label}: turn cancelled, every call has a result, next turn runs`, /turn_complete\(cancelled\)/.test(term) && calls === sc.calls && results.length === calls && next.terminal?.[0]?.type === 'turn_complete',
      `create=${cr.status} trigger=${trig}ms cancel=${c.status}@${cAt}ms idle@${idleAt}ms${delay?.entry ? ` delayedStoreReply=${delay.entry.status}` : ''} terminal=${term} recoveryBlocked=${st.recoveryBlocked} calls=${calls} results=${results.length} [${results.map((x) => x.slice(0, 70)).join(' | ')}] preToolUse=[${recs.join(', ')}] hookRuns=${hookRuns} filesWritten=${written} next=${turn(next)}`);
    const d = await s.detach();
    const l = await s.load();
    const again = await s.prompt(script([], `AGAIN-${WS}`), 60_000);
    const d2 = await s.detach();
    const other = new HSession(h, await createWorkspaceSession(w.workspaceId), storeConnection(h, w.workspaceId));
    await other.create();
    const of = `other-${stamp}.txt`;
    const po = await other.prompt(script([[call('write_file', { file_path: of, content: 'o' })]], `OTHER-${WS}`), 60_000);
    await other.detach();
    R.check(`${sc.label}: detach, load, another prompt, then a second Session (no Hooks) writes in the Workspace`, d.status === 204 && l.status === 200 && !l.json?.recoveryRequired && again.terminal?.[0]?.type === 'turn_complete' && po.terminal?.[0]?.type === 'turn_complete' && fs.existsSync(`${w.dir}/${of}`),
      `detach=${d.status} load=${l.status}${l.json?.recoveryRequired ? ' recoveryRequired' : ''} again=${turn(again)} detach2=${d2.status} other=${turn(po)} otherFile=${fs.existsSync(`${w.dir}/${of}`)}`);
    const h2 = await new Harness({ name: `s17c-${arm}-${sc.ws}`, modelUrl: model.url, arm }).start();
    try {
      const s2 = new HSession(h2, id, storeConnection(h2, w.workspaceId));
      const l2 = await s2.load();
      const tr2 = toolTrace((await s2.transcript()).filter((e) => e.promptId === sub.promptId));
      const p2 = await s2.prompt(script([], `COLD-${WS}`), 60_000);
      R.check(`${sc.label}: a new Harness process cold-loads the Session from the Store and runs a turn`, l2.status === 200 && !l2.json?.recoveryRequired && p2.terminal?.[0]?.type === 'turn_complete' && tr2.filter((x) => x.startsWith('result ')).length === sc.calls,
        `load=${l2.status}${l2.json?.recoveryRequired ? ' recoveryRequired' : ''}${l2.json?.code ? ` ${l2.json.code}` : ''} durable calls/results=${tr2.filter((x) => x.startsWith('call ')).length}/${tr2.filter((x) => x.startsWith('result ')).length} next=${turn(p2)}`);
      await s2.detach();
    } finally {
      await h2.close();
    }
  }
} finally {
  setControl({});
  await h.close();
  await model.close();
  await web.close();
  await proxy.close();
  R.done();
}
