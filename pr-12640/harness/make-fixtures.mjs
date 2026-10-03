// Creates real on-disk extensions under <home>/extensions.
// usage: node make-fixtures.mjs <qwenHome> <bulkCount> [--edge]
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [home, bulkArg, ...flags] = process.argv.slice(2);
const bulk = Number(bulkArg ?? 0);
const edge = flags.includes('--edge');
const ext = join(home, 'extensions');
mkdirSync(ext, { recursive: true });
const w = (p, c) => { mkdirSync(join(p, '..'), { recursive: true }); writeFileSync(p, c); };
const skill = (dir, name, desc) =>
  w(join(dir, 'skills', name, 'SKILL.md'), `---\nname: ${name}\ndescription: ${desc}\n---\nDo ${name} work.\n`);
const agent = (dir, name) =>
  w(join(dir, 'agents', `${name}.md`), `---\nname: ${name}\ndescription: Agent ${name}\n---\nAgent ${name} prompt.\n`);

// --- bulk extensions, same shape as the PR author's benchmark (40/10/5 + QWEN.md)
for (let i = 0; i < bulk; i++) {
  const name = `bulk-${String(i).padStart(3, '0')}`;
  const dir = join(ext, name);
  w(join(dir, 'qwen-extension.json'), JSON.stringify({ name, version: '1.0.0', displayName: `Bulk ${i}`, description: `Bulk fixture ${i}` }));
  w(join(dir, 'QWEN.md'), `Context ${i}\n`);
  for (let j = 0; j < 40; j++) skill(dir, `skill-${j}`, `Skill ${j}`);
  for (let j = 0; j < 10; j++) w(join(dir, 'commands', `command-${j}.md`), `Do command ${j}.\n`);
  for (let j = 0; j < 5; j++) agent(dir, `agent-${j}`);
}

// --- rich qwen extension: MCP (stdio + http), settings, hooks, nested commands, context file, git install metadata with credentials
{
  const dir = join(ext, 'rich-qwen');
  w(join(dir, 'qwen-extension.json'), JSON.stringify({
    name: 'rich-qwen', version: '2.3.4', displayName: 'Rich Qwen Extension',
    description: 'MCP servers, settings, hooks, nested commands and a context file',
    contextFileName: 'QWEN.md',
    mcpServers: {
      'alpha-stdio': { command: 'node', args: ['${extensionPath}/server.js'] },
      'beta-http': { httpUrl: 'http://127.0.0.1:9/mcp' },
    },
    settings: [
      { name: 'API Token', description: 'Token for the rich API', envVar: 'RICH_API_TOKEN', sensitive: true },
      { name: 'Region', description: 'Deployment region', envVar: 'RICH_REGION' },
    ],
    hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'true' }] }] },
  }, null, 2));
  w(join(dir, 'QWEN.md'), 'Rich context\n');
  w(join(dir, 'server.js'), '// placeholder\n');
  w(join(dir, 'commands', 'deploy.md'), 'Deploy.\n');
  w(join(dir, 'commands', 'ops', 'rollback.md'), 'Rollback.\n');
  w(join(dir, 'commands', 'ops', 'status.toml'), 'prompt = "Show status"\n');
  skill(dir, 'triage', 'Triage incidents');
  skill(dir, 'postmortem', 'Write postmortems');
  agent(dir, 'oncall');
  w(join(dir, '.qwen-extension-install.json'), JSON.stringify({
    source: 'https://deploy-bot:s3cr3t-token@github.com/acme/rich-qwen.git?access_token=abc#readme',
    type: 'git', ref: 'release/2.x', autoUpdate: true,
  }));
}

// --- Agent Plugins v1 package: plugin.json + mcp.json + skills
{
  const dir = join(ext, 'agent-plugin');
  w(join(dir, 'plugin.json'), JSON.stringify({
    $schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json',
    name: 'agent-plugin', version: '0.9.0', description: 'Agent Plugins v1 package',
  }));
  w(join(dir, 'mcp.json'), JSON.stringify({
    $schema: 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json',
    mcpServers: {
      'plugin-stdio': { type: 'stdio', command: 'node', args: ['${PLUGIN_ROOT}/server.js'] },
      'plugin-http': { type: 'streamable-http', url: 'https://mcp.example.com/mcp' },
    },
  }));
  w(join(dir, 'server.js'), '// placeholder\n');
  skill(dir, 'summarize', 'Summarize text');
  skill(dir, 'translate', 'Translate text');
}

// --- a plain small extension (used for the activation-toggle scenario)
{
  const dir = join(ext, 'toggle-me');
  w(join(dir, 'qwen-extension.json'), JSON.stringify({ name: 'toggle-me', version: '1.0.0', description: 'Activation toggle target' }));
  for (let j = 0; j < 6; j++) skill(dir, `toggle-skill-${j}`, `Toggle skill ${j}`);
  w(join(dir, 'commands', 'ping.md'), 'Ping.\n');
}

if (edge) {
  // names differing only by case — both are listed by the full status
  for (const [d, n, s] of [['case-upper', 'CaseExt', 'upper-only-skill'], ['case-lower', 'caseext', 'lower-only-skill']]) {
    const dir = join(ext, d);
    w(join(dir, 'qwen-extension.json'), JSON.stringify({ name: n, version: '1.0.0', description: `dir ${d}` }));
    skill(dir, s, `only in ${d}`);
  }
  // exact duplicate manifest name in two directories
  for (const [d, s] of [['dup-a', 'dup-a-skill'], ['dup-b', 'dup-b-skill']]) {
    const dir = join(ext, d);
    w(join(dir, 'qwen-extension.json'), JSON.stringify({ name: 'dup', version: '1.0.0', description: `dir ${d}` }));
    skill(dir, s, `only in ${d}`);
  }
  // broken manifest: must be excluded by both paths
  w(join(ext, 'broken', 'qwen-extension.json'), '{ not json');
  // extension literally named like a route segment
  for (const n of ['summary', 'operations']) {
    const dir = join(ext, `named-${n}`);
    w(join(dir, 'qwen-extension.json'), JSON.stringify({ name: n, version: '1.0.0', description: `named ${n}` }));
    skill(dir, `${n}-skill`, `skill of ${n}`);
  }
}
console.log(`fixtures in ${ext}: bulk=${bulk} edge=${edge}`);
