// Scriptable fake OpenAI model for the PR 13936 real-stack rig (child task panel).
// Parent prompts carry PARENT::<mode>::<id>::<childspec>; the agent call it emits
// carries CHILD::<childspec>::<id>. A later parent prompt CONT::<token> answers
// PARENT_CONTINUATION_OK::<reversed token> so the reply never echoes the prompt.
// Every request is logged (role, advertised tools, reply) to runs/model-requests.jsonl.
import { appendFileSync } from 'node:fs';
import { createServer } from 'node:http';
import {
  fakeToolCall,
  startFakeOpenAIServer,
  type FakeOpenAIResponse,
} from '/Users/wenshao/git/pr13936-merge/integration-tests/fake-openai-server.ts';

const LOG = '/Users/wenshao/git/pr13936-rig/runs/model-requests.jsonl';
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
type Msg = { role: string; content?: unknown; tool_calls?: unknown };
function text(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content))
    return content
      .map((p) => (typeof p === 'object' && p && 'text' in p ? String((p as { text: unknown }).text) : ''))
      .join('');
  return '';
}

const server = await startFakeOpenAIServer(
  async ({ body, requestIndex }): Promise<FakeOpenAIResponse> => {
    const messages = (body['messages'] ?? []) as Msg[];
    const tools = ((body['tools'] ?? []) as Array<{ function: { name: string } }>).map((t) => t.function.name);
    const users = messages.filter((m) => m.role === 'user').map((m) => text(m.content));
    const userText = users.join('\n');
    const last = messages[messages.length - 1];
    const lastUser = users[users.length - 1] ?? '';
    const parentAll = [...userText.matchAll(/PARENT::([a-z0-9-]+)::([A-Za-z0-9_-]+)::([a-z0-9-]+)/g)];
    const parent = parentAll.length ? parentAll[parentAll.length - 1] : null;
    const child = /CHILD::([a-z0-9-]+)::([A-Za-z0-9_-]+)/.exec(userText);
    const cont = /CONT::([A-Za-z0-9_-]+)/.exec(lastUser);
    let role = 'other';
    let reply: FakeOpenAIResponse = { content: 'UNSCRIPTED' };
    const roundsWith = (name: string) =>
      messages.filter(
        (m) => m.role === 'assistant' && Array.isArray(m.tool_calls) &&
          (m.tool_calls as Array<{ function?: { name?: string } }>).some((c) => c.function?.name === name),
      ).length;
    if (child) {
      const [, spec, id] = child;
      role = 'child';
      if (spec.startsWith('hold')) {
        await hold(id).promise;
        reply = { content: `CHILD_RESULT::${id}::released` };
      } else if (spec === 'reply') {
        reply = { content: `CHILD_RESULT::${id}::ok` };
      } else {
        reply = { content: `CHILD_RESULT::${id}::${spec}` };
      }
    } else if (cont && last?.role !== 'tool') {
      role = 'parent-continue';
      reply = { content: `PARENT_CONTINUATION_OK::${[...cont[1]].reverse().join('')}` };
    } else if (parent) {
      const [, mode, id, spec] = parent;
      const agentArgs = (n?: number) => ({
        description: `child task ${id}${n ? ' #' + n : ''}`,
        prompt: `CHILD::${spec}::${id}${n ? '-' + n : ''} Compute the answer and reply with one line.`,
        run_in_background: true,
      });
      if (mode === 'mixsh' && last?.role === 'tool' && roundsWith('agent') === 0) {
        role = 'parent-launch-mixsh-agent';
        reply = { toolCalls: [fakeToolCall('agent', agentArgs(), `call_${id}_agent`)] };
      } else if (last?.role === 'tool') {
        role = 'parent-after-tool';
        reply = { content: `PARENT_FINAL::${id}|tools=${messages.filter((m) => m.role === 'tool').length}` };
      } else if (!lastUser.includes('PARENT::')) {
        role = 'parent-wake';
        reply = { content: `PARENT_WAKE::${id}` };
      } else if (mode === 'bg' && roundsWith('agent') === 0) {
        role = 'parent-launch-bg';
        reply = { toolCalls: [fakeToolCall('agent', agentArgs(), `call_${id}`)] };
      } else if (mode === 'multi' && roundsWith('agent') === 0) {
        // N background children in one batch: PARENT::multi::<id>::<spec> with N=3
        role = 'parent-launch-multi';
        reply = { toolCalls: [1, 2, 3].map((n) => fakeToolCall('agent', agentArgs(n), `call_${id}_${n}`)) };
      } else if (mode === 'mixsh' && roundsWith('run_shell_command') === 0) {
        // Round 1: a background Shell task; round 2 (after its result): a background child.
        role = 'parent-launch-mixsh-shell';
        reply = { toolCalls: [fakeToolCall('run_shell_command', { command: `sleep 900 # bg-shell-${id}`, is_background: true, description: `bg shell ${id}` }, `call_${id}_sh`)] };
      } else {
        role = 'parent-plain';
        reply = { content: `PARENT_PLAIN::${id}` };
      }
    }
    return logAnd(reply, role);

    function logAnd(r: FakeOpenAIResponse, roleName: string) {
      appendFileSync(
        LOG,
        JSON.stringify({
          t: new Date().toISOString(),
          i: requestIndex,
          role: roleName,
          parent: parent?.[0],
          child: child?.[0],
          tools: tools.sort(),
          lastRole: last?.role,
          n: messages.length,
          reply: r.content?.slice(0, 120) ?? (r.toolCalls ? r.toolCalls.map((c) => c.function.name + c.function.arguments) : r.errorContent),
        }) + '\n',
      );
      return r;
    }
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
}).listen(19380, '127.0.0.1', () => console.log('CONTROL 19380'));
