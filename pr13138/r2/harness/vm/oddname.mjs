// add|del a FIFO whose name holds a double quote, a newline and an ANSI colour escape (JSON-escaping check on stderr).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
const dir = process.argv[3];
const name = `${dir}/x"\n\u001b[31mred`;
if (process.argv[2] === 'add') execFileSync('mkfifo', [name]);
else fs.rmSync(name, { force: true });
console.log(JSON.stringify(name));
