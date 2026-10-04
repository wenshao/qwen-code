// <tree>/packages/core/dist-s2: the arm's dist with one edit -- domain.committed
// also admits the harness actor class (triage Suggestion 2's what-if).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
const [tree] = process.argv.slice(2);
const dst = `${tree}/packages/core/dist-s2`;
fs.rmSync(dst, { recursive: true, force: true });
execFileSync('cp', ['-Rc', `${tree}/packages/core/dist`, dst]);
const file = `${dst}/src/managed-runtime/managed-session-records.js`;
const text = fs.readFileSync(file, 'utf8');
const find = `    'domain.committed': ['trusted_entry'],`;
if (text.split(find).length !== 2) throw new Error('anchor');
fs.writeFileSync(file, text.replace(find, `    'domain.committed': ['trusted_entry', 'harness'],`));
console.log('patched', dst);
