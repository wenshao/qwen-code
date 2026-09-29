// Scripted OpenAI-compatible fake model for PR #9466 verification.
// Every request body is recorded; the handler decides the reply per request.
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';

export type Reply =
  | { text: string }
  | { toolCalls: Array<{ name: string; args: Record<string, unknown> }>; text?: string }
  | { httpError: number; message?: string };

export type Msg = { role: string; content?: unknown; tool_calls?: unknown[] };
export type Req = { index: number; body: { messages: Msg[]; tools?: unknown[]; stream?: boolean; [k: string]: unknown } };

export function msgText(m: Msg | undefined): string {
  if (!m) return '';
  const c = m.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.map((p: any) => (typeof p === 'string' ? p : p?.text ?? '')).join('');
  return '';
}

export function lastMsg(req: Req): Msg | undefined {
  return req.body.messages[req.body.messages.length - 1];
}

export async function startFake(handler: (req: Req) => Reply | Promise<Reply>) {
  const requests: Req[] = [];
  const server: Server = createServer(async (req, res) => {
    if (req.method !== 'POST' || !req.url?.endsWith('/chat/completions')) {
      res.writeHead(404).end('nf');
      return;
    }
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const r: Req = { index: requests.length, body };
    requests.push(r);
    let reply: Reply;
    try {
      reply = await handler(r);
    } catch (e) {
      reply = { text: `handler error ${String(e)}` };
    }
    if ('httpError' in reply) {
      res.writeHead(reply.httpError, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: reply.message ?? 'scripted failure', type: 'invalid_request_error', code: 'scripted' } }));
      return;
    }
    const id = `chatcmpl-${randomUUID()}`;
    const created = Math.floor(Date.now() / 1000);
    const model = String(body.model ?? 'dummy');
    const toolCalls = 'toolCalls' in reply ? reply.toolCalls : [];
    const text = 'text' in reply ? reply.text ?? '' : '';
    const pt = Number(process.env.FAKE_PROMPT_TOKENS ?? 100);
    const usage = { prompt_tokens: pt, completion_tokens: 10, total_tokens: pt + 10 };
    if (!body.stream) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          id, object: 'chat.completion', created, model,
          choices: [{
            index: 0,
            message: {
              role: 'assistant',
              content: text || null,
              ...(toolCalls.length ? { tool_calls: toolCalls.map((t, i) => ({ id: `call_${randomUUID()}`, type: 'function', function: { name: t.name, arguments: JSON.stringify(t.args) } })) } : {}),
            },
            finish_reason: toolCalls.length ? 'tool_calls' : 'stop',
          }],
          usage,
        }),
      );
      return;
    }
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
    const send = (obj: unknown) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
    const base = { id, object: 'chat.completion.chunk', created, model };
    send({ ...base, choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }] });
    if (text) send({ ...base, choices: [{ index: 0, delta: { content: text }, finish_reason: null }] });
    toolCalls.forEach((t, i) => {
      send({ ...base, choices: [{ index: 0, delta: { tool_calls: [{ index: i, id: `call_${randomUUID()}`, type: 'function', function: { name: t.name, arguments: JSON.stringify(t.args) } }] }, finish_reason: null }] });
    });
    send({ ...base, choices: [{ index: 0, delta: {}, finish_reason: toolCalls.length ? 'tool_calls' : 'stop' }] });
    send({ ...base, choices: [], usage });
    res.write('data: [DONE]\n\n');
    res.end();
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const port = (server.address() as AddressInfo).port;
  return {
    baseUrl: `http://127.0.0.1:${port}/v1`,
    requests,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}
