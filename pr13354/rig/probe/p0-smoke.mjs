// VERIFICATION RIG ONLY (PR #13354): smoke — one Workspace Session, one write Turn, capabilities.
import * as L from './lib.mjs';
await L.ensureWorkspace('ws-a', 'st-a');
const c = await L.createSession('public', 'ws-a', 'G_WRITE name=smoke.txt content=smoke-ok');
console.log('create', c.status, c.session, L.code(c));
const t = await L.waitTurns(c.session, 1);
console.log('turn', L.j(t.rows), t.ms, 'ms');
const r = await L.read('public', c.session);
console.log('read', r.status, r.json.status, L.j(L.caps('public', r)));
const w = await L.read('web', c.session);
console.log('web read', w.status, L.j(L.caps('web', w)));
console.log('file', L.j(L.readWs('a', 'child/smoke.txt')));
console.log('bindings', L.j(await L.bindings(c.session)));
console.log('pids', L.j(L.pidsOfSession(c.session)), 'allWorkers', L.j(L.workerPids()));
console.log('regs', L.j(L.registrations().slice(0, 5)));
console.log('tap', L.j(L.tapFor(c.session)));
await L.closeDb();
