import { ensureWorkspace, createSession, waitTurn, readWs, executions, sessionRow, listActions, j, WS, ST } from './lib.mjs';
ensureWorkspace(WS, `st-${ST}`);
const n = Number(process.argv[2] ?? 22);
const stamp = Date.now().toString(36);
const names = Array.from({ length: n }, (_, i) => `yolo-${stamp}-${String(i).padStart(2, '0')}.txt`);
const c = await createSession('web', WS, `UI_BATCH names=${names.join(',')}`);
const t = await waitTurn(c.session, { timeoutMs: 60_000 });
console.log(`n=${n} mode=${sessionRow(c.session)[1]} turn=${t.status}${t.timeout ? ' (timeout)' : ''} ${t.error} written=${names.filter((f) => readWs(ST, `child/${f}`) !== null).length} executions=${executions(c.session)} actions=${(await listActions('web', c.session)).json.data?.length}`);
