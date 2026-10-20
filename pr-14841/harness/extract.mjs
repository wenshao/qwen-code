// Usage: node extract.mjs <wireDir> -> prints the project-tier MEMORY.md block
// of the request-tail catalog from the first main request, plus stats.
import fs from 'node:fs';
import path from 'node:path';
const dir = process.argv[2];
const files = fs.readdirSync(dir).filter((f) => /^req-\d+\.json$/.test(f))
  .sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));
for (const f of files) {
  const raw = fs.readFileSync(path.join(dir, f), 'utf8');
  if (!raw.includes('Current auto-memory catalog')) continue;
  const body = JSON.parse(raw);
  const texts = [];
  for (const m of body.messages) {
    if (typeof m.content === 'string') texts.push(m.content);
    else if (Array.isArray(m.content)) for (const p of m.content) if (p.text) texts.push(p.text);
  }
  const cat = texts.find((t) => t.includes('Current auto-memory catalog'));
  // The project tier is the block whose header path ends in /projects/.../memory/MEMORY.md
  const blocks = cat.split(/\n(?=## \/)/);
  const proj = blocks.find((b) => /\/projects\/.*\/memory\/MEMORY\.md/.test(b.split('\n')[0])) ?? '';
  const lines = proj.split('\n');
  const entryLines = lines.filter((l) => /^- \[/.test(l));
  const warn = lines.filter((l) => l.startsWith('> WARNING'));
  console.log(JSON.stringify({ request: f, header: lines[0], entryLines: entryLines.length,
    firstEntry: entryLines[0], lastEntry: entryLines.at(-1), warnings: warn,
    rawHasLoneSurrogateEscape: /\\ud[89ab][0-9a-f]{2}(?!\\ud[c-f])/i.test(raw) }, null, 2));
  fs.writeFileSync(path.join(dir, 'catalog-project.txt'), proj);
  fs.writeFileSync(path.join(dir, 'catalog-full.txt'), cat);
  break;
}
