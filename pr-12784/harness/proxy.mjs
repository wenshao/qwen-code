// Logging reverse proxy. Base URL http://127.0.0.1:PORT/<runId>/v1 -> upstream.
// Each request body and raw response body is written under LOGDIR/<runId>/.
// The upstream key is read from ~/.qwen/settings.json (env.<KEYNAME>) at startup
// so it never appears on a command line or in the isolated QWEN_HOME.
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
const [port, upstream, logdir, keyName] = process.argv.slice(2);
const key = JSON.parse(fs.readFileSync(`${os.homedir()}/.qwen/settings.json`, 'utf8')).env[keyName];
if (!key) throw new Error(`no key ${keyName}`);
fs.mkdirSync(logdir, { recursive: true });
let n = 0;
http
  .createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', async () => {
      const body = Buffer.concat(chunks);
      const m = req.url.match(/^\/([^/]+)(\/v1)?(\/.*)$/);
      const runId = m ? m[1] : 'unknown';
      const rest = m ? m[3] : req.url;
      const dir = `${logdir}/${runId}`;
      fs.mkdirSync(dir, { recursive: true });
      const seq = String(n++).padStart(5, '0');
      fs.writeFileSync(`${dir}/${seq}.req.json`, body);
      const h = { ...req.headers };
      delete h.host;
      delete h['content-length'];
      delete h['accept-encoding'];
      h.authorization = `Bearer ${key}`;
      try {
        const r = await fetch(upstream.replace(/\/$/, '') + rest, {
          method: req.method,
          headers: h,
          body: req.method === 'GET' ? undefined : body,
          duplex: 'half',
        });
        res.writeHead(
          r.status,
          Object.fromEntries(
            [...r.headers].filter(
              ([k]) => !['content-encoding', 'content-length', 'transfer-encoding'].includes(k),
            ),
          ),
        );
        const out = fs.createWriteStream(`${dir}/${seq}.res.txt`);
        if (r.body) for await (const c of r.body) { res.write(c); out.write(c); }
        out.end();
        res.end();
      } catch (e) {
        res.writeHead(502);
        res.end(String(e));
      }
    });
  })
  .listen(+port, '127.0.0.1', () => console.log('proxy on', port));
