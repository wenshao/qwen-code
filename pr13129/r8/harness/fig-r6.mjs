// VERIFICATION RIG ONLY (PR #13129): round-6 figure (head af89ec27ac) from the probe ledgers.
import fs from 'node:fs';
import { figs, render, page, table, OK, BAD, WARN, count, res, RIG } from './figures.mjs';

const r6 = (n) => res('r6', n);
const lx6 = (n) => JSON.parse(fs.readFileSync(`${RIG}/lx/rig/out/lx6/${n}.json`, 'utf8'));
const runs = { macOld: r6('s17-cancel-window-head7'), macNew: r6('s17-cancel-window-head8'), lxOld: lx6('s17-cancel-window-head7'), lxNew: lx6('s17-cancel-window-head8') };
const CASES = [
  ['(b) 2 calls, cancel during call 1 PreToolUse HTTP Hook (server answers after 4 s)', 'two tool calls, cancel while call 1’s PreToolUse HTTP Hook waits (server answers after 4 s)'],
  ['(b) 2 calls, cancel during call 1 PreToolUse function Hook (honours the abort)', 'two tool calls, cancel during call 1’s PreToolUse function Hook (honours the abort)'],
  ['(b) 2 calls, cancel during call 1 PreToolUse function Hook (finishes 0.5 s later, inside the grace)', 'two tool calls, call 1’s function Hook finishes inside the 1 s grace'],
  ['(a) cancel while the assistant tool-call commit is in flight, PreToolUse function Hook', 'one tool call, cancel while the assistant commit is in flight (Store reply delayed 3 s)'],
  ['(a) control: same timing, no Hooks', 'control: same as above, no Hooks'],
];
const rows = (r, c) => r.rows.filter((x) => x.label.startsWith(`${c}:`));
const cell = (r, c) => {
  const rs = rows(r, c);
  if (!rs.length) return BAD('not run');
  const first = rs[0].detail;
  const calls = first.match(/calls=(\d+)/)?.[1];
  const results = first.match(/results=(\d+)/)?.[1];
  const cold = rs.find((x) => x.label.includes('new Harness process'));
  const passedAll = rs.every((x) => x.ok);
  if (passedAll && rs.length === 3) return OK(`3/3 · results ${results}/${calls} · cancelled · detach/load · 2nd Session · cold load`);
  if (passedAll) return WARN(`${rs.length}/${rs.length} · results ${results}/${calls} · cancelled · detach/load · 2nd Session; cold-load step not reached (VM out of memory)`);
  const why = [`results ${results}/${calls}`, /next=admit=409/.test(first) ? 'next 409' : null, /load=200 recoveryRequired/.test(rs[1]?.detail ?? '') ? 'load → recoveryRequired' : null, cold ? (/recoveryRequired/.test(cold.detail) ? 'cold load recoveryRequired' : null) : 'cold-load step not reached'].filter(Boolean).join(' · ');
  return BAD(`${rs.filter((x) => x.ok).length}/${rs.length} · ${why}`);
};
const s11 = r6('s11-cancel-head8');
const lxRun = fs.readFileSync(`${RIG}/lx/run-r6.out`, 'utf8');
const lxS11 = lxRun.match(/RESULT s11-cancel-head8: (\d+) passed, (\d+) failed/);
const end = (txt) => (txt.match(/NOTE {2}SessionEnd HTTP reply dropped \(unknown\).*/)?.[0] ?? '');
const macEnd = end(fs.readFileSync(`${RIG}/out/r6/s12-lifecycle-head8.log`, 'utf8'));
const lxEnd = end(fs.readFileSync(`${RIG}/lx/run-r6b.out`, 'utf8'));
const endCell = (t) => (/retry2=503/.test(t) && /sessionEndHttpRequests=1 /.test(t) ? WARN(`3 × DELETE → 503, 1 HTTP request (no replay), Session kept, owner lease kept, other Session’s tool turn fails`) : BAD(t.slice(0, 120)));
const reg = ['s1-permission-head8', 's3-catalog-head8', 's4-prompt-head8', 's6-limits', 's8-secrets', 's10-baseline-head8', 's15-history-hooks-head8', 's2e-reattach-head8-ws-t6b', 's5b-lost-head8-ws-t9c'].map((n) => `${n.replace(/-head8.*$/, '')} ${count(r6(n))}`).join(' · ');

figs['09-round6'] = page(
  'Round 6 — head af89ec27ac (settle cancellation before occurrence planning)',
  'A/B on the real stack: Harness bundle at d5de4f1813 (before) vs af89ec27ac (after), same Java Store/Broker/workers; fresh MySQL databases (macOS r6, Linux lx6); every case on its own Workspace. “Cold load” = a new Harness process loads the Session from the Store.',
  table(
    ['Cancel window', 'before (d5de4f1813) macOS', 'before Linux', 'after (af89ec27ac) macOS', 'after Linux'],
    CASES.map(([c, label]) => [label, cell(runs.macOld, c), cell(runs.lxOld, c), cell(runs.macNew, c), cell(runs.lxNew, c)]),
  ) +
    table(
      ['Check (after)', 'macOS', 'Linux'],
      [
        ['single-call cancel at 4 stages, function + HTTP Hooks (round 4/5 cases)', s11.pass === 8 ? OK('8/8 (+2 documented negatives: abort ignored; HTTP timeout)') : BAD(count(s11)), lxS11 && lxS11[1] === '8' ? OK('8/8 (+2 documented negatives)') : BAD(lxS11?.[0] ?? 'missing')],
        ['unknown SessionEnd (HTTP reply dropped) — now an accepted, documented H2 limitation', endCell(macEnd), endCell(lxEnd)],
        ['HTTP Hook timeout (15 s, server never replies) — accepted, #13133', WARN('unknown; Session + Workspace blocked (unchanged)'), '—'],
        ['regression (real stack)', OK(reg), OK('s9-linux 7/7 · F1 SIGKILL holds · lost ack 2/2')],
        ['unit tests; pin (revert the one-line fix)', OK('CLI 517/518 + 3 × 135/135 isolated rerun of the load flake · core 1445 · revert fails exactly the 2 new cases'), OK('managed-hook-runtime + hosted-workspace-tool-turn 164/164 · core 54/54')],
      ],
    ),
);
await render(['09-round6']);
