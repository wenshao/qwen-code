// VERIFICATION RIG ONLY (PR #13194): after the fleet runs head again, does the DELETE blocked by the older coordinator ever finish?
import fs from 'node:fs';
import { Report, sessStatus, j, del, archive, unarchive, closeSession, opId, code, waitFor, opState, retirement, RIG, DB } from './lib94.mjs';
const [WS = 'ws-mxb', SECS = '180'] = process.argv.slice(2);
const st = JSON.parse(fs.readFileSync(`${RIG}/out/${DB}/mixed-${WS}.json`, 'utf8'));
const rep = new Report(`p5-heal-${WS}${process.env.TAG ? "-" + process.env.TAG : ""}`);
const t0 = Date.now();
const fin = await waitFor(() => opState(st.op)?.[0] === 'COMPLETED', Number(SECS) * 1000, 1000);
rep.check(`head-only fleet completes the DELETE blocked by the older coordinator within ${SECS} s`, !!fin.v, `${j(opState(st.op))} session=${sessStatus(st.S)} retirement=${retirement(st.S).length} after ${((Date.now() - t0) / 1000).toFixed(0)} s`);
const K = (n) => `${n}-${Date.now().toString(36)}`;
const r1 = await del('public', st.S, { key: K('d') });
const r2 = await archive('web', st.S, { key: K('a') });
const r3 = await unarchive('public', st.S, { key: K('u') });
const r4 = await closeSession('public', st.S, { key: K('c') });
rep.note('API on the stranded Session (fresh delete / archive / unarchive / close)', `${r1.status}/${code(r1)} ${r2.status}/${code(r2)} ${r3.status}/${code(r3)} ${r4.status}/${code(r4)}`);
rep.done({ ...st, final: opState(st.op) });
