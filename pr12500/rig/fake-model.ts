// Scripted OpenAI-compatible model. Logs every request (declared MCP tool names, last message) to MODEL_LEDGER.
// A user prompt containing "CALL:<tool name>" makes the model call that tool once, then echo its result.
import fs from 'node:fs';
import {
  startFakeOpenAIServer,
  fakeToolCall,
} from '../integration-tests/fake-openai-server.ts';

const LEDGER = process.env.MODEL_LEDGER!;
const PORT_FILE = process.env.MODEL_PORT_FILE!;

type Msg = { role: string; content?: unknown; tool_calls?: unknown[] };

function text(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content))
    return content
      .map((p) => (typeof p === 'object' && p && 'text' in p ? String((p as { text: unknown }).text) : ''))
      .join('');
  return '';
}

const server = await startFakeOpenAIServer(({ body, requestIndex }) => {
  const tools = ((body.tools as Array<{ function: { name: string } }>) ?? []).map((t) => t.function.name);
  const messages = (body.messages as Msg[]) ?? [];
  const last = messages[messages.length - 1];
  const lastUser = [...messages].reverse().find((m) => m.role === 'user');
  const userText = text(lastUser?.content);
  fs.appendFileSync(
    LEDGER,
    JSON.stringify({
      t: new Date().toISOString(),
      requestIndex,
      lastRole: last?.role,
      userTail: userText.slice(-80),
      mcpTools: tools.filter((n) => n.startsWith('mcp__')),
      toolCount: tools.length,
      toolResult: last?.role === 'tool' ? text(last.content).slice(0, 300) : undefined,
    }) + '\n',
  );
  const usage = { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 };
  const m = /CALL:(\S+)/.exec(userText);
  if (!m) return { content: 'ok', usage };
  if (last?.role === 'tool') return { content: `TOOL RESULT >> ${text(last.content).slice(0, 200)}`, usage };
  if (!tools.includes(m[1])) return { content: `TOOL NOT DECLARED: ${m[1]} (declared mcp: ${tools.filter((n) => n.startsWith('mcp__')).join(',') || 'none'})`, usage };
  return { toolCalls: [fakeToolCall(m[1], {})], usage };
});

fs.writeFileSync(PORT_FILE, new URL(server.baseUrl).port);
console.log(`fake model at ${server.baseUrl}`);
