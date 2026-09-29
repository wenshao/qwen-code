// Forward proxy for the Broker -> Worker hop. The Spring JVM runs with
// -Dhttp.proxyHost=127.0.0.1 -Dhttp.proxyPort=<port> -Dhttp.nonProxyHosts=
// (empty, so loopback traffic is proxied too). One JSONL line per completed
// request; Authorization is never logged.
import http from 'node:http';
import fs from 'node:fs';

const port = Number(process.argv[2]);
const ledger = process.argv[3];
const server = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks);
    const target = new URL(req.url);
    const headers = { ...req.headers, host: target.host };
    const up = http.request(
      { host: target.hostname, port: target.port, path: target.pathname + target.search, method: req.method, headers },
      (answer) => {
        const out = [];
        answer.on('data', (c) => out.push(c));
        answer.on('end', () => {
          const reply = Buffer.concat(out);
          fs.appendFileSync(
            ledger,
            JSON.stringify({
              t: new Date().toISOString(),
              method: req.method,
              path: target.pathname,
              requestBody: body.toString('utf8').slice(0, 4000),
              status: answer.statusCode,
              replyBody: reply.toString('utf8').slice(0, answer.statusCode === 200 ? 600 : 4000),
            }) + '\n',
          );
          res.writeHead(answer.statusCode, answer.headers);
          res.end(reply);
        });
        answer.on('aborted', () => res.destroy());
      },
    );
    up.on('error', (e) => {
      fs.appendFileSync(ledger, JSON.stringify({ t: new Date().toISOString(), path: target.pathname, error: e.message }) + '\n');
      res.destroy();
    });
    up.end(body);
  });
});
server.listen(port, '127.0.0.1', () => console.log(`wire tap on ${port} -> ${ledger}`));
