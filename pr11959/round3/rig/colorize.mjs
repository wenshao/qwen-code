// Colours a matrix printed by ctx-matrix.sh / out-matrix.sh: cells that
// differ from the first (base) column are highlighted, and a note column is
// appended from the given notes file: model -> [level, text, {arm: level}?]
// (the optional map overrides the highlight colour of one arm's cell).
// usage: node colorize.mjs <notes.json> [cellWidth] < matrix.txt
import { readFileSync } from 'node:fs';
const notes = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const width = Number(process.argv[3] ?? 14);
const C = { good: '\x1b[32m', warn: '\x1b[33m', bad: '\x1b[31m', dim: '\x1b[2m', reset: '\x1b[0m', bold: '\x1b[1m' };
const lines = readFileSync(0, 'utf8').split('\n').filter(Boolean);
let header = [];
for (const [i, line] of lines.entries()) {
  const parts = line.trim().match(/^(\S+)\s+(.*)$/);
  const name = parts[1];
  const cols = parts[2].split(/\s{2,}/).map((s) => s.trim()).filter(Boolean);
  if (i === 0) {
    header = cols;
    console.log(C.bold + name.padEnd(19) + ' ' + cols.map((c) => c.padEnd(width)).join(' ') + ' note' + C.reset);
    continue;
  }
  const [level, text, perArm] = notes[name] ?? ['dim', ''];
  const out = [name.padEnd(19)];
  cols.forEach((v, j) => {
    const changed = j > 0 && v !== cols[0];
    const lv = perArm?.[header[j]] ?? level;
    out.push((changed ? C[lv] + C.bold : j === 0 ? '' : C.dim) + v.padEnd(width) + C.reset);
  });
  out.push(C[level] + text + C.reset);
  console.log(out.join(' '));
}
