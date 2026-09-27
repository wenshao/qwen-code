// Evidence snapshot: host identity, SQL, durable registrations, processes, marker tails.
import * as d from './drive.mjs';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
const label = process.argv[2];
const arms = JSON.parse(fs.readFileSync(`/rig/out/${label}-arms.json`, 'utf8')).arms;
console.log(`## ${d.now()} host ${JSON.stringify(d.hostFacts())}`);
console.log(`## service ${execFileSync('sh', ['-c', 'systemctl is-active qwen-w0e3.service; systemctl show qwen-w0e3.service -p MainPID -p ActiveEnterTimestamp | tr "\\n" " "'], { encoding: 'utf8' }).replace(/\n/g, ' ')}`);
console.log(d.snapshot().replace(/\n\n/g, '\n'));
console.log(d.sql('SELECT LEFT(binding_id,8) bid, execution_state, COUNT(*) n, SUM(result_json IS NOT NULL) with_result FROM qwen_tool_execution GROUP BY binding_id, execution_state ORDER BY 1,2', { header: true }));
const dir = `/var/lib/qwen-rt/${d.DB}`;
console.log('## durable registrations', dir);
for (const f of fs.readdirSync(dir).sort()) {
  if (!f.endsWith('.json')) { console.log(`   ${f.slice(0, 12)}…${f.slice(64)} ${fs.statSync(`${dir}/${f}`).size} B`); continue; }
  const r = JSON.parse(fs.readFileSync(`${dir}/${f}`, 'utf8')); const h = JSON.parse(r.handle);
  console.log(`   ${f.slice(0, 12)}….json state=${r.state} pid=${r.pid} started=${r.started} endpoint=${r.endpoint || '-'} hostId=${h.hostId.slice(0, 8)}… bootId=${h.bootId}`);
}
console.log('## processes');
console.log(d.workers().trimEnd() || '   (no worker / writer / server processes)');
console.log('## escaped writers');
for (const [name, arm] of Object.entries(arms)) {
  const p = `${arm.dir}/escaped-marker`;
  if (!fs.existsSync(p)) continue;
  const lines = fs.readFileSync(p, 'utf8').trimEnd().split('\n');
  console.log(`   arm ${name}: pid ${arm.escapedPid} alive=${fs.existsSync(`/proc/${arm.escapedPid}`) && fs.readFileSync(`/proc/${arm.escapedPid}/cmdline`, 'utf8').includes(arm.nonce)} lines=${lines.length} first=[${lines[0].slice(0, 90)}]`);
  console.log(`          last=[${lines.at(-1)}]`);
}
