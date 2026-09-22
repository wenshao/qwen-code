// Real bundled CLI in a real PTY (xterm.js in headless Chromium) against a
// scripted fake OpenAI endpoint. The fake model echoes back which bridge
// sentence (if any) arrived in the workflow keyword reminder, so the verdict is
// visible in the screenshot and recorded from the raw request body.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startFakeOpenAIServer } from '/root/verify/pr12497/head/integration-tests/fake-openai-server.js';
import { TerminalCapture } from '/root/verify/pr12497/head/integration-tests/terminal-capture/terminal-capture.js';

const [arm, mode] = process.argv.slice(2); // arm label, 'direct' | 'code'
const OUT = '/root/verify/pr12497/out';
fs.mkdirSync(OUT, { recursive: true });
const KW = 'includes the "workflow" keyword';
const SKILL_BRIDGE = 'If the Skill tool is not in your tool list, review its schema with `tool_search` and then invoke it with `tool_call`.';
const BRIDGE = 'If the Workflow tool is not in your tool list, review its schema with `tool_search` and then invoke it with `tool_call`.';

function userText(body: any): string {
  const msgs = (body.messages ?? []).filter((m: any) => m.role === 'user');
  const last = msgs[msgs.length - 1];
  if (!last) return '';
  return typeof last.content === 'string' ? last.content : (last.content ?? []).map((p: any) => p.text ?? '').join('');
}

const fake = await startFakeOpenAIServer(({ body }) => {
  const t = userText(body);
  if (!t.includes('draft a workflow')) return { content: 'ok' };
  const hasReminder = t.includes(KW);
  const hasBridge = t.includes(BRIDGE);
  const tools = ((body.tools as any[]) ?? []).map((x) => x.function?.name).sort();
  return {
    content:
      `[fake model] workflow keyword reminder received: ${hasReminder ? 'YES' : 'NO'}\n` +
      `[fake model] Workflow-tool bridge sentence ("If the Workflow tool is not in your tool list, review its schema with tool_search ... tool_call") present: ${hasBridge ? 'YES' : 'NO'}\n` +
      `[fake model] Skill-tool bridge sentence present: ${t.includes(SKILL_BRIDGE) ? 'YES' : 'NO'}\n` +
      `[fake model] tools declared in this request: ${tools.join(', ')}`,
  };
});

const home = fs.mkdtempSync(path.join(os.tmpdir(), `pr12497-${arm}-`));
const ws = path.join(home, 'ws');
fs.mkdirSync(path.join(home, '.qwen'), { recursive: true });
fs.mkdirSync(ws);
fs.writeFileSync(
  path.join(home, '.qwen', 'settings.json'),
  JSON.stringify({
    tools: { workflowsEnabled: true, eager: ['read_file'], codeModeOnly: mode === 'code' },
    security: { folderTrust: { enabled: false } },
    ui: { hideTips: true },
  }, null, 2),
);
const env: NodeJS.ProcessEnv = { ...process.env, HOME: home, USERPROFILE: home, QWEN_SANDBOX: 'false', QWEN_CODE_NO_RELAUNCH: '1', TERM: 'xterm-256color', FORCE_COLOR: '1' };
for (const k of ['NO_COLOR', 'QWEN_CODE_SIMPLE', 'HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'ALL_PROXY', 'all_proxy', 'QWEN_CODE_ENABLE_WORKFLOWS', 'QWEN_CODE_DISABLE_WORKFLOWS']) delete env[k];

const t = await TerminalCapture.create({ cols: 130, rows: 34, cwd: ws, env, theme: 'dracula', chrome: true, title: `qwen — PR #12497 arm ${arm} (${mode === 'code' ? 'tools.codeModeOnly=true' : 'direct tool mode'})` });
try {
  await t.spawn('node', ['/root/verify/pr12497/head/dist/cli.js', '--approval-mode', 'yolo', '--auth-type', 'openai', '--openai-api-key', 'dummy', '--openai-base-url', fake.baseUrl, '--model', 'dummy']);
  await t.waitFor('Type your message', { timeout: 60000 });
  await t.idle(600, 8000);
  await t.type('please draft a workflow that lints each package');
  await t.idle(400, 4000);
  await t.type('\n');
  await t.waitFor('tools declared in this request', { timeout: 60000 });
  await t.idle(800, 8000);
  await t.capture(`${arm}.png`, OUT);
  const req = fake.requests.find((r) => userText(r.body).includes('draft a workflow'))!;
  const u = userText(req.body);
  const rec = {
    arm, mode,
    reminderPresent: u.includes(KW),
    skillBridgePresent: u.includes(SKILL_BRIDGE),
    keywordReminder: u.slice(u.lastIndexOf('<system-reminder>')),
    bridgePresent: u.includes(BRIDGE),
    tools: ((req.body.tools as any[]) ?? []).map((x) => x.function?.name).sort(),
    userMessage: u,
  };
  fs.writeFileSync(`${OUT}/${arm}.request.json`, JSON.stringify(rec, null, 2));
  const { userMessage: _u, ...short } = rec; console.log(JSON.stringify(short, null, 2));
} finally {
  await t.close();
  await fake.close();
}
