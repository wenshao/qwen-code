// Transparent HTTP proxy with fault injection and a request ledger.
// usage: node proxy.mjs <listenPort> <targetPort> <controlPort> <ledger.jsonl>
// Control: GET http://127.0.0.1:<controlPort>/rule?method=DELETE&path=^/session/&action=reset|503|hang|pass
//          GET /clear  (drop all rules)
import http from 'node:http';
import fs from 'node:fs';

const [listen, target, control, ledger] = process.argv.slice(2);
let rules = [];
let lastHeaders = {};
let seq = 0;

function record(entry) {
  fs.appendFileSync(ledger, JSON.stringify({ t: new Date().toISOString(), ...entry }) + '\n');
}

http
  .createServer((req, res) => {
    const id = ++seq;
    const rule = rules.find(
      (r) => (!r.method || r.method === req.method) && new RegExp(r.path).test(req.url),
    );
    const action = rule ? rule.action : 'pass';
    if (action === 'reset') {
      record({ id, method: req.method, url: req.url, action });
      req.socket.destroy();
      return;
    }
    if (action === '503') {
      record({ id, method: req.method, url: req.url, action, status: 503 });
      const h = { ...lastHeaders, 'content-type': 'application/json' };
      delete h['content-length'];
      delete h['transfer-encoding'];
      res.writeHead(503, h);
      res.end(JSON.stringify({ error: 'rig_injected_outage' }));
      return;
    }
    if (action.startsWith('delay:')) {
      const ms = Number(action.slice(6));
      record({ id, method: req.method, url: req.url, action, phase: 'held' });
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => setTimeout(() => {
        const up = http.request({ host: '127.0.0.1', port: Number(target), method: req.method, path: req.url, headers: { ...req.headers, host: `127.0.0.1:${target}` } }, (u) => {
          record({ id, method: req.method, url: req.url, action, phase: 'forwarded', status: u.statusCode });
          res.writeHead(u.statusCode, u.headers);
          u.pipe(res);
        });
        up.on('error', (e) => { record({ id, action, error: e.code }); res.destroy(); });
        up.end(Buffer.concat(chunks));
      }, ms));
      return;
    }
    if (action === 'hang') {
      record({ id, method: req.method, url: req.url, action });
      return; // never answer
    }
    const upstream = http.request(
      { host: '127.0.0.1', port: Number(target), method: req.method, path: req.url, headers: { ...req.headers, host: `127.0.0.1:${target}` } },
      (up) => {
        lastHeaders = { ...up.headers };
        record({ id, method: req.method, url: req.url, action, status: up.statusCode });
        res.writeHead(up.statusCode, up.headers);
        up.pipe(res);
      },
    );
    upstream.on('error', (e) => {
      record({ id, method: req.method, url: req.url, action, error: e.code });
      req.socket.destroy();
    });
    req.pipe(upstream);
  })
  .listen(Number(listen), '127.0.0.1', () => console.log(`proxy ${listen} -> ${target}`));

http
  .createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/rule') {
      rules.unshift({
        method: u.searchParams.get('method') || null,
        path: u.searchParams.get('path') || '.',
        action: u.searchParams.get('action') || 'pass',
      });
    } else if (u.pathname === '/clear') {
      rules = [];
    }
    record({ control: u.pathname, rules });
    res.end(JSON.stringify(rules));
  })
  .listen(Number(control), '127.0.0.1');
