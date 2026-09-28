// PR #12545 end-to-end rig: drives the real bundled CLI (dist/cli.js) of one
// arm headless against a scripted OpenAI-compatible model, with real agent
// definitions, real skills, a real stdio MCP server, and records every
// request body the model receives.
//
// usage: node driver.mjs <head|base> <scenario>
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const SP =
  '/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/7bc698b0-90bd-485c-a8ac-90247e63fd5c/scratchpad';
const { startFakeOpenAIServer, fakeToolCall } = await import(
  `${SP}/wt-head/integration-tests/fake-openai-server.ts`
);

const [, , arm, scenario] = process.argv;
const WT = `${SP}/wt-${arm}`;
const RUN = `${SP}/runs/${arm}-${scenario}`;
rmSync(RUN, { recursive: true, force: true });
const HOME = join(RUN, 'home');
const QHOME = join(HOME, '.qwen');
const PROJ = join(RUN, 'proj');

// ---------- fixture ----------
const AGENTS = {
  'probe-allow': { tools: ['read_file', 'agent'] },
  'probe-deny': { disallowedTools: ['skill'] },
  'probe-open': {},
  'probe-exec': { tools: ['exec', 'read_file', 'agent'] },
  'probe-exec-skill': { tools: ['exec', 'read_file', 'skill'] },
  'probe-reader': { tools: ['read_file', 'grep_search', 'glob'] },
};
mkdirSync(join(QHOME, 'agents'), { recursive: true });
// Written only for the empty-list scenarios, so every other scenario's Agent
// tool description (which lists agent types) stays byte-comparable across rounds.
if (scenario.includes('empty')) {
  AGENTS['probe-empty'] = { tools: [] };
  AGENTS['probe-empty-deny'] = { tools: [], disallowedTools: ['write_file'] };
}
for (const [name, spec] of Object.entries(AGENTS)) {
  const lines = ['---', `name: ${name}`, `description: PR12545 probe agent ${name}`];
  if (spec.tools && spec.tools.length === 0) lines.push('tools: []');
  else if (spec.tools) lines.push('tools:', ...spec.tools.map((t) => `  - ${t}`));
  if (spec.disallowedTools)
    lines.push('disallowedTools:', ...spec.disallowedTools.map((t) => `  - ${t}`));
  lines.push('---', `You are the ${name} probe. Follow the task exactly.`, '');
  writeFileSync(join(QHOME, 'agents', `${name}.md`), lines.join('\n'));
}
mkdirSync(join(QHOME, 'skills', 'demo-skill'), { recursive: true });
writeFileSync(
  join(QHOME, 'skills', 'demo-skill', 'SKILL.md'),
  '---\nname: demo-skill\ndescription: Demo skill used by the PR12545 probe.\n---\nDEMO-SKILL-BODY-7731\n',
);
mkdirSync(join(QHOME, 'skills', 'tsx-helper'), { recursive: true });
writeFileSync(
  join(QHOME, 'skills', 'tsx-helper', 'SKILL.md'),
  "---\nname: tsx-helper\ndescription: React TSX component helper (path-gated).\npaths:\n  - 'src/**/*.tsx'\n---\nTSX-HELPER-BODY-4412\n",
);
mkdirSync(join(PROJ, 'src'), { recursive: true });
writeFileSync(
  join(PROJ, 'src', 'App.tsx'),
  'export const App = () => <div>hello</div>;\n',
);
const codeMode = false;
writeFileSync(
  join(QHOME, 'settings.json'),
  JSON.stringify(
    {
      security: { auth: { selectedType: 'openai' } },
      mcpServers: {
        echo: { command: process.execPath, args: [`${SP}/rig/mcp-echo.mjs`] },
      },
      tools: { codeModeOnly: codeMode },
    },
    null,
    2,
  ),
);


// ---------- resume scenario: launch in background, restart, send_message ----------
const SDK_TOOLS = { 'sdk-str': 'read_file', 'sdk-arr': ['read_file'], 'sdk-null': null, 'sdk-star': '*', 'sdk-estr': '' }[scenario];
const SDK_DISALLOWED = { 'sdk-dstr': 'skill' }[scenario];
const sdkMode = scenario.startsWith('sdk-');
const SUBTYPE = sdkMode ? 'probe-sdk' : { resume: 'probe-deny', 'resume-open': 'probe-open', 'resume-allow': 'probe-allow', 'resume-empty': 'probe-empty' }[scenario];
if (!SUBTYPE) throw new Error(`unknown scenario ${scenario}`);
function textOf(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content))
    return content.map((p) => (typeof p === 'string' ? p : p?.text ?? '')).join('');
  return content == null ? '' : JSON.stringify(content);
}
const users = (body) => (body.messages ?? []).filter((m) => m.role === 'user').map((m) => textOf(m.content));
function classify(body) {
  const u = users(body).join('\n');
  if (u.includes('SUB1-PROBE')) return 'sub1';
  if (u.includes('MAIN-PROBE')) return 'main';
  return 'aux';
}
let phase = 1;
const records = [];
const server = await startFakeOpenAIServer(({ body }) => {
  const role = classify(body);
  const msgs = body.messages ?? [];
  const tools = body.tools ?? [];
  const declared = tools.map((t) => t?.function?.name);
  const allText = msgs.map((m) => textOf(m.content)).join('\n');
  const listing = allText.match(/<available_skills>[\s\S]*?<\/available_skills>/g) ?? [];
  const lastUser = users(body).at(-1) ?? '';
  const last = msgs.at(-1);
  records.push({ idx: records.length, phase, role, stream: body.stream === true, declared,
    availableSkills: listing, lastUser: lastUser.slice(0, 1500),
    lastMsgRole: last?.role, lastToolResult: last?.role === 'tool' ? textOf(last.content).slice(0, 600) : null });
  if (role === 'aux' || body.stream !== true)
    return { content: body.stream === true ? 'ok' : '{"selected_memories":[]}' };
  const call = (name, args) => ({ toolCalls: [fakeToolCall(name, args, `call-${role}-${records.length}`)] });
  if (role === 'sub1') return { content: lastUser.includes('CONTINUE-AFTER-RESUME') ? 'SUB1-REVIVED-DONE' : 'SUB1-DONE' };
  // main
  if (last?.role === 'user' && lastUser.includes('RESUME-QUERY')) {
    const m = allText.match(/task_id: ([A-Za-z0-9_.-]+)/);
    return call('send_message', { task_id: m ? m[1] : 'missing', message: 'SUB1-PROBE CONTINUE-AFTER-RESUME' });
  }
  if (last?.role === 'user' && phase === 1 && msgs.filter((x) => x.role === 'tool').length === 0)
    return call('agent', { subagent_type: SUBTYPE, description: 'pr12545 bg probe', prompt: `SUB1-PROBE (${scenario}) background`, run_in_background: true });
  return { content: `MAIN-DONE-P${phase}` };
});

const env = { ...process.env };
for (const k of Object.keys(env)) if (/_proxy$/i.test(k) || k.startsWith('QWEN_') || k.startsWith('OPENAI_') || k.startsWith('DASHSCOPE')) delete env[k];
Object.assign(env, { HOME, QWEN_HOME: QHOME, QWEN_RUNTIME_DIR: QHOME, NO_COLOR: '1' });
const SESSION = '6d1f2c1e-1254-4c5a-9e00-0000000' + String(12545 + (arm === 'base' ? 1 : 0)).padStart(5, '0');
const SDK_AGENT = { name: 'probe-sdk', description: 'PR12545 SDK session probe agent', systemPrompt: 'You are the SDK probe.', level: 'session', tools: SDK_TOOLS, disallowedTools: SDK_DISALLOWED };
async function launch(extra, prompt) {
  const io = sdkMode ? ['--input-format', 'stream-json', '--output-format', 'stream-json'] : ['-p', prompt];
  const args = [`${WT}/dist/cli.js`, ...extra, ...io, '--approval-mode', 'yolo', '--auth-type', 'openai',
    '--openai-api-key', 'fake-key', '--openai-base-url', server.baseUrl, '--model', 'fake-model'];
  const child = spawn(process.execPath, args, { cwd: PROJ, env });
  let stdout = '', stderr = '';
  child.stdout.on('data', (d) => (stdout += d));
  if (sdkMode) {
    const startRecords = records.length;
    child.stdin.write(JSON.stringify({ type: 'control_request', request_id: 'init-1', request: { subtype: 'initialize', agents: [SDK_AGENT] } }) + '\n');
    child.stdin.write(JSON.stringify({ type: 'user', session_id: SESSION, message: { role: 'user', content: prompt }, parent_tool_use_id: null }) + '\n');
    // Close stdin once the child agent has made its request (launch) or the revive
    // outcome is back, plus a short settle so notifications drain.
    const poll = setInterval(() => {
      const mine = records.slice(startRecords);
      const done = phase === 1
        ? mine.some((r) => r.role === 'sub1') && mine.filter((r) => r.role === 'main').length >= 2
        : mine.some((r) => r.role === 'main' && r.lastMsgRole === 'tool');
      if (done) { clearInterval(poll); setTimeout(() => child.stdin.end(), 3000); }
    }, 200);
    child.on('close', () => clearInterval(poll));
  }
  child.stderr.on('data', (d) => (stderr += d));
  const killer = setTimeout(() => child.kill('SIGKILL'), 240_000);
  const code = await new Promise((r) => child.on('close', r));
  clearTimeout(killer);
  return { code, stdout, stderr: stderr.slice(-3000) };
}
const p1 = await launch(['--session-id', SESSION], `MAIN-PROBE (${scenario}) start`);
phase = 2;
const p2 = await launch(['--resume', SESSION], 'MAIN-PROBE RESUME-QUERY continue the background agent');
writeFileSync(join(RUN, 'result.json'), JSON.stringify({ arm, scenario, p1, p2, records }, null, 2));
console.log(`${arm}/${scenario}: p1=${p1.code} p2=${p2.code} requests=${records.length}`);
process.exit(0);
