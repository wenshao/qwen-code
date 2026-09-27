// B: a genuinely executing call with an active poller.  D: worker-only death, escaped writer survives.
import * as d from './drive.mjs';
import fs from 'node:fs';
import { spawn, execFileSync } from 'node:child_process';
const label = process.argv[2];
const file = `/rig/out/${label}-arms.json`;
const state = JSON.parse(fs.readFileSync(file, 'utf8'));
const { B, D } = state.arms;
const say = (...a) => console.log(d.now(), ...a);
const size = (p) => fs.statSync(p).size;

const c = await d.create(B.sid, B.rsid, 'call-live', 'echo started > live.txt; sleep 100000');
B.escapeCall = c.json.executionCallId;   // polled by s2c-poll.mjs
say('arm B call-live', c.status, c.json?.status?.state, B.escapeCall);
fs.writeFileSync(file, JSON.stringify(state, null, 1));
const log = fs.openSync(`/var/log/qwen-w0e3/poller-${label}.log`, 'a');
spawn(process.execPath, ['/rig/vm/s2c-poll.mjs', label, 'B', '7200'], { detached: true, stdio: ['ignore', log, log], cwd: '/rig/vm' }).unref();

// D: SIGKILL only the worker (exact PID from the durable registration of D's binding)
const bid = d.sql(`SELECT binding_id, JSON_UNQUOTE(JSON_EXTRACT(resource_handle_json,'$.resourceId')) FROM qwen_runtime_binding WHERE storage_id='st-d'`)[0];
const reg = JSON.parse(fs.readFileSync(`/var/lib/qwen-rt/${d.DB}/${bid[1]}.json`, 'utf8'));
D.workerPid = reg.pid; D.bindingId = bid[0];
const before = size(`${D.dir}/escaped-marker`);
say(`arm D: killing worker pid=${reg.pid} only; escaped writer pid=${D.escapedPid}; marker=${before} B`);
process.kill(reg.pid, 'SIGKILL');
const t0 = Date.now(); let lost = null;
while (Date.now() - t0 < 40000) {
  const row = d.sql(`SELECT binding_state, IF(loss_evidence_json IS NULL,'-',JSON_UNQUOTE(JSON_EXTRACT(loss_evidence_json,'$.source'))), IF(stop_evidence_json IS NULL,'-','present') FROM qwen_runtime_binding WHERE binding_id='${bid[0]}'`)[0];
  if (row[0] !== 'READY') { lost = row; say(`arm D: binding ${row[0]} after ${Date.now() - t0} ms (maintenance scan, no request) loss=${row[1]} stop=${row[2]}`); break; }
  await d.sleep(250);
}
if (!lost) say('arm D: binding still READY after 40 s');
const w = await d.warm(D.sid);
say('arm D warm after worker-only death:', w.status, JSON.stringify(w.json));
await d.sleep(3000);
const after = size(`${D.dir}/escaped-marker`);
say(`arm D: escaped writer alive=${fs.existsSync(`/proc/${D.escapedPid}`)} marker ${before} -> ${after} B (+${after - before})`);
say('arm D holder:', JSON.stringify(d.sql(`SELECT IFNULL(LEFT(holder_key,8),'<none>'), IFNULL(runtime_session_id,'<none>') FROM managed_workspace_execution_lease WHERE binding_id='${bid[0]}'`)));
say('arm D executions:', JSON.stringify(d.sql(`SELECT tool_call_id, execution_state FROM qwen_tool_execution WHERE binding_id='${bid[0]}'`)));
fs.writeFileSync(file, JSON.stringify(state, null, 1));
console.log(d.workers());
