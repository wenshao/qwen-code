// Scriptable fake OpenAI model for the PR 13572 channel rig. The channel
// turn text is the rendered <channel-message> block; markers in the mail
// body steer the reply:  T#<id> names the run; THINK adds reasoning_content;
// LONG:<kb>:<ascii|json|emoji> answers a long reply; HOLD parks the answer
// until POST /release/<id> on the control port. Every request is logged
// with the full last user text, so what the model saw is evidence.
import { appendFileSync } from 'node:fs';
import { createServer } from 'node:http';
import {
  startFakeOpenAIServer,
  type FakeOpenAIResponse,
} from '/Users/wenshao/git/pr13572-head/integration-tests/fake-openai-server.ts';

const LOG = '/Users/wenshao/git/pr13572-rig/runs/model-requests.jsonl';
const holds = new Map<string, { promise: Promise<void>; release: () => void }>();
function hold(id: string) {
  let entry = holds.get(id);
  if (!entry) {
    let release!: () => void;
    const promise = new Promise<void>((resolve) => (release = resolve));
    entry = { promise, release };
    holds.set(id, entry);
  }
  return entry;
}
type Msg = { role: string; content?: unknown };
const text = (content: unknown): string =>
  typeof content === 'string'
    ? content
    : Array.isArray(content)
      ? content.map((p) => (p && typeof p === 'object' && 'text' in p ? String((p as { text: unknown }).text) : '')).join('')
      : '';

function longReply(kb: number, kind: string, id: string): string {
  const head = `LONG ${id} ${kind} ${kb}KiB BEGIN\n`;
  const unit =
    kind === 'json'
      ? '{"k":"v\\"q\\\\b","ctl":"\u0001\u0002","n":[1,2,3]}\n'
      : kind === 'emoji'
        ? '😀 漢字 é ✓ 🚀 '
        : 'abcdefghijklmnopqrstuvwxyz0123456789 ';
  let body = head;
  while (Buffer.byteLength(body, 'utf8') < kb * 1024) body += unit;
  return body + `\nLONG ${id} END`;
}

const server = await startFakeOpenAIServer(
  async ({ body, requestIndex }): Promise<FakeOpenAIResponse> => {
    const messages = (body['messages'] ?? []) as Msg[];
    const users = messages.filter((m) => m.role === 'user').map((m) => text(m.content));
    const last = users[users.length - 1] ?? '';
    const id = /T#([A-Za-z0-9_-]+)/.exec(last)?.[1] ?? `r${requestIndex}`;
    const channelBlocks = users.filter((u) => u.includes('<channel-message')).length;
    let reply: FakeOpenAIResponse;
    const long = /LONG:(\d+):(ascii|json|emoji)/.exec(last);
    // The request's message shape, and any assistant tool call that no tool
    // message answers: what an interrupted turn leaves in the history.
    const wire = messages as Array<Msg & { tool_calls?: Array<{ id: string }>; tool_call_id?: string }>;
    const shape = wire.map((m) => m.role + (m.tool_calls ? `+tc${m.tool_calls.length}` : '')).join(',');
    const answered = new Set(wire.filter((m) => m.role === 'tool').map((m) => m.tool_call_id));
    const dangling = wire.flatMap((m) => (m.tool_calls ?? []).map((c) => c.id)).filter((c) => !answered.has(c));
    const sleep = /SLEEP:(\d+)/.exec(last);
    const shellTool =
      ((body['tools'] ?? []) as Array<{ function: { name: string } }>).map((t) => t.function.name).find((n) => /shell/.test(n)) ??
      'run_shell_command';
    if (/\bHOLD\b/.test(last)) {
      appendFileSync(LOG, JSON.stringify({ t: new Date().toISOString(), i: requestIndex, id, held: true, shape }) + '\n');
      await hold(id).promise;
    }
    if (sleep && wire[wire.length - 1]?.role === 'user') {
      // SLEEP:<s> answers the user turn with one shell call that runs for <s>
      // seconds, so the Harness can be killed while the tool is running.
      reply = {
        toolCalls: [
          {
            id: `call_${id}_${requestIndex}`,
            type: 'function',
            function: { name: shellTool, arguments: JSON.stringify({ command: `sleep ${sleep[1]} # intentional-sleep: rig fault injection`, description: `rig sleep ${id}` }) },
          },
        ],
      };
    } else if (long) {
      reply = { content: longReply(Number(long[1]), long[2], id) };
    } else {
      const content = `ACK ${id} | channel-turns-in-context=${channelBlocks} | saw: ${last.replace(/\s+/g, ' ').slice(0, 600)}`;
      reply = /\bTHINK\b/.test(last)
        ? { content, reasoning: `PRIVATE-REASONING-${id} the user must never see this line` }
        : { content };
    }
    appendFileSync(
      LOG,
      JSON.stringify({
        t: new Date().toISOString(),
        i: requestIndex,
        id,
        n: messages.length,
        channelBlocks,
        tools: ((body['tools'] ?? []) as Array<{ function: { name: string } }>).map((t) => t.function.name).sort(),
        last: last.slice(0, 6000),
        shape,
        dangling,
        lastTool: (() => {
          const tool = [...wire].reverse().find((m) => m.role === 'tool');
          return tool ? text(tool.content).slice(0, 400) : null;
        })(),
        toolCall: reply.toolCalls?.[0]?.function ?? null,
        replyHead: reply.content?.slice(0, 160),
        replyBytes: reply.content ? Buffer.byteLength(reply.content) : 0,
        reasoning: reply.reasoning ?? null,
      }) + '\n',
    );
    return reply;
  },
  { listenHost: '127.0.0.1', baseUrlHost: '127.0.0.1', keepAlive: false },
);
console.log(`MODEL ${server.baseUrl}`);
createServer((req, res) => {
  const m = /^\/release\/(.+)$/.exec(req.url ?? '');
  if (m) {
    hold(m[1]).release();
    res.end('released ' + m[1] + '\n');
    return;
  }
  res.statusCode = 404;
  res.end();
}).listen(35734, '127.0.0.1', () => console.log('CONTROL 35734'));
