// Provisioner model: spawn with pipes (like Java ProcessBuilder), read ready, then die by SIGKILL.
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
if (process.argv[2] === 'provisioner') {
  const c = spawn(process.execPath, [process.argv[3], 'managed-runtime-worker'], { stdio: ['pipe', 'pipe', 'pipe'], detached: false });
  c.stdin.end(readFileSync('boot.json'));
  c.stdout.once('data', (d) => { process.stderr.write(`PID ${c.pid} READY ${d}`); process.kill(process.pid, 'SIGKILL'); });
} else {
  const p = spawn(process.execPath, [new URL(import.meta.url).pathname, 'provisioner', process.argv[2]], { stdio: ['ignore', 'ignore', 'pipe'] });
  let e = ''; p.stderr.on('data', (d) => (e += d));
  p.on('exit', async (code, sig) => {
    const pid = Number(/PID (\d+)/.exec(e)[1]); const url = /"url":"([^"]+)"/.exec(e)[1];
    console.log(`provisioner exit sig=${sig}; worker pid=${pid} url=${url}`);
    for (const t of [1, 30]) {
      await new Promise((r) => setTimeout(r, t === 1 ? 1000 : 29000));
      let alive = true; try { process.kill(pid, 0); } catch { alive = false; }
      const ppid = alive ? readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1].split(' ')[1] : '-';
      let status = '-'; try { status = (await fetch(url + '/x')).status; } catch (x) { status = 'ERR'; }
      console.log(`t=${t}s worker alive=${alive} ppid=${ppid} GET /x -> ${status}`);
    }
    process.kill(pid, 'SIGTERM');
  });
}
