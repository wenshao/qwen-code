// Is a foreground call longer than 30 s reported UNKNOWN regardless of the recovery option? (context for the receipts above)
import * as d from './drive.mjs';
import fs from 'node:fs';
const [sid, tag, seconds = '45'] = process.argv.slice(2);
const rsid = `long-${tag}-${Date.now() % 100000}`;
console.log(d.now(), `[${tag}] option=${fs.readFileSync('/etc/qwen-w0e3.env', 'utf8').match(/TRUSTED=(\w+)/)[1]} acquire`, (await d.acquire(sid, rsid)).status);
const c = await d.create(sid, rsid, `long-${tag}-${Date.now() % 100000}`, `echo started; tail -f /dev/null & wait $!`.replace('tail -f /dev/null & wait $!', `perl -e 'select(undef,undef,undef,${seconds}); print qq(done\\n)'`));
console.log(d.now(), `[${tag}] create`, c.status, JSON.stringify(c.json).slice(0, 200));
let last = ''; const t0 = Date.now();
while (Date.now() - t0 < (Number(seconds) + 15) * 1000) {
  const s = await d.status(sid, rsid, c.json.executionCallId);
  const line = `${s.status} ${s.json?.status?.state ?? s.json?.code}`;
  if (line !== last) { console.log(d.now(), `[${tag}] +${((Date.now() - t0) / 1000).toFixed(1)} s`, line); last = line; }
  if (s.json?.status?.state === 'settled') break;
  await d.sleep(200);
}
console.log(d.now(), `[${tag}] row`, JSON.stringify(d.sql(`SELECT execution_state, IFNULL(execution_status,'-') FROM qwen_tool_execution WHERE execution_call_id='${c.json.executionCallId}'`)[0]), 'release', (await d.release(sid, rsid)).status);
