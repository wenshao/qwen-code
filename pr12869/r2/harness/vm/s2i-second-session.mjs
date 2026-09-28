// E2: after a worker died before READY (arm E), may another Session of the same Workspace start on the same boot?
import * as d from './drive.mjs';
import fs from 'node:fs';
const label = process.argv[2];
const file = `/rig/out/${label}-arms.json`.replace('/rig/', '/rig/');
const state = JSON.parse(fs.readFileSync(file, 'utf8'));
const E = state.arms.E;
const sid = await d.createSession(E.workspace);
const w = await d.warm(sid, { timeoutMs: 30000 });
console.log(d.now(), `arm E2: second Session ${sid} on ${E.workspace} warm ->`, w.status, JSON.stringify(w.json), `${w.ms} ms`);
const rsid = `rs-E2-${sid.slice(-6)}`;
const a = w.status === 200 ? await d.acquire(sid, rsid) : { status: '-' };
console.log(d.now(), 'arm E2 acquire ->', a.status, JSON.stringify(a.json ?? {}).slice(0, 160));
state.arms.E2 = { storage: E.storage, workspace: E.workspace, sid, rsid, dir: E.dir };
fs.writeFileSync(file, JSON.stringify(state, null, 1));
console.log(d.now(), 'bindings on st-e:', JSON.stringify(d.sql(`SELECT LEFT(binding_id,8), binding_state, IFNULL(runtime_endpoint,'-') FROM qwen_runtime_binding WHERE storage_id='st-e' ORDER BY record_version`)));
