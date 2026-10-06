// VERIFICATION RIG ONLY (PR #13247 R4) S15b: the mount root disappears between claim and probe (claim held 4 s).
// Since R4 a vanished mount root is a terminal verdict (NoSuchFileException), not a retry.
import fs from 'node:fs';
import { Report, register, createSession, waitTurn, sleep, j, RUN } from './lib.mjs';
import { pubChange, opId, waitCwdOp, binding, cwdOpRow, mkdirWs } from './cwd.mjs';
const R = new Report(process.env.NAME ?? 's15b-mount-root');
const ST = process.env.ST ?? 'g';
const tag = Date.now() % 100000;
const root = fs.realpathSync(`${RUN}/ws/${ST}`);
const WS = `ws-s15b-${tag}`;
register(WS, `st-${ST}`);
const c = await createSession('public', WS, 'PLAIN'); await waitTurn(c.session);
const d = `trap-claim-s15b-${tag}`; mkdirWs(ST, d);
const a = await pubChange(c.session, d, 1, { key: `s15b-${tag}` });
await sleep(800);
fs.renameSync(root, `${root}.moved`);
const w = await waitCwdOp(c.session, opId(a), { timeoutMs: 30_000 });
fs.renameSync(`${root}.moved`, root);
const row = cwdOpRow(opId(a));
R.check('vanished mount root → FAILED workspace_unavailable without retries; binding kept', w.json.status === 'failed' && w.json.failure_code === 'workspace_unavailable' && row.attempts === 0 && binding(c.session).rev === 1, `${w.ms} ms ${w.json.status}/${w.json.failure_code} attempts=${row.attempts} ${j(binding(c.session))}`);
const again = await pubChange(c.session, d, 1, { key: `s15b2-${tag}` });
const w2 = await waitCwdOp(c.session, opId(again));
R.check('…the root back, a re-issued change completes', w2.json.status === 'completed', `${again.status} ${w2.json.status}`);
R.done({});
