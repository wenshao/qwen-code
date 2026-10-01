// VERIFICATION RIG ONLY: round-3 evidence cards for PR #13110 at 560752cad0 / 80f8cfe3f5, built from the probe logs.
import fs from 'node:fs';
const OUT = '/rig/out';
const read = (f) => (fs.existsSync(`${OUT}/${f}`) ? fs.readFileSync(`${OUT}/${f}`, 'utf8').split('\n') : [`<missing ${f}>`]);
const cut = (s0, n = 172) => {
  const s = s0.replace(/\\+"/g, '"').replace(/\/rig\/run\/[a-z0-9]+\/ws\/[a-z0-9]+\/child\//g, '');
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
};
const H = (text) => ({ kind: 'HEAD', text });
const R2 = '263859b0', R3 = '560752ca';
const tagged = (l, prefix = '') => {
  const m = l.match(/^(PASS|FAIL|NOTE)\s+(.*?)(?:\s{2}->\s(.*))?$/);
  if (!m) return cut(prefix + l.trim());
  return { tag: m[1], kind: m[1], text: cut(prefix + m[2], 150), detail: m[3] ? cut(m[3].replace(/terminal=turn_error\[.*?\]/, 'terminal=turn_error').replace(/admit=202 /, ''), 166) : undefined };
};
const checks = (f, prefix = '') => read(f).filter((l) => /^(PASS|FAIL|NOTE)/.test(l)).map((l) => tagged(l, prefix));
const both = (name, label) => [H(label), ...checks(`fh3x/s15-${name}-head3.log`, `${R2}  `), ...checks(`fh4/s15-${name}-head4.log`, `${R3}  `)];
const real = (f) => {
  const r = read(f).find((l) => /^== RESULT (script|script2)\//.test(l)) ?? '';
  const m = r.match(/trials=(\d+) blocked=(\d+) finished=(\d+)/);
  return m ? `${m[3]} of ${m[1]} finish the task (${m[2]} blocked)` : '<missing>';
};

const rebase = {
  id: 'r3-01-rebaseline',
  title: `Round 3: drift is accepted at the next Write/Edit prompt (${R2} vs ${R3})`,
  subtitle: 'Scripted model, files profile unless noted, real MySQL 8.4.7 + Java Broker + packaged Harness and worker. "outside" = a change made directly on the Workspace volume between two prompts. The checks state the behaviour expected now; on 263859b0 they show the old behaviour.',
  sections: [
    { heading: 'files profile', lines: [...both('rebase-external-edit', 'P1 writes notes.txt; outside edit; P2 edits the new content; undo P2, then undo P1'), ...both('rebase-delete', 'P1 writes a.txt and b.txt; outside delete of b.txt; P2 edits a.txt'), ...both('rebase-mode', 'P1 edits tool.sh (644) and creates new.sh; outside chmod 755 on both; P2 edits both')] },
    { heading: 'Shell profile', lines: both('shell-same-and-next', 'P1: write_file run.sh -> chmod +x && ./run.sh -> edit run.sh (same prompt); P2: the same edit') },
    {
      heading: 'real model qwen3.8-max, Shell profile: "create hello.sh, make it executable, run it, then change Hello to Hi and run it again"',
      lines: [
        H('the whole task in one prompt'),
        `  main 310f4ba3   ${real('fhbase4/s8-script-base4.log')}`,
        `  ${R3}       ${real('fh4/s8-script-head4.log')}  (the edit after chmod is refused inside the same prompt; undo of the prompt then answers 409 conflict)`,
        H('the same task over two prompts (create + chmod + run, then change + run)'),
        `  main 310f4ba3   ${real('fhbase4/s8-script2-base4.log')}`,
        `  ${R3}       ${real('fh4/s8-script2-head4.log')}  (undo of prompt 2 -> 200, hello.sh says Hello again, mode stays 755)`,
      ],
    },
  ],
  footer: `On ${R3} a new Write/Edit prompt backs up the outside state and accepts it; undo of that prompt restores it exactly (content, deletion and mode), and older snapshots stay usable. Direct undo across drift and drift inside the same prompt are still refused, so a single-prompt "chmod, then edit" task still cannot finish.`,
};

const conseq = {
  id: 'r3-02-absorbed-drift',
  title: `Round 3: two consequences of absorbing every tracked file at a new prompt (${R2} vs ${R3})`,
  subtitle: 'Scripted model, files profile. The new prompt samples, backs up and re-checks every tracked file, not only the files it is about to change.',
  sections: [
    { heading: 'another Session edits a file this Session tracks, then this Session writes something else', lines: both('two-sessions-undo', 'Sessions A and B in one Workspace: A writes shared.txt=A1, B edits it to B1, A writes only other.txt; then A undo(A1), B undo(B1), A undo(A2)') },
    { heading: 'an outside change to a tracked file that the next prompt does not touch', lines: both('rebase-untouched-drift', 'P1 writes a.txt and b.txt; the user changes b.txt; P2 edits only a.txt; undo P2, undo P1, undo P2 again') },
    { heading: 'a tracked file that another process keeps writing', lines: both('busy-tracked-file', 'P1 writes log.txt and x.txt; a process appends to log.txt; every later prompt edits only x.txt') },
  ],
  footer: `On ${R2} these undos answered 409 conflict and the outside change stayed on disk. On ${R3} undo of an earlier prompt restores past an absorbed change without a conflict. The change is not lost (undo of the prompt that absorbed it brings it back), but in the two-Session case B's own undo then answers 409 and only A's history can restore B's edit. Edits to unrelated files are refused while any tracked file is being written, because a file that changes while it is sampled refuses the whole batch.`,
  footColor: '#d29922',
};

// crash matrix
const crashes = (f) => Object.fromEntries(read(f).filter((l) => l.startsWith('== CRASH ')).map((l) => JSON.parse(l.slice(9))).map((c) => [c.k, c]));
const head = crashes('fh4/crash-sweep.console');
const prev = crashes('fh3x-crash-sweep.console');
const main = crashes('fhbase4/crash-sweep.console');
const cell = (c) => {
  if (!c) return '—';
  const starts = Number(c.after.match(/starts=(\d+)/)?.[1]);
  const follow = Number(c.after.match(/model follow-ups=(\d+)/)?.[1]);
  if (c.outcome.startsWith('load=409')) return `blocked 409${c.after.includes('lease=free') ? '' : ', lease held'}`;
  if (/prompt=turn_complete blocked=false/.test(c.outcome)) return `completes${follow > 1 ? ', model asked again' : ''}${/undo=200 restored/.test(c.undo) ? ', undo ok' : ''}`;
  return c.outcome;
};
const ROWS = [
  [4, 4, 'assistant tool-call message'],
  [5, null, 'file history: pending marker'],
  [6, 5, 'tool intent'],
  [7, 6, 'checkpoint before dispatch'],
  ['start', 'start', '--- the tool starts on the worker ---'],
  [8, 7, 'tool result message'],
  [9, 8, 'checkpoint: results ready'],
  [10, null, 'file history: settle commit'],
  [11, 9, 'checkpoint'],
  [12, 10, 'final model message'],
  [13, 11, 'checkpoint'],
  [14, 12, 'settle turn'],
];
const pad = (s, n) => String(s).padEnd(n);
const matrix = [
  `${pad('Store commit held, then SIGKILL', 40)}${pad('main 310f4ba3', 30)}${pad(R2, 30)}${R3}`,
  ...ROWS.map(([k, mk, label]) => (k === 'start' ? { kind: 'HEAD', text: label } : `${pad(`#${k} ${label}`, 40)}${pad(mk ? cell(main[mk]) : 'n/a', 30)}${pad(cell(prev[k]), 30)}${cell(head[k])}`)),
];
const allStarts = [head, prev, main].flatMap((m) => Object.values(m)).map((c) => Number(c.after.match(/starts=(\d+)/)?.[1]));
const settle = {
  id: 'r3-03-crash-and-settle',
  title: `Round 3: a real Harness crash at every Store commit of a Write turn, and the settle path (${R3})`,
  subtitle: 'One write_file prompt. The k-th Store commit after submit is held (never reaches the Store), the Harness is killed with SIGKILL, a new Harness cold-loads the Session after the writer lease. Same scripted model and Workspace layout on all three arms.',
  sections: [
    { heading: `crash matrix (${allStarts.length} crashes; the tool started at most once in every one: max starts=${Math.max(...allStarts)})`, lines: matrix },
    {
      heading: `settle path on ${R3} (${R2} for comparison)`,
      lines: [
        ...both('snapshot-reply-lost', 'post-effect snapshot reply lost, then detach + load in the same Harness'),
        ...both('settle-store-503', 'Store 503 on the settle commit (no crash)'),
        ...both('settle-shell-kill', 'Shell profile: echo >> ran.log and write_file in one batch, SIGKILL in the settle window'),
        ...both('release-reply-lost', 'runtime release reply lost once (the case 80f8cfe3f5 realigned in the IT)'),
        H('runtime release request dropped every time'),
        ...checks('fh4/s15-release-request-lost-head4.log', `${R3}  `),
        H('mysqld killed (SIGKILL) together with the Harness in the settle window'),
        ...checks('fh4/s15-settle-mysql-kill-head4.log', `${R3}  `),
        H('every worker of the server killed together with the Harness in the settle window (expected: stays blocked)'),
        ...['fh3x/s15-settle-worker-lost-head3.log', 'fh4/s15-settle-worker-lost-head4.log'].map((f, i) => {
          const l = read(f).find((x) => x.startsWith('FAIL  cold load')) ?? '';
          const r = read(f).find((x) => /no replay/.test(x)) ?? '';
          return { tag: i ? R3 : R2, kind: i ? 'NOTE' : 'PASS', pad: 9, text: cut(l.replace(/^.*-> /, '').replace(/; earlier answers.*$/, ''), 120), detail: cut((i ? 'load error (debug build): Hosted tool turn requires recovery; its original work was not released.  ' : '') + r.replace(/^.*-> /, ''), 166) };
        }),
        ...both('reservation-conflict', 'injected 409 runtime_execution_conflict on /executions:prepare'),
        H(`a pending record written by ${R2} (no batch identity), loaded by ${R3}`),
        ...checks('fh4/s15-legacy-pending-head4.log', `${R3}  `),
      ],
    },
  ],
  footer: `A crash after the batch's results checkpoint now finishes the prompt from the saved results (tool not rerun, undo works); main and ${R2} leave the Session blocked at every point. Earlier crashes stay blocked on all three arms. A Store failure on the settle commit is recovered only by a new Harness process: in the same process detach answers 503 managed_session_close_failed, as on ${R2}.`,
};

const mut = read('mutation-r3-final.txt').filter((l) => /^[PM]\d+ /.test(l));
const short = (l) => cut('  ' + l.replace(/\s{2,}/g, '  ').replace(/ \(case-level recheck: .*?\)/, '').replace(/  <- .*$/, ''), 172);
const gates = {
  id: 'r3-04-gates-and-mutation',
  title: `Round 3: ITs on local MySQL 8.4.7, unit tests and mutation of the new code (${R3} / 80f8cfe3)`,
  subtitle: 'Mutation: 27 mutants of fee8f8763d plus 4 round-1 mutants whose code moved. Runs that failed only known load-sensitive tests were repeated and rechecked case by case against a 4-run baseline.',
  sections: [
    { heading: 'Hosted ITs (-Phosted-harness-mysql) on 80f8cfe3, one class per run where the shared run hit the fork timeout', lines: read('r3/it-summary.txt').filter(Boolean).map((l) => cut('  ' + l)) },
    { heading: 'unit tests', lines: read('r3/unit-summary.txt').filter(Boolean).map((l) => cut('  ' + l)) },
    { heading: `mutants: ${mut.filter((l) => / KILLED /.test(l.slice(0, 14))).length} killed, ${mut.filter((l) => / SURVIVED /.test(l.slice(0, 14))).length} survived of ${mut.length}`, lines: [H('killed'), ...mut.filter((l) => / KILLED /.test(l.slice(0, 14))).map(short), H('survived'), ...mut.filter((l) => / SURVIVED /.test(l.slice(0, 14))).map(short)] },
  ],
  footer: 'The rebaseline itself and the main recovery decisions are pinned. Not pinned: sampling every tracked file at a new prompt (P05, the source of both new behaviours), and most of the settle-eligibility guards (batch identity, checkpoint prompt, every item settled, only tool results after the batch, legacy pending, settle only while recovering).',
  footColor: '#d29922',
};
export const cards = [rebase, conseq, settle, gates];
