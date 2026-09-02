// Minimal fake OpenAI-compatible streaming server with a scripted Goal agent.
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { appendFileSync } from 'node:fs';

export async function startFakeOpenAI({ logPath, script }) {
  const requests = [];
  const log = (obj) => {
    try {
      appendFileSync(logPath, JSON.stringify({ t: Date.now(), ...obj }) + '\n');
    } catch {}
  };

  const server = createServer(async (req, res) => {
    if (req.method !== 'POST' || !req.url?.includes('/chat/completions')) {
      res.writeHead(404); res.end('nf'); return;
    }
    let raw = '';
    for await (const c of req) raw += c;
    let body;
    try { body = JSON.parse(raw); } catch { res.writeHead(400); res.end('bad'); return; }

    const idx = requests.length;
    const msgs = body.messages ?? [];
    const joined = JSON.stringify(msgs);
    const isJudge = joined.includes('You are evaluating a stop-condition hook');
    const kind = isJudge ? 'judge' : 'agent';
    requests.push({ idx, kind, at: Date.now(), body });
    log({ ev: 'request', idx, kind, stream: body.stream === true, nMessages: msgs.length });

    const out = await script({ idx, kind, body, requests });
    log({ ev: 'reply', idx, kind, summary: out.summary ?? '' });

    if (body.stream === true) await writeStream(res, body.model ?? 'fake-model', out);
    else writeJson(res, body.model ?? 'fake-model', out);
  });

  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  return {
    baseUrl: `http://127.0.0.1:${port}/v1`,
    requests,
    close: () => new Promise((r) => server.close(() => r())),
  };
}

function buildMessage(out) {
  const msg = { role: 'assistant', content: out.content ?? '' };
  if (out.toolCalls?.length) {
    msg.tool_calls = out.toolCalls.map((tc, i) => ({
      index: i, id: tc.id ?? `call_${randomUUID()}`, type: 'function',
      function: { name: tc.name, arguments: JSON.stringify(tc.args) },
    }));
  }
  return msg;
}

function writeJson(res, model, out) {
  const msg = buildMessage(out);
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({
    id: `chatcmpl-${randomUUID()}`, object: 'chat.completion',
    created: Math.floor(Date.now() / 1000), model,
    choices: [{ index: 0, message: msg, finish_reason: out.finishReason ?? (out.toolCalls?.length ? 'tool_calls' : 'stop') }],
    usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
  }));
}

async function writeStream(res, model, out) {
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  });
  const id = `chatcmpl-${randomUUID()}`;
  const created = Math.floor(Date.now() / 1000);
  const send = (delta, finish) => {
    res.write(`data: ${JSON.stringify({
      id, object: 'chat.completion.chunk', created, model,
      choices: [{ index: 0, delta, finish_reason: finish ?? null }],
    })}\n\n`);
  };
  send({ role: 'assistant', content: '' });
  if (out.contentChunks?.length) {
    for (const chunk of out.contentChunks) {
      if (res.writableEnded || res.destroyed) return;
      send({ content: chunk });
      await new Promise((r) => setTimeout(r, out.chunkDelayMs ?? 500));
    }
  } else if (out.content) send({ content: out.content });
  if (out.toolCalls?.length) {
    out.toolCalls.forEach((tc, i) => {
      send({ tool_calls: [{
        index: i, id: tc.id ?? `call_${randomUUID()}`, type: 'function',
        function: { name: tc.name, arguments: JSON.stringify(tc.args) },
      }] });
    });
  }
  send({}, out.finishReason ?? (out.toolCalls?.length ? 'tool_calls' : 'stop'));
  res.write(`data: ${JSON.stringify({
    id, object: 'chat.completion.chunk', created, model, choices: [],
    usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
  })}\n\n`);
  res.write('data: [DONE]\n\n');
  res.end();
}
