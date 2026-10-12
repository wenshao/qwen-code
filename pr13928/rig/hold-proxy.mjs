// usage: node hold-proxy.mjs <listenPort> <harnessPort> <controlDir> <logFile>
// Spring -> Harness pass-through. Every POST .../messages/operations is logged
// with its kind/commandId and answer status. While <controlDir>/hold-execute
// exists, a command `execute` is answered here with the Harness's own
// 409 session_command_blocked shape (boot id echoed from the request, so the
// client's generation check passes) and never reaches the lead. While
// <controlDir>/hold-handover exists, a command's member-side `handover`
// (a session_message handover carries no commandId and passes) is refused
// the same way, so the entry stays `planned`.
import http from 'node:http';
import { appendFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const [, , lp, hp, ctl, logf] = process.argv;
const log = (entry) =>
  appendFileSync(logf, JSON.stringify({ t: new Date().toISOString(), ...entry }) + '\n');

http
  .createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      const op = /\/session\/([^/]+)\/messages\/operations$/.exec(req.url ?? '');
      let parsed = null;
      if (op && req.method === 'POST') {
        try {
          parsed = JSON.parse(body.toString('utf8'));
        } catch {
          parsed = null;
        }
      }
      const meta = parsed
        ? {
            session: op[1],
            kind: parsed.kind,
            commandId: parsed.commandId,
            messageId: parsed.messageId,
          }
        : null;
      const holdKind =
        meta && meta.kind === 'execute' && existsSync(join(ctl, 'hold-execute'))
          ? 'held'
          : meta && meta.kind === 'handover' && meta.commandId && existsSync(join(ctl, 'hold-handover'))
            ? 'held-handover'
            : null;
      if (holdKind) {
        const payload = JSON.stringify({
          error: 'session_command_blocked',
          code: 'session_command_blocked',
          message: 'held by the PR 13928 probe proxy',
        });
        const headers = { 'content-type': 'application/json; charset=utf-8' };
        const boot = req.headers['x-qwen-harness-boot-id'];
        if (boot) headers['x-qwen-harness-boot-id'] = boot;
        res.writeHead(409, headers);
        res.end(payload);
        log({ ...meta, action: holdKind, status: 409 });
        return;
      }
      const up = http.request(
        {
          host: '127.0.0.1',
          port: Number(hp),
          method: req.method,
          path: req.url,
          headers: { ...req.headers, host: `127.0.0.1:${hp}`, 'content-length': String(body.length) },
        },
        (ur) => {
          const out = [];
          ur.on('data', (c) => {
            if (meta) out.push(c);
            res.write(c);
          });
          ur.on('end', () => {
            if (meta)
              log({
                ...meta,
                action: 'forwarded',
                status: ur.statusCode,
                answer: Buffer.concat(out).toString('utf8').slice(0, 600),
              });
            res.end();
          });
          ur.on('aborted', () => res.destroy());
          res.writeHead(ur.statusCode ?? 502, ur.headers);
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
  .listen(Number(lp), '127.0.0.1', () => console.log('hold-proxy', lp, '->', hp));
