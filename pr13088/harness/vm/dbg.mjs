import * as L from './lib.mjs';
const ids = JSON.parse((await import('node:fs')).readFileSync(`${L.OUT}/s1-ids.json`, 'utf8'));
const rig = await L.startRig('dbg');
const A = new L.HSession(rig.h, ids.A, 'ws-a');
console.log('load', (await A.load()).status);
const r = await A.prompt('HISTORY');
console.log(JSON.stringify(r.events.map((e) => ({ type: e.type, rec: e.data?.record?.type, parts: e.data?.record?.message?.parts, keys: Object.keys(e.data ?? {}) })), null, 0).slice(0, 1500));
console.log('model log tail', JSON.stringify(rig.model.state.log.slice(-2)));
await A.detach(); await rig.stop();
