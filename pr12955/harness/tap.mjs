// VERIFICATION RIG ONLY: records Spring -> Hosted Harness requests, streams
// everything through unchanged. Usage: node tap.mjs <listen> <target> <log>
import http from 'node:http';
import fs from 'node:fs';

const [listen, target, log] = [Number(process.argv[2]), Number(process.argv[3]), process.argv[4]];

http
  .createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      if (fs.existsSync(`${log}.fail`) && !req.url.startsWith("/capabilities")) {
        fs.appendFileSync(log, JSON.stringify({ t: new Date().toISOString(), method: req.method, path: req.url, fault: "drop" }) + "\n");
        req.socket.destroy();
        return;
      }
      const entry = { t: new Date().toISOString(), method: req.method, path: req.url };
      if (body.length) {
        try {
          entry.body = JSON.parse(body.toString('utf8'));
        } catch {
          entry.bodyBytes = body.length;
        }
      }
      const upstream = http.request(
        { host: '127.0.0.1', port: target, method: req.method, path: req.url, headers: { ...req.headers, host: `127.0.0.1:${target}` } },
        (up) => {
          entry.status = up.statusCode;
          fs.appendFileSync(log, JSON.stringify(entry) + '\n');
          res.writeHead(up.statusCode, up.headers);
          up.on("aborted", () => res.destroy());
          up.on("error", () => res.destroy());
          up.on("close", () => { if (!up.complete) res.destroy(); });
          up.pipe(res);
        },
      );
      upstream.on('error', (e) => {
        entry.error = e.code;
        fs.appendFileSync(log, JSON.stringify(entry) + '\n');
        res.destroy();
      });
      res.on('close', () => upstream.destroy());
      upstream.end(body);
    });
  })
  .listen(listen, '127.0.0.1', () => console.log(`tap ${listen} -> ${target}`));
