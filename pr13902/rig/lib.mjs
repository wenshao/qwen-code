// Shared daemon client for the PR 13902 rig: real HTTP + SSE against a real
// `qwen serve` daemon. Every SSE frame is appended verbatim to events.jsonl so
// all verdicts can be recomputed offline from the raw capture.
import fs from 'node:fs';
import path from 'node:path';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function runCtx(runDir, port) {
  const token = fs.readFileSync(path.join(runDir, 'token'), 'utf8').trim();
  const base = `http://127.0.0.1:${port}`;
  const T0 = Date.now();
  const ts = () => +((Date.now() - T0) / 1000).toFixed(3);
  const timeline = [];
  const mark = (step, extra = {}) => {
    const row = { t: ts(), step, ...extra };
    timeline.push(row);
    console.log(`[${row.t.toFixed(3)}s] ${step} ${Object.keys(extra).length ? JSON.stringify(extra) : ''}`);
    return row;
  };
  const hdr = (clientId) => ({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(clientId ? { 'X-Qwen-Client-Id': clientId } : {}) });
  async function j(method, url, body, clientId) {
    const r = await fetch(base + url, { method, headers: hdr(clientId), body: body ? JSON.stringify(body) : undefined });
    const text = await r.text();
    let data; try { data = JSON.parse(text); } catch { data = text; }
    return { status: r.status, data };
  }
  return { runDir, port, token, base, ts, mark, timeline, hdr, j, ws: path.join(runDir, 'ws') };
}

export class Sess {
  constructor(ctx, name) {
    this.ctx = ctx; this.name = name; this.id = null; this.clientId = null;
    this.frames = []; this.perms = []; this.resolved = []; this.turns = [];
    this.evLog = fs.createWriteStream(path.join(ctx.runDir, `events-${name}.jsonl`), { flags: 'a' });
  }
  async create(extra = {}) {
    const r = await this.ctx.j('POST', '/session', { cwd: this.ctx.ws, sessionScope: 'thread', ...extra });
    if (r.status !== 200 && r.status !== 201) throw new Error(`create ${this.name}: ${r.status} ${JSON.stringify(r.data)}`);
    this.id = r.data.sessionId; this.clientId = r.data.clientId;
    this.ctx.mark(`session ${this.name} created`, { id: this.id, clientId: this.clientId });
    this.subscribe();
    await sleep(400);
    return r.data;
  }
  attachAs(id, clientId) { this.id = id; this.clientId = clientId; this.subscribe(); }
  subscribe() {
    const ac = new AbortController(); this.ac = ac;
    (async () => {
      const r = await fetch(`${this.ctx.base}/session/${this.id}/events`, { headers: this.ctx.hdr(this.clientId), signal: ac.signal });
      const reader = r.body.getReader(); const dec = new TextDecoder(); let buf = '';
      for (;;) {
        const { value, done } = await reader.read(); if (done) break;
        buf += dec.decode(value, { stream: true });
        let i; while ((i = buf.indexOf('\n\n')) >= 0) { const frame = buf.slice(0, i); buf = buf.slice(i + 2); this.onFrame(frame); }
      }
    })().catch((e) => { if (!ac.signal.aborted) console.error(`sse ${this.name} error`, e.message); });
  }
  onFrame(frame) {
    let type = '', data = '', id = '';
    for (const line of frame.split('\n')) {
      if (line.startsWith('event:')) type = line.slice(6).trim();
      else if (line.startsWith('data:')) data += line.slice(5).trim();
      else if (line.startsWith('id:')) id = line.slice(3).trim();
    }
    if (!type) return;
    let d = {}; try { d = JSON.parse(data); } catch { d = { unparsed: data }; }
    const rec = { t: this.ctx.ts(), session: this.name, sseId: id, type, data: d };
    this.evLog.write(JSON.stringify(rec) + '\n');
    this.frames.push(rec);
    const p = d?.data ?? d;
    if (type === 'permission_request') {
      this.perms.push({ t: rec.t, requestId: p.requestId, options: p.options, toolCallId: p.toolCall?.toolCallId, title: p.toolCall?.title, meta: p.toolCall?._meta, raw: p });
      this.ctx.mark(`PERMISSION_REQUEST ${this.name}`, { requestId: p.requestId, toolCallId: p.toolCall?.toolCallId, title: p.toolCall?.title });
    }
    if (type === 'permission_resolved') { this.resolved.push({ t: rec.t, requestId: p.requestId, raw: p }); this.ctx.mark(`permission_resolved ${this.name}`, { requestId: p.requestId }); }
    if (type === 'turn_complete' || type === 'turn_error' || type === 'prompt_cancelled') {
      this.turns.push({ t: rec.t, type, stopReason: p.stopReason ?? d.stopReason, raw: p });
      this.ctx.mark(`${type} ${this.name}`, { stopReason: p.stopReason ?? d.stopReason });
    }
  }
  async prompt(text) {
    const r = await this.ctx.j('POST', `/session/${this.id}/prompt`, { prompt: [{ type: 'text', text }] }, this.clientId);
    this.ctx.mark(`prompt -> ${this.name}`, { status: r.status, text: text.slice(0, 80) });
    if (r.status >= 300) throw new Error(`prompt ${this.name}: ${r.status} ${JSON.stringify(r.data)}`);
    return r;
  }
  async mode(mode) { const r = await this.ctx.j('POST', `/session/${this.id}/approval-mode`, { mode }, this.clientId); this.ctx.mark(`approval-mode ${this.name}=${mode}`, { status: r.status }); return r; }
  async status() { const r = await this.ctx.j('GET', `/session/${this.id}/status`, undefined, this.clientId); return r.data; }
  async vote(requestId, optionId, clientId = this.clientId) {
    const r = await this.ctx.j('POST', `/session/${this.id}/permission/${requestId}`, { outcome: { outcome: 'selected', optionId } }, clientId);
    this.ctx.mark(`vote ${this.name}`, { requestId, optionId, status: r.status, resp: r.data });
    return r;
  }
  async cancel() { const r = await this.ctx.j('POST', `/session/${this.id}/cancel`, {}, this.clientId); this.ctx.mark(`cancel ${this.name}`, { status: r.status }); return r; }
  async waitFor(pred, timeoutS, every = 100) { const s = Date.now(); for (;;) { const v = pred(); if (v) return v; if (Date.now() - s > timeoutS * 1000) return null; await sleep(every); } }
  async waitTurns(n, timeoutS) { return this.waitFor(() => (this.turns.length >= n ? this.turns[n - 1] : null), timeoutS); }
  close() { this.ac?.abort(); this.evLog.end(); }
}

/** The `_meta` object of an SSE frame's session update, wherever it sits. */
export function frameMeta(rec) {
  const d = rec.data?.data ?? rec.data;
  const u = d?.update ?? d;
  return u?._meta ?? d?._meta ?? null;
}
export function frameUpdate(rec) {
  const d = rec.data?.data ?? rec.data;
  return d?.update ?? d;
}
export function readLedger(runDir) {
  const f = path.join(runDir, 'fake-ledger.jsonl');
  if (!fs.existsSync(f)) return [];
  return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
}
export function check(results, name, ok, detail) {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail !== undefined ? '  ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) : ''}`);
}
export function walkFiles(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkFiles(p, out); else out.push(p);
  }
  return out;
}
