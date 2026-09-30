// VERIFICATION RIG ONLY: control happy path on an untouched Workspace.
import fs from 'node:fs';
import { R, register, create, waitTurn, turnRow, tapEntries, terminalEvents, thrown } from './lib.mjs';
const tag = process.argv[2] ?? 'ctl';
register(`ws-${tag}`, 'st-l');
const t0 = Date.now();
const c = await create(`ws-${tag}`, `G0_FILES name=${tag}.txt`, `smoke-${tag}`);
console.log('create', c.status, JSON.stringify(c.json).slice(0, 300));
const w = await waitTurn(c.json.id, { timeoutMs: 90_000 });
console.log('turn', JSON.stringify(w));
console.log('file', fs.existsSync(`${R}/roots/l/child/${tag}.txt`) ? fs.readFileSync(`${R}/roots/l/child/${tag}.txt`, 'utf8') : null);
console.log('tap', tapEntries().filter((e) => Date.parse(e.t) >= t0).map((e) => `${e.method} ${e.path.replace(c.json.id, ':id')} -> ${e.status}`).join(' | '));
console.log('terminal', JSON.stringify(await terminalEvents(c.json.id)));
const ex = thrown(['RuntimeBrokerException', 'DaemonHttpException'], { sinceMs: t0 });
console.log('thrown', ex.length, JSON.stringify(ex.slice(0, 2)));
