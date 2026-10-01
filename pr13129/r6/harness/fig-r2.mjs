// VERIFICATION RIG ONLY (PR #13129): round-2 figure (head 39de410325) from the probe ledgers.
import fs from 'node:fs';
import { figs, render, page, table, OK, BAD, WARN, passed, count, res, RIG } from './figures.mjs';

const r2 = (n) => res('r2', n);
const lx2 = (n) => JSON.parse(fs.readFileSync(`${RIG}/lx/rig/out/lx2/${n}.json`, 'utf8'));
const note = (r, label) => r.rows.find((x) => x.label.startsWith(label))?.detail ?? '';
const yes = (r, label, t) => (passed(r, label) ? OK(t) : BAD('still fails'));

const term = r2('s2b-lease-head4-ws-t9d-yes-SIGTERM');
const kill = r2('s2b-lease-head4-ws-t2-yes-SIGKILL');
const lxKill = lx2('s2b-lease-head4-ws-t1-yes-SIGKILL');
const ctl = r2('s2b-lease-head4-ws-base2-no-SIGTERM');
const re = r2('s2e-reattach-head4-ws-t6b');
const ack = r2('s5b-lost-head4-ws-t9c');
const lxAck = lx2('s5b-lost-head4-ws-t9b');
const cat = r2('s2f-catalog-only-head4-to-head4-ws-f1d');
const legacyRec = r2('s2b-lease-head3-to-head4-ws-f1c-yes-SIGTERM');
const legacyCat = r2('s2f-catalog-only-head3-to-head4-ws-f1b');
const s5 = r2('s5-lost-head4');
const f3 = (ws) => r2(`s9mac-refusal-${ws}-head4`);
const cap = r2('s7-scale-ws-cap-head4');
const after = r2('s7e-after-cap-head4');
const s9 = lx2('s9-linux-99db');
const capCsv = fs.readFileSync(`${RIG}/run/r2/s7-ws-cap.csv`, 'utf8').trim().split('\n').slice(1).map((l) => l.split(',').map(Number));
const at4615 = capCsv.find((r) => r[3] >= 4615);
const reg = ['s1-permission-head4', 's3-catalog-head4', 's4-prompt-head4', 's6-limits', 's8-secrets', 's10-baseline-head4'].map((n) => `${n.replace(/-head4$/, '')} ${count(r2(n))}`).join(' · ');
const f3row = (label, ws, fixed) => {
  const r = f3(ws);
  const ok = passed(r, 'after cancelling the blocked occurrence') && /turn_complete/.test(note(r, 'after cancelling the blocked occurrence'));
  return [label, BAD('blocked forever'), ok ? OK(`recovers (${count(r)})`) : fixed ? WARN('admitted, then the same unavailable Hook re-blocks the turn') : BAD('still blocked forever after cancel, detach+load')];
};

figs['05-round2'] = page(
  'Round 2 — head 39de410325 (ec96690bde + merge of main): what the fix commit changed',
  'Same rig, fresh databases: macOS MySQL 8.4.7 (r2) and Linux colima + delegated cgroup v2, MySQL 8.4.11 (lx2). Every row is a re-run of the round-1 probe.',
  table(
    ['Check', 'round 1 (8ffbbbb…99db)', 'round 2 (39de410325)'],
    [
      ['F1 · SIGTERM replacement → reloaded Session runs a tool turn; Workspace freed after detach', BAD('hosted_turn_failed; lease leaked'), yes(term, 'A turn after cold load', `completes; lease ${passed(term, 'a fresh no-hook') ? 'freed' : 'held'}`)],
      ['F1 · SIGKILL replacement (macOS / Linux)', BAD('leaked'), passed(kill, 'A turn after cold load') && passed(lxKill, 'A turn after cold load') ? OK('completes on both; Workspace freed') : BAD('fails')],
      ['F1 · detach → load → Hook turn ×3, DELETE', OK('6/6'), OK(count(re))],
      ['F1 · lost dispatch ack + cold reload → one effect, then a tool turn (macOS / Linux)', BAD('one effect ✔, next turn ✘'), passed(ack, '(d) the reconciled') && passed(lxAck, '(d) the reconciled') ? OK(`one call, one callback; next turn completes (${count(ack)} / ${count(lxAck)})`) : BAD('fails')],
      ['F1 · catalog-only acquisition (no execution record), SIGKILL, reload', '—', yes(cat, `head4: reloaded`, 'recovered (activation-derived owner)')],
      ['F1 · leak left by the 99db6e527e Harness (has an execution record), reloaded on the new head', '—', yes(legacyRec, 'A turn after cold load', 'recovered')],
      ['F1 · catalog-only leak left by 99db6e527e (random owner, no record)', '—', WARN(passed(legacyCat, 'head4: reloaded') ? 'recovered' : 'not recoverable — the documented compatibility limit')],
      ['F1 · attached idle Hook Session blocks other Sessions of the Workspace', BAD('blocks'), WARN(`${passed(term, 'B (no hooks') ? 'no longer blocks' : 'still blocks'} — tracked in #13133`)],
      ['F1 · unknown HTTP outcome: other Sessions of the Workspace', BAD('blocked'), WARN(`${passed(s5, '(b) another no-hook') ? 'usable' : 'still blocked'} — original-owner recovery by design (#13133)`)],
      f3row('F3 · UserPromptSubmit, missing handler revision, onceKey', 'ws-hvo', true),
      f3row('F3 · UserPromptSubmit, command without cgroup / missing handler (no onceKey)', 'ws-t8', true),
      f3row('F3 · SessionStart, missing handler revision', 'ws-hvs', false),
      f3row('F3 · PreToolUse, missing handler revision', 'ws-hvp', false),
      f3row('F3 · PreToolUse, command without cgroup delegation', 'ws-t8p', false),
      ['F4 · fail-open guard after 4096 receipts', BAD('bypassed: blocked-after.txt written'), passed(cap, 'guard after the quota') ? OK('blocks (“receipt capacity is exhausted”)') : BAD('bypassed')],
      ['F4 · ordinary guarded write after the cap; after a reload on a new Harness; fresh Session', '—', WARN(`blocked; ${/written=false/.test(note(after, 'guarded write after reload')) ? 'still blocked after reload (worker persists)' : 'writes after reload'}; fresh Session ${/written=true/.test(note(after, 'fresh Session')) ? 'writes' : 'blocked'}`)],
      ['F6 · Linux delegated cgroup v2 stack probe (argv secrecy)', OK('7/7 at 99db6e527e'), OK(`${count(s9)}`)],
      ['F2 · SELECT per 8-Hook operation at 4 615 records / cold load', '42 452 / 327 s at 5 421', WARN(`unchanged (${at4615?.[2]} at ${at4615?.[3]} records); cold load ${Math.round(parseInt(note(after, 'cold load'), 10) / 1000)} s at 4 792 under host load ~60 — tracked in #13132`)],
      ['F5 · PreToolUse deny reason', BAD('“No reason provided”'), WARN('unchanged — tracked in #13133')],
      ['regression on the real stack (macOS)', '—', OK(reg)],
    ],
  ),
);
await render(['05-round2']);
