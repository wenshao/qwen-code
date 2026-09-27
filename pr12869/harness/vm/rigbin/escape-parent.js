// Foreground tool process: spawns the detached writer, then stays in the foreground.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const nonce = process.argv[2];
const child = spawn(process.execPath, ['/opt/qwen/rig/escaped-writer.js', nonce, `${process.cwd()}/escaped-marker`],
  { detached: true, stdio: 'ignore' });
fs.writeFileSync('escaped-pid', String(child.pid));
child.unref();
console.log(`escaped writer pid=${child.pid} nonce=${nonce}`);
if (process.argv[3] === 'stay') setInterval(() => {}, 1000);
