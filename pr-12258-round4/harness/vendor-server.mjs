// "Third-party vendor" origin, mimicking Tableau's startSession CORS check: it refuses Origin: null.
import http from 'node:http'; import fs from 'node:fs';
const port = Number(process.argv[2]); const LOG = process.argv[3];
const log = (o) => fs.appendFileSync(LOG, JSON.stringify({ t: Date.now(), ...o }) + '\n');
const page = `<!doctype html><meta charset=utf-8><title>vendor</title><body style="font:12px system-ui;margin:6px">
<div>vendor frame origin: <b id=o></b></div><div>POST /api/startSession: <b id=s>pending</b></div>
<script>document.getElementById('o').textContent=self.origin;
fetch('http://127.0.0.1:${port}/api/startSession',{method:'POST',headers:{'content-type':'application/json'},body:'{"view":"superstore"}'})
 .then(async r=>{const t=await r.text();document.getElementById('s').textContent='HTTP '+r.status+' '+t;document.getElementById('s').style.color=r.ok?'#1a7f37':'#cf222e'})
 .catch(e=>{const s=document.getElementById('s');s.textContent='FAILED ('+e.name+': '+e.message+')';s.style.color='#cf222e'});</script>`;
http.createServer((req, res) => {
  const origin = req.headers.origin;
  log({ method: req.method, url: req.url, origin: origin ?? '(none)' });
  if (req.url.startsWith('/topnav') || req.url.startsWith('/popup')) { res.writeHead(200, { 'content-type': 'text/html' }); res.end(`<!doctype html><title>attacker page</title><body style="margin:0;font:20px system-ui;background:#fff5f5;color:#8b0000;display:flex;align-items:center;justify-content:center;height:100vh;text-align:center"><div><div style="font-size:44px;font-weight:800">ATTACKER-CONTROLLED PAGE</div><div style="margin-top:14px">The top-level Qwen WebShell tab was navigated here by a sandboxed MCP App</div><div style="margin-top:8px;font:16px monospace">${req.url}</div></div>`); return; }
  if (req.url === '/vendor') { res.writeHead(200, { 'content-type': 'text/html' }); res.end(page); return; }
  if (req.url === '/api/startSession') {
    if (origin === 'null') { res.writeHead(403, { 'content-type': 'text/plain' }); res.end('Origin null rejected'); return; }
    const self = `http://127.0.0.1:${port}`;
    if (req.method === 'OPTIONS') { res.writeHead(204, origin === self ? {} : { 'access-control-allow-origin': origin ?? '', 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'POST' }); res.end(); return; }
    res.writeHead(200, { 'content-type': 'application/json', ...(origin && origin !== self ? { 'access-control-allow-origin': origin } : {}) });
    res.end(JSON.stringify({ ok: true, sessionOrigin: origin ?? '(same-origin, none)' })); return;
  }
  res.writeHead(404).end();
}).listen(port, '127.0.0.1', () => console.log('VENDOR_READY ' + port));
