// Recording fake OpenAI-compatible model for PR #10943 round-3 verification.
// Replies are chosen by markers in the conversation; every request is
// appended to a JSONL ledger with its Authorization header so a worker's
// effective credentials are observable from outside the process.
import { appendFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import {
  startFakeOpenAIServer,
  fakeToolCall,
} from '/root/verify/pr10943/head/integration-tests/fake-openai-server.ts';

const ledger = process.env['LEDGER'] ?? '/root/verify/pr10943/ledger.jsonl';
const portFile = process.env['PORT_FILE'] ?? '/root/verify/pr10943/fake-port';

type Msg = { role: string; content?: unknown; tool_calls?: unknown };
const text = (c: unknown): string =>
  typeof c === 'string'
    ? c
    : Array.isArray(c)
      ? c.map((p) => (typeof p === 'string' ? p : (p as { text?: string })?.text ?? '')).join('')
      : '';

const server = await startFakeOpenAIServer(async ({ body, requestIndex }) => {
  const messages = (body['messages'] as Msg[]) ?? [];
  const tools = ((body['tools'] as Array<{ function?: { name?: string } }>) ?? [])
    .map((t) => t.function?.name)
    .filter(Boolean) as string[];
  const all = messages.map((m) => text(m.content)).join('\n');
  const last = messages[messages.length - 1];
  const lastUser = [...messages].reverse().find((m) => m.role === 'user');
  const lastUserText = text(lastUser?.content);
  const afterTool = last?.role === 'tool';
  const req = server.requests[requestIndex];
  const auth = String(req?.headers['authorization'] ?? '');
  let reply: Record<string, unknown> = { content: 'OK' };
  let kind = 'default';
  // Markers act only on the main agent turn: the marker must sit in the
  // last user message itself. Side queries (suggestions, memory terms,
  // titles) carry their own instructions as the last user message.
  const peer = /PEERMSG:([A-Za-z0-9_-]+)/.exec(lastUserText);
  const bgw = /BGWRITE:(\S+)/.exec(lastUserText);
  const envp = /ENVPROBE:(\S+)/.exec(lastUserText);
  const sendto = /SENDTO:([0-9a-f-]{36}):([A-Za-z0-9_-]+)/.exec(lastUserText);
  const call = (name: string, args: Record<string, unknown>) => ({
    toolCalls: [fakeToolCall(name, args)],
    finishReason: 'tool_calls',
  });
  if (afterTool) {
    const m = /(BGWRITE|ENVPROBE|SENDTO)/.exec(lastUserText);
    kind = m ? `${m[1].toLowerCase()}-done` : 'side-after-tool';
    reply = { content: m ? `DONE ${m[1]}` : 'OK' };
  } else if (tools.length === 0) {
    kind = 'side-notools';
  } else if (peer) {
    kind = 'peer-received';
    reply = { content: `ACK ${peer[1]}` };
  } else if (sendto) {
    kind = 'sendto';
    reply = call('send_message', { to: `[${createHash('sha256').update(sendto[1]).digest('hex').slice(0, 6)}]`, message: `PEERMSG:${sendto[2]}` });
  } else if (envp) {
    kind = 'envprobe';
    reply = call('run_shell_command', {
      command: `printf 'MARK=%s\\nKEY=%s\\n' "$PR10943_MARK" "$OPENAI_API_KEY" > ${envp[1]}`,
      description: 'probe env',
    });
  } else if (bgw) {
    kind = 'bgwrite';
    reply = call('write_file', { file_path: bgw[1], content: 'written by the background worker\n' });
  } else if (/BGHOLD/.test(lastUserText)) {
    kind = 'hold';
    reply = { content: 'released' };
  } else if (/BG|PEERWAIT/.test(lastUserText)) {
    kind = 'main-other';
  } else {
    kind = 'side';
  }
  appendFileSync(
    ledger,
    JSON.stringify({
      t: new Date().toISOString(),
      i: requestIndex,
      kind,
      auth,
      ua: String(req?.headers['user-agent'] ?? ''),
      host: String(req?.headers['host'] ?? ''),
      nTools: tools.length,
      hasSendMessage: tools.includes('send_message'),
      lastRole: last?.role,
      lastUser: lastUserText.slice(-300),
      lastTool: afterTool ? text(last?.content).slice(0, 600) : undefined,
    }) + '\n',
  );
  if (kind === 'hold') await new Promise((r) => setTimeout(r, 600_000));
  return reply as never;
});
writeFileSync(portFile, server.baseUrl);
console.log('fake model at', server.baseUrl);
