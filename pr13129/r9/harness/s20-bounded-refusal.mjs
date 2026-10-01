// S20 (251117c3d5, review r4156861669): a refused PreToolUse on a large batch, then operator cancel. Recovery must
// split the refusals into records that each fit the REAL Java Store's inline limit, keep one response per call
// (no duplicates), chain the records, and survive a failure on the second record (fill only what is missing).
import fs from 'node:fs';
import { startStoreProxy, Report, Harness, HSession, startModel, workspace, createWorkspaceSession, storeConnection, script, turn, pin, hookRecords, setControl, j, sleep } from './lib.mjs';
import { STORAGE } from './manifest.mjs';
if (!process.env.DB) throw new Error('DB is required');
const arm = process.env.ARM ?? 'head';
const ONLY = process.env.ONLY;
const R = new Report(`s20-bounded-refusal-${arm}${ONLY ? `-${ONLY}` : ''}`);
setControl({});
const model = await startModel();
const proxy = await startStoreProxy();
const MARK = 'cancelled before this tool call ran';
const writes = [];
let fault = null; // { action, skip, left }
proxy.state.hook = async (entry, parsed, body) => {
  let decoded = 0;
  let hay = '';
  for (const m of body.toString().matchAll(/"bytesBase64"\s*:\s*"([A-Za-z0-9+/=]+)"/g)) {
    const b = Buffer.from(m[1], 'base64');
    decoded = Math.max(decoded, b.length);
    hay += b.toString();
  }
  if (!hay.includes(MARK)) return 'forward';
  const w = { entry, decoded, parts: (hay.match(/cancelled before this tool call ran/g) ?? []).length };
  writes.push(w);
  if (fault && fault.skip > 0) {
    fault.skip--;
    return 'forward';
  }
  if (fault && fault.left > 0) {
    fault.left--;
    w.injected = fault.action;
    return fault.action;
  }
  return 'forward';
};
// Durable view of one prompt: tool_result records, response ids, parent chain.
async function view(s, promptId) {
  const ev = (await s.transcript().catch(() => [])).filter((e) => e.promptId === promptId);
  const recs = ev.map((e) => e.data?.record).filter(Boolean);
  const assistant = recs.find((r) => r.type === 'assistant');
  const calls = (assistant?.message?.parts ?? []).filter((p) => p.functionCall).map((p) => p.functionCall.id);
  const results = recs.filter((r) => r.type === 'tool_result');
  const ids = results.flatMap((r) => (r.message?.parts ?? []).filter((p) => p.functionResponse).map((p) => p.functionResponse.id));
  let chain = results.length > 0;
  let prev = assistant?.uuid;
  for (const r of results) {
    if (r.parentUuid !== prev) chain = false;
    prev = r.uuid;
  }
  const term = ev.filter((e) => e.type.startsWith('turn_')).map((e) => `${e.type}${e.data?.stopReason ? `(${e.data.stopReason})` : ''}`).join(',') || '<none>';
  const unique = new Set(ids).size;
  const covered = calls.every((c) => ids.includes(c));
  return { calls: calls.length, records: results.length, ids: ids.length, unique, covered, chain, term, sizes: results.map((r) => Buffer.byteLength(JSON.stringify(r))) };
}
const fmt = (v) => `calls=${v.calls} toolResultRecords=${v.records} responses=${v.ids} unique=${v.unique} allCallsCovered=${v.covered} parentChain=${v.chain} terminal=${v.term}`;
const good = (v, n) => v.calls === n && v.ids === n && v.unique === n && v.covered && v.chain;
const h = await new Harness({ name: `s20-${arm}`, modelUrl: model.url, arm }).start();
const CASES = [
  { k: '505', n: 505 },
  { k: '510', n: 510 },
  { k: '650', n: 650 },
  { k: '650f', n: 650, fault: 'fail-503', label: 'second record answered 503 three times' },
  { k: '650d', n: 650, fault: 'drop-reply', label: 'second record committed, reply lost 3 times' },
];
try {
  for (const sc of CASES.filter((c) => !ONLY || c.k === ONLY)) {
    const WS = `ws-bf${sc.k}`;
    const L = `${sc.n} write_file calls${sc.label ? `; ${sc.label}` : ''}`;
    const w = await workspace(STORAGE[WS], WS);
    const hx = sc.fault ? await new Harness({ name: `s20f-${arm}-${sc.k}`, modelUrl: model.url, arm }).start() : h;
    const id = await createWorkspaceSession(w.workspaceId);
    const s = new HSession(hx, id, storeConnection(hx, w.workspaceId, proxy.url));
    await s.create({ hookCatalog: pin(WS) });
    const p1 = await s.prompt(`BATCH:${sc.n}:END`, 120_000);
    const rec = hookRecords(id, 'hook_execution').find((r) => r.rec.hookId === 'bf-pre')?.rec;
    const w0 = writes.length;
    fault = sc.fault ? { action: sc.fault, skip: 1, left: 3 } : null;
    const c = rec ? await s.hookStatus(rec.hookExecutionId, true) : { status: '-' };
    fault = null;
    const mine = writes.slice(w0);
    const wire = `recovery writes=${mine.length} [${mine.map((x) => `${x.decoded}B/${x.parts} refusals/${x.injected ?? x.entry.status}`).join(', ')}]`;
    const v1 = await view(s, p1.promptId);
    const next = await s.prompt(script([], `BF-NEXT-${sc.k}`), 60_000);
    if (!sc.fault) {
      R.check(`${L}: cancel → every call has exactly one refusal, records fit the real Store, next turn runs`, c.status === 200 && good(v1, sc.n) && next.terminal?.[0]?.type === 'turn_complete',
        `first turn=${turn(p1)} record=${rec?.run.state}/${j(rec?.run.execution)} cancel=${c.status} ${c.json?.state ?? c.json?.code ?? ''} ${wire} record sizes=${v1.sizes.join('/')} ${fmt(v1)} next=${turn(next)}`);
      const d = await s.detach();
      const l = await s.load();
      const again = await s.prompt(script([], `BF-AGAIN-${sc.k}`), 60_000);
      await s.detach();
      const h2 = await new Harness({ name: `s20c-${arm}-${sc.k}`, modelUrl: model.url, arm }).start();
      try {
        const s2 = new HSession(h2, id, storeConnection(h2, w.workspaceId));
        const l2 = await s2.load();
        const v2 = await view(s2, p1.promptId);
        const p2 = await s2.prompt(script([], `BF-COLD-${sc.k}`), 60_000);
        R.check(`${L}: detach/load, then a new Harness process cold-loads; durable responses unchanged`, d.status === 204 && l.status === 200 && !l.json?.recoveryRequired && again.terminal?.[0]?.type === 'turn_complete' && l2.status === 200 && !l2.json?.recoveryRequired && good(v2, sc.n) && p2.terminal?.[0]?.type === 'turn_complete',
          `detach=${d.status} load=${l.status} again=${turn(again)} | cold load=${l2.status}${l2.json?.recoveryRequired ? ' recoveryRequired' : ''}${l2.json?.code ? ` ${l2.json.code}` : ''} ${fmt(v2)} next=${turn(p2)}`);
        await s2.detach();
      } finally {
        await h2.close();
      }
      continue;
    }
    const retry = rec ? await s.hookStatus(rec.hookExecutionId) : { status: '-' };
    const d0 = await s.detach();
    R.note(`${L}: in the same Harness after the failed second record`, `cancel=${c.status} ${c.json?.state ?? c.json?.code ?? ''} ${wire} visible ${fmt(v1)} next=${next.status} ${next.json?.code ?? ''} status-read retry=${retry.status} ${retry.json?.state ?? retry.json?.code ?? ''} detach=${d0.status}`);
    await hx.close();
    const h2 = await new Harness({ name: `s20r-${arm}-${sc.k}`, modelUrl: model.url, arm }).start();
    try {
      const s2 = new HSession(h2, id, storeConnection(h2, w.workspaceId, proxy.url));
      const w1 = writes.length;
      const t0 = Date.now();
      let l2;
      for (;;) {
        l2 = await s2.load();
        if (l2.status === 200 || Date.now() - t0 > 150_000) break;
        await sleep(10_000);
      }
      const fill = writes.slice(w1);
      const v2 = l2.status === 200 ? await view(s2, p1.promptId) : null;
      const p2 = await s2.prompt(script([], `BF-COLD-${sc.k}`), 60_000);
      R.check(`${L}: after Harness replacement the load writes only the missing refusals; no duplicates`, l2.status === 200 && !l2.json?.recoveryRequired && v2 && good(v2, sc.n) && p2.terminal?.[0]?.type === 'turn_complete',
        `load=${l2.status}${l2.json?.recoveryRequired ? ' recoveryRequired' : ''}${l2.json?.code ? ` ${l2.json.code}` : ''} after ${Math.round((Date.now() - t0) / 1000)}s; fill writes=${fill.length} [${fill.map((x) => `${x.decoded}B/${x.parts} refusals/${x.entry.status}`).join(', ')}] ${v2 ? fmt(v2) : ''} next=${turn(p2)}`);
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
