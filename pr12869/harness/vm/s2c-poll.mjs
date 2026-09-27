// Keeps polling an in-flight execution like the Hosted Harness does (until the host goes away).
import * as d from './drive.mjs';
import fs from 'node:fs';
const [label, armName, seconds = '5'] = process.argv.slice(2);
const arm = JSON.parse(fs.readFileSync(`/rig/out/${label}-arms.json`, 'utf8')).arms[armName];
const end = Date.now() + Number(seconds) * 1000; let last = '';
while (Date.now() < end) {
  const s = await d.status(arm.sid, arm.rsid, arm.escapeCall);
  const line = `${s.status} ${s.json?.status?.state ?? JSON.stringify(s.json).slice(0, 160)}`;
  if (line !== last) { console.log(d.now(), `arm ${armName} call-escape`, line); last = line; }
  await d.sleep(200);
}
