// VERIFICATION RIG ONLY (PR #13129): round-3 figure (head 5ca4314690) from the probe ledgers.
import fs from 'node:fs';
import { figs, render, page, table, OK, BAD, WARN, passed, count, res, RIG } from './figures.mjs';

const r3 = (n) => res('r3', n);
const lx3 = (n) => JSON.parse(fs.readFileSync(`${RIG}/lx/rig/out/lx3/${n}.json`, 'utf8'));
const note = (r, label) => r.rows.find((x) => x.label.startsWith(label))?.detail ?? '';
const refusal = (ws) => r3(`s9mac-refusal-${ws}-head5`);
const recovered = (r) => passed(r, 'after cancelling the blocked occurrence') && /turn_complete/.test(note(r, 'after cancelling the blocked occurrence'));
const life = r3('s12-lifecycle-head5');
const lifeRow = (label) => note(life, label);
const cancel = r3('s11-cancel-head5');
const act5 = r3('s14-activation-fault-head5');
const act4 = r3('s14-activation-fault-head4');
const catGone = r3('s13-catalog-gone-head5');
const ctl = r3('s13b-worker-kill-control-head5');
const reg = ['s1-permission-head5', 's3-catalog-head5', 's4-prompt-head5', 's6-limits', 's8-secrets', 's10-baseline-head5'].map((n) => `${n.replace(/-head5$/, '')} ${count(r3(n))}`).join(' · ');
const f1 = r3('s2b-lease-head5-ws-t9d-yes-SIGTERM');
const lxKill = lx3('s2b-lease-head5-ws-t1-yes-SIGKILL');
const s9 = lx3('s9-linux-99db');
const ack = r3('s5b-lost-head5-ws-t9c');
const lxAck = lx3('s5b-lost-head5-ws-t9b');
const stages = ['UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop'];

figs['06-round3'] = page(
  'Round 3 — head 5ca4314690 (d0b1bb3482 + review fixes + merges of main)',
  'Fresh databases: macOS MySQL 8.4.7 (r3) and Linux colima + delegated cgroup v2, MySQL 8.4.11 (lx3). Rows marked NEW were not exercised in rounds 1–2.',
  table(
    ['Check', 'result at 5ca4314690'],
    [
      ['F3 · SessionStart refused before effect (missing handler revision / command without cgroup), then cancelled', recovered(refusal('ws-hvs')) && recovered(refusal('ws-t8s')) ? OK(`recovers — ${count(refusal('ws-hvs'))} and ${count(refusal('ws-t8s'))}, also after detach+load`) : BAD('still blocked')],
      ['F3 · PreToolUse refused before effect, then cancelled', recovered(refusal('ws-hvp')) ? OK('recovers') : WARN('still blocked forever — tracked in #13133')],
      ['NEW · user cancels the turn while a function Hook runs (UserPromptSubmit / PreToolUse / PostToolUse / Stop)', BAD(`${stages.filter((s) => !passed(cancel, s)).length}/4 stages: Hook recorded outcome_unknown → Session blocked forever (next prompt 409, detach 503, load 409); other Sessions of the Workspace hosted_turn_failed`)],
      ['… same cancel on a command Hook (Linux, delegated cgroup)', passed(s9, 'C: cancel drains') && passed(s9, 'C: Session accepts') ? OK('drains and settles; Session continues') : BAD('fails')],
      ['SessionDelete input (R1-2)', /matches/.test(lifeRow('SessionEnd succeeds')) ? OK('deleted_session_id matches the deleted Session; End → Delete once each') : BAD('missing')],
      ['DELETE with SessionEnd that throws / is refused before effect (R1-1, R2-3)', WARN(`throws: ${lifeRow('SessionEnd throws').match(/DELETE=\d+/)?.[0]} · refused: ${lifeRow('SessionEnd refused').match(/DELETE=\d+[^ ]* [^ ]*/)?.[0]}, then ${lifeRow('SessionEnd refused').match(/retry=\d+/)?.[0]}`)],
      ['DELETE with SessionEnd HTTP reply lost (unknown)', WARN(`DELETE 503 on every retry, Session stays, other Sessions blocked — unknown keeps its owner (#13133)`)],
      ['Activation install refused once by the Store (R2-5)', WARN(`previous head: prompts 503 even after the fault clears · now: prompts refused before admission (409), still refused after the fault clears, status.recoveryBlocked=false; detach+load recovers`)],
      ['R1-7 (definite Runtime refusal treated as unknown)', WARN(`not reproduced: replacing the worker fails on this rig even without Hooks (${note(ctl, 'turns 2 and 3').match(/runtime_[a-z_]+/)?.[0] ?? 'provision failed'} / placement recovery required) — pre-existing local-Broker limit`)],
      ['F1 · SIGTERM (macOS) / SIGKILL (Linux) replacement, then a tool turn; Workspace freed', passed(f1, 'A turn after cold load') && passed(lxKill, 'A turn after cold load') ? OK('completes on both; idle Session still blocks others (#13133)') : BAD('fails')],
      ['F1 · lost dispatch ack + cold reload (macOS / Linux)', passed(ack, '(d) the reconciled') && passed(lxAck, '(d) the reconciled') ? OK(`one call, one callback, next turn completes (${count(ack)} / ${count(lxAck)})`) : BAD('fails')],
      ['V27 migration', OK('fresh 27/27 on MySQL 8.4.7 and 8.4.11; upgrade from main (V26 tool-result projection) applies V27; a DB that ran the old PR V26 fails Flyway validation (unmerged builds only)')],
      ['F6 · Linux stack probe; cgroup unit tests', OK(`${count(s9)}; 11/11 and 21/21`)],
      ['regression on the real stack (macOS)', OK(reg)],
    ],
  ),
);
await render(['06-round3']);
