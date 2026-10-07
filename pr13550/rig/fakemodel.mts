// Scriptable fake OpenAI model for the PR 13550 real-stack rig.
// Parent prompts carry PARENT::<mode>::<id>::<childspec>; the Agent call it
// emits carries CHILD::<childspec>::<id>. Every request is logged with the
// advertised tool names so the declaration set is evidence, not inference.
import { appendFileSync } from 'node:fs';
import { createServer } from 'node:http';
import {
  fakeToolCall,
  startFakeOpenAIServer,
  type FakeOpenAIResponse,
} from '/Users/wenshao/git/pr13550-head/integration-tests/fake-openai-server.ts';

const LOG = '/Users/wenshao/git/pr13550-rig/runs/model-requests.jsonl';
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
    const tools = ((body['tools'] ?? []) as Array<{ function: { name: string } }>).map(
      (t) => t.function.name,
    );
    const users = messages.filter((m) => m.role === 'user').map((m) => text(m.content));
    const userText = users.join('\n');
    const last = messages[messages.length - 1];
    const lastUser = users[users.length - 1] ?? '';
    const parent = /PARENT::([a-z0-9-]+)::([A-Za-z0-9_-]+)::([a-z0-9-]+)/.exec(userText);
    const child = /CHILD::([a-z0-9-]+)::([A-Za-z0-9_-]+)/.exec(userText);
    let role = 'other';
    let reply: FakeOpenAIResponse = { content: 'UNSCRIPTED' };
    if (parent) {
      const [, mode, id, spec] = parent;
      const calledAgent = messages.some(
        (m) => m.role === 'assistant' && Array.isArray(m.tool_calls) &&
          (m.tool_calls as Array<{ function?: { name?: string } }>).some((c) => c.function?.name === 'agent'),
      );
      const fgArgs = {
        description: `child task ${id}`,
        prompt: `CHILD::${spec}::${id} Compute the answer and reply with one line.`,
        run_in_background: false,
      };
      if (mode === 'pre' && last?.role === 'tool' && !calledAgent) {
        // Second batch: the agent call after an earlier non-agent batch.
        return logAnd({ toolCalls: [fakeToolCall('agent', fgArgs, `call_${id}_agent`)] }, 'parent-pre-agent');
      }
      if ((mode === 'pre' || mode === 'mixed') && last?.role !== 'tool' && lastUser.includes('PARENT::')) {
        const shell = fakeToolCall('run_shell_command', { command: `echo parent-${id} > parent-${id}.txt; ls` }, `call_${id}_shell`);
        return logAnd(
          { toolCalls: mode === 'pre' ? [shell] : [shell, fakeToolCall('agent', fgArgs, `call_${id}_agent`)] },
          `parent-${mode}-first`,
        );
      }
      if (last?.role === 'tool') {
        role = 'parent-after-tool';
        reply = { content: `PARENT_FINAL::${id}|saw=${text(last.content).slice(0, 240)}` };
      } else if (!lastUser.includes('PARENT::')) {
        role = 'parent-wake';
        reply = { content: `PARENT_WAKE::${id}|saw=${lastUser.slice(0, 400)}` };
      } else if (mode === 'plain') {
        role = 'parent-plain';
        reply = { content: `PARENT_PLAIN::${id}` };
      } else {
        role = 'parent-launch';
        const args: Record<string, unknown> = {
          description: `child task ${id}`,
          prompt: `CHILD::${spec}::${id} Compute the answer and reply with one line.`,
        };
        if (mode === 'fg') args['run_in_background'] = false;
        if (mode === 'bg') args['run_in_background'] = true;
        if (mode === 'subagent') {
          args['run_in_background'] = false;
          args['subagent_type'] = 'general-purpose';
        }
        if (mode === 'five') {
          return logAnd(
            {
              toolCalls: [1, 2, 3, 4, 5].map((n) =>
                fakeToolCall(
                  'agent',
                  {
                    description: `child ${id} #${n}`,
                    prompt: `CHILD::${spec}::${id}-${n} Reply with one line.`,
                    run_in_background: true,
                  },
                  `call_${id}_${n}`,
                ),
              ),
            },
            'parent-launch-five',
          );
        }
        reply = { toolCalls: [fakeToolCall('agent', args, `call_${id}`)] };
      }
    } else if (child) {
      const [, spec, id] = child;
      role = 'child';
      if (last?.role === 'tool') {
        reply = { content: `CHILD_RESULT::${id}::after-tool` };
      } else if (spec === 'reply') {
        reply = { content: `CHILD_RESULT::${id}::ok` };
      } else if (spec.startsWith('hold')) {
        await hold(id).promise;
        reply = { content: `CHILD_RESULT::${id}::released` };
      } else if (spec.startsWith('streamhold')) {
        reply = {
          contentChunks: [`CHILD_PARTIAL::${id}`, `::released`],
          holdAfterChunks: 1,
          holdUntil: hold(id).promise,
        };
      } else if (spec.startsWith('sleep')) {
        const ms = Number(spec.slice(5));
        await new Promise((r) => setTimeout(r, ms));
        reply = { content: `CHILD_RESULT::${id}::slept${ms}` };
      } else if (spec === 'shell') {
        reply = {
          toolCalls: [
            fakeToolCall('run_shell_command', { command: `echo child-${id} > child-${id}.txt; pwd` }, `call_c_${id}`),
          ],
        };
      } else if (spec === 'error') {
        reply = { errorContent: `child model failure ${id}` };
      } else if (/^fill\d+c\d+$/.test(spec)) {
        const [, n, c] = /^fill(\d+)c(\d+)$/.exec(spec)!;
        reply = { content: `CHILD_RESULT::${id}::` + String.fromCharCode(Number(c)).repeat(Number(n)) };
      } else if (/^mix\d+c\d+x\d+c\d+$/.test(spec)) {
        const [, n, c, m2, d] = /^mix(\d+)c(\d+)x(\d+)c(\d+)$/.exec(spec)!;
        reply = {
          content: `CHILD_RESULT::${id}::` + String.fromCharCode(Number(c)).repeat(Number(n)) + String.fromCharCode(Number(d)).repeat(Number(m2)),
        };
      } else if (spec === 'lines') {
        reply = { content: `CHILD_RESULT::${id}::first line\nsecond line\n- item A\n- item B` };
      } else if (spec === 'mid') {
        reply = { content: `CHILD_RESULT::${id}::` + 'y'.repeat(100 * 1024) };
      } else if (spec === 'big') {
        reply = { content: `CHILD_RESULT::${id}::` + 'x'.repeat(300 * 1024) };
      } else {
        reply = { content: `CHILD_RESULT::${id}::${spec}` };
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
          reply: r.content?.slice(0, 120) ?? (r.toolCalls ? r.toolCalls.map((c) => c.function.name + c.function.arguments) : r.errorContent ?? r.contentChunks),
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
}).listen(18551, '127.0.0.1', () => console.log('CONTROL 18551'));
