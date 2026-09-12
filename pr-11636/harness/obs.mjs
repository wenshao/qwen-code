// Wire-level observer for a real `qwen serve` daemon: REST helpers, an SSE
// subscriber, and a live-state/status poller that records every CHANGE.
import fs from 'node:fs';

export const ARM = process.env.ARM || 'pr';
const ARMS = {
  pr: { port: 4636, mock: 18636, ws: '/root/git/h11636/ws-pr' },
  base: { port: 4637, mock: 18637, ws: '/root/git/h11636/ws-base' },
};
export const cfg = ARMS[ARM];
export const BASE = `http://127.0.0.1:${cfg.port}`;
export const TOKEN = 'T0KEN11636';
export const MOCK = `http://127.0.0.1:${cfg.mock}`;
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const T0 = Date.now();
export const rel = (t = Date.now()) => ((t - T0) / 1000).toFixed(2);

export async function api(path, { method = 'GET', body, clientId } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'content-type': 'application/json',
      ...(clientId ? { 'x-qwen-client-id': clientId } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, json, text: text.slice(0, 600) };
}

export async function mockRun(label) {
  await fetch(`${MOCK}/__run`, { method: 'POST', body: JSON.stringify({ label }) });
}
export async function mockLog() {
  return (await fetch(`${MOCK}/__log`)).json();
}

export async function createSession(extra = {}) {
  const r = await api('/session', { method: 'POST', body: { cwd: cfg.ws, approvalMode: 'yolo', sessionScope: 'thread', ...extra } });
  if (r.status >= 300) throw new Error(`POST /session ${r.status} ${r.text}`);
  return r.json;
}

export function prompt(sid, clientId, text) {
  return api(`/session/${sid}/prompt`, { method: 'POST', clientId, body: { prompt: [{ type: 'text', text }] } });
}

/** SSE subscriber: records a compact row per event. */
export function subscribe(sid, clientId, rows) {
  const ac = new AbortController();
  (async () => {
    try {
      const res = await fetch(`${BASE}/session/${sid}/events`, {
        headers: { Authorization: `Bearer ${TOKEN}`, accept: 'text/event-stream', ...(clientId ? { 'x-qwen-client-id': clientId } : {}) },
        signal: ac.signal,
      });
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf('\n\n')) >= 0) {
          const frame = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          const data = frame
            .split('\n')
            .filter((l) => l.startsWith('data:'))
            .map((l) => l.slice(5).trimStart())
            .join('\n');
          if (!data) continue;
          let ev;
          try {
            ev = JSON.parse(data);
          } catch {
            continue;
          }
          const upd = ev?.data?.update;
          const meta = upd?._meta ?? {};
          rows.push({
            t: Date.now(),
            type: ev.type,
            promptId: ev.promptId ?? ev?.data?.promptId,
            su: upd?.sessionUpdate,
            source: meta.source,
            bgTurn: meta.backgroundTurn?.turnId ?? ev?.data?.backgroundTurn?.turnId,
            stopReason: ev?.data?.stopReason ?? ev?.data?.reason,
            text: (upd?.content?.text ?? '').replace(/\s+/g, ' ').slice(0, 90) || undefined,
            tool: upd?.title ?? upd?.toolCallId,
            status: upd?.status,
          });
        }
      }
    } catch (e) {
      if (!ac.signal.aborted) rows.push({ t: Date.now(), type: 'sse-error', text: String(e).slice(0, 120) });
    }
  })();
  return () => ac.abort();
}

/** Poll status + live-state; push a row only when the observed tuple changes. */
export function poll(sid, rows, everyMs = 200) {
  let last = '';
  let stopped = false;
  (async () => {
    while (!stopped) {
      const [st, ls] = await Promise.all([
        api(`/session/${sid}/status`),
        api(`/workspaces/${encodeURIComponent(cfg.ws)}/sessions/live-state`),
      ]);
      const s = st.json ?? {};
      const l = (ls.json?.sessions ?? []).find((x) => x.sessionId === sid) ?? {};
      const tuple = {
        status_hasActivePrompt: s.hasActivePrompt,
        status_activeWork: s.activeWorkState,
        status_bgTurn: s.backgroundTurn?.turnId ? s.backgroundTurn.turnId.replace(/^.*notification/, 'notif:').slice(0, 14) : undefined,
        live_hasActivePrompt: l.hasActivePrompt,
        live_bgTurn: l.backgroundTurn?.turnId ? l.backgroundTurn.turnId.replace(/^.*notification/, 'notif:').slice(0, 14) : undefined,
        live_bgTasks: l.hasRunningBackgroundTasks,
        live_activeWork: l.activeWorkState,
        lsStatus: ls.status,
      };
      const key = JSON.stringify(tuple);
      if (key !== last) {
        rows.push({ t: Date.now(), ...tuple });
        last = key;
      }
      await sleep(everyMs);
    }
  })();
  return () => {
    stopped = true;
  };
}

export function save(file, obj) {
  fs.mkdirSync(file.replace(/\/[^/]+$/, ''), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(obj, null, 1));
}
