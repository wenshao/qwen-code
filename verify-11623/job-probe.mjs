// Isolates one Windows fact the leak analysis depends on: when a node parent
// dies, what happens to the cmd.exe it spawned, and to cmd.exe's own child?
import { execFileSync, spawn } from 'node:child_process';

const ps = (c) => { try { return execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', c], { encoding: 'utf8' }).trim(); } catch { return ''; } };
const alive = (pid) => ps(`if (Get-Process -Id ${pid} -ErrorAction SilentlyContinue) { 'y' } else { 'n' }`) === 'y';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const child = (detached) => `
const { spawn } = require('node:child_process');
const c = spawn(process.env.ComSpec, ['/d','/s','/c','ping -n 600 127.0.0.1 > nul'],
  { stdio: 'ignore', detached: ${detached} });
console.log('cmd:' + c.pid);
setInterval(() => {}, 1000);
`;

for (const detached of [false, true]) {
  const parent = spawn(process.execPath, ['-e', child(detached)], { stdio: ['ignore', 'pipe', 'inherit'] });
  let cmdPid;
  parent.stdout.on('data', (d) => { const m = /cmd:(\d+)/.exec(String(d)); if (m) cmdPid = Number(m[1]); });
  for (let i = 0; i < 60 && !cmdPid; i++) await wait(100);
  await wait(1500);
  const pingPid = Number(ps(`@((Get-CimInstance Win32_Process -Filter "ParentProcessId=${cmdPid} and Name='PING.EXE'").ProcessId)[0]`));
  console.log(`\n--- node parent ${parent.pid} -> spawn(cmd.exe, { detached: ${detached} }) = ${cmdPid} -> ping ${pingPid} ---`);
  console.log(`before: cmd ${alive(cmdPid) ? 'alive' : 'gone'}, ping ${alive(pingPid) ? 'alive' : 'gone'}`);
  ps(`Stop-Process -Id ${parent.pid} -Force`);
  await wait(2000);
  console.log(`after killing ONLY the node parent: cmd.exe ${alive(cmdPid) ? 'STILL ALIVE' : 'died with the parent'}, ping.exe ${alive(pingPid) ? 'STILL ALIVE' : 'died with the parent'}`);
  for (const p of [cmdPid, pingPid]) if (p && alive(p)) ps(`Stop-Process -Id ${p} -Force`);
}
process.exit(0);
