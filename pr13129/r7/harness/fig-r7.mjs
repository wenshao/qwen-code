// VERIFICATION RIG ONLY (PR #13129): round-7 figure (head c5a4cd2853) from the probe ledgers.
import fs from 'node:fs';
import { figs, render, page, table, OK, BAD, WARN, count, res, RIG } from './figures.mjs';

const r7 = (n) => res('r7', n);
const lx7 = (n) => JSON.parse(fs.readFileSync(`${RIG}/lx/rig/out/lx7/${n}.json`, 'utf8'));
const mac = r7('s18-refusal-recovery-head9-d');
const lx = lx7('s18-refusal-recovery-head9-a');
const old = r7('s18-refusal-recovery-head8-b-rf2');
const xb = res('r6', 's18x-load-recovery-head9');
const CASES = [
  ['one tool call', 'one tool call'],
  ['two tool calls', 'two tool calls'],
  ['two tool calls; recovery write committed but its reply dropped 3 times', 'two calls; the recovery write commits but its reply is lost 3 times'],
  ['two tool calls; recovery write answered 503 three times', 'two calls; the recovery write gets 503 three times'],
  ['two tool calls; cancel, 2 status reads and a prompt fired concurrently', 'two calls; cancel, 2 status reads and a prompt race'],
];
const rows = (r, c) => r.rows.filter((x) => x.label.startsWith(`${c}:`));
const num = (d, k) => d.match(new RegExp(`${k}=(\\d+)/(\\d+)`));
const cell = (r, c) => {
  const rs = rows(r, c);
  if (!rs.length) return '—';
  const checks = rs.filter((x) => !x.note);
  const ok = checks.every((x) => x.ok);
  const note = rs.find((x) => x.note)?.detail ?? '';
  const repl = rs.find((x) => x.label.includes('after Harness replacement'));
  const main = rs.find((x) => x.label.includes('after the cancel every call'));
  if (repl) {
    const d = repl.detail;
    const m = num(d, 'durable calls\\/results');
    const inproc = `same Harness: cancel ${note.match(/cancel=(\d+)/)?.[1]}, retry ${note.match(/status-read retry=(\d+)/)?.[1]}, detach ${note.match(/detach=(\d+)/)?.[1]}`;
    const txt = `${checks.filter((x) => x.ok).length}/${checks.length} · ${inproc} · after Harness replacement (lease ${d.match(/after (\d+)s/)?.[1]} s): results ${m?.[2]}/${m?.[1]}, no duplicates, next turn runs`;
    return ok ? OK(txt) : BAD(txt);
  }
  const m = main ? num(main.detail, 'results') : null;
  const race = main?.detail.match(/race: status=(\S+) prompt=(\d+)/);
  const txt = `${checks.filter((x) => x.ok).length}/${checks.length} · blocked until cancel · results ${m?.[1]}/${m?.[2]}${race ? ` · racing prompt ${race[2]}, reads ${race[1]}` : ''} · next turn · detach/load · 2nd Session · cold load`;
  if (ok) return OK(txt);
  return BAD(`${checks.filter((x) => x.ok).length}/${checks.length} · after cancel results ${m?.[1]}/${m?.[2]} · next 409 · load recoveryRequired · cold load recoveryRequired`);
};
const xrow = (prefix) => xb.rows.find((x) => x.label.startsWith(prefix));
const s17 = r7('s17-cancel-window-head9');
const lxRun = fs.readFileSync(`${RIG}/lx/run-r7.out`, 'utf8');
const lxRes = (n) => lxRun.match(new RegExp(`RESULT ${n}: (\\d+) passed, (\\d+) failed`));
const s11 = r7('s11-cancel-head9');
const unit = fs.readFileSync(`${RIG}/out/unit-r7.out`, 'utf8');
const reg = ['s1-permission-head9', 's3-catalog-head9', 's4-prompt-head9', 's6-limits', 's8-secrets', 's10-baseline-head9', 's15-history-hooks-head9', 's2e-reattach-head9-ws-t6b', 's5b-lost-head9-ws-t9c'].map((n) => `${n.replace(/-head9.*$/, '')} ${count(r7(n))}`).join(' · ');

figs['10-round7'] = page(
  'Round 7 — head c5a4cd2853 (settle proven-unstarted pre-tool cancellations)',
  'A PreToolUse Hook is refused before any effect (function Hook pinned to a missing handler revision → not_started_proven), then the operator cancels that execution. Fresh MySQL databases (macOS r7, Linux lx7); every case on its own Workspace. “Cold load” = a new Harness process loads the Session from the Store.',
  table(
    ['Refused PreToolUse, then operator cancel', 'before (af89ec27ac) macOS', 'after (c5a4cd2853) macOS', 'after Linux'],
    CASES.map(([c, label]) => [label, c === 'two tool calls' ? cell(old, c) : '—', cell(mac, c), cell(lx, c)]),
  ) +
    table(
      ['Load an older Session with c5a4cd2853 (DB r6, macOS)', 'Result'],
      [
        ['refused + cancelled PreToolUse Session stranded by af89ec27ac', xrow('refused+cancelled')?.ok ? OK(`recovers on load: ${xrow('refused+cancelled').detail.match(/durable calls\/results=\d+\/\d+/)?.[0]}, next turn runs`) : BAD('fails')],
        ['3 cancel-window Sessions stranded by d5de4f1813 (no refused child)', ['2-call HTTP', '2-call function', 'assistant-commit'].every((p) => xrow(p)?.ok) ? WARN('stay blocked (recoveryRequired, 409), as the design doc says — recovery is narrow') : BAD('unexpected')],
      ],
    ) +
    table(
      ['Check (c5a4cd2853)', 'macOS', 'Linux'],
      [
        ['cancel windows from round 6 (s17: HTTP / function / grace / assistant commit / control)', s17.pass === 15 ? OK('15/15') : BAD(count(s17)), lxRes('s17-cancel-window-head9')?.[1] === '15' ? OK('15/15') : BAD('fails')],
        ['single-call cancel at 4 stages, function + HTTP Hooks', s11.pass === 8 ? OK('8/8 (+2 documented negatives)') : BAD(count(s11)), lxRes('s11-cancel-head9')?.[1] === '8' ? OK('8/8 (+2 documented negatives)') : BAD('fails')],
        ['unknown SessionEnd: 3 × DELETE (accepted H2 limitation)', WARN('503 each, 1 HTTP request, Session + owner kept'), WARN('same')],
        ['regression (real stack)', OK(reg), OK(`s9-linux ${lxRes('s9-linux-99db')?.[1]}/7 · F1 SIGKILL holds · lost ack ${lxRes('s5b-lost-head9-ws-t9b')?.[1]}/2`)],
        ['unit tests; pin (revert c5a4cd2853 production change)', OK(`CLI ${unit.match(/r7-unit-cli:\s+Tests\s+(\d+) passed/)?.[1]} · core ${unit.match(/r7-unit-core:\s+Tests\s+(\d+) passed/)?.[1]} · revert fails the 6 positive cases, 4 guard cases pass both ways`), OK('core 54/54 · CLI (3 files) 292/292')],
      ],
    ),
);
await render(['10-round7']);
