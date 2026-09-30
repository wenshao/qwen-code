// VERIFICATION RIG ONLY: round-2 evidence cards for PR #13110 at 263859b004, built from the probe logs.
import fs from 'node:fs';
const OUT = '/rig/out';
const read = (f) => (fs.existsSync(`${OUT}/${f}`) ? fs.readFileSync(`${OUT}/${f}`, 'utf8').split('\n') : [`<missing ${f}>`]);
const grep = (f, re) => read(f).filter((l) => re.test(l));
const first = (f, re) => grep(f, re)[0] ?? `<no match ${re} in ${f}>`;
const cut = (s0, n = 172) => {
  const s = s0.replace(/\\+"/g, '"').replace(/\/rig\/run\/[a-z0-9]+\/ws\//g, '<ws>/');
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
};
const tagged = (l) => {
  const m = l.match(/^(PASS|FAIL|NOTE)\s+(.*?)(?:\s{2}->\s(.*))?$/);
  return m ? { tag: m[1], kind: m[1], text: cut(m[2], 150), detail: m[3] ? cut(m[3].replace(/terminal=turn_error\[.*?\]/, 'terminal=turn_error'), 160) : undefined } : cut(l.trim());
};
const H = (text) => ({ kind: 'HEAD', text });
const R1 = 'fbafd241', R2 = '263859b0';
const res = (db, arm, s) => {
  const l = first(`${db}/s4-${s}-${arm}.log`, /^== RESULT [a-z-]+\//);
  try {
    return JSON.parse(l.slice(l.indexOf('{')));
  } catch {
    return null;
  }
};
const cell = (r) => (!r ? 'n/a' : r.blocked ? 'BLOCKED, lease held, load ' + r.load : 'completes, lease free, load ' + r.load);
const seenBy = (db, arm, s) => {
  const l = grep(`${db}/s4-${s}-${arm}.log`, /^\s+result (edit|write_file): /).map((x) => x.trim().replace(/^result /, ''));
  return l.length ? cut(l[/^shell-/.test(s) ? l.length - 1 : 0], 150) : '';
};
const SCEN = [
  ['external-edit', 'files   P1 write notes.txt; the user edits it; P2 edit notes.txt'],
  ['directory-path', 'files   write_file file_path="src" (a directory), then the corrected path'],
  ['parent-is-file', 'files   write_file "notes.txt/child.txt", then the corrected path'],
  ['symlink', 'files   edit AGENTS.md, a symlink to CLAUDE.md inside the Workspace'],
  ['two-sessions', 'files   Session A writes shared.txt, Session B writes it, A edits it again'],
  ['shell-chmod', 'shell   write_file run.sh -> "chmod +x run.sh && ./run.sh" -> edit run.sh'],
  ['shell-format', 'shell   write_file data.json -> a Shell command rewrites it -> read_file -> edit'],
];
const block = (f, from = 1, to = -1) => read(f).slice(from, to).filter(Boolean).map((l) => (/^(PASS|NOTE|FAIL)/.test(l) ? tagged(l) : cut(l.trim().replace(/terminal=turn_error\[.*?\]/, 'terminal=turn_error'), 172)));

const f1 = {
  id: 'r2-01-f1-f4-status',
  title: `Round 2: the first report's F1, F3 and F4 on ${R1} (round 1) and ${R2} (now)`,
  subtitle: 'Same scripted model, same files, real MySQL 8.4.7, packaged Harness + worker + real Java Broker. "load" is detach + load of the Session afterwards.',
  sections: [
    {
      heading: 'F1: a definite refusal before dispatch',
      lines: SCEN.flatMap(([s, label]) => [H(label), { tag: R1, kind: 'FAIL', pad: 9, text: cell(res('fh2', 'head2', s)) }, { tag: R2, kind: 'PASS', pad: 9, text: cell(res('fh3', 'head3', s)), detail: 'model saw: ' + seenBy('fh3', 'head3', s) }]),
    },
    {
      heading: `F3 and F4 on ${R2}`,
      lines: [
        H('undo with a missing backup (bind refused after acquire)'),
        ...block('fh3/s2-undo-refusal-lease.log', 1, 9),
        H('undo while another Session of the Workspace runs a Shell command'),
        ...block('fh3/s2-undo-busy.log', 1, 8),
        H('backup directory gone; the next prompt only reads another file'),
        ...grep('fh3/s6-volume-lost-head3.log', /read-only|recoveryBlocked=|detach|put back/).map((l) => (/^(PASS|NOTE)/.test(l) ? tagged(l) : cut(l.trim().replace(/terminal=turn_error\[.*?\]/, 'terminal=turn_error'), 172))),
        H(`rollout order: ${R2} Harness against a main ${'afb911a3'} Broker and worker`),
        ...read(`fhbase3/s12-skew-harness-head3-server-base3.log`).slice(1, 5).map((l) => cut(l.trim().replace(/terminal=turn_error\[.*?\]/, 'terminal=turn_error'), 172)),
      ],
    },
  ],
  footer: `On ${R2} every definite refusal is answered as a tool error or a failed turn, the Workspace lease is released, and detach + load works. Ambiguous failures still block (see the step-4 rows, unchanged).`,
};

const real = {
  id: 'r2-02-shell-profile-real-model',
  title: `Round 2, Shell profile: the Session survives, but the task can no longer be finished (${R2})`,
  subtitle: 'Real model qwen3.8-max, "create hello.sh, make it executable and run it, then change Hello to Hi and run it again", fresh Workspace and Session per trial.',
  sections: [
    { heading: `${R2}: 5 of 5 turns complete, 0 of 5 finish the task, undo then answers conflict`, lines: read('fh3/s8-script-head3.log').filter((l) => /^trial|task finished|undo:|== RESULT script/.test(l)).map((l) => (/^trial/.test(l) ? H(cut(l)) : cut(l))) },
    { heading: 'what the model answered (first 170 characters of three trials)', lines: read('fh3/s8-script-head3-final-answers.txt').filter(Boolean).slice(0, 3).map((l) => cut(l.replace(/^\S+ \S+: /, '  '), 172)) },
    { heading: `main ${'afb911a3'}: 3 of 3 complete`, lines: read('fhbase3/s8-script-base3.console').filter((l) => /^trial|task finished|== RESULT script/.test(l)).map((l) => (/^trial/.test(l) ? H(cut(l)) : cut(l))) },
    {
      heading: 'which Shell side effect triggers it (scripted model): only the mode change',
      lines: [
        ...grep('fh3/s4-shell-touch-head3.log', /write_file run.sh|edit result|undo of/).map((l) => cut(`${R2} ` + l.trim(), 172)),
        ...grep('fh3/s4-shell-chmod-only-head3.log', /write_file run.sh|edit result|undo of/).map((l) => cut(`${R2} ` + l.trim(), 172)),
        ...grep('fhbase3/s4-shell-chmod-only-base3.log', /write_file run.sh|edit result/).map((l) => cut('main ' + l.trim(), 172)),
      ],
    },
  ],
  footer: 'The fingerprint of a tracked file includes its mode, so the agent\'s own chmod +x counts as "changed outside tracked mutations". Every later Write/Edit of that file is refused for the rest of the Session, and undo of that prompt answers conflict. The model reads the refusal as a policy denial and stops rather than edit through the Shell. mtime-only changes (touch) are accepted.',
  footColor: '#d29922',
};

const cap = {
  id: 'r2-03-capacity-and-new-fixes',
  title: `Round 2: capacity refusals, the new repairs, cold load and durability (${R2})`,
  subtitle: 'One files-profile Session per capacity row: prompt 1 edits N files, every later prompt edits one of them.',
  sections: [
    {
      heading: 'record capacity: the same bounds as round 1, now refused as a tool error',
      lines: [10, 20, 40].flatMap((n) => grep(`fh3/s5-record-${n}.log`, /mutating prompt|model saw|record sizes/).map((l) => cut(`${String(n).padStart(2)} files  ` + l.trim().replace(/\\"/g, '"'), 172))),
    },
    { heading: '1 tracked file, prompt 101', lines: grep('fh3/s5-snapshots.log', /mutating prompt 101|Session recoveryBlocked|detach/).map((l) => cut(l.trim())) },
    { heading: 'undo receipts at capacity (40 files, 5 prompts, then undo back and forth)', lines: grep('fh3/s5-receipts-40.log', /tracked files, |undo #[1-6] /).map((l) => cut(l.trim().replace(/; src\/components.*$/, ''), 172)) },
    { heading: 'files named after Object.prototype members, across cold binding', lines: block('fh3/s14-special-names-head3.log', 1, -1).filter((x) => typeof x === 'object') },
    { heading: 'undo retried with the released requestId', lines: block('fh3/s14-undo-retry-after-release-head3.log', 1, -1).filter((x) => typeof x === 'object') },
    { heading: 'backup directory unreadable for a moment (chmod 000), then readable', lines: block('fh3/s14-transient-backup-access-head3.log', 1, -1).filter((x) => typeof x === 'object') },
    { heading: 'tracked file becomes read-only or unreadable before undo', lines: block('fh3/s14-readonly-drift-head3.log', 1, -1).filter((x) => typeof x === 'object') },
    { heading: "main's W1a cold load (no tool profile) with file history", lines: block('fh3/s14-w1a-cold-load-head3.log', 1, -1).filter((x) => typeof x === 'object') },
    {
      heading: 'durability (as in round 1)',
      lines: ['harness-kill', 'mysql-restart', 'mysql-kill'].map((s) => cut('  ' + first(`fh3/s6-${s}-head3.log`, /== RESULT/).replace('== RESULT ', ''), 172)),
    },
  ],
  footer: 'Capacity is unchanged (5 / 11 / 22 mutating prompts for 40 / 20 / 10 tracked files, 100 snapshots for one file), but reaching it now leaves the Session usable: Write/Edit get a tool error, undo gets 409 before any runtime is acquired. The repairs listed in the author\'s comment hold on the real stack.',
};

export const cards = [f1, real, cap];

// ---- gates and mutation --------------------------------------------------------------------------------------------
const mfinal = read('mutation-r2-final.txt').filter((l) => /^(M|N|C)\d+ /.test(l));
const killed = mfinal.filter((l) => / KILLED /.test(l.slice(0, 14))), survived = mfinal.filter((l) => / SURVIVED /.test(l.slice(0, 14)));
const short = (l) => cut('  ' + l.replace(/^(\S+) (KILLED|SURVIVED)\s+/, '$1 ').replace(/\s{2,}/g, '  ').replace(/ \(recheck: .*\)$/, '').replace(/  <- .*$/, ''), 172);
const gates = {
  id: 'r2-04-gates-and-mutation',
  title: `Round 2: Hosted IT profile on local MySQL 8.4.7 and mutation of the old survivors and the new code (${R2})`,
  subtitle: 'Mutation: round-1 survivors plus 20 mutants of the new fixes. Kills that involved a test which also fails unmutated on this host were rechecked alone (case-level for the parametrized undo test).',
  sections: [
    { heading: 'Hosted IT profile (-Phosted-harness-mysql), one database', lines: read('r2/it-head3-hosted-all.summary.txt').filter(Boolean).map((l) => cut('  ' + l)) },
    { heading: `mutants: ${killed.length} killed, ${survived.length} survived of ${mfinal.length}`, lines: [H('killed'), ...killed.map(short), H('survived'), ...survived.map(short)] },
  ],
  footer: 'The two IT failures are not from this PR: W1a\'s HostedWorkspaceConcurrencyIT requires Linux when run on MySQL, and ManagedAgentMySqlIT needs a fresh database (15/15 alone). Six round-1 survivors are now pinned (pending undo before effects, partial restore, failed undo blocks, denied calls not prepared, drift after preparation, states refreshed after restore). Of the new code, the capacity preflight call in the tool turn (N01) and the 1 KiB reserve (N07) are not pinned by any unit test.',
  footColor: '#d29922',
};
cards.push(gates);
