// S18 (c5a4cd2853 "settle proven-unstarted pre-tool cancellations"): a PreToolUse Hook is refused before any effect
// (function Hook pinned to a handler revision the worker does not have), the operator cancels the blocked
// execution (not_started_proven), and recovery must persist a refusal for every call and settle the turn.
// rf1/rf2: one / two calls. rf3: the recovery write's Store reply is dropped 3 times (committed, unacknowledged).
// rf4: the recovery write gets 503 3 times. rf5: cancel, status reads and a prompt race. Each case has its own Workspace.
import fs from 'node:fs';
import { startStoreProxy, Report, Harness, HSession, startModel, workspace, createWorkspaceSession, storeConnection, script, call, turn, pin, hookRecords, setControl, toolTrace, j, sleep } from './lib.mjs';
import { STORAGE } from './manifest.mjs';
if (!process.env.DB || !process.env.SET) throw new Error('DB and SET are required');
const SET = process.env.SET;
const arm = process.env.ARM ?? 'head';
const R = new Report(`s18-refusal-recovery-${arm}-${SET}${process.env.ONLY ? `-${process.env.ONLY}` : ""}`);
setControl({});
const model = await startModel();
const proxy = await startStoreProxy();
let fault = null; // { action, left, seen }
const MARK = 'cancelled before this tool call ran';
proxy.state.hook = async (entry, parsed, body) => {
  if (!fault || fault.left <= 0) return 'forward';
  let hay = body.toString();
  for (const m of hay.matchAll(/"bytesBase64"\s*:\s*"([A-Za-z0-9+/=]+)"/g)) hay += Buffer.from(m[1], 'base64').toString();
  if (!hay.includes(MARK)) return 'forward';
  fault.left--;
  fault.seen++;
  return fault.action;
};
const h = await new Harness({ name: `s18-${arm}-${SET}`, modelUrl: model.url, arm }).start();
const CASES = [
  { k: 'rf1', calls: 1, label: 'one tool call' },
  { k: 'rf2', calls: 2, label: 'two tool calls' },
  { k: 'rf3', calls: 2, label: 'two tool calls; recovery write committed but its reply dropped 3 times', fault: 'drop-reply' },
  { k: 'rf4', calls: 2, label: 'two tool calls; recovery write answered 503 three times', fault: 'fail-503' },
  { k: 'rf5', calls: 2, label: 'two tool calls; cancel, 2 status reads and a prompt fired concurrently', race: true },
];
const counts = (s, promptId) => s.transcript().catch(() => []).then((ev) => {
  const tr = toolTrace(ev.filter((e) => e.promptId === promptId));
  const results = tr.filter((x) => x.startsWith('result '));
  return { calls: tr.filter((x) => x.startsWith('call ')).length, results: results.length, text: results.map((x) => x.slice(0, 75)).join(' | '), term: ev.filter((e) => e.promptId === promptId && e.type.startsWith('turn_')).map((e) => `${e.type}${e.data?.stopReason ? `(${e.data.stopReason})` : ''}`).join(',') || '<none>' };
});
try {
  for (const sc of CASES.filter((c) => !process.env.ONLY || c.k === process.env.ONLY)) {
    const WS = `ws-${sc.k}-${SET}`;
    const L = `${sc.label}`;
    const w = await workspace(STORAGE[WS], WS);
    const id = await createWorkspaceSession(w.workspaceId);
    const hx = sc.fault ? await new Harness({ name: `s18f-${arm}-${sc.k}-${SET}`, modelUrl: model.url, arm }).start() : h;
    const s = new HSession(hx, id, storeConnection(hx, w.workspaceId, sc.fault ? proxy.url : undefined));
    await s.create({ hookCatalog: pin(WS) });
    const stamp = Date.now();
    const files = Array.from({ length: sc.calls }, (_, i) => `r${i + 1}-${sc.k}-${stamp}.txt`);
    const p1 = await s.prompt(script([files.map((f) => call('write_file', { file_path: f, content: 'x' }))], `RF-${WS}`), 60_000);
    const rec = hookRecords(id, 'hook_execution').find((r) => r.rec.hookId === 'rf-pre')?.rec;
    const pre = await s.submit(script([], `PRE-${WS}`));
    if (pre.status === 202) await s.waitIdle();
    R.check(`${L}: refused before effect; before the explicit cancel the Session stays blocked`, rec?.run.execution !== undefined && pre.status === 409 && files.every((f) => !fs.existsSync(`${w.dir}/${f}`)),
      `turn=${turn(p1)} record=${rec?.run.state}/${j(rec?.run.execution)} nextBeforeCancel=${pre.status} ${pre.json?.code ?? ''}`);
    if (!rec) continue;
    fault = sc.fault ? { action: sc.fault, left: 3, seen: 0 } : null;
    let c;
    let raceNote = '';
    if (sc.race) {
      const [cc, g1, g2, pr] = await Promise.all([s.hookStatus(rec.hookExecutionId, true), s.hookStatus(rec.hookExecutionId), s.hookStatus(rec.hookExecutionId), s.submit(script([], `RACE-${WS}`))]);
      if (pr.status === 202) await s.waitIdle();
      c = cc;
      raceNote = ` race: status=${g1.status}/${g2.status} prompt=${pr.status}${pr.json?.code ? ` ${pr.json.code}` : ''}`;
    } else c = await s.hookStatus(rec.hookExecutionId, true);
    const after = await counts(s, p1.promptId);
    const next = await s.prompt(script([], `NEXT-${WS}`), 60_000);
    if (sc.fault) {
      // The barrier must hold while the recovery write is unproven. Try the in-process retry paths first.
      const seen = fault.seen;
      fault = null;
      const blocked = next.status === 409;
      const retry = await s.hookStatus(rec.hookExecutionId);
      const afterRetry = await counts(s, p1.promptId);
      const next2 = await s.prompt(script([], `NEXT2-${WS}`), 60_000);
      const d0 = await s.detach();
      const l0 = d0.status === 204 ? await s.load() : { status: '-' };
      const next3 = l0.status === 200 ? await s.prompt(script([], `NEXT3-${WS}`), 60_000) : { status: '-' };
      R.note(`${L}: in the same Harness after the failed write`, `cancel=${c.status} ${c.json?.state ?? c.json?.code ?? ''} faultedWrites=${seen} results=${after.results}/${after.calls} next=${next.status} ${next.json?.code ?? ''} | status-read retry=${retry.status} ${retry.json?.state ?? retry.json?.code ?? ''} results=${afterRetry.results}/${afterRetry.calls} next=${next2.status} ${next2.json?.code ?? ''} | detach=${d0.status} load=${l0.status}${l0.json?.recoveryRequired ? ' recoveryRequired' : ''} next=${next3.status}`);
      // Operator path: replace the Harness process, wait out its writer lease, load in a new process.
      await hx.close();
      const h2 = await new Harness({ name: `s18r-${arm}-${sc.k}-${SET}`, modelUrl: model.url, arm }).start();
      try {
        const s2 = new HSession(h2, id, storeConnection(h2, w.workspaceId));
        const t0 = Date.now();
        let l2;
        for (;;) {
          l2 = await s2.load();
          if (l2.status === 200 || Date.now() - t0 > 150_000) break;
          await sleep(10_000);
        }
        const cold = l2.status === 200 ? await counts(s2, p1.promptId) : { calls: 0, results: 0, text: '', term: '<none>' };
        const p2 = await s2.prompt(script([], `COLD-${WS}`), 60_000);
        R.check(`${L}: barrier held; after Harness replacement the load recovers with exactly one result per call`, blocked && l2.status === 200 && !l2.json?.recoveryRequired && cold.results === sc.calls && cold.calls === sc.calls && p2.terminal?.[0]?.type === 'turn_complete',
          `load=${l2.status}${l2.json?.recoveryRequired ? ' recoveryRequired' : ''}${l2.json?.code ? ` ${l2.json.code}` : ''} after ${Math.round((Date.now() - t0) / 1000)}s durable calls/results=${cold.calls}/${cold.results} [${cold.text}] terminal=${cold.term} next=${turn(p2)} filesWritten=${files.filter((f) => fs.existsSync(`${w.dir}/${f}`)).length}`);
        await s2.detach();
      } finally {
        await h2.close();
      }
      const other = new HSession(h, await createWorkspaceSession(w.workspaceId), storeConnection(h, w.workspaceId));
      await other.create();
      const of = `other-${stamp}.txt`;
      const po = await other.prompt(script([[call('write_file', { file_path: of, content: 'o' })]], `OTHER-${WS}`), 60_000);
      await other.detach();
      R.check(`${L}: a second Session (no Hooks) writes in the Workspace`, po.terminal?.[0]?.type === 'turn_complete' && fs.existsSync(`${w.dir}/${of}`), turn(po));
      continue;
    } else {
      R.check(`${L}: after the cancel every call has a refusal, the turn settles and the next turn runs`, after.results === sc.calls && after.calls === sc.calls && next.terminal?.[0]?.type === 'turn_complete',
        `cancel=${c.status} ${c.json?.state ?? c.json?.code ?? ''} ${c.json?.execution ?? ''}${raceNote} results=${after.results}/${after.calls} [${after.text}] terminal=${after.term} next=${turn(next)}`);
    }
    fault = null;
    const d = await s.detach();
    const l = await s.load();
    const again = await s.prompt(script([], `AGAIN-${WS}`), 60_000);
    const afterLoad = await counts(s, p1.promptId);
    await s.detach();
    const other = new HSession(h, await createWorkspaceSession(w.workspaceId), storeConnection(h, w.workspaceId));
    await other.create();
    const of = `other-${stamp}.txt`;
    const po = await other.prompt(script([[call('write_file', { file_path: of, content: 'o' })]], `OTHER-${WS}`), 60_000);
    await other.detach();
    R.check(`${L}: detach, load, another prompt; a second Session (no Hooks) writes in the Workspace`, d.status === 204 && l.status === 200 && !l.json?.recoveryRequired && again.terminal?.[0]?.type === 'turn_complete' && afterLoad.results === sc.calls && po.terminal?.[0]?.type === 'turn_complete' && fs.existsSync(`${w.dir}/${of}`),
      `detach=${d.status} load=${l.status}${l.json?.recoveryRequired ? ' recoveryRequired' : ''} again=${turn(again)} results=${afterLoad.results}/${afterLoad.calls} other=${turn(po)} otherFile=${fs.existsSync(`${w.dir}/${of}`)}`);
    const h2 = await new Harness({ name: `s18c-${arm}-${sc.k}-${SET}`, modelUrl: model.url, arm }).start();
    try {
      const s2 = new HSession(h2, id, storeConnection(h2, w.workspaceId));
      const l2 = await s2.load();
      const cold = await counts(s2, p1.promptId);
      const p2 = await s2.prompt(script([], `COLD-${WS}`), 60_000);
      R.check(`${L}: a new Harness process cold-loads the Session; durable results unchanged; a turn runs`, l2.status === 200 && !l2.json?.recoveryRequired && cold.results === sc.calls && p2.terminal?.[0]?.type === 'turn_complete',
        `load=${l2.status}${l2.json?.recoveryRequired ? ' recoveryRequired' : ''} durable calls/results=${cold.calls}/${cold.results} terminal=${cold.term} next=${turn(p2)} filesWritten=${files.filter((f) => fs.existsSync(`${w.dir}/${f}`)).length}`);
      await s2.detach();
    } finally {
      await h2.close();
    }
  }
} finally {
  await h.close();
  await model.close();
  await proxy.close();
  R.done();
}
