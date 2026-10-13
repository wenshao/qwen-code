// Round 3: a Spring -> Harness tap. Every request streams through unchanged (SSE included) except
// POST /session/:id/lifecycle, whose JSON body is buffered so a rule can act on its phase:
//   drop-reply  forward to the Harness, read the full answer, then destroy Spring's socket (lost response)
//   hold        park the request until release(); then forward it (even if Spring's socket is gone)
//   fail        destroy Spring's socket without forwarding (request never reached the Harness)
// Each lifecycle exchange is appended to <runDir>/tap.jsonl with phase, operationId, claim and the Harness status.
import http from 'node:http';
import fs from 'node:fs';

export async function startTap(ctx, upstreamPort) {
  const rules = [];
  const holds = new Map();
  const seen = [];
  const logFile = `${ctx.runDir}/tap.jsonl`;
  const note = (e) => { seen.push(e); fs.appendFileSync(logFile, JSON.stringify(e) + '\n'); };
  const forward = (req, body, onDone) => {
    const headers = { ...req.headers, host: `127.0.0.1:${tap.upstreamPort}` };
    if (body) headers['content-length'] = String(body.length);
    const up = http.request({ host: '127.0.0.1', port: tap.upstreamPort, method: req.method, path: req.url, headers }, (ur) => onDone(null, ur));
    up.on('error', (e) => onDone(e));
    if (body) up.end(body); else up.end();
    return up;
  };
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      let body = chunks.length ? Buffer.concat(chunks) : null;
      const lifecycle = req.method === 'POST' && /^\/session\/[^/]+\/lifecycle$/.test(req.url.split('?')[0]);
      if (!lifecycle) {
        const path = req.url.split('?')[0];
        if (tap.rewrite && body && req.method === 'POST' && (path === '/session' || /^\/session\/[^/]+\/load$/.test(path))) {
          try {
            const j = JSON.parse(body.toString('utf8'));
            const next = tap.rewrite(path, j);
            if (next) {
              body = Buffer.from(JSON.stringify(next));
              note({ t: new Date().toISOString(), rewrite: path === '/session' ? 'create' : 'load', toolProfile: j.toolProfile, lifecycleLoad: j.lifecycleAuthority !== undefined, added: Object.keys(next).filter((k) => !(k in j)) });
            }
          } catch {}
        }
        const up = forward(req, body, (err, ur) => {
          if (err) { try { res.destroy(); } catch {} return; }
          res.writeHead(ur.statusCode, ur.headers);
          ur.pipe(res);
          ur.on('aborted', () => res.destroy());
          ur.on('error', () => res.destroy());
        });
        res.on('close', () => { if (!res.writableFinished) up.destroy(); });
        return;
      }
      let j = {};
      try { j = JSON.parse(body.toString('utf8')); } catch {}
      const phase = j.phase ?? (j.protocolVersion === undefined || j.protocolVersion === 1 ? 'effects' : null);
      const meta = { t: new Date().toISOString(), sid: req.url.split('/')[2]?.slice(0, 8), phase, kind: j.kind, op: j.authority?.operationId?.slice(0, 8), claim: j.authority?.claimGeneration };
      const rule = rules.find((r) => r.left > 0 && r.phase === phase && (!r.sid || meta.sid === r.sid.slice(0, 8)));
      const action = rule ? rule.action : 'pass';
      if (rule) rule.left--;
      const finish = (extra) => (err, ur) => {
        if (err) { note({ ...meta, ...extra, action, upstream: `error ${err.code ?? err.message}` }); try { res.destroy(); } catch {} return; }
        const out = [];
        ur.on('data', (c) => out.push(c));
        ur.on('end', () => {
          const text = Buffer.concat(out).toString('utf8');
          let code = null; try { code = JSON.parse(text)?.error?.code ?? JSON.parse(text)?.code ?? null; } catch {}
          note({ ...meta, ...extra, action, upstream: ur.statusCode, code });
          if (action === 'drop-reply') { try { res.socket?.destroy(); } catch {} return; }
          if (res.destroyed || res.socket?.destroyed) return;
          res.writeHead(ur.statusCode, ur.headers);
          res.end(text);
        });
      };
      if (action === 'fail') { note({ ...meta, action, upstream: 'not-forwarded' }); try { res.socket?.destroy(); } catch {} return; }
      if (action === 'hold') {
        note({ ...meta, action: 'held' });
        holds.set(rule.name, () => forward(req, body, finish({ released: true, clientGone: res.destroyed || !!res.socket?.destroyed })));
        if (rule.onHeld) rule.onHeld(meta);
        return;
      }
      forward(req, body, finish({}));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const tap = {
    server, port: server.address().port, upstreamPort, seen, rewrite: null,
    rule(r) { rules.push({ left: 1, ...r }); },
    clear() { rules.length = 0; },
    held: (name) => holds.has(name),
    release(name) { const h = holds.get(name); holds.delete(name); if (h) h(); return !!h; },
    lifecycleCalls: (sidPrefix) => seen.filter((e) => e.sid === sidPrefix.slice(0, 8)),
  };
  return tap;
}
