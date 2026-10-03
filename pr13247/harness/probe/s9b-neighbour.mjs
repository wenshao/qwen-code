// VERIFICATION RIG ONLY (PR #13247) S9b: does a wedged later Turn hold the storage against a neighbour Session?
import fs from 'node:fs';
import { Report, createSession, waitTurn, turnRow, j, one, RUN } from './lib.mjs';
const R = new Report(process.env.NAME ?? 's9b-neighbour');
const WS = process.env.WS; const ST = process.env.ST;
const tag = Date.now() % 100000;
const c = await createSession('public', WS, `G_WRITE name=nb-${tag}.txt content=nb`);
const t = await waitTurn(c.session, { timeoutMs: Number(process.env.WAIT ?? 60000) });
const hit = fs.existsSync(`${RUN}/ws/${ST}/child/nb-${tag}.txt`);
R.check(`neighbour Session on ${WS} (st-${ST}) runs its initial file Turn`, t.status === 'COMPLETED' && hit, `create=${c.status} turn=${t.status} ${t.error ?? ''} after ${t.ms} ms file=${hit} last=${j(turnRow(c.session).at(-1))}`);
R.done({ session: c.session });
