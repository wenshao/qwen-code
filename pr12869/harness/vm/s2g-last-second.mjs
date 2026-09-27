// G: a binding whose registration is written immediately before the power loss (fsync check).
import * as d from './drive.mjs';
import fs from 'node:fs';
const label = process.argv[2];
const file = `/rig/out/${label}-arms.json`;
const state = JSON.parse(fs.readFileSync(file, 'utf8'));
const sid = await d.createSession('ws-f');
const w = await d.warm(sid);
state.arms.G = { storage: 'f', workspace: 'ws-f', sid, dir: '/srv/ws/f/project', warmedAt: d.now() };
fs.writeFileSync(file, JSON.stringify(state, null, 1));
console.log(d.now(), 'arm G warm', w.status, 'binding', JSON.stringify(d.sql(`SELECT LEFT(binding_id,8), binding_state, record_version FROM qwen_runtime_binding WHERE isolation_key='${sid}'`)));
