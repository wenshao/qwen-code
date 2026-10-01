// VERIFICATION RIG ONLY (PR #13129): round-9 figure (head 433f9d358e) from the probe ledgers.
import fs from 'node:fs';
import { figs, render, page, table, OK, BAD, WARN, count, res, RIG } from './figures.mjs';

const r8 = (n) => res('r9', n);
const lx8 = (n) => JSON.parse(fs.readFileSync(`${RIG}/lx/rig/out/lx9/${n}.json`, 'utf8'));
const mac = r8('s20-bounded-refusal-head11');
const lx = lx8('s20-bounded-refusal-head11');
const xb = res('r7', 's18x-load-recovery-head10-big650-crossbuild');
const g = (n) => res('r9', `s21-bigid-guard-${n}`).rows[0].detail;
const gcell = (d) => {
  const first = d.match(/first turn=(admit=\d+ terminal=[^ ]+)/)?.[1] ?? '';
  const err = d.match(/harness error=(Error: [^.]+\.)/)?.[1];
  const next = d.match(/\| next=(admit=\d+[^ ]* terminal=[^ ]+)/)?.[1] ?? d.match(/next=(admit=\d+ \S+)/)?.[1];
  const load = d.match(/load=(\d+(?: recoveryRequired)?)/)?.[1];
  const stuck = /recoveryRequired/.test(load ?? '') || /admit=409/.test(next ?? '');
  const txt = `first turn ${first.replace(/\[.*$/, '')}${err ? ` (${err.replace('Error: ', '')})` : ''} · next ${next?.replace(/\[.*$/, '')} · load ${load}`;
  const safe = txt.replace(/<none>/g, 'none (blocked)');
  return stuck ? BAD(safe) : OK(safe);
};
const row = (r, prefix) => r.rows.filter((x) => x.label.startsWith(prefix));
const writes = (d) => d.match(/recovery writes=\d+ \[([^\]]*)\]/)?.[1].replace(/\/200/g, '').replace(/ refusals/g, ' refusals') ?? '';
const cleanCell = (r, n) => {
  const rs = row(r, `${n} write_file calls:`);
  const d = rs[0]?.detail ?? '';
  const ok = rs.length === 2 && rs.every((x) => x.ok);
  const txt = `${rs.filter((x) => x.ok).length}/${rs.length} · records ${writes(d)} · ${d.match(/unique=(\d+)/)?.[1]}/${n} unique · chain ok · cold load identical`;
  return ok ? OK(txt) : BAD(txt);
};
const faultCell = (r, label) => {
  const rs = row(r, `650 write_file calls; ${label}`);
  const note = rs.find((x) => x.note)?.detail ?? '';
  const chk = rs.find((x) => !x.note);
  const fill = chk?.detail.match(/fill writes=(\d+)/)?.[1];
  const txt = `same Harness: ${note.match(/responses=(\d+)/)?.[1]} visible, cancel ${note.match(/cancel=(\d+)/)?.[1]}, detach ${note.match(/detach=(\d+)/)?.[1]} · after replacement: ${fill} fill write${fill === '1' ? '' : 's'}, ${chk?.detail.match(/unique=(\d+)/)?.[1]}/650 unique`;
  return chk?.ok ? OK(txt) : BAD(txt);
};
const lxRun = fs.readFileSync(`${RIG}/lx/run-r9.out`, 'utf8');
const lxRes = (n) => lxRun.match(new RegExp(`RESULT ${n}: (\\d+) passed, (\\d+) failed`));
const unit = fs.readFileSync(`${RIG}/out/unit-r9.out`, 'utf8');
const reg = ['s1-permission-head11', 's3-catalog-head11', 's4-prompt-head11', 's6-limits', 's8-secrets', 's10-baseline-head11', 's15-history-hooks-head11', 's2e-reattach-head11-ws-t6b', 's5b-lost-head11-ws-t9c'].map((n) => `${n.replace(/-head11.*$/, '')} ${count(r8(n))}`).join(' · ');

figs['12-round9'] = page(
  'Round 9 — head 433f9d358e (251117c3d5 merged with the parallel fix 90609cee0b)',
  'Refused PreToolUse on one assistant message with N write_file calls, then operator cancel. Record sizes are the decoded bytes the real Java Session Store accepted (limit 64 KiB, inclusive on both sides). Fresh MySQL databases (macOS r9, Linux lx9).',
  table(
    ['Case', 'macOS', 'Linux'],
    [
      ['505 calls (one record)', cleanCell(mac, 505), cleanCell(lx, 505)],
      ['510 calls (just over one record)', cleanCell(mac, 510), cleanCell(lx, 510)],
      ['650 calls (reviewer’s case)', cleanCell(mac, 650), cleanCell(lx, 650)],
      ['650; second record 503 ×3', faultCell(mac, 'second record answered 503'), faultCell(lx, 'second record answered 503')],
      ['650; second record committed, reply lost ×3', faultCell(mac, 'second record committed'), faultCell(lx, 'second record committed')],
    ],
  ) +
    table(
      ['Load older 650-call Sessions with the 251117c3d5 recovery code (DB r7; unchanged in the merge)', 'Result'],
      xb.rows.map((x) => [x.label.replace(/ \(expected to recover\)$/, ''), x.ok ? OK(`load 200 · ${x.detail.match(/durable calls\/results=\d+\/\d+/)?.[0]} · next turn runs`) : BAD(x.detail.slice(0, 90))]),
    ) +
    table(
      ['Merge guard: one write_file call with a very long id, refused PreToolUse catalog (macOS r9)', '251117c3d5', '433f9d358e'],
      [
        ['id 64,700 (assistant record 65,204 B; fits)', gcell(g('head10-ws-bid3-64700')), gcell(g('head11-ws-bid4-64700'))],
        ['id 65,010 (assistant record fits, the call’s cancellation record would not)', gcell(g('head10-ws-bid5-65010')), gcell(g('head11-ws-bid7-65010'))],
      ],
    ) +
    table(
      ['Check (433f9d358e)', 'macOS', 'Linux'],
      [
        ['review P1: InstructionsLoaded refused before effect, then cancel', WARN('not exercisable here: InstructionsLoaded never fired with QWEN.md in the Workspace, the Harness home/cwd or QWEN_HOME (covered by the new unit cases)'), '—'],
        ['round 6–7 cases: s17 cancel windows · s18 refused-PreToolUse recovery', OK(`${count(r8('s17-cancel-window-head11'))} · ${count(r8('s18-refusal-recovery-head11-a'))}`), OK(`${lxRes('s17-cancel-window-head11')?.[1]}/15 · ${lxRes('s18-refusal-recovery-head11-a')?.[1]}/18`)],
        ['single-call cancel at 4 stages (function + HTTP)', OK(`${r8('s11-cancel-head11').pass}/8 (+2 documented negatives)`), OK(`${lxRes('s11-cancel-head11')?.[1]}/8 (+2 documented negatives)`)],
        ['regression (real stack)', OK(reg), OK(`s9-linux ${lxRes('s9-linux-99db')?.[1]}/7 · F1 SIGKILL holds · lost ack ${lxRes('s5b-lost-head11-ws-t9b')?.[1]}/2`)],
        ['unit tests; pin', OK(`CLI ${unit.match(/r9-unit-cli:\s+Tests\s+(\d+) passed/)?.[1]} · core ${unit.match(/r9-unit-core:\s+Tests\s+(\d+) passed/)?.[1]} · reverting the 251117c3d5 recovery change fails its 8 new cases; reverting the merge guard fails 1 (oversized cancellation record)`), OK('core 54/54 · CLI (3 files) 303/303')],
      ],
    ),
);
await render(['12-round9']);
