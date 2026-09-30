// VERIFICATION RIG ONLY (PR #13037): sits between Spring and the Hosted Harness.
// It records every request and makes ONE kind of change: on session create/load
// it swaps the file tool profile the Java connector always sends
// ("hosted-workspace-files/1") for the Shell profile with an O2 capture budget.
// Public Shell admission is a later slice, so without this swap no public
// Session can run a Hosted Shell; the jar and the bundle stay exactly as built
// from the PR head.
// The mode for NEW sessions comes from <run>/tap-mode.json ({"shell":true,"capture":N});
// each session keeps the mode it was created with (persisted in tap-sessions.json).
// Usage: node tap.mjs <listen> <target> <log.jsonl>
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const [listen, target, log] = [Number(process.argv[2]), Number(process.argv[3]), process.argv[4]];
const dir = path.dirname(log);
const modeFile = path.join(dir, 'tap-mode.json');
const sessionsFile = path.join(dir, 'tap-sessions.json');
const sessions = fs.existsSync(sessionsFile) ? JSON.parse(fs.readFileSync(sessionsFile, 'utf8')) : {};
const currentMode = () => {
  try {
    return JSON.parse(fs.readFileSync(modeFile, 'utf8'));
  } catch {
    return { shell: true, capture: 2 * 1024 * 1024 * 1024 };
  }
};

http
  .createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      let body = Buffer.concat(chunks);
      const entry = { t: new Date().toISOString(), method: req.method, path: req.url };
      if (body.length) {
        try {
          const json = JSON.parse(body.toString('utf8'));
          entry.body = json;
          const m = /^\/session(?:\/([^/]+)\/load)?$/.exec(req.url);
          if (req.method === 'POST' && m && json.toolProfile === 'hosted-workspace-files/1') {
            const id = m[1] ?? json.sessionId;
            if (!sessions[id]) {
              sessions[id] = currentMode();
              fs.writeFileSync(sessionsFile, JSON.stringify(sessions));
            }
            if (sessions[id].shell) {
              const rewritten = { ...json, toolProfile: 'hosted-workspace-shell/1', captureBytes: sessions[id].capture };
              body = Buffer.from(JSON.stringify(rewritten));
              entry.rewritten = { toolProfile: rewritten.toolProfile, captureBytes: rewritten.captureBytes };
            }
          }
        } catch {
          entry.bodyBytes = body.length;
        }
      }
      const headers = { ...req.headers, host: `127.0.0.1:${target}` };
      if (body.length || req.headers['content-length']) headers['content-length'] = String(body.length);
      const upstream = http.request(
        { host: '127.0.0.1', port: target, method: req.method, path: req.url, headers },
        (up) => {
          entry.status = up.statusCode;
          fs.appendFileSync(log, JSON.stringify(entry) + '\n');
          res.writeHead(up.statusCode, up.headers);
          up.on('aborted', () => res.destroy());
          up.on('error', () => res.destroy());
          up.on('close', () => {
            if (!up.complete) res.destroy();
          });
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
