#!/usr/bin/env node
// shift.mjs <file> — prepend two comment lines (separate process, moves every symbol down by 2).
import fs from 'node:fs';
const f = process.argv[2];
fs.writeFileSync(f, '// moved\n// down\n' + fs.readFileSync(f, 'utf8'));
console.log(`prepended 2 lines to ${f}`);
