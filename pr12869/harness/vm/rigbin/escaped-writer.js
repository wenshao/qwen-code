// Detached descendant of a tool call: keeps appending to the Workspace after its worker is gone.
const fs = require('node:fs');
const [nonce, file] = process.argv.slice(2);
const boot = fs.readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim();
const fd = fs.openSync(file, 'a');
let n = 0;
setInterval(() => {
  fs.writeSync(fd, `${nonce} seq=${n++} at=${new Date().toISOString()} boot=${boot} pid=${process.pid}\n`);
  fs.fsyncSync(fd);
}, 200);
