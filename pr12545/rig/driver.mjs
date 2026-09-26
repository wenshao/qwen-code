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
for (const [name, spec] of Object.entries(AGENTS)) {
  const lines = ['---', `name: ${name}`, `description: PR12545 probe agent ${name}`];
  if (spec.tools) lines.push('tools:', ...spec.tools.map((t) => `  - ${t}`));
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
const codeMode = scenario.startsWith('exec') || scenario === 'eager-cm';
writeFileSync(
  join(QHOME, 'settings.json'),
  JSON.stringify(
    {
      security: { auth: { selectedType: 'openai' } },
      mcpServers: {
        echo: { command: process.execPath, args: [`${SP}/rig/mcp-echo.mjs`] },
      },
      tools: { codeModeOnly: codeMode, ...(scenario === 'eager-cm' ? { eager: ['read_file'] } : {}) },
    },
    null,
    2,
  ),
);

// ---------- scripted model ----------
const SUBTYPE = {
  allow: 'probe-allow',
  deny: 'probe-deny',
  open: 'probe-open',
  exec: 'probe-exec',
  'exec-skill': 'probe-exec-skill',
  path: 'probe-reader',
  'path-open': 'probe-open',
  path2: 'probe-reader',
  'path-builtin': 'statusline-setup',
  'eager-cm': 'general-purpose',
  'path2-open': 'probe-open',
}[scenario];
const twoQueries = scenario.startsWith('path2');
if (!SUBTYPE) throw new Error(`unknown scenario ${scenario}`);

const EXEC_SOURCE = [
  'try {',
  "  const r = await tools.skill({ skill: 'demo-skill' });",
  "  text('SKILL_CALL_OK ' + String(r.output).replace(/\\s+/g, ' ').slice(0, 160));",
  '} catch (e) {',
  "  text('SKILL_CALL_ERR ' + String((e && e.message) || e).slice(0, 200));",
  '}',
  "text('BINDINGS ' + ALL_TOOLS.map((t) => t.name).join(','));",
].join('\n');

function textOf(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content))
    return content.map((p) => (typeof p === 'string' ? p : p?.text ?? '')).join('');
  return content == null ? '' : JSON.stringify(content);
}
function classify(body) {
  const user = (body.messages ?? [])
    .filter((m) => m.role === 'user')
    .map((m) => textOf(m.content))
    .join('\n');
  if (user.includes('SUB2-PROBE')) return 'sub2';
  if (user.includes('SUB1-PROBE')) return 'sub1';
  if (user.includes('MAIN-PROBE')) return 'main';
  return 'aux';
}
const turnOf = (body) => (body.messages ?? []).filter((m) => m.role === 'tool').length;

function lastUserText(body) {
  const u = (body.messages ?? []).filter((m) => m.role === 'user');
  return u.length ? textOf(u.at(-1).content) : '';
}
function script(role, turn, body) {
  const call = (name, args) => ({
    toolCalls: [fakeToolCall(name, args, `call-${role}-${turn}`)],
  });
  const done = (t) => ({ content: t });
  if (role === 'main') {
    if (lastUserText(body).includes('SECOND-QUERY')) return done('MAIN2-DONE');
    if (turn === 0)
      return call('agent', {
        subagent_type: SUBTYPE,
        description: 'pr12545 probe',
        prompt: `SUB1-PROBE (${scenario}) do the scripted steps`,
        run_in_background: false,
      });
    if (turn === 1) {
      if (scenario.startsWith('path2')) return done('MAIN-DONE');
      if (scenario.startsWith('path')) return call('skill', { skill: 'tsx-helper' });
      if (!codeMode) return call('mcp__echo__ping', {});
    }
    return done('MAIN-DONE');
  }
  if (role === 'sub1') {
    if (codeMode) {
      if (turn === 0) return call('exec', { source: EXEC_SOURCE });
      return done('SUB1-DONE');
    }
    if (scenario.startsWith('path')) {
      if (turn === 0) return call('read_file', { file_path: join(PROJ, 'src', 'App.tsx') });
      return done('SUB1-DONE');
    }
    // allow / deny / open: follow the pointer, then launch a nested agent.
    if (turn === 0) return call('skill', { skill: 'agent-delegation' });
    if (turn === 1)
      return call('agent', {
        subagent_type: 'probe-open',
        description: 'nested probe',
        prompt: 'SUB2-PROBE nested child',
      });
    return done('SUB1-DONE');
  }
  if (role === 'sub2') {
    if (turn === 0) return call('skill', { skill: 'demo-skill' });
    return done('SUB2-DONE');
  }
  return undefined;
}

const records = [];
const server = await startFakeOpenAIServer(({ body }) => {
  const role = classify(body);
  const turn = turnOf(body);
  const tools = body.tools ?? [];
  const declared = tools.map((t) => t?.function?.name);
  const desc = (n) => tools.find((t) => t?.function?.name === n)?.function?.description ?? null;
  const allText = (body.messages ?? []).map((m) => textOf(m.content)).join('\n');
  const listing = allText.match(/<available_skills>[\s\S]*?<\/available_skills>/g) ?? [];
  const toolMsgs = (body.messages ?? []).filter((m) => m.role === 'tool');
  records.push({
    idx: records.length,
    role,
    turn,
    stream: body.stream === true,
    declared,
    agentDesc: desc('agent'),
    execDesc: desc('exec'),
    availableSkills: listing,
    mentionsTsxHelper: allText.includes('tsx-helper'),
    lastUser: lastUserText(body).slice(0, 3000),
    lastToolResult: toolMsgs.length ? textOf(toolMsgs.at(-1).content) : null,
  });
  if (role === 'aux' || body.stream !== true)
    return { content: body.stream === true ? 'ok' : '{"selected_memories":[]}' };
  return script(role, turn, body) ?? { content: 'noop' };
});

// ---------- launch the real CLI ----------
const env = { ...process.env };
for (const k of Object.keys(env)) if (/_proxy$/i.test(k) || k.startsWith('QWEN_') || k.startsWith('OPENAI_') || k.startsWith('DASHSCOPE')) delete env[k];
Object.assign(env, {
  HOME,
  QWEN_HOME: QHOME,
  QWEN_RUNTIME_DIR: QHOME,
  NO_COLOR: '1',
});
const args = [
  `${WT}/dist/cli.js`,
  ...(twoQueries
    ? ['--input-format', 'stream-json', '--output-format', 'stream-json']
    : ['-p', `MAIN-PROBE (${scenario}) start`]),
  '--approval-mode',
  'yolo',
  '--auth-type',
  'openai',
  '--openai-api-key',
  'fake-key',
  '--openai-base-url',
  server.baseUrl,
  '--model',
  'fake-model',
];
const t0 = Date.now();
const child = spawn(process.execPath, args, { cwd: PROJ, env });
let stdout = '';
let stderr = '';
let results = 0;
const userMsg = (content) =>
  JSON.stringify({
    type: 'user',
    session_id: 'pr12545-probe',
    message: { role: 'user', content },
    parent_tool_use_id: null,
  }) + '\n';
child.stdout.on('data', (d) => {
  stdout += d;
  if (!twoQueries) return;
  const n = (stdout.match(/"type":"result"/g) ?? []).length;
  if (n > results) {
    results = n;
    if (n === 1) child.stdin.write(userMsg('MAIN-PROBE SECOND-QUERY what next?'));
    else child.stdin.end();
  }
});
if (twoQueries) child.stdin.write(userMsg(`MAIN-PROBE (${scenario}) start`));
child.stderr.on('data', (d) => (stderr += d));
const killer = setTimeout(() => child.kill('SIGKILL'), 240_000);
const code = await new Promise((r) => child.on('close', r));
clearTimeout(killer);
const out = {
  arm,
  scenario,
  head: arm,
  exitCode: code,
  ms: Date.now() - t0,
  stdout,
  stderr: stderr.slice(-4000),
  records,
};
writeFileSync(join(RUN, 'result.json'), JSON.stringify(out, null, 2));
console.log(`${arm}/${scenario}: exit=${code} requests=${records.length} ms=${out.ms}`);
process.exit(0);
