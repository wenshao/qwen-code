// VERIFICATION RIG ONLY (PR #13135): while a close of Session X is recovery_blocked (binding DRAINING), can a NEW Session
// on the same Workspace/storage run a file Turn? And can a new Session on another storage? (placement exclusion scope)
import { Report, createSession, waitTurn, ensureWorkspace, j, lxWs, bindingOf, sql } from './lib.mjs';
const [WS, ST, label, OTHER_WS = 'wsfree-p', OTHER_ST = 'p'] = process.argv.slice(2);
const rep = new Report(`s6-ws-after-block-${label}`);
ensureWorkspace(WS, `st-${ST}`);
const draining = sql(`SELECT b.isolation_key, b.binding_state FROM qwen_runtime_binding b JOIN managed_agent_session s ON s.session_id = b.isolation_key WHERE s.workspace_id='${WS}' AND b.binding_state='DRAINING'`);
rep.note('DRAINING bindings on this Workspace', j(draining));
const n = await createSession('public', WS, `G_FILES name=after-block.txt tag=${ST}x`);
const t = await waitTurn(n.session, { timeoutMs: 90_000 });
rep.note(`new Session on the SAME storage st-${ST}`, `admit=${n.status} turn=${t.status} ${t.error} ${t.ms}ms binding=${j(bindingOf(n.session))} file=${lxWs(ST, 'child/after-block.txt')}`);
rep.check('new Session on the same storage completes a file Turn', t.status === 'COMPLETED', `${t.status} ${t.error}`);
ensureWorkspace(OTHER_WS, `st-${OTHER_ST}`);
const o = await createSession('public', OTHER_WS, `G_FILES name=free.txt tag=${OTHER_ST}`);
const to = await waitTurn(o.session, { timeoutMs: 90_000 });
rep.check(`control: new Session on another storage st-${OTHER_ST} completes`, to.status === 'COMPLETED', `${to.status} ${to.error} ${to.ms}ms`);
rep.done({ same: n.session, other: o.session });
