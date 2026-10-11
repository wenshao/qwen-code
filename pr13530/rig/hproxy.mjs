// usage: node hproxy.mjs <listenPort> <harnessPort> <logFile>
// Spring -> Harness pass-through. Logs every Session create/load request
// (its agentDefinition, toolProfile, approvalMode) with the answer status,
// plus every >=400 answer with its body. Tokens are never logged.
import http from 'node:http';
import { appendFileSync } from 'node:fs';
const [, , lp, hp, logf] = process.argv;
const interesting = (m, p) => m === 'POST' && (/^\/session(\?|$)/.test(p) || /^\/session\/[^/]+\/load/.test(p));
http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks);
    let reqInfo;
    if (interesting(req.method, req.url)) {
      try {
        const j = JSON.parse(body.toString('utf8'));
        reqInfo = { sessionId: j.sessionId, agentDefinition: j.agentDefinition ?? null, toolProfile: j.toolProfile, approvalMode: j.approvalMode, keys: Object.keys(j).sort() };
      } catch { reqInfo = { unparsable: true }; }
    }
    const up = http.request({ host: '127.0.0.1', port: Number(hp), method: req.method, path: req.url,
      headers: { ...req.headers, host: `127.0.0.1:${hp}`, 'content-length': String(body.length) } }, (ur) => {
      const out = [];
      ur.on('data', (c) => { out.push(c); res.write(c); });
      ur.on('end', () => {
        const status = ur.statusCode ?? 0;
        if (reqInfo || status >= 400)
          appendFileSync(logf, JSON.stringify({ t: new Date().toISOString(), m: req.method, path: req.url.slice(0, 160), status, req: reqInfo, body: status >= 400 ? Buffer.concat(out).toString('utf8').slice(0, 400) : undefined }) + '\n');
        res.end();
      });
      res.writeHead(ur.statusCode ?? 502, ur.headers);
      ur.on('aborted', () => res.destroy());
    });
    up.on('error', () => res.destroy());
    res.on('close', () => { if (!res.writableEnded) up.destroy(); });
    up.end(body);
  });
}).listen(Number(lp), '127.0.0.1', () => console.log('hproxy', lp, '->', hp));
