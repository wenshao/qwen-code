// logging reverse proxy: http://127.0.0.1:PORT -> real upstream; writes each request body to LOGDIR
import http from 'node:http'; import fs from 'node:fs';
const [port, upstream, logdir] = process.argv.slice(2);
fs.mkdirSync(logdir, { recursive: true }); let n = 0;
http.createServer((req, res) => {
  const chunks = []; req.on('data', c => chunks.push(c));
  req.on('end', async () => {
    const body = Buffer.concat(chunks);
    const tag = (req.headers['x-arm-run'] || 'x');
    try { fs.writeFileSync(`${logdir}/${Date.now()}-${process.pid}-${n++}.json`, body); } catch {}
    const url = upstream.replace(/\/$/, '') + req.url.replace(/^\/v1/, '');
    const h = { ...req.headers }; delete h.host; delete h['content-length']; delete h['accept-encoding'];
    try {
      const r = await fetch(url, { method: req.method, headers: h, body: req.method === 'GET' ? undefined : body, duplex: 'half' });
      res.writeHead(r.status, Object.fromEntries([...r.headers].filter(([k]) => !['content-encoding','content-length','transfer-encoding'].includes(k))));
      if (r.body) for await (const c of r.body) res.write(c);
      res.end();
    } catch (e) { res.writeHead(502); res.end(String(e)); }
  });
}).listen(+port, '127.0.0.1', () => console.log('proxy on', port));
