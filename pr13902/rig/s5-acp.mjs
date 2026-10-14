// S5 (bot R1-2) on a direct ACP host: `qwen --acp` over raw NDJSON JSON-RPC,
// the way an IDE-style ACP client talks to it (no daemon bridge in between).
// Timeline: spawn a teammate that reports after FAKE_TM_SLOW_MS; start a slow
// leader turn; (mode=load) send session/load for the SAME live session, which
// enters withLiveSessionRestore -> beginClose -> drain; the teammate report
// lands inside that window. mode=control runs the identical timeline without
// the load request.
// usage: node s5-acp.mjs <runDir> <wt> <fakePort> <mode:load|control>
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { readLedger, check, sleep } from './lib.mjs';

const [runDir, wt, fakePort, mode] = process.argv.slice(2);
const ws = path.join(runDir, 'ws');
for (const d of ['home', 'qwen-home', 'runtime', 'ws']) fs.mkdirSync(path.join(runDir, d), { recursive: true });
fs.writeFileSync(path.join(runDir, 'qwen-home/settings.json'), JSON.stringify({ security: { auth: { selectedType: 'openai' } }, general: { enableAutoUpdate: false, disableUpdateNag: true }, model: { name: 'fake-model' }, experimental: { agentTeam: true } }));
const T0 = Date.now();
const ts = () => +((Date.now() - T0) / 1000).toFixed(3);
const tl = [];
const mark = (s, x = {}) => { const r = { t: ts(), s, ...x }; tl.push(r); console.log(`[${r.t}s] ${s} ${Object.keys(x).length ? JSON.stringify(x) : ''}`); };
const child = spawn(process.execPath, [path.join(wt, 'dist/cli.js'), '--acp'], {
  cwd: ws,
  env: { HOME: path.join(runDir, 'home'), PATH: process.env.PATH, QWEN_HOME: path.join(runDir, 'qwen-home'), QWEN_RUNTIME_DIR: path.join(runDir, 'runtime'), OPENAI_API_KEY: 'dummy', OPENAI_BASE_URL: `http://127.0.0.1:${fakePort}/v1`, OPENAI_MODEL: 'fake-model', QWEN_CODE_ENABLE_AGENT_TEAM: '1', QWEN_CODE_NO_RELAUNCH: 'true', NO_COLOR: '1' },
  stdio: ['pipe', 'pipe', 'pipe'],
});
const errLog = fs.createWriteStream(path.join(runDir, `acp-${mode}.stderr.log`));
child.stderr.pipe(errLog);
const wire = fs.createWriteStream(path.join(runDir, `acp-${mode}.wire.jsonl`));
let nextId = 1; const pending = new Map(); const updates = [];
let buf = '';
child.stdout.on('data', (c) => {
  buf += c.toString();
  let i; while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i); buf = buf.slice(i + 1);
    if (!line.trim()) continue;
    let msg; try { msg = JSON.parse(line); } catch { continue; }
    wire.write(JSON.stringify({ t: ts(), dir: 'in', msg }) + '\n');
    if (msg.id !== undefined && (msg.result !== undefined || msg.error !== undefined) && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); continue; }
    if (msg.method === 'session/update') { updates.push({ t: ts(), p: msg.params }); continue; }
    if (msg.id !== undefined && msg.method) {
      // Agent -> client request. YOLO session: answer permissions with allow,
      // decline anything else.
      let result = null; let error;
      if (msg.method === 'session/request_permission') {
        const opt = (msg.params.options || []).find((o) => o.kind === 'allow_once') || msg.params.options?.[0];
        result = { outcome: { outcome: 'selected', optionId: opt?.optionId } };
      } else error = { code: -32601, message: `unsupported in rig: ${msg.method}` };
      const out = { jsonrpc: '2.0', id: msg.id, ...(error ? { error } : { result }) };
      wire.write(JSON.stringify({ t: ts(), dir: 'out', msg: out }) + '\n');
      child.stdin.write(JSON.stringify(out) + '\n');
    }
  }
});
function rpc(method, params) {
  const id = nextId++;
  const msg = { jsonrpc: '2.0', id, method, params };
  wire.write(JSON.stringify({ t: ts(), dir: 'out', msg }) + '\n');
  child.stdin.write(JSON.stringify(msg) + '\n');
  return new Promise((res) => pending.set(id, (m) => res(m)));
}
const results = [];
const v = {};
try {
  const init = await rpc('initialize', { protocolVersion: 1, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false } } });
  mark('initialize', { ok: !!init.result, err: init.error?.message });
  const ns = await rpc('session/new', { cwd: ws, mcpServers: [] });
  const sid = ns.result?.sessionId; mark('session/new', { sid, err: ns.error?.message });
  const sm = await rpc('session/set_mode', { sessionId: sid, modeId: 'yolo' }); mark('set_mode yolo', { ok: !sm.error, err: sm.error?.message });
  const p1 = await rpc('session/prompt', { sessionId: sid, prompt: [{ type: 'text', text: '[[LEAD:team:S5:slow]] Create a team; the teammate reports after a delay.' }] });
  mark('team prompt done', { stopReason: p1.result?.stopReason, err: p1.error?.message });
  await sleep(1500); // let the roster-join notification turn settle
  const pSlow = rpc('session/prompt', { sessionId: sid, prompt: [{ type: 'text', text: '[[LEAD:slow:S5:20]] Think for a while.' }] }).then((m) => { mark('slow prompt done', { stopReason: m.result?.stopReason, err: m.error?.message }); return m; });
  await sleep(1000);
  let pLoad = Promise.resolve(null);
  if (mode === 'load' || mode === 'loadfix') {
    const t = ts(); mark('session/load (same live session) sent');
    pLoad = rpc('session/load', { sessionId: sid, cwd: ws, mcpServers: [] }).then((m) => { v.load = { tookS: +(ts() - t).toFixed(3), ok: !!m.result, err: m.error?.message }; mark('session/load returned', v.load); return m; });
  }
  await Promise.all([pSlow, pLoad]);
  // Allow any drained notification turn to run.
  for (let i = 0; i < 40 && !readLedger(runDir).some((r) => r.who === 'leader' && r.scen === 'notified' && r.tag === 'S5'); i++) await sleep(250);
  await sleep(2000);
  const ledger = readLedger(runDir);
  v.teammateReplied = ledger.filter((r) => r.who === 'teammate' && /TEAMMATE-REPORT S5/.test(r.reply)).map((r) => r.t);
  v.leaderModelGotReport = ledger.filter((r) => r.who === 'leader' && r.scen === 'notified' && r.tag === 'S5').length;
  v.reportUpdates = updates.filter((u) => JSON.stringify(u.p).includes('TEAMMATE-REPORT S5')).length;
  v.peerReportUpdates = updates.filter((u) => /teammate-message-/.test(JSON.stringify(u.p))).length;
  const inbox = path.join(runDir, 'qwen-home/teams/t-s5/inboxes/leader.json');
  v.inboxRows = fs.existsSync(inbox) ? JSON.parse(fs.readFileSync(inbox, 'utf8')).map((m) => ({ from: m.from, read: m.read, text: String(m.text ?? '').slice(0, 40) })) : null;
  const chats = []; const walk = (d) => { if (!fs.existsSync(d)) return; for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (p.endsWith('.jsonl') && p.includes(sid)) chats.push(p); } };
  walk(path.join(runDir, 'runtime')); walk(path.join(runDir, 'qwen-home'));
  // Conversation records only: a ui_telemetry api_response row logs the
  // teammate's raw model output and is not something a resumed session reads.
  const recs = chats.flatMap((p) => fs.readFileSync(p, 'utf8').split('\n').filter((l) => l.includes('TEAMMATE-REPORT S5')).map((l) => { try { return JSON.parse(l); } catch { return {}; } }));
  v.transcriptReportRecords = recs.map((r) => `${r.type}/${r.subtype}`);
  v.reportInTranscript = recs.some((r) => r.subtype !== 'ui_telemetry');
  v.debugDropLog = fs.existsSync(path.join(runDir, `acp-${mode}.stderr.log`)) ? fs.readFileSync(path.join(runDir, `acp-${mode}.stderr.log`), 'utf8').split('\n').filter((l) => /teammate|leader inbox|closing/i.test(l)).slice(0, 5) : [];
  console.log('V', JSON.stringify(v, null, 1));
  if (mode === 'loadfix') {
    check(results, 'CAND: load entered the restore gate (blocked until the slow turn drained)', v.load && v.load.tookS > 5, v.load);
    check(results, 'CAND: teammate report was produced inside the window', v.teammateReplied.length === 1, v.teammateReplied);
    check(results, 'CAND: peer report notification (teammate-message-*) delivered to the client', v.peerReportUpdates >= 1, v.peerReportUpdates);
    check(results, 'CAND: report reached the leader model', v.leaderModelGotReport >= 1, v.leaderModelGotReport);
    check(results, 'CAND: report persisted in the transcript', v.reportInTranscript, v.transcriptReportRecords);
  } else if (mode === 'load') {
    check(results, 'load entered the restore gate (blocked until the slow turn drained)', v.load && v.load.tookS > 5, v.load);
    check(results, 'teammate report was produced inside the window', v.teammateReplied.length === 1, v.teammateReplied);
    check(results, 'R1-2: inbox row marked read:true', v.inboxRows?.some((r) => r.read === true), v.inboxRows);
    check(results, 'R1-2: no peer report notification (teammate-message-*) reaches the client', v.peerReportUpdates === 0, v.peerReportUpdates);
    check(results, 'R1-2: report never reached the leader model', v.leaderModelGotReport === 0, v.leaderModelGotReport);
    check(results, 'R1-2: report absent from the persisted transcript', !v.reportInTranscript, chats.map((p) => path.basename(p)));
  } else {
    check(results, 'control: teammate report produced', v.teammateReplied.length === 1, v.teammateReplied);
    check(results, 'control: peer report notification (teammate-message-*) delivered to the client', v.peerReportUpdates >= 1, v.peerReportUpdates);
    check(results, 'control: report reached the leader model', v.leaderModelGotReport >= 1, v.leaderModelGotReport);
    check(results, 'control: report persisted in the transcript', v.reportInTranscript);
  }
} catch (e) { mark('ERROR', { message: e.message }); }
fs.writeFileSync(path.join(runDir, `s5-acp-${mode}-result.json`), JSON.stringify({ mode, v, results, timeline: tl }, null, 2));
console.log(`RESULT s5-acp ${mode} pass=${results.filter((r) => r.ok).length} fail=${results.filter((r) => !r.ok).length}`);
child.kill('SIGTERM');
await sleep(500);
process.exit(0);
