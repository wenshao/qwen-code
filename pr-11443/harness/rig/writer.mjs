#!/usr/bin/env node
// writer.mjs <file> <variant>  — a separate process rewriting the fixture on disk.
// "equal" keeps the byte size and restores the previous mtime exactly.
import fs from 'node:fs';
const [file, variant] = process.argv.slice(2);
const V = {
  v1: 'let value: number = 42;\nvalue;\n',
  equal: "let value: string ='x';\nvalue;\n",
  moved: '\n\nlet value: string = "moved";\nvalue;\n',
  bool: 'let value: boolean = true;\r\nvalue;\r\n',
};
const before = fs.existsSync(file) ? fs.statSync(file) : null;
fs.writeFileSync(file, V[variant]);
if (variant === 'equal' && before) fs.utimesSync(file, before.atime, before.mtime);
const after = fs.statSync(file);
console.log(`wrote ${variant}: size ${before?.size}->${after.size} mtimeMs ${before?.mtimeMs}->${after.mtimeMs}`);
