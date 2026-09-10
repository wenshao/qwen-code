/**
 * Minimal OpenAI-compatible server for the PR #9541 TUI A/B.
 *
 * - normal turn  -> a long Chinese assistant reply (fills the session)
 * - compression  -> a well-formed <state_snapshot> summary
 * Every request body is appended to REQ_LOG so the run can be audited.
 */
const http = require('node:http');
const fs = require('node:fs');

const REQ_LOG = process.env['REQ_LOG'] || '/tmp/fake-openai-requests.jsonl';
const WINDOW = Number(process.env['FAKE_WINDOW'] || 48000);
const { fromPreTrained } = require('/root/git/shared-node-deps/node_modules/@lenml/tokenizer-qwen2_5/dist/main.js');
const tokenizer = fromPreTrained();
const realTokens = (s) => tokenizer.encode(s).length;
const messagesText = (messages) =>
  (messages ?? [])
    .map((m) =>
      typeof m.content === 'string'
        ? m.content
        : Array.isArray(m.content)
          ? m.content.map((p) => p.text ?? '').join('')
          : JSON.stringify(m.content ?? ''),
    )
    .join('\n');
const ZH_REPLY_CHARS = Number(process.env['ZH_REPLY_CHARS'] || 3600);

const ZH_SENTENCES = [
  '这一轮我梳理了上下文压缩的整体流程，先确认历史里哪些内容可以裁剪，再决定是否需要发起摘要请求。',
  '工具调用的返回值通常是历史里最大的部分，因此微压缩会优先清理较早的工具结果，保留最近的几条。',
  '摘要请求本身也会占用上下文窗口，所以必须为输出预留足够的预算，否则服务端会直接拒绝这次请求。',
  '如果本地估算把中文内容算得过高，明明可以压缩的会话就会被判定为放不下，用户会陷入既压不了也聊不下去的状态。',
  '为了验证这一点，我们准备了一段足够长的中文对话历史，用来观察压缩准入检查在不同实现下的表现差异。',
  '接下来可以执行 /compress 手动触发压缩，观察终端上给出的提示信息是否清晰、是否说明了失败原因。',
];

function buildZhReply() {
  let out = '';
  let i = 0;
  while (out.length < ZH_REPLY_CHARS) {
    out += ZH_SENTENCES[i % ZH_SENTENCES.length];
    i++;
  }
  return out.slice(0, ZH_REPLY_CHARS);
}

const SUMMARY = `<state_snapshot>
<overall_goal>验证压缩准入检查在中文会话下的行为</overall_goal>
<key_knowledge>压缩请求必须先通过本地准入检查；输出预算需要从上下文窗口中预留。</key_knowledge>
<recent_actions>生成了一段较长的中文对话历史，然后手动触发 /compress。</recent_actions>
</state_snapshot>`;

function isCompressionRequest(body) {
  // The compression side-query is identified by its own system prompt, not by
  // any <state_snapshot> text that a previous summary left in the history.
  const system = (body?.messages ?? [])
    .filter((m) => m.role === 'system')
    .map((m) =>
      typeof m.content === 'string'
        ? m.content
        : Array.isArray(m.content)
          ? m.content.map((p) => p.text ?? '').join('')
          : '',
    )
    .join('\n');
  return system.includes(
    'You are the component that summarizes a conversation',
  );
}

function sse(res, chunks, usage) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  const id = `chatcmpl-${Date.now()}`;
  for (const piece of chunks) {
    res.write(
      `data: ${JSON.stringify({
        id,
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: 'dummy',
        choices: [{ index: 0, delta: { content: piece }, finish_reason: null }],
      })}\n\n`,
    );
  }
  res.write(
    `data: ${JSON.stringify({
      id,
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model: 'dummy',
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
      usage,
    })}\n\n`,
  );
  res.write('data: [DONE]\n\n');
  res.end();
}

const server = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    let body = {};
    try {
      body = JSON.parse(raw || '{}');
    } catch {
      /* ignore */
    }
    if (req.url.includes('/models')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: [{ id: 'dummy', object: 'model' }] }));
      return;
    }
    const compression = isCompressionRequest(body);
    fs.appendFileSync(
      REQ_LOG,
      JSON.stringify({
        at: new Date().toISOString(),
        url: req.url,
        compression,
        verdict: 'accepted',
        max_tokens: body?.max_tokens,
        messageCount: body?.messages?.length,
        promptTokens: realTokens(messagesText(body?.messages)),
      }) + '\n',
    );
    const content = compression ? SUMMARY : buildZhReply();
    const promptTokens = realTokens(messagesText(body?.messages));
    const maxTokens = Number(body?.max_tokens ?? 0);
    // A real provider validates prompt + max_tokens against the window.
    if (promptTokens + maxTokens > WINDOW) {
      fs.appendFileSync(
        REQ_LOG,
        JSON.stringify({
          at: new Date().toISOString(),
          compression,
          verdict: 'rejected-400',
          promptTokens,
          maxTokens,
          window: WINDOW,
        }) + '\n',
      );
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: {
            message: `Range of input length should be [1, ${WINDOW}] (prompt ${promptTokens} + max_tokens ${maxTokens})`,
            type: 'invalid_request_error',
            code: 'context_length_exceeded',
          },
        }),
      );
      return;
    }
    const usage = {
      prompt_tokens: promptTokens,
      completion_tokens: realTokens(content),
      total_tokens: 0,
    };
    usage.total_tokens = usage.prompt_tokens + usage.completion_tokens;
    if (body?.stream) {
      // Emit in slices so the TUI streams like a real turn.
      const slices = [];
      for (let i = 0; i < content.length; i += 400)
        slices.push(content.slice(i, i + 400));
      sse(res, slices, usage);
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        id: `chatcmpl-${Date.now()}`,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: 'dummy',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content },
            finish_reason: 'stop',
          },
        ],
        usage,
      }),
    );
  });
});

server.listen(0, '127.0.0.1', () => {
  const { port } = server.address();
  console.log(`FAKE_SERVER_READY http://127.0.0.1:${port}/v1`);
});
