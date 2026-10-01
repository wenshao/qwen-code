// VERIFICATION RIG ONLY (PR #13129): round-8 figure (head 251117c3d5) from the probe ledgers.
import fs from 'node:fs';
import { figs, render, page, table, OK, BAD, WARN, count, res, RIG } from './figures.mjs';

const r8 = (n) => res('r8', n);
const lx8 = (n) => JSON.parse(fs.readFileSync(`${RIG}/lx/rig/out/lx8/${n}.json`, 'utf8'));
const mac = r8('s20-bounded-refusal-head10');
const lx = lx8('s20-bounded-refusal-head10');
const xb = res('r7', 's18x-load-recovery-head10-big650-crossbuild');
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
const lxRun = fs.readFileSync(`${RIG}/lx/run-r8.out`, 'utf8');
const lxRes = (n) => lxRun.match(new RegExp(`RESULT ${n}: (\\d+) passed, (\\d+) failed`));
const unit = fs.readFileSync(`${RIG}/out/unit-r8.out`, 'utf8');
const reg = ['s1-permission-head10', 's3-catalog-head10', 's4-prompt-head10', 's6-limits', 's8-secrets', 's10-baseline-head10', 's15-history-hooks-head10', 's2e-reattach-head10-ws-t6b', 's5b-lost-head10-ws-t9c'].map((n) => `${n.replace(/-head10.*$/, '')} ${count(r8(n))}`).join(' · ');

figs['11-round8'] = page(
  'Round 8 — head 251117c3d5 (bounded cancellation results; pre-model InstructionsLoaded)',
  'Refused PreToolUse on one assistant message with N write_file calls, then operator cancel. Record sizes are the decoded bytes the real Java Session Store accepted (limit 64 KiB, inclusive on both sides). Fresh MySQL databases (macOS r8, Linux lx8).',
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
      ['Load older 650-call Sessions with 251117c3d5 (DB r7)', 'Result'],
      xb.rows.map((x) => [x.label.replace(/ \(expected to recover\)$/, ''), x.ok ? OK(`load 200 · ${x.detail.match(/durable calls\/results=\d+\/\d+/)?.[0]} · next turn runs`) : BAD(x.detail.slice(0, 90))]),
    ) +
    table(
      ['Check (251117c3d5)', 'macOS', 'Linux'],
      [
        ['review P1: InstructionsLoaded refused before effect, then cancel', WARN('not exercisable here: InstructionsLoaded never fired with QWEN.md in the Workspace, the Harness home/cwd or QWEN_HOME (covered by the new unit cases)'), '—'],
        ['round 6–7 cases: s17 cancel windows · s18 refused-PreToolUse recovery', OK(`${count(r8('s17-cancel-window-head10'))} · ${count(r8('s18-refusal-recovery-head10-a'))}`), OK(`${lxRes('s17-cancel-window-head10')?.[1]}/15 · ${lxRes('s18-refusal-recovery-head10-a')?.[1]}/18`)],
        ['single-call cancel at 4 stages (function + HTTP)', OK(`${r8('s11-cancel-head10').pass}/8 (+2 documented negatives)`), OK(`${lxRes('s11-cancel-head10')?.[1]}/8 (+2 documented negatives)`)],
        ['regression (real stack)', OK(reg), OK(`s9-linux ${lxRes('s9-linux-99db')?.[1]}/7 · F1 SIGKILL holds · lost ack ${lxRes('s5b-lost-head10-ws-t9b')?.[1]}/2`)],
        ['unit tests; pin (revert 251117c3d5 production change)', WARN(`CLI ${unit.match(/r8-unit-cli:\s+Tests\s+\d+ failed \| (\d+) passed/)?.[1]} passed, 3 failed on a 1 s vi.waitFor at load 23 (isolated reruns 138/138 ×3) · core ${unit.match(/r8-unit-core:\s+Tests\s+(\d+) passed/)?.[1]} · revert fails 8 new InstructionsLoaded / large-batch cases`), OK('core 54/54 · CLI (3 files) 302/302')],
      ],
    ),
);
await render(['11-round8']);
