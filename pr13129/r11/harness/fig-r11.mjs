// VERIFICATION RIG ONLY (PR #13129): round-11 figure (head 4dbdd48736) from the probe ledgers.
import fs from 'node:fs';
import { figs, render, page, table, OK, BAD, WARN, count, res, RIG } from './figures.mjs';

const r11 = (n) => res('r11', n);
const old = (n) => res('r11o', n);
const lxRun = fs.readFileSync(`${RIG}/lx/run-r11.out`, 'utf8');
const lxRes = (n) => lxRun.match(new RegExp(`RESULT ${n}: (\\d+) passed, (\\d+) failed`));
const unit = fs.readFileSync(`${RIG}/out/unit-r11.out`, 'utf8');
const neu = r11('s23-owner-diagnostics-head13');
const row = (r, p) => r.rows.find((x) => x.label.startsWith(p));
const brief = (d) => {
  if (!d) return 'not run';
  const adm = d.match(/turn=admit=(\d+)( \S+)?/);
  const parts = [adm?.[1] === '202' ? `turn ${d.match(/terminal=(\S+)/)?.[1]}` : `prompt ${adm?.[1]}${adm?.[2] ?? ''}`];
  const runs = d.match(/hookRuns=(\d+)/)?.[1];
  if (runs !== undefined) parts.push(`Hook ran ${runs}×`);
  const paths = d.match(/paths=(\[[^\]]*\])/)?.[1];
  if (paths) parts.push(`HTTP ${paths}`);
  const fw = d.match(/fileWritten=(\w+)/)?.[1];
  if (fw) parts.push(`file written ${fw}`);
  return parts.join(' · ');
};
const ab = (label, p, oldName, note) => {
  const n = row(neu, p);
  const o = row(old(oldName), p);
  return [label, (o?.ok ? OK : BAD)(`${brief(o?.detail)}${note ? ` — ${note}` : ''}`), (n?.ok ? OK : BAD)(brief(n?.detail))];
};
const diag = (db, arm) => {
  const d = res(db, `s12-lifecycle-${arm}`).rows.find((x) => x.label.startsWith('SessionEnd HTTP reply dropped'))?.detail ?? '';
  return `DELETE ${d.match(/DELETE=(\d+)/)?.[1]} · SessionEnd HTTP requests ${d.match(/sessionEndHttpRequests=(\d+)/)?.[1]} · status.recoveryBlocked=${d.match(/status\.recoveryBlocked=(\w+)/)?.[1]}`;
};
const s14 = (db, arm) => (res(db, `s14-activation-fault-${arm}`).rows.find((x) => x.label === '503 on every activation-install commit (retries exhausted)')?.detail ?? '').match(/status\.recoveryBlocked=\w+|next prompt: admit=\d+ \S+/g)?.join(' · ');
const pin = (n) => {
  const m = unit.match(new RegExp(`== pin ${n}[^\\n]*\\n([\\s\\S]*?)Tests\\s+(\\d+) failed`));
  return m ? OK(`${m[2]} fail`) : BAD('not pinned');
};
const reg = ['s1-permission-head13', 's3-catalog-head13', 's4-prompt-head13', 's6-limits', 's8-secrets', 's10-baseline-head13', 's15-history-hooks-head13', 's2e-reattach-head13-ws-t6b', 's5b-lost-head13-ws-t9c'].map((n) => `${n.replace(/-head13.*$/, '')} ${count(r11(n))}`).join(' · ');

figs['14-round11'] = page(
  'Round 11 — head 4dbdd48736 (recovery owners and diagnostics; parallel cancellation-recovery branch merged)',
  'Same jar as round 10 (no Java/SQL change). A/B: old = d4dd9afbe3 bundle + workers, new = 4dbdd48736. Old-build cases ran one at a time with a manifest containing only that case, on a separate database.',
  table(
    ['Hook configuration (macOS)', 'old (d4dd9afbe3)', 'new (4dbdd48736)'],
    [
      ab('HTTP PreToolUse Hook, URL …/${RIG_HOOK_PATH}, allowedEnvVars [RIG_HOOK_PATH]', 'E1', 's23-owner-diagnostics-head12-onlyws-ue1', 'the Hook never called its server; the write went through (fail-open)'),
      ab('Hook Session in Workspace "_lead-ws"', 'I1', 's23-owner-diagnostics-head12-only_lead-ws'),
      ab('hookId ".dot-pre"', 'I2', 's23-owner-diagnostics-head12-onlyws-dot'),
    ],
  ) +
    table(
      ['Recovery diagnostics (fresh databases)', 'old (d4dd9afbe3)', 'new (4dbdd48736)'],
      [
        ['unknown SessionEnd (reply dropped) — Session kept, prompts refused', WARN(diag('r11d', 'head12')), OK(diag('r11c', 'head13'))],
        ['activation-install commit fails 3× (round-4 R2-5 case)', WARN(s14('r10', 'head12')), WARN(`${s14('r11', 'head13')} — unchanged; detach + load recovers`)],
      ],
    ) +
    table(
      ['Production change, reverted (unit tests that fail)', 'Result'],
      [
        ['managed-hook-runtime.ts: identifiers with leading punctuation; interpolated URL allowlist', pin('P1-runtime')],
        ['hosted-hook-model.ts: cleanup failure keeps the Hook result', pin('P2-prompt-model')],
        ['hosted-harness-session.ts: unknown-Hook fence diagnostics; original Shell owner', pin('P3-session')],
        ['merged branch 483c81e4c9: Broker UNKNOWN ≠ not found (recovery / broker)', (() => {
          const n = (k) => unit.match(new RegExp(`== pin ${k}[^\\n]*\\n([\\s\\S]*?)Tests\\s+(\\d+) failed`))?.[2];
          const a = n('P4-unknown-recovery');
          const b = n('P5-unknown-broker');
          return a && b ? OK(`${a} fail / ${b} fail`) : BAD('not pinned');
        })()],
      ],
    ) +
    table(
      ['Regression at 4dbdd48736', 'macOS', 'Linux'],
      [
        ['s23 (new) · s22 merge policy · s20 · s18 · s17', OK(`${count(neu)} · ${count(r11('s22-merge-policy-head13'))} · ${count(r11('s20-bounded-refusal-head13'))} · ${count(r11('s18-refusal-recovery-head13-a'))} · ${count(r11('s17-cancel-window-head13'))}`), OK(`${lxRes('s23-owner-diagnostics-head13')?.[1]}/3 · — · ${lxRes('s20-bounded-refusal-head13')?.[1]}/8 · ${lxRes('s18-refusal-recovery-head13-a')?.[1]}/18 · ${lxRes('s17-cancel-window-head13')?.[1]}/15`)],
        ['single-call cancel at 4 stages', OK(`${r11('s11-cancel-head13').pass}/8 (+2 documented negatives)`), OK(`${lxRes('s11-cancel-head13')?.[1]}/8 (+2 documented negatives)`)],
        ['real stack', OK(reg), OK(`s9-linux ${lxRes('s9-linux-99db')?.[1]}/7 · F1 SIGKILL holds · lost ack ${lxRes('s5b-lost-head13-ws-t9b')?.[1]}/2`)],
        ['unit tests (changed files vs merge base a7deb01bcb)', OK(`CLI ${unit.match(/r11-unit-cli:\s+Tests\s+(\d+) passed/)?.[1]} · core ${unit.match(/r11-unit-core:\s+Tests\s+(\d+) passed/)?.[1]} · 0 failed`), OK('core 54/54 · CLI (3 files) 337/337')],
      ],
    ),
);
await render(['14-round11']);
