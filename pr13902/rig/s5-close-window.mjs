// S5 (bot R1-2): a teammate report that lands while the session is in its
// restore/close window (POST /session/:id/load on a live session during an
// in-flight leader turn). Mode `load` triggers the window; mode `control`
// runs the identical timeline without the load call.
// usage: node s5-close-window.mjs <runDir> <port> <mode:load|control>
// Requires the fake provider started with FAKE_TM_SLOW_MS (teammate delay).
import fs from 'node:fs';
import path from 'node:path';
import { runCtx, Sess, sleep, frameMeta, readLedger, check } from './lib.mjs';

const [runDir, port, mode] = process.argv.slice(2);
const ctx = runCtx(runDir, Number(port));
const results = [];
const v = {};
const tag = 'S5';
const A = new Sess(ctx, 'leader');
await A.create();
await A.mode('yolo');
await A.prompt(`[[LEAD:team:${tag}:slow]] Create a team; the teammate reports after a delay.`);
await A.waitFor(() => readLedger(runDir).some((r) => r.who === 'teammate'), 30);
ctx.mark('teammate model call started (it will answer after FAKE_TM_SLOW_MS)');
// Let the spawn turn and the roster-join wake turn settle first.
await A.waitFor(() => A.turns.length >= 2, 20);
await sleep(500);
await A.prompt(`[[LEAD:slow:${tag}:20]] Think for a while.`);
await sleep(1000);
let loadRes = null;
const loadP = mode === 'load'
  ? (async () => { const t = ctx.ts(); ctx.mark('POST /session/:id/load (live restore) sent'); const r = await ctx.j('POST', `/session/${A.id}/load`, { cwd: ctx.ws }, A.clientId); loadRes = { status: r.status, tookS: +(ctx.ts() - t).toFixed(3), attached: r.data?.attached, error: r.data?.error ?? r.data?.code }; ctx.mark('load returned', loadRes); })()
  : Promise.resolve();
// Teammate report lands during the window.
const reportAt = await A.waitFor(() => readLedger(runDir).find((r) => r.who === 'teammate' && /TEAMMATE-REPORT/.test(r.reply)), 30);
ctx.mark('teammate reply produced by provider', { at: reportAt?.t });
await loadP;
// Wait for the slow leader turn and anything it should drain afterwards.
await A.waitFor(() => readLedger(runDir).some((r) => r.who === 'leader' && r.scen === 'notified' && r.tag === tag), 45);
await sleep(3000);
const inbox = path.join(runDir, 'qwen-home/teams/t-s5/inboxes/leader.json');
const rows = fs.existsSync(inbox) ? JSON.parse(fs.readFileSync(inbox, 'utf8')) : [];
v.inboxRows = (Array.isArray(rows) ? rows : []).map((m) => ({ from: m.from, read: m.read, text: String(m.text ?? '').slice(0, 50) }));
v.peerReportFrames = A.frames.filter((f) => frameMeta(f)?.backgroundTask?.taskId?.startsWith('teammate-message-')).length;
v.reportTextFrames = A.frames.filter((f) => JSON.stringify(f.data).includes(`TEAMMATE-REPORT ${tag}`)).length;
v.leaderModelGotReport = readLedger(runDir).filter((r) => r.who === 'leader' && r.scen === 'notified' && r.tag === tag).length;
v.load = loadRes;
v.turns = A.turns.map((t) => ({ t: t.t, type: t.type, stopReason: t.stopReason }));
// Persisted transcript: does the report exist anywhere in the session record?
const chats = [];
const walk = (d) => { if (!fs.existsSync(d)) return; for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (p.endsWith('.jsonl') && p.includes(A.id)) chats.push(p); } };
walk(path.join(runDir, 'runtime')); walk(path.join(runDir, 'qwen-home'));
v.transcriptFiles = chats.map((p) => path.relative(runDir, p));
v.reportInTranscript = chats.some((p) => fs.readFileSync(p, 'utf8').includes(`TEAMMATE-REPORT ${tag}`));
console.log('V', JSON.stringify(v, null, 1));
if (mode === 'load') {
  check(results, 'load reached the live-restore path (blocked on drain, not instant)', loadRes && loadRes.tookS > 5, loadRes);
  check(results, 'R1-2: inbox row marked read:true', v.inboxRows.some((r) => r.read === true), v.inboxRows);
  check(results, 'R1-2: no peer report frame on the wire', v.peerReportFrames === 0, v.peerReportFrames);
  check(results, 'R1-2: report never reached the leader model', v.leaderModelGotReport === 0, v.leaderModelGotReport);
  check(results, 'R1-2: report absent from the persisted transcript', !v.reportInTranscript, v.transcriptFiles);
} else {
  check(results, 'control: report delivered as a peer frame', v.peerReportFrames >= 1, v.peerReportFrames);
  check(results, 'control: report reached the leader model', v.leaderModelGotReport >= 1, v.leaderModelGotReport);
  check(results, 'control: report persisted in the transcript', v.reportInTranscript, v.transcriptFiles);
}
fs.writeFileSync(path.join(runDir, `s5-${mode}-result.json`), JSON.stringify({ mode, v, results, timeline: ctx.timeline }, null, 2));
console.log(`RESULT s5 ${mode} pass=${results.filter((r) => r.ok).length} fail=${results.filter((r) => !r.ok).length}`);
A.close();
process.exit(0);
