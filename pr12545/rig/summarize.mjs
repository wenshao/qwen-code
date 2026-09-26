// Summarize one or more rig runs: node summarize.mjs <arm> <scenario>...
import { readFileSync } from 'node:fs';

const SP =
  '/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/7bc698b0-90bd-485c-a8ac-90247e63fd5c/scratchpad';
const [, , arm, ...scenarios] = process.argv;

export function surface(desc) {
  if (!desc) return '-';
  if (desc.includes('load the `agent-delegation` skill')) return 'POINTER';
  if (desc.includes('Skills cannot be loaded in this session')) return 'INLINE';
  return 'other';
}
const one = (s) => String(s ?? '').replace(/\s+/g, ' ');

for (const sc of scenarios) {
  const r = JSON.parse(readFileSync(`${SP}/runs/${arm}-${sc}/result.json`, 'utf8'));
  console.log(`## ${arm}/${sc} exit=${r.exitCode} requests=${r.records.length}`);
  for (const x of r.records) {
    if (x.role === 'aux') {
      console.log(`  #${x.idx} aux stream=${x.stream} decl=${x.declared.length}`);
      continue;
    }
    const bits = [
      `#${x.idx} ${x.role} t${x.turn}`,
      `decl=${x.declared.length}`,
      x.declared.includes('skill') ? '+skill' : '-skill',
      x.declared.includes('agent') ? `agent:${surface(x.agentDesc)}(${x.agentDesc.length})` : 'no-agent',
      x.execDesc ? `exec:${x.execDesc.includes('tools.skill(') ? '+tools.skill' : '-tools.skill'}` : '',
      `listing=${x.availableSkills.length}`,
      x.lastUser.includes('tsx-helper') ? 'LASTUSER-MENTIONS-tsx-helper' : '',
      `last="${one(x.lastToolResult).slice(0, 110)}"`,
    ];
    console.log('  ' + bits.filter(Boolean).join(' '));
  }
}
