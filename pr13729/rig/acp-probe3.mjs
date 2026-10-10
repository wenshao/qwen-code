// ACP stdio probe: session/load a transcript whose conversation-only rewind
// left a retained snapshot, send one text-only prompt, report the minted id.
// Usage: node acp-probe.mjs <cli.js> <cwd> <home> <baseUrl> <sessionId> <out.json>
import { spawn } from 'node:child_process';
import { writeFileSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const [, , cli, cwd, home, baseUrl, sessionId, outPath, targetMarker = 'MARK_F'] = process.argv;
const env = {
  HOME: home,
  PATH: `${path.dirname(process.execPath)}:/usr/bin:/bin:/usr/sbin:/sbin`,
  LANG: 'en_US.UTF-8',
};
const child = spawn(
  process.execPath,
  [
    cli,
    '--acp',
    '--approval-mode',
    'yolo',
    '--auth-type',
    'openai',
    '--openai-api-key',
    'dummy',
    '--openai-base-url',
    baseUrl,
    '--model',
    'dummy',
  ],
  { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] },
);
let stderr = '';
child.stderr.on('data', (d) => (stderr += d));
let buf = '';
let nextId = 1;
const pending = new Map();
const notes = [];
child.stdout.on('data', (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      continue;
    }
    if (msg.id !== undefined && pending.has(msg.id) && !msg.method) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    } else if (msg.method && msg.id !== undefined) {
      // Agent -> client request: we expose no client capabilities.
      child.stdin.write(
        JSON.stringify({
          jsonrpc: '2.0',
          id: msg.id,
          error: { code: -32601, message: 'not supported by probe' },
        }) + '\n',
      );
    } else if (msg.method) {
      notes.push(msg.params?.update?.sessionUpdate ?? msg.method);
    }
  }
});
function call(method, params, timeoutMs = 120000) {
  const id = nextId++;
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${method} timed out; stderr=${stderr.slice(-800)}`)),
      timeoutMs,
    );
    pending.set(id, (m) => {
      clearTimeout(timer);
      resolve(m);
    });
  });
}
const result = {};
try {
  result.initialize = (
    await call('initialize', {
      protocolVersion: 1,
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false } },
    })
  ).result?.protocolVersion;
  const load = await call('session/load', { sessionId, cwd, mcpServers: [] });
  result.load = load.error ?? 'ok';
  const prompt = await call('session/prompt', {
    sessionId,
    prompt: [{ type: 'text', text: 'MARK_F acp replacement text-only' }],
  });
  result.prompt = prompt.error ?? prompt.result;
  const projects = path.join(home, '.qwen', 'projects');
  const chatDir = path.join(projects, readdirSync(projects)[0], 'chats');
  const tr = () =>
    readFileSync(path.join(chatDir, `${sessionId}.jsonl`), 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l));
  const userId = (marker) =>
    tr()
      .filter(
        (r) =>
          r.type === 'user' &&
          (r.message?.parts ?? []).some((p) => p.text?.includes(marker)),
      )
      .at(-1)?.promptId;
  result.markFPromptId = userId('MARK_F');
  const edit = await call('session/prompt', {
    sessionId,
    prompt: [{ type: 'text', text: 'MARK_G EDIT_STATE:NEW_EDIT' }],
  });
  result.edit = edit.error ?? edit.result?.stopReason;
  result.markGPromptId = userId('MARK_G');
  result.stateBeforeRewind = readFileSync(path.join(cwd, 'state.txt'), 'utf8').trim();
  const rw = await call('qwen/control/session/rewind', {
    sessionId,
    promptId: userId(targetMarker),
    rewindFiles: true,
  });
  result.rewind = rw.error ?? {
    filesChanged: rw.result?.filesChanged,
    filesFailed: rw.result?.filesFailed,
    targetTurnIndex: rw.result?.targetTurnIndex,
    apiTruncateIndex: rw.result?.apiTruncateIndex,
    target: targetMarker,
    targetPromptId: userId(targetMarker),
  };
  result.stateAfterRewind = readFileSync(path.join(cwd, 'state.txt'), 'utf8').trim();
} catch (e) {
  result.error = String(e);
}
result.updates = [...new Set(notes)];
writeFileSync(outPath, JSON.stringify(result, null, 2));
child.kill('SIGTERM');
setTimeout(() => process.exit(0), 1500);
