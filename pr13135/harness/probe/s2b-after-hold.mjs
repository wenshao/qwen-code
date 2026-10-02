// VERIFICATION RIG ONLY (PR #13135): continue s2 — the bound Turn cannot be cancelled on this base (409 workspace_unavailable),
// so wait for the model to give up (120 s) and the Turn to end, then close with the key that was refused earlier.
import { Report, closeSession, opIdOf, waitTurn, waitOp, sessStatus, j, bindingOf, handleOf, registration, procState, fenceRows } from './lib.mjs';
const S = process.argv[2];
const rep = new Report(`s2b-after-hold-${process.env.ARM ?? 'head'}`);
const t = await waitTurn(S, { timeoutMs: 180_000 });
rep.check('held Turn ends on its own', ['COMPLETED', 'FAILED'].includes(t.status), `${t.status} ${t.error} waited=${t.ms}ms`);
const [binding] = bindingOf(S);
const pid = binding ? registration(handleOf(binding[0]).resourceId)?.pid ?? 0 : 0;
rep.note('binding before close', `${j(binding)} pid=${pid} proc=${procState(pid)} fence=${fenceRows(S)}`);
const r = await closeSession('public', S, { key: 'close-active-public' });
rep.check('the key refused during the Turn is admitted now (refusal stored nothing)', r.status === 202, `status=${r.status} code=${r.json.error?.code ?? r.json.status}`);
const w = await waitOp(S, opIdOf('public', r), { timeoutMs: 60_000 });
rep.check('close completes; Session CLOSED', w.json.status === 'completed' && sessStatus(S) === 'CLOSED', `op=${w.json.status} ${w.ms}ms session=${sessStatus(S)}`);
const [b1] = bindingOf(S);
rep.check('binding RELEASED with receipt; worker gone', b1?.[1] === 'RELEASED' && Number(b1?.[3]) > 0 && procState(pid) === 'gone', `${j(b1)} pid=${pid} proc=${procState(pid)}`);
rep.done({ session: S });
