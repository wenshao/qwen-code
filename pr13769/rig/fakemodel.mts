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
} from '/Users/wenshao/git/pr13769-head/integration-tests/fake-openai-server.ts';

const LOG = '/Users/wenshao/git/pr13769-rig/runs/model-requests.jsonl';
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
    // The newest marker wins, so a later Turn of the same Session can switch mode.
    const parentAll = [...userText.matchAll(/PARENT::([a-z0-9-]+)::([A-Za-z0-9_-]+)::([a-z0-9-]+)/g)];
    const parent = parentAll.length ? parentAll[parentAll.length - 1] : null;
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
      const bgArgs = { ...fgArgs, run_in_background: true };
      const roundsWith = (name: string) => messages.filter(
        (m) => m.role === 'assistant' && Array.isArray(m.tool_calls) &&
          (m.tool_calls as Array<{ function?: { name?: string } }>).some((c) => c.function?.name === name),
      ).length;
      if (mode === 'fgsh') {
        // Round 1: a foreground agent call. Round 2 (after its fold): a
        // shell call. Round 3: final text naming what the model saw.
        if (last?.role !== 'tool' && lastUser.includes('PARENT::') && roundsWith('agent') === 0)
          return logAnd({ toolCalls: [fakeToolCall('agent', fgArgs, `call_${id}_agent`)] }, 'parent-fgsh-agent');
        if (last?.role === 'tool' && roundsWith('run_shell_command') === 0) {
          const shell = fakeToolCall('run_shell_command', { command: `echo parent-${id} > parent-${id}.txt; ls` }, `call_${id}_shell`);
          return logAnd({ toolCalls: [shell] }, 'parent-fgsh-shell');
        }
      }
      if (mode === 'fgbg' && last?.role !== 'tool' && lastUser.includes('PARENT::') && roundsWith('agent') === 0) {
        // One agent-only batch: a foreground child that answers, then a
        // background child (the spec) that the bot's R1-24 scenario names.
        const fg = { ...fgArgs, prompt: `CHILD::reply::${id}f Compute the answer and reply with one line.` };
        const bg = { ...fgArgs, run_in_background: true, description: `bg child ${id}`, prompt: `CHILD::${spec}::${id}b Reply with one line.` };
        return logAnd({ toolCalls: [fakeToolCall('agent', fg, `call_${id}_fg`), fakeToolCall('agent', bg, `call_${id}_bg`)] }, 'parent-fgbg');
      }
      if (mode === 'prebg' && last?.role === 'tool' && !calledAgent) {
        return logAnd({ toolCalls: [fakeToolCall('agent', bgArgs, `call_${id}_agent`)] }, 'parent-prebg-agent');
      }
      if ((mode === 'sh' || mode === 'prebg') && last?.role !== 'tool' && lastUser.includes('PARENT::')) {
        const shell = fakeToolCall('run_shell_command', { command: `echo parent-${id} > parent-${id}.txt; ls` }, `call_${id}_shell`);
        return logAnd({ toolCalls: [shell] }, `parent-${mode}-first`);
      }
      if (mode === 'dups' || mode === 'dupb') {
        // Two agent calls in one Turn that reuse one callId, the way an
        // index-numbered provider (call_0, call_1, ...) can across rounds.
        const agentCalls = messages.filter(
          (m) => m.role === 'assistant' && Array.isArray(m.tool_calls) &&
            (m.tool_calls as Array<{ function?: { name?: string } }>).some((c) => c.function?.name === 'agent'),
        ).length;
        if (last?.role !== 'tool' && lastUser.includes('PARENT::') && agentCalls === 0) {
          return logAnd({ toolCalls: [fakeToolCall('agent', { ...fgArgs, run_in_background: true }, 'call_0')] }, `parent-${mode}-first`);
        }
        if (last?.role === 'tool' && agentCalls === 1) {
          const second = { ...fgArgs, run_in_background: true, prompt: `CHILD::reply::${id}b second prompt` + (mode === 'dupb' ? ' ' + 'q'.repeat(40 * 1024) : '') };
          return logAnd({ toolCalls: [fakeToolCall('agent', second, 'call_0')] }, `parent-${mode}-second`);
        }
      }
      if (mode === 'phold' && last?.role !== 'tool' && lastUser.includes('PARENT::')) {
        // The parent's own model call stays in flight until released (control probes).
        await hold(id).promise;
        return logAnd({ content: `PARENT_PLAIN::${id}::released` }, 'parent-phold');
      }
      if (mode === 'bigp' && last?.role !== 'tool' && lastUser.includes('PARENT::')) {
        const big = { ...fgArgs, prompt: fgArgs.prompt + ' ' + 'p'.repeat(40 * 1024) };
        return logAnd({ toolCalls: [fakeToolCall('agent', big, `call_${id}_agent`)] }, 'parent-bigp');
      }
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
        reply = { content: `PARENT_FINAL::${id}|saw=${messages.filter((m) => m.role === 'tool').map((m) => text(m.content).slice(0, 160)).join(' || ')}` };
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
          toolMsgs: messages.filter((m) => m.role === 'tool').map((m) => `${(m as { tool_call_id?: string }).tool_call_id}=${text(m.content).slice(0, 160)}`),
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
}).listen(18769, '127.0.0.1', () => console.log('CONTROL 18769'));
