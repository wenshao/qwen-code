// Loopback OpenAI-compatible model for the PR 13729 rig.
// Content-driven: the reply depends only on the conversation, never on the
// request index, so side queries cannot shift it.
//   "EDIT_STATE:<VALUE>" in the last user prompt -> read_file, write_file, text
//   anything else                                -> one text reply
// Usage: node mock.mjs <port> <workspace-dir> <log.jsonl>
import { appendFileSync } from 'node:fs';
import path from 'node:path';
import {
  startFakeOpenAIServer,
  fakeToolCall,
} from '/Users/wenshao/pr13729-rig/main/integration-tests/fake-openai-server.ts';

const [, , portArg, wsArg, logArg] = process.argv;
const ws = path.resolve(wsArg);
const statePath = path.join(ws, 'state.txt');

function text(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content))
    return content
      .map((p) => (typeof p === 'string' ? p : (p?.text ?? '')))
      .join('');
  return '';
}

function handler({ body, requestIndex }) {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const tools = Array.isArray(body.tools)
    ? body.tools.map((t) => t?.function?.name)
    : [];
  const main = tools.includes('write_file') && tools.includes('read_file');
  // Last real user prompt (skip system-reminder-only user messages).
  let lastUser = '';
  let lastUserIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') {
      const t = text(messages[i].content);
      if (/MARK_[A-Z]/.test(t)) {
        lastUser = t;
        lastUserIdx = i;
        break;
      }
    }
  }
  // Tool calls the model already made for this prompt, in order.
  const calledSince = messages
    .slice(lastUserIdx + 1)
    .filter((m) => m.role === 'assistant' && m.tool_calls?.length)
    .flatMap((m) => m.tool_calls.map((c) => c.function?.name));
  const marker = (lastUser.match(/MARK_[A-Z]+/) || [''])[0];
  const last = messages[messages.length - 1];
  let reply;
  const edit = lastUser.match(/EDIT_STATE:([A-Z_]+)/);
  if (main && edit && marker) {
    if (calledSince.includes('write_file')) {
      reply = { content: `${marker} done: state.txt is now ${edit[1]}.` };
    } else if (calledSince.includes('read_file')) {
      reply = {
        toolCalls: [
          fakeToolCall('write_file', {
            file_path: statePath,
            content: `${edit[1]}\n`,
          }),
        ],
      };
    } else {
      reply = {
        toolCalls: [fakeToolCall('read_file', { file_path: statePath })],
      };
    }
  } else if (main && marker) {
    reply = { content: `${marker} acknowledged (no file changes).` };
  } else {
    reply = { content: 'ok' };
  }
  appendFileSync(
    logArg,
    JSON.stringify({
      i: requestIndex,
      t: new Date().toISOString(),
      main,
      marker,
      lastRole: last?.role,
      userPrompts: messages
        .filter((m) => m.role === 'user')
        .map((m) => text(m.content))
        .filter((t) => /MARK_[A-Z]/.test(t))
        .map((t) => t.slice(0, 80)),
      reply: reply.content ?? reply.toolCalls.map((c) => c.function.name),
    }) + '\n',
  );
  return {
    ...reply,
    usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 },
  };
}

const server = await startFakeOpenAIServer(handler, {});
// startFakeOpenAIServer picks an ephemeral port; report it for the driver.
console.log(`BASEURL ${server.baseUrl}`);
void portArg;
