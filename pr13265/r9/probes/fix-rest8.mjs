// Round 8: the two candidate-r3 edits the head still lacks, applied to a
// compiled hook-command-cgroup.js — H4 (re-raise the signal the launched
// command died of) and H3 (wait for the unit to empty after cgroup.kill).
import fs from 'node:fs';
const file = process.argv[2];
let s = fs.readFileSync(file, 'utf8');
const rep = (a, b) => { if (s.split(a).length !== 2) throw new Error(`anchor: ${a.slice(0, 50)}`); s = s.replace(a, () => b); };
rep("child.on('exit', (code) => process.exit(code ?? 1));",
  "child.on('exit', (code, signal) => { if (signal) { process.removeAllListeners(signal); process.kill(process.pid, signal); setTimeout(() => process.exit(1), 1000); } else process.exit(code ?? 1); });");
rep('if (!(await this.waitForEmpty(graceMs)))\n            this.kill();',
  'if (!(await this.waitForEmpty(graceMs))) {\n            this.kill();\n            await this.waitForEmpty(1000);\n        }');
fs.writeFileSync(file, s);
console.log('patched 2 sites');
