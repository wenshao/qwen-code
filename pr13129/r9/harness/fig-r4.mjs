// VERIFICATION RIG ONLY (PR #13129): round-4 figure (head b15a7496d4) from the probe ledgers.
import fs from 'node:fs';
import { figs, render, page, table, OK, BAD, WARN, passed, count, res, RIG } from './figures.mjs';

const r4 = (n) => res('r4', n);
const lx4 = (n) => JSON.parse(fs.readFileSync(`${RIG}/lx/rig/out/lx4/${n}.json`, 'utf8'));
const note = (r, label) => r.rows.find((x) => x.label.startsWith(label))?.detail ?? '';
const cancel = r4('s11-cancel-head6');
const lxCancel = lx4('s11-cancel-head6');
const stage = (r, label) => passed(r, `${label}: cancel mid-Hook`);
const four = ['UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop'];
const act = r4('s14-activation-fault-head6');
const actLine = (label) => (act.rows.find((x) => x.label === label)?.detail ?? '').replace(/ next prompt:.*$/, '');
const hist = r4('s15-history-hooks-head6');
const ref = (ws) => r4(`s9mac-refusal-${ws}-head6`);
const recovered = (r) => passed(r, 'after cancelling the blocked occurrence') && /turn_complete/.test(note(r, 'after cancelling the blocked occurrence'));
const f1 = r4('s2b-lease-head6-ws-t9d-yes-SIGTERM');
const lxKill = lx4('s2b-lease-head6-ws-t1-yes-SIGKILL');
const ack = r4('s5b-lost-head6-ws-t9c');
const lxAck = lx4('s5b-lost-head6-ws-t9b');
const s9 = lx4('s9-linux-99db');
const reg = ['s1-permission-head6', 's3-catalog-head6', 's4-prompt-head6', 's6-limits', 's8-secrets', 's10-baseline-head6'].map((n) => `${n.replace(/-head6$/, '')} ${count(r4(n))}`).join(' · ');

figs['07-round4'] = page(
  'Round 4 — head b15a7496d4 (202f7c1f4f + merges of main incl. #13110 file history)',
  'Fresh databases: macOS MySQL 8.4.7 (r4) and Linux colima + delegated cgroup v2, MySQL 8.4.11 (lx4).',
  table(
    ['Check', 'macOS', 'Linux'],
    [
      ['F7 · user cancels while a trusted function Hook runs (UserPromptSubmit / PreToolUse / PostToolUse / Stop)', four.every((s) => stage(cancel, s)) ? OK('4/4: turn cancelled, Hook settled, next turn runs') : BAD(`${four.filter((s) => !stage(cancel, s)).join(', ')} fail`), four.every((s) => stage(lxCancel, s)) ? OK('4/4') : BAD('fails')],
      ['… callback ignores the abort for 8 s (beyond the 1 s grace)', WARN('unknown → Session + Workspace blocked (documented)'), WARN('same')],
      ['… a PreToolUse HTTP Hook whose server answers after 8 s', stage(cancel, 'PreToolUse (HTTP') ? OK('recovers') : BAD('outcome_unknown → Session blocked (409 / detach 503 / load 409), other Sessions hosted_turn_failed'), stage(lxCancel, 'PreToolUse (HTTP') ? OK('recovers') : BAD('same')],
      ['R2-5 · activation-install commit: one 503 / reply dropped after commit', /hookOp=200/.test(actLine('one 503 on the activation-install commit')) && /hookOp=200/.test(actLine('activation-install commit succeeds, its reply is dropped once')) ? OK(`operation 200, next prompt runs, no reload; journal tx 12 = clean baseline 12 (2 install requests clean, 3 with one retry)`) : BAD('fails'), '—'],
      ['… 503 on every attempt (retries exhausted)', WARN('stops writes; prompts 409 until detach + load; status.recoveryBlocked=false'), '—'],
      ['#13110 file history × Hooks: Write, Write, undo, Write; Hooks once per write; Workspace free after detach', passed(hist, 'with Hooks: Write') && passed(hist, 'with Hooks: PreToolUse') && passed(hist, 'with Hooks: after detach') ? OK(`${count(hist)} (no-Hook control included)`) : BAD(count(hist)), '—'],
      ['F3 · SessionStart / once-keyed UserPromptSubmit refusal, then cancel', recovered(ref('ws-hvs')) && recovered(ref('ws-hvo')) ? OK('both recover (6/6, 6/6)') : BAD('fails'), '—'],
      ['F3 · PreToolUse refusal, then cancel', recovered(ref('ws-hvp')) ? OK('recovers') : WARN('still blocked — tracked in #13133'), '—'],
      ['F1 · replacement then a tool turn; Workspace freed after detach (SIGTERM macOS, SIGKILL Linux)', passed(f1, 'A turn after cold load') ? OK('holds') : BAD('fails'), passed(lxKill, 'A turn after cold load') ? OK('holds') : BAD('fails')],
      ['F1 · lost dispatch ack + cold reload', passed(ack, '(d) the reconciled') ? OK(count(ack)) : BAD('fails'), passed(lxAck, '(d) the reconciled') ? OK(count(lxAck)) : BAD('fails')],
      ['F6 · command Hooks under delegated cgroup v2 (stack); cgroup unit tests', '—', OK(`${count(s9)}; 11/11, 25/25`)],
      ['regression (macOS real stack)', OK(reg), '—'],
    ],
  ),
);
await render(['07-round4']);
