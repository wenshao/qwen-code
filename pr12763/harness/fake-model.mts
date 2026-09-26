// Scripted OpenAI-compatible model for the PR #12763 real-CLI rig.
//  - main session prompt containing SPAWN_ISOLATED_AGENT -> call `agent` with
//    isolation:"worktree" (exercises the product's own worktree creation,
//    including worktree.symlinkDirectories);
//  - the sub-agent (prompt contains SUBAGENT_MARKER) -> plain text;
//  - after a tool result -> plain text;
//  - everything else -> "OK" after DELAY_MS so the headless process stays alive
//    long enough for the fire-and-forget startup sweep to finish.
import fs from 'node:fs';
import {
  startFakeOpenAIServer,
  fakeToolCall,
} from '<git>/qwen-code-pr12763/integration-tests/fake-openai-server.ts';

const delayMs = Number(process.env.DELAY_MS ?? '6000');
const log = process.env.REQ_LOG;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Msg = { role?: string; content?: unknown };
const text = (m: Msg) =>
  typeof m.content === 'string'
    ? m.content
    : Array.isArray(m.content)
      ? m.content.map((p: { text?: string }) => p?.text ?? '').join('')
      : '';

const server = await startFakeOpenAIServer(async ({ body, requestIndex }) => {
  const messages = (body['messages'] ?? []) as Msg[];
  const tools = new Set(
    ((body['tools'] ?? []) as Array<{ function?: { name?: string } }>).map(
      (t) => t?.function?.name,
    ),
  );
  const userText = messages.filter((m) => m.role === 'user').map(text).join('\n');
  const last = messages[messages.length - 1];
  let kind = 'plain';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let resp: any;
  if (userText.includes('SUBAGENT_MARKER')) {
    kind = last?.role === 'tool' ? 'sub-after-tool' : 'sub';
    resp = { content: 'sub-agent done, no changes made.' };
  } else if (last?.role === 'tool') {
    kind = 'main-after-tool';
    resp = { content: 'finished' };
  } else if (userText.includes('SPAWN_ISOLATED_AGENT') && tools.has('agent')) {
    kind = 'main-spawn';
    resp = {
      toolCalls: [
        fakeToolCall('agent', {
          description: 'isolated probe',
          prompt: 'SUBAGENT_MARKER reply with one line; do not edit files.',
          subagent_type: 'general-purpose',
          isolation: 'worktree',
          run_in_background: false,
        }),
      ],
      finishReason: 'tool_calls',
    };
  } else {
    await sleep(delayMs);
    resp = { content: 'OK' };
  }
  if (log) {
    fs.appendFileSync(
      log,
      JSON.stringify({ requestIndex, kind, tools: tools.size, last: last?.role }) + '\n',
    );
  }
  return resp;
});

const port = new URL(server.baseUrl).port;
if (process.env.PORT_FILE) fs.writeFileSync(process.env.PORT_FILE, port);
console.log(`fake model listening ${server.baseUrl}`);
