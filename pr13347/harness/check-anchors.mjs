import { MUTANTS } from './mutants.mjs';
import fs from 'node:fs';
for (const [arm, wt] of [['head', '/Users/wenshao/git/pr13347-mut'], ['base', '/Users/wenshao/git/pr13347-mutb']]) {
  for (const m of MUTANTS) {
    const counts = m.edits.map(([f, find]) => fs.readFileSync(`${wt}/${f}`, 'utf8').split(find).length - 1);
    console.log(arm, m.id.padEnd(4), m.name.padEnd(22), counts.join(','));
  }
}
