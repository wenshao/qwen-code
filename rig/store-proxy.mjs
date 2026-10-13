// PR 13974 probe: Harness -> Session Store pass-through in front of Spring.
// usage: node store-proxy.mjs <listenPort> <springPort> <controlDir> <logFile>
// Every journal commit (POST .../transactions:commit[-v2] or a publication
// receipt commit) is logged with its Session, operation and commandId.
// While <controlDir>/hold-commit exists, the first commit whose operation
// equals a line of that file is held here: it is never forwarded and never
// answered, so the Harness waits on it until the probe kills the Harness.
// Only commits matching while the file exists are held; the file is
// consumed (renamed to hold-commit.fired) when the hold fires.
import http from 'node:http';
import { appendFileSync, existsSync, readFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';

const [, , lp, sp, ctl, logf] = process.argv;
const log = (entry) =>
  appendFileSync(logf, JSON.stringify({ t: new Date().toISOString(), ...entry }) + '\n');
const held = [];

http
  .createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      const commit =
        req.method === 'POST' &&
        /\/(transactions:commit(-v2)?|receipts\/commit)(\?|$)/.test(req.url ?? '');
      let meta = null;
      if (commit) {
        try {
          const parsed = JSON.parse(body.toString('utf8'));
          const session = /\/sessions\/([^/?]+)/.exec(req.url ?? '');
          meta = {
            session: session ? decodeURIComponent(session[1]) : null,
            operation: parsed.operation,
            commandId: parsed.commandId,
            firstSequence: parsed.firstSequence,
          };
        } catch {
          meta = { unparsed: true };
        }
        const holdFile = join(ctl, 'hold-commit');
        if (existsSync(holdFile)) {
          const wanted = readFileSync(holdFile, 'utf8')
            .split('\n')
            .map((s) => s.trim())
            .filter(Boolean);
          if (wanted.includes(meta.operation)) {
            renameSync(holdFile, holdFile + '.fired');
            held.push(res);
            log({ ...meta, action: 'held' });
            res.on('close', () => log({ ...meta, action: 'held-closed' }));
            return;
          }
        }
      }
      const up = http.request(
        {
          host: '127.0.0.1',
          port: Number(sp),
          method: req.method,
          path: req.url,
          headers: { ...req.headers, host: `127.0.0.1:${sp}`, 'content-length': String(body.length) },
        },
        (ur) => {
          res.writeHead(ur.statusCode ?? 502, ur.headers);
          ur.on('data', (c) => res.write(c));
          ur.on('end', () => {
            if (meta) log({ ...meta, action: 'forwarded', status: ur.statusCode });
            res.end();
          });
          ur.on('aborted', () => res.destroy());
          ur.on('close', () => {
            if (!res.writableEnded) res.destroy();
          });
        },
      );
      up.on('error', (e) => {
        if (meta) log({ ...meta, action: 'upstream-error', error: String(e) });
        res.destroy();
      });
      res.on('close', () => {
        if (!res.writableEnded) up.destroy();
      });
      up.end(body);
    });
  })
  .listen(Number(lp), '127.0.0.1', () => console.log('store-proxy', lp, '->', sp));
