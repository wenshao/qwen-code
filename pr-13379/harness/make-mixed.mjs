// 24 extensions, seeded shuffle: 2 heavy (60 skills), 4 medium (15), 18 light (2).
import fs from 'node:fs'; import path from 'node:path';
const [home, seedArg] = process.argv.slice(2); const ext = path.join(home, '.qwen', 'extensions');
fs.rmSync(home, { recursive: true, force: true });
let seed = Number(seedArg ?? 1); const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const sizes = [60, 60, 15, 15, 15, 15, ...Array(18).fill(2)];
for (let i = sizes.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [sizes[i], sizes[j]] = [sizes[j], sizes[i]]; }
sizes.forEach((n, e) => {
  const name = `mx-${String(e).padStart(2, '0')}`; const dir = path.join(ext, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'qwen-extension.json'), JSON.stringify({ name, version: '1.0.0' }));
  fs.writeFileSync(path.join(dir, 'QWEN.md'), `ctx ${name}\n`);
  for (let s = 0; s < n; s++) { const d = path.join(dir, 'skills', `s${s}`); fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, 'SKILL.md'), `---\nname: ${name}-s${s}\ndescription: mixed fixture skill ${s} with a realistic description line\n---\n${'body text '.repeat(60)}\n`); }
  for (let c = 0; c < Math.ceil(n / 4); c++) { fs.mkdirSync(path.join(dir, 'commands'), { recursive: true }); fs.writeFileSync(path.join(dir, 'commands', `c${c}.md`), `---\ndescription: c\n---\nx`); }
});
console.log('mixed seed', seedArg, sizes.join(','));
