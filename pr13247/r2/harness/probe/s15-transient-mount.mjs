// VERIFICATION RIG ONLY (PR #13247 R2) S15: the mount root disappears between claim and probe (claim held 4 s).
// R3 classifies probe I/O failures as transient (retryable). Observe the retry, the Session meanwhile, and how it ends.
import fs from 'node:fs';
import { api, Report, register, createSession, waitTurn, sleep, j, one, RUN } from './lib.mjs';
import { pubChange, opId, pubOp, waitCwdOp, binding, cwdOpRow, mkdirWs } from './cwd.mjs';

const R = new Report(process.env.NAME ?? 's15-transient-mount');
const ST = process.env.ST ?? 'g';
const tag = Date.now() % 100000;
const root = fs.realpathSync(`${RUN}/ws/${ST}`);
const msg = (text) => ({ type: 'agent.session.input.message', input: [{ type: 'input_text', text }] });

async function trial(label, restore) {
  const WS = `ws-s15-${label}-${tag}`;
  register(WS, `st-${ST}`);
  const c = await createSession('public', WS, 'PLAIN');
  await waitTurn(c.session);
  const d = `trap-claim-s15-${label}-${tag}`;
  mkdirWs(ST, d);
  const a = await pubChange(c.session, d, 1, { key: `s15-${label}-${tag}` });
  await sleep(800);
  fs.renameSync(root, `${root}.moved`);
  await sleep(9000);
  const mid = cwdOpRow(opId(a));
  const read = await pubOp(c.session, opId(a));
  const turn = await api('POST', `/v1/agents/sessions/${c.session}/events`, msg('PLAIN'), { key: `s15t-${label}-${tag}` });
  const other = await pubChange(c.session, 'child', 1, { key: `s15o-${label}-${tag}` });
  R.note(`${label}: 9 s with the mount root missing`, `row=${j(mid)} read=${read.json.status} laterTurn=${turn.status} ${turn.json.error?.code ?? ''} otherChange=${other.status} ${other.json.error?.code ?? ''}`);
  restore();
  const w = await waitCwdOp(c.session, opId(a), { timeoutMs: 90_000 });
  const end = cwdOpRow(opId(a));
  return { a, w, mid, end, s: c.session };
}

// A: the same directory comes back (rename back, same inode) → should heal
const A = await trial('same', () => fs.renameSync(`${root}.moved`, root));
R.check('A: retried while missing (attempt_count ≥ 1, not terminal), completes once the same root returns', A.mid.state !== 'FAILED' && A.mid.attempts >= 1 && A.w.json.status === 'completed' && binding(A.s).rev === 2, `mid=${j(A.mid)} end=${A.w.json.status} attempts=${A.end.attempts} ${A.w.ms} ms after restore`);

// B: a different directory appears at the root path (new inode) → structural refusal expected
const B = await trial('replaced', () => { fs.mkdirSync(root); fs.mkdirSync(`${root}/child`); });
R.check('B: a replacement root (new file key) ends the operation FAILED workspace_unavailable', B.w.json.status === 'failed' && B.w.json.failure_code === 'workspace_unavailable' && binding(B.s).rev === 1, `mid=${j(B.mid)} end=${B.w.json.status}/${B.w.json.failure_code} attempts=${B.end.attempts}`);
// put the original root back for the rest of the rig
fs.rmSync(root, { recursive: true });
fs.renameSync(`${root}.moved`, root);
R.done({});
