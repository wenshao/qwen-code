// Fixture generators for PR #14841 verification.
import fs from 'node:fs';
import path from 'node:path';

const TYPES = ['feedback', 'project', 'reference', 'user'];
const WORDS = ['deploy', 'runbook', 'staging', 'cluster', 'rollback', 'flaky', 'retry', 'budget', 'schema',
  'migration', 'lease', 'token', 'cache', 'index', 'review', 'release', 'sandbox', 'gateway', 'timeout', 'quota'];

function w(i, k) { return WORDS[(i * 7 + k * 3) % WORDS.length]; }

/** Ordinary topic files: realistic, long-ish descriptions (writer truncates to fit 150). */
export function writeTopicStore(memDir, count, { descLen = 140, prefix = 'note' } = {}) {
  for (let i = 0; i < count; i++) {
    const type = TYPES[i % TYPES.length];
    const id = String(i).padStart(3, '0');
    const title = `${w(i, 0)} ${w(i, 1)} ${w(i, 2)} ${id}`;
    let desc = `How the ${w(i, 3)} ${w(i, 4)} interacts with the ${w(i, 5)} ${w(i, 6)} when ${w(i, 7)} ${w(i, 8)} is on; check ${w(i, 9)} first`;
    while (desc.length < descLen) desc += ` and ${w(i, desc.length)}`;
    desc = desc.slice(0, descLen);
    const rel = `${type}/${prefix}-${id}.md`;
    const file = path.join(memDir, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, [
      '---', `name: ${title}`, `description: ${desc}`, `type: ${type}`, 'category: workflow',
      'keywords:', `  - "${w(i, 0)} ${w(i, 1)}"`, `  - "${w(i, 2)} ${id}"`,
      'usage_scenarios:', `  - "when touching ${w(i, 3)}"`, '---', '', `Body of memory ${id}.`, '',
    ].join('\n'));
  }
}

/** Topic files whose writer index line is exactly `lineLen` UTF-16 units. */
export function writeFixedLineStore(memDir, count, lineLen) {
  for (let i = 0; i < count; i++) {
    const id = String(i).padStart(3, '0');
    const title = `Fixed ${id}`;
    const rel = `project/fixed-${id}.md`;
    const head = `- [${title}](${rel}) — `;
    const desc = ('d' + id + ' ' + 'x'.repeat(400)).slice(0, lineLen - head.length);
    const file = path.join(memDir, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, [
      '---', `name: ${title}`, `description: ${desc}`, 'type: project', 'category: workflow',
      'keywords:', `  - "fixed ${id}"`, 'usage_scenarios:', '  - "line length probe"', '---', '', 'Body.', '',
    ].join('\n'));
  }
}

/** Hand-written MEMORY.md: `count` entries of exactly `lineLen` units. */
export function handWrittenIndex(count, lineLen, nameFn = (i) => `Topic ${i}`) {
  const lines = [];
  for (let i = 0; i < count; i++) {
    const head = `- [${nameFn(i)}](topic-${i}.md) — `;
    lines.push((head + 'h'.repeat(400)).slice(0, lineLen));
  }
  return lines;
}
