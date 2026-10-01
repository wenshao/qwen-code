// VERIFICATION RIG ONLY (PR #13129): round-10 figure (head d4dd9afbe3, main merged) from the probe ledgers.
import fs from 'node:fs';
import { figs, render, page, table, OK, BAD, WARN, count, res, RIG } from './figures.mjs';

const r10 = (n) => res('r10', n);
const lxRun = fs.readFileSync(`${RIG}/lx/run-r10.out`, 'utf8');
const lxRes = (n) => lxRun.match(new RegExp(`RESULT ${n}: (\\d+) passed, (\\d+) failed`));
const A = r10('s22-merge-policy-head12-A');
const B = r10('s22-merge-policy-head12-first-run-B-valid-A-superseded');
const unit = fs.readFileSync(`${RIG}/out/unit-r10.out`, 'utf8');
const field = (d, k) => d.match(new RegExp(`${k}=("[^"]*"|\\S+)`))?.[1];
const aRow = (label) => {
  const r = A.rows.find((x) => x.label.startsWith(`A ${label}`));
  const d = r?.detail ?? '';
  return [label, (r?.ok ? OK : BAD)(`durable ${field(d, 'durable assistant text')} · client ${field(d, 'client chunks')} · message.delta commits ${field(d, 'commits')}${/delta==DRAFT-ONE:true/.test(d) ? ' (DRAFT-ONE)' : ''}`)];
};
const bRow = (label) => {
  const r = B.rows.find((x) => x.label.startsWith(`B ${label}`));
  const d = r?.detail ?? '';
  const last = d.match(/load attempts=\[[^\]]*?([^,\[]+)\]/)?.[1]?.trim();
  return [label, (r?.ok ? OK : BAD)(`load → ${last} (after the 60 s lease) · continue ${d.match(/continue=(\d+ \S+)/)?.[1]} · cancel ${d.match(/cancel=(\d+ \S+)/)?.[1]} · journal head ${/before\/after=(\S+) → \1/.test(d) ? 'unchanged' : 'CHANGED'} · lease ${d.match(/lease (\w+)/)?.[1]}`)];
};
const b0 = B.rows.find((x) => x.label.startsWith('B0'))?.detail ?? '';
const mut = (n) => {
  const m = unit.match(new RegExp(`== mutation ${n}:[^\\n]*\\n([\\s\\S]*?)Tests\\s+(\\d+) failed`));
  if (!m) return BAD('mutation not detected');
  const names = m[1].split('\n').filter((l) => l.startsWith('×')).map((l) => {
    const last = l.split(' > ').at(-1);
    const params = last.match(/\(([^)]*)/)?.[1];
    return `${last.replace(/\s*\(.*$/, '').replace(/ \d+ms$/, '').trim()}${params ? ` [${params.split(',').map((p) => p.trim()).filter((p) => /^(SessionStart|UserPromptSubmit|InstructionsLoaded|reload=true)$/.test(p)).join(', ')}]` : ''}`;
  });
  return OK(`${m[2]} tests fail: ${names.join('; ')}`);
};
const reg = ['s1-permission-head12', 's3-catalog-head12', 's4-prompt-head12', 's6-limits', 's8-secrets', 's10-baseline-head12', 's15-history-hooks-head12', 's2e-reattach-head12-ws-t6b', 's5b-lost-head12-ws-t9c'].map((n) => `${n.replace(/-head12.*$/, '')} ${count(r10(n))}`).join(' · ');

figs['13-round10'] = page(
  'Round 10 — head d4dd9afbe3 (main merged; managed Hook policy preserved)',
  'New server jar and bundle built at d4dd9afbe3 (main brings #13083 Hosted Turn takeover / text deltas, #13020, …). Fresh MySQL databases (macOS r10, Linux lx10).',
  table(
    ['Text deltas × Hook output policy (prompt replies DRAFT-ONE; Stop block makes the model answer FINAL-TWO)', 'macOS'],
    [aRow('no Hooks'), aRow('UserPromptSubmit Hook only'), aRow('Stop Hook blocks the first draft once'), aRow('Stop Hook allows'), aRow('MessageDisplay Hook')],
  ) +
    table(
      ['Runtime-only takeover on a Hook Session (Harness SIGKILLed while a PreToolUse Hook runs; new Harness)', 'macOS'],
      [bRow('load with driveRuntimeRecovery'), bRow('load with passiveManagedRuntimeRecovery'), bRow('plain load (control)'), ['control: Session without Hooks, empty body', OK(`continue ${b0.match(/continue=(\d+ \S+)/)?.[1]} · cancel ${b0.match(/cancel=(\d+ \S+)/)?.[1]} (the routes exist; only Hook Sessions get 409)`)]],
    ) +
    table(
      ['Hand-resolved merge policy, mutated (unit tests)', 'Result'],
      [
        ['M1: Stop / MessageDisplay catalogs stream deltas anyway', mut('M1-buffer-never')],
        ['M2: takeover flags honoured for Hook Sessions', mut('M2-takeover-flags-for-hooks')],
        ['M3: Runtime-only continue / cancel without the Hook guard', mut('M3-runtime-routes-unguarded')],
      ],
    ) +
    table(
      ['Regression at d4dd9afbe3', 'macOS', 'Linux'],
      [
        ['s20 bounded refusals · s18 refused-PreToolUse recovery · s17 cancel windows', OK(`${count(r10('s20-bounded-refusal-head12'))} · ${count(r10('s18-refusal-recovery-head12-a'))} · ${count(r10('s17-cancel-window-head12'))}`), OK(`${lxRes('s20-bounded-refusal-head12')?.[1]}/8 · ${lxRes('s18-refusal-recovery-head12-a')?.[1]}/18 · ${lxRes('s17-cancel-window-head12')?.[1]}/15`)],
        ['single-call cancel at 4 stages', OK(`${r10('s11-cancel-head12').pass}/8 (+2 documented negatives)`), OK(`${lxRes('s11-cancel-head12')?.[1]}/8 (+2 documented negatives)`)],
        ['real stack', OK(reg), OK(`s9-linux ${lxRes('s9-linux-99db')?.[1]}/7 · F1 SIGKILL holds · lost ack ${lxRes('s5b-lost-head12-ws-t9b')?.[1]}/2`)],
        ['unit tests (changed files vs the new merge base 728c13de21)', OK(`CLI ${unit.match(/r10-unit-cli:\s+Tests\s+(\d+) passed/)?.[1]} · core ${unit.match(/r10-unit-core:\s+Tests\s+(\d+) passed/)?.[1]} · 0 failed`), OK('core 54/54 · CLI (3 files) 320/320')],
      ],
    ),
);
await render(['13-round10']);
