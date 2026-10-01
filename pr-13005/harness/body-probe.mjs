// Free, deterministic probe: run the real CLI bundle once per settings arm
// against a capture-only fake OpenAI server, and report where "monitor"
// appears in the FIRST main-model request (declared tool vs. deferred-tool
// reminder text vs. tool_search description).
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';

const CLI = '/root/verify/pr13005/wt/dist/cli.js';
const OUT = '/root/verify/pr13005/body-probe';
fs.mkdirSync(OUT, { recursive: true });

function sse(content) {
  const chunk = { id: 'x', object: 'chat.completion.chunk', created: 0, model: 'fake', choices: [{ index: 0, delta: { role: 'assistant', content }, finish_reason: null }] };
  const end = { id: 'x', object: 'chat.completion.chunk', created: 0, model: 'fake', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } };
  return `data: ${JSON.stringify(chunk)}\n\ndata: ${JSON.stringify(end)}\n\ndata: [DONE]\n\n`;
}

async function probe(arm, settings) {
  const bodies = [];
  const server = http.createServer((req, res) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => {
      const body = JSON.parse(b || '{}');
      bodies.push(body);
      if (body.stream) {
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.end(sse('Monitor launched.'));
      } else {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ id: 'x', object: 'chat.completion', created: 0, model: 'fake', choices: [{ index: 0, message: { role: 'assistant', content: '{}' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }));
      }
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/v1`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `p13005-${arm}-`));
  fs.mkdirSync(path.join(dir, '.qwen'));
  fs.writeFileSync(path.join(dir, '.qwen/settings.json'), JSON.stringify({ sandbox: false, ...settings }, null, 2));
  const home = path.join(dir, 'home');
  fs.mkdirSync(home);
  fs.writeFileSync(path.join(home, 'settings.json'), '{}');
  await new Promise((resolve) => {
    execFile('node', [CLI, '--no-chat-recording', '--yolo', '--prompt',
      'Use the monitor tool to watch this command: for i in 1 2 3; do echo "EVENT_$i"; sleep 0.3; done. Set description to "test events". After starting the monitor, just say "Monitor launched."',
      '--auth-type', 'openai', '--model', 'fake-model', '--openai-base-url', base, '--openai-api-key', 'fake'],
      { cwd: dir, env: { ...process.env, QWEN_HOME: home, QWEN_RUNTIME_DIR: home, QWEN_SANDBOX: 'false', QWEN_CODE_SUPPRESS_YOLO_WARNING: '1', NO_PROXY: '127.0.0.1,localhost' }, timeout: 120000 },
      () => resolve());
  });
  server.close();
  const first = bodies.find((b) => b.stream);
  fs.writeFileSync(path.join(OUT, `${arm}-first-request.json`), JSON.stringify(first, null, 2));
  const toolNames = (first.tools ?? []).map((t) => t.function?.name);
  const msgText = (m) => (typeof m.content === 'string' ? m.content : (m.content ?? []).map((p) => p.text ?? '').join(''));
  const hits = [];
  first.messages.forEach((m, i) => {
    const t = msgText(m);
    let at = -1;
    while ((at = t.indexOf('monitor', at + 1)) !== -1) hits.push({ msg: i, role: m.role, ctx: t.slice(Math.max(0, at - 80), at + 60).replace(/\n/g, ' ') });
  });
  const tsDesc = first.tools?.find((t) => t.function?.name === 'tool_search')?.function?.description ?? '';
  return {
    arm,
    requests: bodies.length,
    streamingRequests: bodies.filter((b) => b.stream).length,
    toolCount: toolNames.length,
    monitorDeclared: toolNames.includes('monitor'),
    toolSearchDeclared: toolNames.includes('tool_search'),
    toolSearchDescMentionsMonitor: tsDesc.includes('monitor'),
    monitorMentionsInMessages: hits,
  };
}

const results = [];
results.push(await probe('base', {}));
results.push(await probe('pr', { tools: { visible: ['monitor'] }, memory: { enableManagedAutoMemory: false } }));
fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
