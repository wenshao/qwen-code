// Real-bundle TUI E2E for PR #12495: a scripted fake OpenAI model asks the CLI to
// run one sed command; we observe whether the real CLI prompts, runs, or rejects.
import fs from 'node:fs';
import path from 'node:path';
import {
  startFakeOpenAIServer,
  fakeToolCall,
} from '/root/verify/pr12495-head/integration-tests/fake-openai-server.ts';
import { TerminalCapture } from '/root/verify/pr12495-head/integration-tests/terminal-capture/terminal-capture.ts';

const RIG = '/root/verify/pr12495-rig';
const ARMS: Record<string, string> = {
  base: '/root/verify/pr12495-base/dist/cli.js',
  head: '/root/verify/pr12495-head/dist/cli.js',
};
const CASES = [
  { id: 'A', mode: 'default', cmd: "sed -n 's/alpha/ALPHA/p' notes.txt" },
  { id: 'B', mode: 'default', cmd: "sed --quiet 's/alpha/ALPHA/p' notes.txt" },
  { id: 'C', mode: 'default', cmd: "sed --silent 's/alpha/ALPHA/p' notes.txt" },
  { id: 'D', mode: 'default', cmd: "sed --quiet 'w leaked.txt' notes.txt" },
  { id: 'E', mode: 'plan', cmd: "sed --quiet 's/alpha/ALPHA/p' notes.txt" },
  { id: 'F', mode: 'plan', cmd: "sed --quiet 'w leaked.txt' notes.txt" },
];
const only = process.argv.slice(2);
const CONFIRM = /Yes, allow once|Allow execution of/;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function lastText(m: any): string {
  if (typeof m?.content === 'string') return m.content;
  if (Array.isArray(m?.content)) return m.content.map((p: any) => p.text ?? '').join('');
  return '';
}

async function runCase(arm: string, c: (typeof CASES)[number]) {
  const ws = fs.mkdtempSync(path.join(RIG, `ws-${arm}-${c.id}-`));
  const home = path.join(ws, '.home');
  fs.mkdirSync(home);
  fs.mkdirSync(path.join(ws, 'proj'));
  const proj = path.join(ws, 'proj');
  fs.writeFileSync(path.join(proj, 'notes.txt'), 'alpha\nbeta\n');
  let toolIssued = false;
  const server = await startFakeOpenAIServer(({ body }) => {
    const msgs = (body.messages as any[]) ?? [];
    const last = msgs[msgs.length - 1];
    const isMain = Array.isArray(body.tools) && (body.tools as any[]).some((t) => t?.function?.name === 'run_shell_command');
    if (isMain && last?.role === 'tool') return { content: 'Finished.' };
    if (isMain && last?.role === 'user' && lastText(last).includes('RUN_SED') && !toolIssued) {
      toolIssued = true;
      return { toolCalls: [fakeToolCall('run_shell_command', { command: c.cmd, description: 'preview notes' })], finishReason: 'tool_calls' };
    }
    return { content: 'ok' };
  });
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: home, USERPROFILE: home, QWEN_SANDBOX: 'false', QWEN_CODE_NO_RELAUNCH: '1', TERM: 'xterm-256color', FORCE_COLOR: '1' };
  for (const k of ['NO_COLOR', 'QWEN_CODE_SIMPLE', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy', 'QWEN_HOME']) delete env[k];
  const t = await TerminalCapture.create({ cols: 110, rows: 34, cwd: proj, env, theme: 'github-dark' as any, chrome: false, outputDir: path.join(RIG, 'shots') });
  let outcome = 'timeout';
  try {
    await t.spawn('node', [ARMS[arm]!, '--approval-mode', c.mode, '--auth-type', 'openai', '--openai-api-key', 'dummy', '--openai-base-url', server.baseUrl, '--model', 'dummy']);
    // Trust dialog may appear for a fresh folder.
    for (let i = 0; i < 60; i++) {
      const s = await t.getScreenText();
      if (/Type your message/.test(s)) break;
      if (/Trust folder|Do you trust/i.test(s)) { await t.type('\r'); await sleep(800); }
      await sleep(250);
    }
    await t.idle(500, 5000);
    await t.type('RUN_SED preview the notes file');
    await t.idle(400, 4000);
    await t.type('\r');
    for (let i = 0; i < 120; i++) {
      const s = await t.getScreenText();
      if (CONFIRM.test(s)) { outcome = 'PROMPTED'; break; }
      if (/Finished\./.test(s)) { outcome = 'FINISHED'; break; }
      await sleep(250);
    }
    await t.idle(600, 5000);
    await t.capture(`${arm}-${c.id}.png`);
    fs.writeFileSync(path.join(RIG, 'shots', `${arm}-${c.id}.txt`), await t.getScreenText());
  } finally {
    await t.close();
    await server.close();
  }
  const toolMsg = server.requests.map((r) => (r.body.messages as any[]) ?? []).flat().filter((m) => m.role === 'tool').map(lastText);
  const res = {
    arm, id: c.id, mode: c.mode, cmd: c.cmd, outcome,
    leaked: fs.existsSync(path.join(proj, 'leaked.txt')),
    notesUnchanged: fs.readFileSync(path.join(proj, 'notes.txt'), 'utf8') === 'alpha\nbeta\n',
    toolResult: (toolMsg[0] ?? '').slice(0, 300),
  };
  fs.rmSync(ws, { recursive: true, force: true });
  return res;
}

fs.mkdirSync(path.join(RIG, 'shots'), { recursive: true });
const results: any[] = [];
for (const c of CASES) for (const arm of ['base', 'head']) {
  if (only.length && !only.includes(c.id)) continue;
  const r = await runCase(arm, c);
  console.log(JSON.stringify(r));
  results.push(r);
}
fs.writeFileSync(path.join(RIG, `e2e-results${only.length ? '-' + only.join('') : ''}.json`), JSON.stringify(results, null, 2));
