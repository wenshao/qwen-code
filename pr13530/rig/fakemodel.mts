// Scripted fake OpenAI provider for the PR 13530 real-stack rig.
// User prompts carry D8::<mode>::<id>. Every request is logged with the
// requested model id, the API key it authenticated with, the advertised tool
// names and where the agent/project instruction markers sit in the system
// message, so model selection and instruction placement are evidence.
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import {
  fakeToolCall,
  startFakeOpenAIServer,
  type FakeOpenAIResponse,
} from '/Users/wenshao/git/pr13530-head/integration-tests/fake-openai-server.ts';

const RIG = '/Users/wenshao/git/pr13530-rig';
const LOG = `${RIG}/runs/model-requests.jsonl`;
mkdirSync(`${RIG}/runs/sys`, { recursive: true });
type Msg = { role: string; content?: unknown; tool_calls?: unknown; tool_call_id?: string };
function text(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content))
    return content
      .map((p) => (typeof p === 'object' && p && 'text' in p ? String((p as { text: unknown }).text) : ''))
      .join('');
  return '';
}
const holds = new Map<string, { promise: Promise<void>; release: () => void }>();
function hold(id: string) {
  let e = holds.get(id);
  if (!e) {
    let release!: () => void;
    const promise = new Promise<void>((r) => (release = r));
    e = { promise, release };
    holds.set(id, e);
  }
  return e;
}

let server: Awaited<ReturnType<typeof startFakeOpenAIServer>>;
server = await startFakeOpenAIServer(
  async ({ body, requestIndex }): Promise<FakeOpenAIResponse> => {
    const headers = server.requests[requestIndex]?.headers ?? {};
    const auth = String(headers['authorization'] ?? '').replace(/^Bearer\s+/i, '');
    const messages = (body['messages'] ?? []) as Msg[];
    const tools = ((body['tools'] ?? []) as Array<{ function: { name: string } }>).map((t) => t.function.name).sort();
    const sys = messages.filter((m) => m.role === 'system').map((m) => text(m.content)).join('\n');
    const users = messages.filter((m) => m.role === 'user').map((m) => text(m.content));
    const all = users.join('\n');
    const last = messages[messages.length - 1];
    const marks = [...all.matchAll(/D8::([a-z0-9-]+)::([A-Za-z0-9_-]+)/g)];
    const mk = marks.length ? marks[marks.length - 1] : null;
    const [mode, id] = mk ? [mk[1], mk[2]] : ['none', `r${requestIndex}`];
    // Count tool rounds of the current Turn only (after the newest user message).
    let lastUser = -1;
    messages.forEach((m, i) => { if (m.role === 'user') lastUser = i; });
    const rounds = (name: string) =>
      messages.slice(lastUser + 1).filter(
        (m) => m.role === 'assistant' && Array.isArray(m.tool_calls) &&
          (m.tool_calls as Array<{ function?: { name?: string } }>).some((c) => c.function?.name === name),
      ).length;
    const toolMsgs = messages.filter((m) => m.role === 'tool').map((m) => `${m.tool_call_id}=${text(m.content).slice(0, 200)}`);
    const fresh = last?.role !== 'tool';
    let reply: FakeOpenAIResponse = { content: `REPLY::${id}::model=${String(body['model'])}` };
    if (mode === 'hold' && fresh) await hold(id).promise;
    if (mode === 'glob' || mode === 'globwrite') {
      if (fresh && rounds('glob') === 0)
        reply = { toolCalls: [fakeToolCall('glob', { pattern: '**/*.md' }, `call_${id}_glob`)] };
      else if (mode === 'globwrite' && rounds('write_file') === 0)
        reply = { toolCalls: [fakeToolCall('write_file', { file_path: `w-${id}.txt`, content: `written by ${id}\n` }, `call_${id}_write`)] };
      else reply = { content: `DONE::${id}::${toolMsgs.map((t) => t.slice(0, 80)).join(' | ')}` };
    }
    if (mode === 'write') {
      if (fresh && rounds('write_file') === 0)
        reply = { toolCalls: [fakeToolCall('write_file', { file_path: `w-${id}.txt`, content: `written by ${id}\n` }, `call_${id}_write`)] };
      else reply = { content: `DONE::${id}::${toolMsgs.map((t) => t.slice(0, 80)).join(' | ')}` };
    }
    if (mode === 'agent') {
      if (fresh && rounds('agent') === 0 && /D8::agent::/.test(users[users.length - 1] ?? ''))
        reply = {
          toolCalls: [fakeToolCall('agent', {
            description: `child ${id}`,
            prompt: `D8::text::${id}child Reply with one line.`,
            run_in_background: false,
          }, `call_${id}_agent`)],
        };
      else if (!fresh) reply = { content: `DONE::${id}::${toolMsgs.map((t) => t.slice(0, 120)).join(' | ')}` };
    }
    const agentIdx = sys.indexOf('# Agent instructions');
    const instr = [...sys.matchAll(/INSTR-[A-Z0-9-]+/g)].map((m) => `${m[0]}@${m.index}`);
    const proj = [...sys.matchAll(/PROJECT-CTX-[A-Z0-9-]+/g)].map((m) => `${m[0]}@${m.index}`);
    const sysFile = `${RIG}/runs/sys/${id}-${requestIndex}.txt`;
    writeFileSync(sysFile, sys);
    appendFileSync(
      LOG,
      JSON.stringify({
        t: new Date().toISOString(), i: requestIndex, mode, id,
        model: body['model'], key: auth, tools, glob: tools.includes('glob'),
        sysLen: sys.length, coreHead: sys.slice(0, 60), agentIdx, instr, proj,
        lastRole: last?.role, n: messages.length, toolMsgs,
        reply: reply.content?.slice(0, 160) ?? reply.toolCalls?.map((c) => c.function.name + c.function.arguments),
      }) + '\n',
    );
    return reply;
  },
  { listenHost: '127.0.0.1', baseUrlHost: '127.0.0.1', keepAlive: false },
);
writeFileSync(`${RIG}/runs/model.url`, server.baseUrl + '\n');
console.log(`MODEL ${server.baseUrl}`);
createServer((req, res) => {
  const m = /^\/release\/(.+)$/.exec(req.url ?? '');
  if (m) { hold(m[1]).release(); res.end(`released ${m[1]}\n`); return; }
  res.statusCode = 404; res.end();
}).listen(18539, '127.0.0.1', () => console.log('CONTROL 18539'));
