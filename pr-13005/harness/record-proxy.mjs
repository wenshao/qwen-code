// Recording reverse proxy in front of a real OpenAI-compatible endpoint.
// Logs one JSON line per model request (purpose, tools offered, tool calls
// returned, timings) and can inject a fixed pre-forward delay to simulate a
// provider TTFT spike. The real API key is injected here so the CLI under
// test only ever sees a dummy key.
//
// env: UPSTREAM (base URL incl. /v1 path), UPSTREAM_KEY, PORT, LOG (jsonl path),
//      INJECT_MS (default 0), MODEL_OVERRIDE (optional)
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';

const upstream = new URL(process.env.UPSTREAM);
const key = process.env.UPSTREAM_KEY;
const port = Number(process.env.PORT || 0);
const logPath = process.env.LOG;
const injectMs = Number(process.env.INJECT_MS || 0);
let seq = 0;

function textOf(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content))
    return content.map((p) => (typeof p === 'string' ? p : p?.text ?? '')).join('');
  return '';
}

function classify(body) {
  const msgs = body.messages ?? [];
  const all = msgs.map((m) => textOf(m.content)).join('\n');
  const sys = textOf(msgs.find((m) => m.role === 'system')?.content ?? '');
  if (all.includes('managed memory extraction subagent')) return 'memory-extractor';
  if (all.includes('You are selecting memories')) return 'memory-recall-selector';
  if (all.includes('[SUGGESTION MODE')) return 'followup-suggestion';
  if (sys.startsWith('You are Qwen Code')) {
    const last = msgs[msgs.length - 1];
    const lastText = textOf(last?.content ?? '');
    if (last?.role === 'tool') return 'main:after-tool-result';
    if (lastText.includes('<task-notification')) return 'main:task-notification-drain';
    return 'main:user-prompt';
  }
  return 'other';
}

const server = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const raw = Buffer.concat(chunks);
    const idx = ++seq;
    const tRecv = Date.now();
    let body = {};
    try {
      body = JSON.parse(raw.toString('utf8'));
    } catch {}
    if (process.env.MODEL_OVERRIDE && body.model) body.model = process.env.MODEL_OVERRIDE;
    const out = Buffer.from(JSON.stringify(body));
    const msgs = body.messages ?? [];
    const last = msgs[msgs.length - 1];
    const rec = {
      idx,
      path: req.url,
      tRecv,
      injectMs,
      purpose: classify(body),
      model: body.model,
      stream: body.stream === true,
      nMessages: msgs.length,
      tools: (body.tools ?? []).map((t) => t.function?.name ?? t.name),
      lastRole: last?.role,
      lastPreview: textOf(last?.content ?? '').slice(0, 300),
      sysPreview: textOf(msgs.find((m) => m.role === 'system')?.content ?? '').slice(0, 120),
    };
    const forward = () => {
      const target = new URL(upstream.pathname.replace(/\/$/, '') + req.url.replace(/^\/v1/, ''), upstream);
      const headers = { ...req.headers };
      delete headers.host;
      delete headers['content-length'];
      headers.authorization = `Bearer ${key}`;
      headers['content-length'] = out.length;
      const up = https.request(target, { method: req.method, headers }, (ur) => {
        let first = true;
        let respBuf = '';
        res.writeHead(ur.statusCode, ur.headers);
        ur.on('data', (c) => {
          if (first) {
            rec.tFirstByte = Date.now();
            first = false;
          }
          respBuf += c.toString('utf8');
          res.write(c);
        });
        ur.on('end', () => {
          rec.tEnd = Date.now();
          rec.status = ur.statusCode;
          // Summarise the response: tool calls + text.
          const toolNames = new Set();
          let text = '';
          let usage;
          const lines = rec.stream ? respBuf.split('\n').filter((l) => l.startsWith('data:')) : [];
          if (rec.stream) {
            for (const l of lines) {
              const d = l.slice(5).trim();
              if (d === '[DONE]') continue;
              try {
                const j = JSON.parse(d);
                for (const ch of j.choices ?? []) {
                  for (const tc of ch.delta?.tool_calls ?? []) if (tc.function?.name) toolNames.add(tc.function.name);
                  if (ch.delta?.content) text += ch.delta.content;
                }
                if (j.usage) usage = j.usage;
              } catch {}
            }
          } else {
            try {
              const j = JSON.parse(respBuf);
              for (const ch of j.choices ?? []) {
                for (const tc of ch.message?.tool_calls ?? []) toolNames.add(tc.function?.name);
                text += ch.message?.content ?? '';
              }
              usage = j.usage;
            } catch {
              text = respBuf.slice(0, 300);
            }
          }
          rec.respToolCalls = [...toolNames];
          rec.respText = text.slice(0, 300);
          rec.usage = usage && { prompt: usage.prompt_tokens, completion: usage.completion_tokens };
          fs.appendFileSync(logPath, JSON.stringify(rec) + '\n');
          res.end();
        });
      });
      up.on('error', (e) => {
        rec.error = String(e);
        rec.tEnd = Date.now();
        fs.appendFileSync(logPath, JSON.stringify(rec) + '\n');
        if (!res.headersSent) res.writeHead(502);
        res.end();
      });
      up.end(out);
    };
    if (injectMs > 0) setTimeout(forward, injectMs);
    else forward();
  });
});
server.listen(port, '127.0.0.1', () => {
  console.log(`PROXY_READY http://127.0.0.1:${server.address().port}/v1`);
});
