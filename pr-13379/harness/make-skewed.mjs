import fs from 'node:fs'; import path from 'node:path';
const home = process.argv[2]; const ext = path.join(home, '.qwen', 'extensions');
fs.rmSync(home, { recursive: true, force: true });
for (let e = 0; e < 40; e++) {
  const name = `sk-${String(e).padStart(2, '0')}`; const dir = path.join(ext, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'qwen-extension.json'), JSON.stringify({ name, version: '1.0.0' }));
  const n = e % 4 === 0 ? 400 : 5; // one heavy entry at the head of every batch of 4
  for (let s = 0; s < n; s++) { const d = path.join(dir, 'skills', `s${s}`); fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, 'SKILL.md'), `---\nname: ${name}-s${s}\ndescription: skewed fixture skill\n---\nbody\n`); }
}
console.log('skewed fixture', ext);
