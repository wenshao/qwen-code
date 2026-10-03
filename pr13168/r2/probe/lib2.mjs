// VERIFICATION RIG ONLY (PR #13168 R2): helpers on top of lib.mjs.
// - startGateProxy: Harness -> Broker forwarder with a request ledger that records the
//   provider control `operation.kind`, and can HOLD chosen requests (stall) until released.
// - sysText / markersIn: scan the system instruction of each recorded model request.
import { createServer } from 'node:http';
import * as L from './lib.mjs';

export async function startGateProxy(brokerUrl = L.BROKER) {
  const ledger = [];
  const gates = [];
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(Buffer.from(c));
    const body = Buffer.concat(chunks);
    let kind;
    try {
      kind = JSON.parse(body.toString('utf8'))?.operation?.kind;
    } catch {}
    const url = req.url.replace(/\?.*$/, '');
    const entry = { t: Date.now(), method: req.method, url, kind, status: null };
    ledger.push(entry);
    const gate = gates.find((g) => !g.used && g.match(entry));
    if (gate) {
      gate.used = true;
      entry.held = true;
      gate.arrived(entry);
      const action = await gate.released;
      entry.releasedAt = Date.now();
      if (action === 'drop') {
        entry.status = 'dropped';
        res.destroy();
        return;
      }
    }
    try {
      const r = await fetch(new URL(req.url, brokerUrl), {
        method: req.method,
        headers: { Authorization: `Bearer ${L.E.BTOKEN}`, 'Content-Type': 'application/json' },
        ...(body.length ? { body } : {}),
        signal: AbortSignal.timeout(120_000),
      });
      const t = await r.text();
      entry.status = r.status;
      entry.resBody = t.slice(0, 400_000);
      try {
        entry.code = JSON.parse(t).code;
      } catch {}
      if (res.destroyed || req.socket.destroyed) {
        entry.clientGone = true;
        return;
      }
      res.writeHead(r.status, { 'Content-Type': 'application/json' });
      res.end(t);
    } catch (e) {
      entry.status = `proxy-error ${e.message}`;
      if (!res.headersSent) res.writeHead(503);
      res.end(String(e));
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    ledger,
    /** Hold the next request matching `match` until release('forward'|'drop'). */
    hold(match) {
      let arrived;
      let release;
      const g = {
        match,
        used: false,
        arrivedP: new Promise((r) => (arrived = r)),
        released: new Promise((r) => (release = r)),
      };
      g.arrived = arrived;
      gates.push(g);
      return { arrived: g.arrivedP, release: (a = 'forward') => release(a) };
    },
    close: () => new Promise((r) => { server.closeAllConnections(); server.close(() => r()); }),
  };
}

export const label = (e) => `${e.method} ${e.url.replace('/internal/runtime-broker/v1', '').replace(/tool-sessions\/[^/:]+/, 'tool-sessions/<id>')}${e.kind ? `{${e.kind}}` : ''} -> ${e.status}${e.code ? ` ${e.code}` : ''}${e.held ? ' [held]' : ''}`;
export const ledgerFrom = (ledger, t0 = 0) => ledger.filter((e) => e.t >= t0).map(label);
export const ctxOps = (ledger, t0 = 0) => ledger.filter((e) => e.t >= t0 && e.kind === 'workspace-context');

export function sysText(req) {
  const m = (req.messages ?? []).find((x) => x.role === 'system');
  if (!m) return '';
  return typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
}
export function markersIn(req, markers) {
  const s = sysText(req);
  return markers.filter((m) => s.includes(m));
}
