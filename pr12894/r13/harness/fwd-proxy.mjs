// Forward HTTP proxy for the JVM's Broker -> worker traffic (-Dhttp.proxyHost).
// When run/fwd-arm.sql exists, the next POST .../v3/publications:install runs that
// SQL against the rig MySQL *before* the request is forwarded, i.e. after the
// Broker's own ownership check for the install and before it reaches executeV3.
// Every proxied request is appended to run/fwd-ledger.log.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const RIG = path.dirname(new URL(import.meta.url).pathname);
const ARM = path.join(RIG, 'run', 'fwd-arm.sql');
const LEDGER = path.join(RIG, 'run', 'fwd-ledger.log');
const MYSQL = `${process.env.HOME}/Install/mysql-8.4.7-macos15-arm64/bin/mysql`;
const PORT = Number(process.env.FWD_PORT ?? 18897);

http.createServer((req, res) => {
  const target = new URL(req.url);
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    let note = '';
    if (req.method === 'POST' && target.pathname.endsWith('/v3/publications:install') && fs.existsSync(ARM)) {
      const [db, sql] = fs.readFileSync(ARM, 'utf8').split('\n', 2);
      fs.rmSync(ARM);
      try {
        execFileSync(MYSQL, ['-uroot', '-prig12894', '-h127.0.0.1', '-P13894', '-N', '-B', db, '-e', sql], { stdio: ['ignore', 'pipe', 'ignore'] });
        note = ' [armed SQL ran before forwarding]';
      } catch (e) {
        note = ` [armed SQL failed: ${e.message.slice(0, 80)}]`;
      }
    }
    const up = http.request({ host: target.hostname, port: target.port, path: target.pathname + target.search, method: req.method, headers: req.headers }, (r) => {
      fs.appendFileSync(LEDGER, `${new Date().toISOString()} ${req.method} ${target.host}${target.pathname} -> ${r.statusCode}${note}\n`);
      res.writeHead(r.statusCode ?? 502, r.headers);
      if (process.env.FWD_BODIES && target.pathname.endsWith("/v3/status")) { const b = []; r.on("data", (c) => { b.push(c); res.write(c); }); r.on("end", () => { fs.appendFileSync(LEDGER, `  body: ${Buffer.concat(b).toString("utf8").slice(0, 600)}\n`); res.end(); }); return; }
      r.pipe(res);
    });
    up.on('error', (e) => {
      fs.appendFileSync(LEDGER, `${new Date().toISOString()} ${req.method} ${target.host}${target.pathname} -> proxy-error ${e.message}${note}\n`);
      res.writeHead(502);
      res.end();
    });
    up.end(Buffer.concat(chunks));
  });
}).listen(PORT, '127.0.0.1', () => console.log(`forward proxy on ${PORT}`));
