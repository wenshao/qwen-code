import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { MUTANTS } from './mutants.mjs';
const [, , WT, id, out] = process.argv;
const m = MUTANTS.find((x) => x.id === id);
const src = execFileSync('git', ['-C', WT, 'show', `HEAD:${m.file}`], { encoding: 'utf8' });
const parts = src.split(m.find);
if (parts.length !== 2) throw new Error('bad');
fs.writeFileSync(out, parts.join(m.replace));
