// E2E driver for PR 11802: real `qwen serve` daemon, real `qwen --acp` child,
// N sessions multiplexed on one child, permission prompts observed over SSE.
// usage: node driver.mjs --port P --token T --arm head|base --out DIR --scenario s1|s2 [--wait 45] [--siblings 2]
import fs from 'node:fs';
import path from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => { if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : 'true']); return acc; }, []));
const PORT = Number(args.port), TOKEN = args.token, ARM = args.arm, OUT = args.out, SCEN = args.scenario || 's1';
const WAIT = Number(args.wait || 45), SIBLINGS = Number(args.siblings || 2), HOLD = Number(args.hold || 0);
const WS = args.ws;
const BASE = `http://127.0.0.1:${PORT}`;
fs.mkdirSync(OUT, { recursive: true });
const T0 = Date.now();
const evLog = fs.createWriteStream(path.join(OUT, `events-${ARM}-${SCEN}.jsonl`), { flags: 'a' });
const tl = [];
function ts() { return ((Date.now() - T0) / 1000).toFixed(3); }
function mark(step, extra = {}) { const row = { t: ts(), step, ...extra }; tl.push(row); console.log(`[${row.t}s] ${step} ${JSON.stringify(extra)}`); }
function hdr(clientId) { return { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', ...(clientId ? { 'X-Qwen-Client-Id': clientId } : {}) }; }
async function j(method, url, body, clientId) {
  const r = await fetch(BASE + url, { method, headers: hdr(clientId), body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: r.status, data };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Sess {
  constructor(name) { this.name = name; this.id = null; this.perms = []; this.resolved = []; this.turns = []; this.events = []; this.clientId = `probe-${name}`; }
  async create() {
    const r = await j('POST', '/session', { ...(WS ? { cwd: WS } : {}), sessionScope: 'thread' });
    if (r.status !== 200 && r.status !== 201) throw new Error(`create ${this.name}: ${r.status} ${JSON.stringify(r.data)}`);
    this.id = r.data.sessionId; this.clientId = r.data.clientId; mark(`session ${this.name} created`, { id: this.id, attached: r.data.attached, clientId: this.clientId });
    this.subscribe();
    try { const f = path.join(OUT, `sessions-${ARM}-${SCEN}.json`); const cur = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : {}; cur[this.name] = this.id; fs.writeFileSync(f, JSON.stringify(cur)); } catch {}
    await sleep(300);
  }
  subscribe() {
    const ac = new AbortController(); this.ac = ac;
    (async () => {
      const r = await fetch(`${BASE}/session/${this.id}/events`, { headers: hdr(this.clientId), signal: ac.signal });
      const reader = r.body.getReader(); const dec = new TextDecoder(); let buf = '';
      for (;;) {
        const { value, done } = await reader.read(); if (done) break;
        buf += dec.decode(value, { stream: true });
        let i; while ((i = buf.indexOf('\n\n')) >= 0) { const frame = buf.slice(0, i); buf = buf.slice(i + 2); this.onFrame(frame); }
      }
    })().catch((e) => { if (!ac.signal.aborted) console.error(`sse ${this.name} error`, e.message); });
  }
  onFrame(frame) {
    let type = '', data = '';
    for (const line of frame.split('\n')) { if (line.startsWith('event:')) type = line.slice(6).trim(); else if (line.startsWith('data:')) data += line.slice(5).trim(); }
    if (!type) return;
    let d = {}; try { d = JSON.parse(data); } catch {}
    const rec = { t: ts(), session: this.name, type, ...(d?.data?.requestId ? { requestId: d.data.requestId } : {}), ...(d?.stopReason ? { stopReason: d.stopReason } : {}), ...(d?.data?.stopReason ? { stopReason: d.data.stopReason } : {}) };
    evLog.write(JSON.stringify({ ...rec, raw: type === 'permission_request' || type === 'turn_complete' || type === 'permission_resolved' || type === 'prompt_cancelled' || type === 'turn_error' ? d : undefined }) + '\n');
    this.events.push(rec);
    if (type === 'permission_request') { this.perms.push({ t: rec.t, requestId: d.data.requestId, options: d.data.options, title: d.data.toolCall?.title, questions: d.data.toolCall?._meta?.qwenQuestions }); mark(`PERMISSION_REQUEST reached host for ${this.name}`, { requestId: d.data.requestId, title: d.data.toolCall?.title, nOptions: d.data.options?.length }); }
    if (type === 'permission_resolved') this.resolved.push({ t: rec.t, requestId: d.data?.requestId });
    if (type === 'turn_complete' || type === 'turn_error' || type === 'prompt_cancelled') { this.turns.push({ t: rec.t, type, stopReason: d.stopReason ?? d.data?.stopReason }); mark(`${type} for ${this.name}`, { stopReason: d.stopReason ?? d.data?.stopReason }); }
  }
  async prompt(text) { const r = await j('POST', `/session/${this.id}/prompt`, { prompt: [{ type: 'text', text }] }, this.clientId); mark(`prompt sent to ${this.name}`, { status: r.status, text }); if (r.status >= 300) throw new Error(`prompt ${this.name}: ${r.status} ${JSON.stringify(r.data)}`); return r; }
  async status() { const r = await j('GET', `/session/${this.id}/status`, undefined, this.clientId); const s = r.data; return { hasActivePrompt: s.hasActivePrompt, isWaitingForPermission: s.isWaitingForPermission, isWaitingForUserQuestion: s.isWaitingForUserQuestion, pendingInteractionCount: s.pendingInteractionCount }; }
  async vote(requestId, optionId, answers) { const r = await j('POST', `/session/${this.id}/permission/${requestId}`, { outcome: { outcome: 'selected', optionId }, ...(answers ? { answers } : {}) }, this.clientId); mark(`vote ${this.name}`, { requestId, optionId, status: r.status, resp: r.data }); return r; }
  async cancel() { const r = await j('POST', `/session/${this.id}/cancel`, {}, this.clientId); mark(`cancel ${this.name}`, { status: r.status }); return r; }
  async waitPerm(n, timeoutS) { const start = Date.now(); while (this.perms.length < n) { if (Date.now() - start > timeoutS * 1000) return null; await sleep(100); } return this.perms[n - 1]; }
  async waitTurn(n, timeoutS) { const start = Date.now(); while (this.turns.length < n) { if (Date.now() - start > timeoutS * 1000) return null; await sleep(100); } return this.turns[n - 1]; }
}
function answersFor(p) { const q = p.questions || []; return Object.fromEntries(q.map((x, i) => [String(i), x.options?.[0]?.label || 'Alpha'])); }
async function health() { const r = await j('GET', '/health?deep=1'); const h = r.data; return { sessions: h.sessions, pendingPermissions: h.pendingPermissions, activePrompts: h.activePrompts }; }
async function sampleWhile(sessions, labelFn, untilFn, everyMs = 2000, maxS = WAIT) {
  const samples = []; const start = Date.now();
  while (!untilFn() && Date.now() - start < maxS * 1000) {
    const row = { t: ts(), health: await health() };
    for (const s of sessions) row[s.name] = await s.status();
    samples.push(row); console.log(`  sample ${row.t}s health=${JSON.stringify(row.health)} ` + sessions.map((s) => `${s.name}=${JSON.stringify(row[s.name])}`).join(' '));
    await sleep(everyMs);
  }
  return samples;
}

const result = { arm: ARM, scenario: SCEN, port: PORT, startedAt: new Date().toISOString(), sessions: {}, samples: [], verdict: {} };
try {
  const h0 = await health(); mark('daemon health', h0);
  if (SCEN === 's1') {
    // Incident shape: A asks and is never answered; siblings B(,C) ask afterwards.
    const A = new Sess('A'); await A.create();
    const sibs = []; for (let i = 0; i < SIBLINGS; i++) { const s = new Sess(String.fromCharCode(66 + i)); await s.create(); sibs.push(s); }
    await A.prompt(`[[S:A]] [[ASK:A]] Please ask me which path to take.`);
    const pa = await A.waitPerm(1, 60); if (!pa) throw new Error('A permission never reached the host');
    result.verdict.A_first_permission_latency_s = Number(pa.t) - Number(tl.find((r) => r.step === 'prompt sent to A').t);
    mark('A left unanswered on purpose (idle head-of-line session)');
    await sleep(1500);
    mark('health after A pending', await health());
    for (const s of sibs) await s.prompt(`[[S:${s.name}]] [[ASK:${s.name}]] Please ask me which path to take.`);
    const tSent = Number(tl.find((r) => r.step === `prompt sent to ${sibs[0].name}`).t);
    result.samples = await sampleWhile([A, ...sibs], null, () => sibs.every((s) => s.perms.length >= 1), 2000, WAIT);
    if (HOLD > 0) { mark(`holding ${HOLD}s with everything left pending (screenshot window)`, { health: await health() }); await sleep(HOLD * 1000); mark('hold over', { health: await health() }); }
    for (const s of sibs) {
      const p = s.perms[0];
      result.verdict[`${s.name}_permission_reached_host`] = !!p;
      result.verdict[`${s.name}_latency_s`] = p ? +(Number(p.t) - Number(tl.find((r) => r.step === `prompt sent to ${s.name}`).t)).toFixed(3) : null;
      result.verdict[`${s.name}_status_at_end`] = await s.status();
      if (!p) mark(`TIMEOUT: ${s.name} permission never reached host within ${WAIT}s while A stays unanswered`, { statusB: await s.status(), health: await health() });
    }
    result.verdict.health_at_end_of_wait = await health();
    // Incident tail (only meaningful when a sibling is stuck): cancel stuck sibling, re-ask in the same session.
    const stuck = sibs.filter((s) => s.perms.length === 0);
    if (stuck.length) {
      const s = stuck[0];
      await s.cancel(); const tc = await s.waitTurn(1, 20); mark(`after cancel ${s.name}`, { turn: tc, status: await s.status() });
      await sleep(1000);
      await s.prompt(`[[S:${s.name}]] [[ASK:${s.name}2]] Same question again after cancel.`);
      const p2 = await s.waitPerm(1, 30);
      result.verdict[`${s.name}_reask_after_cancel_reached_host`] = !!p2;
      result.verdict[`${s.name}_reask_latency_s`] = p2 ? +(Number(p2.t) - Number(tl.filter((r) => r.step === `prompt sent to ${s.name}`).pop().t)).toFixed(3) : null;
      mark(`re-ask result for ${s.name}`, { reached: !!p2, health: await health(), A_status: await A.status() });
    }
    // Drain: answer everything that reached the host, confirm turns complete.
    const turnsBefore = new Map([A, ...sibs].map((s) => [s.name, s.turns.length]));
    for (let pass = 0; pass < 4; pass++) {
      let voted = 0;
      for (const s of [A, ...sibs]) for (const p of s.perms) if (!p.voted && !s.resolved.find((r) => r.requestId === p.requestId)) { p.voted = true; voted++; await s.vote(p.requestId, p.options?.[0]?.optionId, answersFor(p)); }
      mark(`drain pass ${pass}`, { voted });
      await sleep(2500);
      const outstanding = [A, ...sibs].some((s) => s.perms.some((p) => !p.voted));
      if (!outstanding && (await health()).pendingPermissions === 0) break;
    }
    for (const s of [A, ...sibs]) { const t = await s.waitTurn(turnsBefore.get(s.name) + 1, 30); result.verdict[`${s.name}_turn_after_answer`] = t; result.verdict[`${s.name}_turns_total`] = s.turns.length; }
    result.verdict.health_after_drain = await health();
    for (const s of [A, ...sibs]) result.sessions[s.name] = { id: s.id, perms: s.perms.map((p) => ({ t: p.t, requestId: p.requestId, title: p.title })), turns: s.turns, resolved: s.resolved };
  } else if (SCEN === 's2') {
    // Intra-session guard: one session, model emits TWO ask_user_question calls in one response.
    const A = new Sess('A'); await A.create();
    await A.prompt(`[[S:A]] [[ASK2:A]] Ask me two questions.`);
    const p1 = await A.waitPerm(1, 60); if (!p1) throw new Error('first permission never reached host');
    await sleep(3000);
    result.verdict.perms_visible_after_first_3s = A.perms.length;
    result.verdict.status_after_first = await A.status(); result.verdict.health_after_first = await health();
    mark('one-at-a-time check', { permsSoFar: A.perms.length, status: result.verdict.status_after_first });
    await A.vote(p1.requestId, p1.options?.[0]?.optionId, answersFor(p1));
    const p2 = await A.waitPerm(2, 30);
    result.verdict.second_reached_after_answering_first = !!p2;
    result.verdict.second_latency_after_vote_s = p2 ? +(Number(p2.t) - Number(tl.filter((r) => r.step === 'vote A').pop().t)).toFixed(3) : null;
    if (p2) await A.vote(p2.requestId, p2.options?.[0]?.optionId, answersFor(p2));
    const t = await A.waitTurn(1, 30); result.verdict.turn = t; result.verdict.health_end = await health();
    result.sessions.A = { id: A.id, perms: A.perms.map((p) => ({ t: p.t, requestId: p.requestId, title: p.title })), turns: A.turns, resolved: A.resolved };
  }
  result.ok = true;
} catch (e) { result.ok = false; result.error = e.message; mark('ERROR', { message: e.message }); }
result.timeline = tl; result.finishedAt = new Date().toISOString();
fs.writeFileSync(path.join(OUT, `result-${ARM}-${SCEN}.json`), JSON.stringify(result, null, 2));
console.log('VERDICT', JSON.stringify(result.verdict, null, 1));
evLog.end(); await sleep(200); process.exit(0);
