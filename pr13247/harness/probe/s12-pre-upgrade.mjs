// VERIFICATION RIG ONLY: change the directory of a Session created by an older jar.
import fs from 'node:fs';
import { Report, j } from './lib.mjs';
import { pubChange, opId, waitCwdOp, binding, ctxEvents, mkdirWs } from './cwd.mjs';
const R = new Report(process.env.NAME ?? 's12-pre-upgrade');
const s = fs.readFileSync(process.env.PRE, 'utf8').trim();
mkdirWs('a', 'child2');
const a = await pubChange(s, 'child2', 1, { key: `s12-${Date.now()}` });
const w = await waitCwdOp(s, opId(a));
R.check('Session created by the older jar changes directory after the upgrade', a.status === 202 && w.json.status === 'completed' && binding(s).rev === 2 && ctxEvents(s).length === 1, `${a.status} ${w.json.status} ${j(binding(s))}`);
R.done({ s });
