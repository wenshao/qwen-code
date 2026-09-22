// Minimal fake GitHub REST API (http) for the real GithubChannel adapter.
// Control plane: POST /__inject {login, body, token, reason} adds a new comment
// on acme/app#1 and a matching unread notification; GET /__replies lists bot comments.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const PORT = Number(process.env.GH_PORT || 28190);
const LOGS = process.env.GH_LOGS || '/root/verify/pr12475-runs/github/shared';
fs.mkdirSync(LOGS, { recursive: true });
const apiLog = path.join(LOGS, 'gh-api.jsonl');
const BASE = `http://127.0.0.1:${PORT}`;
let comments = []; let replies = []; let nextId = 1000; let notif = null;
const readBody = (req) => new Promise((r) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => r(b)); });

http.createServer(async (req, res) => {
  const url = new URL(req.url, BASE);
  const raw = await readBody(req);
  let body; try { body = raw ? JSON.parse(raw) : undefined; } catch { body = raw; }
  const send = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(obj === undefined ? '' : JSON.stringify(obj)); };
  if (!url.pathname.startsWith('/__')) fs.appendFileSync(apiLog, JSON.stringify({ t: Date.now(), method: req.method, path: url.pathname, query: url.search }) + '\n');
  const p = url.pathname;
  if (p === '/__inject') {
    const now = new Date(Date.now()).toISOString();
    const c = { id: nextId++, node_id: `IC_${nextId}`, body: body.body, user: { login: body.login }, created_at: now, updated_at: now, html_url: `https://github.example/acme/app/issues/1#issuecomment-${nextId}` };
    comments.push(c);
    notif = { id: 'n1', reason: body.reason ?? 'mention', unread: true, updated_at: new Date(Date.now() + 5).toISOString(), last_read_at: new Date(Date.now() - 3600_000).toISOString(), subject: { title: 'Harness issue', url: `${BASE}/repos/acme/app/issues/1`, type: 'Issue' }, repository: { full_name: 'acme/app' } };
    return send(200, { ok: true, id: c.id });
  }
  if (p === '/__replies') return send(200, replies);
  if (p === '/__reset') { comments = []; replies = []; notif = null; return send(200, {}); }
  if (p === '/user') return send(200, { login: 'qwen-bot', id: 1, type: 'User' });
  if (p === '/notifications' && req.method === 'GET') return send(200, notif ? [notif] : []);
  if (p === '/notifications' && req.method === 'PUT') { notif = null; return send(205); }
  if (/^\/notifications\/threads\//.test(p)) { notif = null; return send(205); }
  if (p === '/repos/acme/app/issues/1/comments' && req.method === 'GET') return send(200, comments);
  if (p === '/repos/acme/app/issues/1/comments' && req.method === 'POST') { const c = { id: nextId++, node_id: `IC_${nextId}`, body: body.body, user: { login: 'qwen-bot' }, created_at: new Date().toISOString() }; replies.push(c); return send(201, c); }
  if (/^\/repos\/acme\/app\/issues\/comments\/\d+$/.test(p) && req.method === 'PATCH') { replies.push({ edited: true, body: body.body }); return send(200, { id: 1, body: body.body }); }
  if (p === '/repos/acme/app/issues/1') return send(200, { number: 1, title: 'Harness issue', body: 'issue body', user: { login: 'someone' }, state: 'open' });
  if (p === '/repos/acme/app/issues/1/events') return send(200, []);
  if (/reactions/.test(p)) return send(req.method === 'DELETE' ? 204 : 201, req.method === 'DELETE' ? undefined : { id: 7, content: body?.content ?? 'eyes' });
  return send(404, { message: 'Not Found' });
}).listen(PORT, '127.0.0.1', () => console.log(`[fake-github] ${BASE}`));
