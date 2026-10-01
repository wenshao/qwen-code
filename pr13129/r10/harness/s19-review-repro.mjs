// S19: real-stack replay of the two review threads posted on c5a4cd2853 (discussion_r4156861642 / r4156861669).
// P1: a native InstructionsLoaded Hook (fires while QWEN.md is loaded, before the first model attempt) is refused before
//     effect and cancelled by the operator. Does the Session recover?
// P2: a refused PreToolUse on a batch of N short read_file calls, then operator cancel. The recovery writes one
//     tool_result holding every refusal; does it fit the Store's resource limit? N=300 (control) and N=650.
import fs from 'node:fs';
import { startStoreProxy, Report, Harness, HSession, startModel, workspace, createWorkspaceSession, storeConnection, script, call, turn, pin, hookRecords, setControl, toolTrace, j, sleep } from './lib.mjs';
import { STORAGE } from './manifest.mjs';
if (!process.env.DB) throw new Error('DB is required');
const arm = process.env.ARM ?? 'head';
const R = new Report(`s19-review-repro-${arm}${process.env.WSUFFIX ?? ""}${process.env.ONLY ? `-${process.env.ONLY}` : ""}${process.env.AUTOID ? "-autoid" : ""}`);
setControl({});
const model = await startModel();
const proxy = await startStoreProxy();
const MARK = 'cancelled before this tool call ran';
const writes = [];
proxy.state.hook = async (entry, parsed, body) => {
  let decoded = 0;
  let hay = '';
  for (const m of body.toString().matchAll(/"bytesBase64"\s*:\s*"([A-Za-z0-9+/=]+)"/g)) {
    const b = Buffer.from(m[1], 'base64');
    decoded = Math.max(decoded, b.length);
    hay += b.toString();
  }
  if (hay.includes(MARK)) writes.push({ entry, decoded });
  return 'forward';
};
const h = await new Harness({ name: `s19-${arm}`, modelUrl: model.url, arm }).start();
const counts = (s, promptId) => s.transcript().catch(() => []).then((ev) => {
  const tr = toolTrace(ev.filter((e) => e.promptId === promptId));
  return { calls: tr.filter((x) => x.startsWith('call ')).length, results: tr.filter((x) => x.startsWith('result ')).length };
});
try {
  if (!process.env.ONLY || process.env.ONLY === 'p1') {
    // Hosted memory discovery reads the Harness's own home/cwd, not the remote Workspace.
    const mem = [`${h.root}/QWEN.md`, `${h.root}/.qwen/QWEN.md`];
    for (const f of mem) fs.writeFileSync(f, '# Project instructions\nBe brief.\n');
    const WS = 'ws-il';
    const w = await workspace(STORAGE[WS], WS);
    const id = await createWorkspaceSession(w.workspaceId);
    const s = new HSession(h, id, storeConnection(h, w.workspaceId));
    const cr = await s.create({ hookCatalog: pin(WS) });
    const p1 = await s.prompt(script([], 'IL-1'), 60_000);
    const ils = () => hookRecords(id, 'hook_execution').filter((r) => r.rec.eventName === 'InstructionsLoaded' && r.rec.hookId === 'il');
    const rec = ils()[0]?.rec;
    const before = await s.submit(script([], 'IL-BEFORE'));
    if (before.status === 202) await s.waitIdle();
    R.check('P1 InstructionsLoaded fires before the model (QWEN.md in the Harness home), is refused before effect, and blocks the Session', !!rec && rec.run.execution === 'not_started_proven' && before.status === 409,
      `create=${cr.status} first turn=${turn(p1)} InstructionsLoaded executions=${ils().length} record=${rec?.run.state}/${j(rec?.run.execution)} next before cancel=${before.status} ${before.json?.code ?? ''}`);
    if (rec) {
      const c = await s.hookStatus(rec.hookExecutionId, true);
      const ev = (await s.transcript().catch(() => [])).filter((e) => e.promptId === p1.promptId);
      const term = ev.filter((e) => e.type.startsWith('turn_')).map((e) => `${e.type}${e.data?.stopReason ? `(${e.data.stopReason})` : ''}`).join(',') || '<none>';
      const withFile = await s.prompt(script([], 'IL-NEXT'), 60_000);
      R.check('P1 after the operator cancel the original turn settles and the Session admits the next prompt', c.status === 200 && /turn_complete\(cancelled\)/.test(term) && withFile.status === 202,
        `cancel=${c.status} ${c.json?.state ?? c.json?.code ?? ''} ${c.json?.execution ?? ''} original turn terminal=${term} | next prompt (QWEN.md still present)=${turn(withFile)} InstructionsLoaded executions now=${ils().length} states=${ils().map((r) => r.rec.run.state + '/' + r.rec.run.execution).join(',')}`);
      // A permanently refused Hook refuses again on every turn that loads QWEN.md; cancel again, then remove the file.
      for (const r of ils().filter((x) => x.rec.run.state === 'recovery_blocked')) await s.hookStatus(r.rec.hookExecutionId, true);
      for (const f of mem) fs.rmSync(f, { force: true });
      const clean = await s.prompt(script([], 'IL-CLEAN'), 60_000);
      const d = await s.detach();
      const l = await s.load();
      const again = await s.prompt(script([], 'IL-AGAIN'), 60_000);
      await s.detach();
      const h2 = await new Harness({ name: `s19c-${arm}-il`, modelUrl: model.url, arm }).start();
      let cold;
      try {
        const s2 = new HSession(h2, id, storeConnection(h2, w.workspaceId));
        const l2 = await s2.load();
        const p2 = await s2.prompt(script([], 'IL-COLD'), 60_000);
        cold = `cold load=${l2.status}${l2.json?.recoveryRequired ? ' recoveryRequired' : ''} next=${turn(p2)}`;
        await s2.detach();
      } finally {
        await h2.close();
      }
      R.check('P1 with QWEN.md removed: next turn, detach/load and a new-process cold load all work', clean.terminal?.[0]?.type === 'turn_complete' && d.status === 204 && l.status === 200 && !l.json?.recoveryRequired && again.terminal?.[0]?.type === 'turn_complete' && /cold load=200 next=admit=202 terminal=turn_complete/.test(cold),
        `next=${turn(clean)} detach=${d.status} load=${l.status}${l.json?.recoveryRequired ? ' recoveryRequired' : ''} again=${turn(again)} | ${cold}`);
    }
  }
  for (const n of (process.env.SIZES ?? '300,650').split(',').map(Number)) {
    if (process.env.ONLY && process.env.ONLY !== `p2-${n}`) continue;
    const WS = `ws-big${n}${process.env.WSUFFIX ?? ""}`;
    const w = await workspace(STORAGE[WS], WS);
    fs.writeFileSync(`${w.dir}/a`, 'a');
    const id = await createWorkspaceSession(w.workspaceId);
    const s = new HSession(h, id, storeConnection(h, w.workspaceId, proxy.url));
    await s.create({ hookCatalog: pin(WS) });
    const prompt = `BATCH:${n}:END`;
    const p1 = await s.prompt(prompt, 120_000);
    const rec = hookRecords(id, 'hook_execution').find((r) => r.rec.hookId === 'big-pre')?.rec;
    const w0 = writes.length;
    const c = rec ? await s.hookStatus(rec.hookExecutionId, true) : { status: '-' };
    const mine = writes.slice(w0);
    const after = await counts(s, p1.promptId);
    const next = await s.prompt(script([], `BIG-NEXT-${n}`), 60_000);
    const retry = rec ? await s.hookStatus(rec.hookExecutionId) : { status: '-' };
    const d = await s.detach();
    const l = d.status === 204 ? await s.load() : null;
    const path = 'same Harness; the new-process load is checked separately';
    const ok = after.results === n && next.terminal?.[0]?.type === 'turn_complete';
    R.check(`P2 ${n} write_file calls: refused PreToolUse, operator cancel, every call gets a refusal and the next turn runs`, ok,
      `first turn=${turn(p1)} record=${rec?.run.state}/${j(rec?.run.execution)} cancel=${c.status} ${c.json?.state ?? c.json?.code ?? ''} recovery writes seen=${mine.length} decoded record bytes=${mine.map((x) => x.decoded).join('/') || '-'} store status=${mine.map((x) => x.entry.status).join('/') || '-'} results=${after.results}/${after.calls} next=${turn(next)} status-read retry=${retry.status} ${retry.json?.state ?? retry.json?.code ?? ''} detach=${d.status} load=${l ? `${l.status}${l.json?.recoveryRequired ? ' recoveryRequired' : ''}${l.json?.code ? ` ${l.json.code}` : ''}` : '-'} (${path})`);
    if (d.status === 204 && l?.status === 200) await s.detach();
    R.note(`P2 ${n}: Session id for the cold-load follow-up`, id);
  }
} finally {
  await h.close();
  await model.close();
  await proxy.close();
  R.done();
}
