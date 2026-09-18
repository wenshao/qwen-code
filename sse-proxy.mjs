/**
 * Transparent HTTP proxy in front of the real daemon, with SSE frame control.
 *
 * Instruments the wire between the mounted Web Shell provider and the daemon so
 * the PR #11251 Reviewer Test Plan items that need transport control can be run
 * against the real stack:
 *
 *   POST /__px {"action":"cut"}            destroy every live SSE socket now
 *   POST /__px {"action":"dupTerminal"}    re-emit the next turn terminal frame twice
 *   POST /__px {"action":"holdTerminal"}   swallow the next turn terminal frame, then cut
 *   POST /__px {"action":"reset"}          clear all armed actions
 *   GET  /__px                             report state + frame counters
 *
 * Every SSE frame that carries turn_complete / turn_error is appended to
 * /var/tmp/pr11251/wire.log so the report can cite the wire, not the UI.
 */
import { createServer, request as httpRequest } from 'node:http';
import { appendFileSync, writeFileSync } from 'node:fs';

const PORT = Number(process.env.PROXY_PORT ?? 4252);
const TARGET_HOST = '127.0.0.1';
const TARGET_PORT = Number(process.env.TARGET_PORT ?? 4251);
const LOG = '/var/tmp/pr11251/wire.log';

let dupTerminalArmed = false;
let holdTerminalArmed = false;
const liveStreams = new Set();
const counters = { terminalsSeen: 0, terminalsDuplicated: 0, terminalsHeld: 0, cuts: 0 };

writeFileSync(LOG, '');
const wire = (text) => appendFileSync(LOG, `${new Date().toISOString()} ${text}\n`);

function terminalTypeOf(chunkText) {
  // SSE frames from the daemon are `data: {json}` lines.
  const hits = [];
  for (const line of chunkText.split('\n')) {
    if (!line.startsWith('data:')) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === '[DONE]') continue;
    try {
      const event = JSON.parse(payload);
      if (event?.type === 'turn_complete' || event?.type === 'turn_error') {
        hits.push(event);
      }
    } catch {
      /* not json */
    }
  }
  return hits;
}

const server = createServer((clientReq, clientRes) => {
  if (clientReq.url === '/__px') {
    if (clientReq.method === 'GET') {
      clientRes.writeHead(200, { 'content-type': 'application/json' });
      clientRes.end(
        JSON.stringify({ dupTerminalArmed, holdTerminalArmed, liveStreams: liveStreams.size, counters }),
      );
      return;
    }
    let body = '';
    clientReq.on('data', (c) => (body += c));
    clientReq.on('end', () => {
      let action = '';
      try {
        action = JSON.parse(body || '{}').action ?? '';
      } catch {
        /* ignore */
      }
      if (action === 'cut') {
        counters.cuts += 1;
        wire(`[px] cut ${liveStreams.size} live SSE socket(s)`);
        for (const res of [...liveStreams]) {
          try {
            res.socket?.destroy();
          } catch {
            /* ignore */
          }
          liveStreams.delete(res);
        }
      } else if (action === 'dupTerminal') {
        dupTerminalArmed = true;
        wire('[px] armed dupTerminal');
      } else if (action === 'holdTerminal') {
        holdTerminalArmed = true;
        wire('[px] armed holdTerminal');
      } else if (action === 'reset') {
        dupTerminalArmed = false;
        holdTerminalArmed = false;
        wire('[px] reset');
      }
      clientRes.writeHead(200, { 'content-type': 'application/json' });
      clientRes.end(JSON.stringify({ ok: true, dupTerminalArmed, holdTerminalArmed, counters }));
    });
    return;
  }

  const headers = { ...clientReq.headers, host: `${TARGET_HOST}:${TARGET_PORT}` };
  if (typeof headers.origin === 'string') {
    headers.origin = headers.origin.replace(String(PORT), String(PORT));
  }
  const upstream = httpRequest(
    { host: TARGET_HOST, port: TARGET_PORT, method: clientReq.method, path: clientReq.url, headers },
    (upstreamRes) => {
      const isSse = String(upstreamRes.headers['content-type'] ?? '').includes('text/event-stream');
      clientRes.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers);
      if (!isSse) {
        upstreamRes.pipe(clientRes);
        return;
      }
      wire(`[px] SSE opened ${clientReq.url}`);
      liveStreams.add(clientRes);
      upstreamRes.setEncoding('utf8');
      upstreamRes.on('data', (chunk) => {
        const hits = terminalTypeOf(chunk);
        for (const hit of hits) {
          counters.terminalsSeen += 1;
          wire(
            `[wire] terminal type=${hit.type} promptId=${hit.promptId ?? hit.data?.promptId ?? '(none)'} stopReason=${hit.data?.stopReason ?? '-'} id=${hit.id ?? '-'}`,
          );
        }
        if (hits.length > 0 && holdTerminalArmed) {
          holdTerminalArmed = false;
          counters.terminalsHeld += 1;
          wire('[px] held terminal frame (not forwarded) and cutting the stream');
          setTimeout(() => {
            try {
              clientRes.socket?.destroy();
            } catch {
              /* ignore */
            }
            liveStreams.delete(clientRes);
          }, 50);
          return; // frame never reaches the client
        }
        clientRes.write(chunk);
        if (hits.length > 0 && dupTerminalArmed) {
          dupTerminalArmed = false;
          counters.terminalsDuplicated += 1;
          wire('[px] re-emitted the same terminal frame a second time');
          clientRes.write(chunk);
        }
      });
      upstreamRes.on('end', () => {
        liveStreams.delete(clientRes);
        clientRes.end();
      });
      upstreamRes.on('error', () => {
        liveStreams.delete(clientRes);
        clientRes.destroy();
      });
      clientRes.on('close', () => liveStreams.delete(clientRes));
    },
  );
  upstream.on('error', (error) => {
    wire(`[px] upstream error ${String(error)}`);
    if (!clientRes.headersSent) clientRes.writeHead(502);
    clientRes.end();
  });
  clientReq.pipe(upstream);
});

server.listen(PORT, '127.0.0.1', () => {
  wire(`[px] listening on http://127.0.0.1:${PORT} -> ${TARGET_HOST}:${TARGET_PORT}`);
  console.log(`sse-proxy on ${PORT} -> ${TARGET_PORT}`);
});
