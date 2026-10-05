// Deterministic extension fixture for PR #13379 E2E.
// usage: node make-fixture.mjs <home> rich|bench [extCount]
import fs from 'node:fs';
import path from 'node:path';

const [home, kind = 'rich', countArg] = process.argv.slice(2);
const extDir = path.join(home, '.qwen', 'extensions');
const srcDir = path.join(home, 'ext-src');
fs.rmSync(home, { recursive: true, force: true });
fs.mkdirSync(extDir, { recursive: true });
fs.mkdirSync(srcDir, { recursive: true });

function write(p, c) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, c);
}

function qwenExt(dir, { name, version = '1.0.0', skills = 1, commands = 1, agents = 1, ctx = true, hooks = false, displayName }) {
  write(path.join(dir, 'qwen-extension.json'), JSON.stringify({
    name, version,
    ...(displayName ? { displayName } : {}),
    description: `Fixture ${name} from ${path.basename(dir)}`,
  }, null, 2));
  if (ctx) write(path.join(dir, 'QWEN.md'), `CTX-MARKER ${path.basename(dir)} (${name}@${version})\n`);
  for (let s = 0; s < skills; s++) {
    write(path.join(dir, 'skills', `${name}-skill-${String(s).padStart(3, '0')}`, 'SKILL.md'),
      ['---', `name: ${name}-skill-${String(s).padStart(3, '0')}`,
       `description: Skill ${s} of ${name} (dir ${path.basename(dir)}). Use when asked about ${name}.`, '---',
       `# ${name} skill ${s}`, '', 'Body paragraph. '.repeat(40)].join('\n'));
  }
  for (let c = 0; c < commands; c++) {
    write(path.join(dir, 'commands', `${name}-cmd-${c}.md`), `---\ndescription: Command ${c} of ${name}\n---\nDo ${c}`);
  }
  for (let a = 0; a < agents; a++) {
    write(path.join(dir, 'agents', `${name}-agent-${a}.md`),
      ['---', `name: ${name}-agent-${a}`, `description: Agent ${a} of ${name} (dir ${path.basename(dir)}).`, '---',
       'Agent prompt body long enough for the validator. '.repeat(3)].join('\n'));
  }
  if (hooks) {
    write(path.join(dir, 'hooks', 'hooks.json'), JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'echo ${CLAUDE_PLUGIN_ROOT}/hook' }] }] } }));
  }
}

if (kind === 'rich') {
  // Directory order (strcmp) -> batches of 4:
  // [a00-heavy a01 a02-hooks a03] [b00-dupe-first b01 b02-dupe-second b03-bad-manifest]
  // [c00-plugin-v1 c01-linked c02 c03-notadir.txt] [d00..d03] [d04..d07] [e00]
  qwenExt(path.join(extDir, 'a00-heavy'), { name: 'heavy', skills: 300, commands: 30, agents: 20 });
  qwenExt(path.join(extDir, 'a01'), { name: 'alpha-one', displayName: 'Alpha One' });
  qwenExt(path.join(extDir, 'a02-hooks'), { name: 'hooked', hooks: true });
  qwenExt(path.join(extDir, 'a03'), { name: 'alpha-three', skills: 0, commands: 0, agents: 0 });
  // Same manifest name in one batch: serial last-name-wins picks b02 (2.0.0).
  // b00 is heavy so it finishes LAST inside its batch.
  qwenExt(path.join(extDir, 'b00-dupe-first'), { name: 'dupe', version: '1.0.0', skills: 300, commands: 20, agents: 10 });
  qwenExt(path.join(extDir, 'b01'), { name: 'beta-one' });
  qwenExt(path.join(extDir, 'b02-dupe-second'), { name: 'dupe', version: '2.0.0', skills: 1 });
  write(path.join(extDir, 'b03-bad-manifest', 'qwen-extension.json'), '{');
  // Agent Plugins v1
  const pv1 = path.join(extDir, 'c00-plugin-v1');
  write(path.join(pv1, 'plugin.json'), JSON.stringify({
    $schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json',
    name: 'portable-plugin', version: '0.3.0', description: 'Agent Plugins v1 fixture' }));
  for (let s = 0; s < 3; s++) write(path.join(pv1, 'skills', `pp-skill-${s}`, 'SKILL.md'),
    ['---', `name: pp-skill-${s}`, `description: Portable skill ${s}.`, '---', 'body'].join('\n'));
  // Linked extension: install dir holds only metadata; source lives elsewhere.
  const linkedSrc = path.join(srcDir, 'linked-src');
  qwenExt(linkedSrc, { name: 'linked-ext', skills: 5, commands: 2, agents: 2 });
  write(path.join(extDir, 'c01-linked', '.qwen-extension-install.json'), JSON.stringify({ source: linkedSrc, type: 'link' }));
  qwenExt(path.join(extDir, 'c02'), { name: 'gamma-two' });
  write(path.join(extDir, 'c03-notadir.txt'), 'not an extension');
  // Decreasing size so completion order inside a batch is reversed.
  for (let i = 0; i < 8; i++) {
    qwenExt(path.join(extDir, `d0${i}`), { name: `delta-${i}`, skills: 120 - i * 15, commands: 3, agents: 2 });
  }
  qwenExt(path.join(extDir, 'e00'), { name: 'epsilon', skills: 2 });
} else {
  // bench: same shape as packages/core/scripts/bench-extension-load.ts
  const n = Number(countArg ?? 100);
  for (let e = 0; e < n; e++) {
    qwenExt(path.join(extDir, `ext-${String(e).padStart(3, '0')}`), { name: `ext-${String(e).padStart(3, '0')}`, skills: 40, commands: 10, agents: 5 });
  }
}
console.log(`fixture ${kind} at ${extDir}: ${fs.readdirSync(extDir).length} entries`);
