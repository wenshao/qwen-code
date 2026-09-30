// VERIFICATION RIG ONLY: evidence cards for PR #13110, built from the probe logs (no hand-typed results).
import fs from 'node:fs';
const OUT = '/rig/out';
const read = (f) => (fs.existsSync(`${OUT}/${f}`) ? fs.readFileSync(`${OUT}/${f}`, 'utf8').replaceAll('<server account QWEN_HOME>/../worker-home/.qwen', '$QWEN_HOME of the server account').split('\n') : [`<missing ${f}>`]);
const grep = (f, re) => read(f).filter((l) => re.test(l));
const first = (f, re) => grep(f, re)[0] ?? `<no match ${re} in ${f}>`;
const cut = (s, n = 168) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
const tagged = (l) => {
  const m = l.match(/^(PASS|FAIL|NOTE)\s+(.*?)(?:\s{2}->\s(.*))?$/);
  return m ? { tag: m[1], kind: m[1], text: cut(m[2], 150), detail: m[3] ? cut(m[3], 160) : undefined } : cut(l.trim());
};
const H = (text) => ({ kind: 'HEAD', text });
const HEADSHA = 'fbafd241';
const BASESHA = '7827a3ff';

// ---- 02: refusal family ------------------------------------------------------------------------------------------
const SCEN = [
  ['external-edit', 'files   P1 write notes.txt; the user edits it in an editor; P2 edit notes.txt'],
  ['directory-path', 'files   write_file file_path="src" (a directory), then the corrected path'],
  ['parent-is-file', 'files   write_file "notes.txt/child.txt", then the corrected path'],
  ['symlink', 'files   edit AGENTS.md, a symlink to CLAUDE.md inside the Workspace'],
  ['two-sessions', 'files   Session A writes shared.txt, Session B writes it, A edits it again'],
  ['shell-chmod', 'shell   write_file run.sh -> run_shell_command "chmod +x run.sh && ./run.sh" -> edit run.sh'],
  ['shell-format', 'shell   write_file data.json -> a Shell command rewrites it -> read_file -> edit'],
];
const res = (db, arm, s) => {
  const l = first(`${db}/s4-${s}-${arm}.log`, /^== RESULT [a-z-]+\//);
  try {
    return JSON.parse(l.slice(l.indexOf('{')));
  } catch {
    return null;
  }
};
const cell = (r) => (!r ? 'n/a' : r.blocked ? `BLOCKED, lease held, load ${r.load}` : `completes, lease free, load ${r.load}`);
const seenBy = (db, arm, s) => {
  const l = grep(`${db}/s4-${s}-${arm}.log`, /^\s+result (edit|write_file): /).map((x) => x.trim().replace(/^result /, ''));
  return l.length ? cut(l[s === 'shell-chmod' || s === 'shell-format' ? l.length - 1 : 0], 150) : '(no tool result: the turn stopped before dispatch)';
};
const refusal = {
  id: '03-refusal-brick-ab',
  title: `A definite, pre-dispatch history refusal ends the Session and wedges its Workspace (head ${HEADSHA})`,
  subtitle: `Same scripted model and same files on three arms: main ${BASESHA} · PR head ${HEADSHA} · PR head + candidate patch (Harness only, worker unchanged). Real MySQL 8.4.7, packaged CLI, real Java Broker.`,
  sections: [
    {
      heading: 'Outcome of the prompt under test (Session state · Workspace execution lease · detach+load)',
      lines: SCEN.flatMap(([s, label]) => [
        H(label),
        { tag: 'main', kind: 'PASS', pad: 9, text: cell(res('fhbase', 'base', s)) },
        { tag: 'PR head', kind: 'FAIL', pad: 9, text: cell(res('fh2', 'head2', s)) + (res('fh2', 'head2', s)?.sibling === 'turn_error' ? '; another Session of the Workspace: turn_error' : '') },
        { tag: 'candidate', kind: 'NOTE', pad: 9, text: cell(res('fhcand2', 'cand2', s)), detail: 'model saw: ' + seenBy('fhcand2', 'cand2', s) },
      ]),
    },
    {
      heading: 'PR head, first row in full',
      lines: read('fh2/s4-external-edit-head2.log').slice(1, 11).map((l) => cut(l.replace(/^\s\s/, '').replace(/POST \/tool-sessions(\/<id>)?/g, '').replace(/terminal=turn_error\[.*?\]/, 'terminal=turn_error(hosted_turn_failed)'), 172)),
    },
  ],
  footer:
    'On the PR head the worker answers "prepare" with a definite 409 before anything is dispatched, yet the turn becomes recovery-blocked: no terminal event, the next prompt and detach+load are refused, and the Workspace lease stays with the blocked prompt, so every other Session of that Workspace fails too. main completes all seven.',
  footColor: '#f85149',
};

// ---- 03: real model ----------------------------------------------------------------------------------------------
const realLines = (f) =>
  read(f)
    .filter((l) => /^trial \d|BLOCKED after|task finished|undo:|== RESULT script/.test(l))
    .map((l) => cut(l.replace(/terminal=turn_error\[.*?\]/, 'terminal=turn_error'), 170));
const real = {
  id: '04-real-model-shell-profile',
  title: 'Real model (qwen3.8-max), Shell profile: write a script, chmod +x and run it, then change it',
  subtitle:
    'Prompt: "create hello.sh that prints Hello, <name>! … make it executable and run it with World … then change the greeting from Hello to Hi and run it again". No scripted replies; one fresh Workspace and Session per trial. Arms: head2 = PR head, base = main, cand2 = PR head + candidate.',
  sections: [
    { heading: `PR head ${HEADSHA}: 5 of 5 trials end recovery-blocked at the edit that follows chmod`, lines: realLines('fh2/s8-script-head2.log').map((l) => (/^trial/.test(l) ? H(l) : l)) },
    { heading: 'tool calls of trial 1 on the PR head', lines: grep('fh2/s8-script-head2.log', /tool calls:/).slice(0, 1).flatMap((l) => l.replace(/^\s+tool calls: /, '').split(' → ').map((c) => '  ' + cut(c, 165))) },
    { heading: `main ${BASESHA}: 3 of 3 complete`, lines: realLines('fhbase/s8-script-base.console').map((l) => (/^trial/.test(l) ? H(l) : l)) },
    { heading: 'PR head + candidate: 5 of 5 complete (the refused edit is a tool error; the model falls back to Shell), undo then reports a conflict', lines: realLines('fhcand2/s8-script-cand2.log').map((l) => (/^trial/.test(l) ? H(l) : l)) },
  ],
  footer:
    'chmod changes the mode of a file the prompt already tracks, so the next Write/Edit of that file is refused as "changed outside tracked mutations". On the PR head that refusal blocks the Session and keeps the Workspace lease (5/5 here, 6/6 on the first head 32dc814d). Files-profile control: "change the port and add a README" completed 2/2 and undo restored both files.',
  footColor: '#f85149',
};

// ---- 04: record budget -------------------------------------------------------------------------------------------
const rec = (n) => {
  const f = `fh2/s5-record-${n}.log`;
  const sizes = first(f, /record sizes by prompt/).replace(/.*: /, '').split(', ').map(Number);
  return { n, prompts: sizes.length, first: sizes[0], last: sizes.at(-1), growth: Math.round((sizes.at(-1) - sizes[0]) / (sizes.length - 1)), sizes };
};
const R10 = rec(10), R20 = rec(20), R40 = rec(40);
const budget = {
  id: '05-history-record-budget',
  title: `The history record grows by about 270 B × tracked files per mutating prompt and is capped at 64 KiB inline (head ${HEADSHA})`,
  subtitle: 'One files-profile Session per row: P1 edits N files, every later prompt edits one of them. Record size is byte_length of the managed-file_history resource in MySQL.',
  sections: [
    {
      heading: 'Mutating prompts a Session can run before the next Write/Edit blocks it',
      lines: [
        '  tracked files   record after P1   growth / prompt   last stored record   mutating prompts that fit   what prompt N+1 gets',
        ...[R10, R20, R40].map((r) => `  ${String(r.n).padStart(13)}   ${String(r.first).padStart(14)} B   ${String(r.growth).padStart(13)} B   ${String(r.last).padStart(16)} B   ${String(r.prompts).padStart(25)}   recovery-blocked, Workspace lease held`),
        `  ${'1'.padStart(13)}   ${first('fh2/s5-snapshots.log', /after 1 mutating/).match(/record=(\d+)/)[1].padStart(14)} B   ${'~446'.padStart(13)} B   ${first('fh2/s5-snapshots.log', /after 100 mutating/).match(/record=(\d+)/)[1].padStart(16)} B   ${'100 (snapshot bound)'.padStart(25)}   recovery-blocked, Workspace lease held`,
      ],
    },
    { heading: '40 tracked files, prompt 6', lines: grep('fh2/s5-record-40.log', /record sizes|first refused|harness stderr|recoveryBlocked=|detach/).map((l) => cut(l.trim(), 172)) },
    { heading: '1 tracked file, prompt 101', lines: grep('fh2/s5-snapshots.log', /100 mutating prompts are|read-only prompt|prompt 101|harness stderr|wire|recoveryBlocked=|detach/).map(tagged) },
    {
      heading: 'Undo receipts share the same record: 40 tracked files, 5 prompts (58.4 KB), then undo back and forth',
      lines: grep('fh2/s5-receipts-40.log', /tracked files, |undo #|after the refused|harness stderr|detach/).map((l) => cut(l.trim().replace(/; src\/components.*$/, ''), 172)),
    },
    {
      heading: 'PR head + candidate, 40 tracked files',
      lines: [
        ...grep('fhcand2/s5-record-40.log', /mutating prompt|model saw|prompt 6 starts/).map((l) => (/^(PASS|FAIL)/.test(l) ? tagged(l) : cut(l.trim().replace(/\\"/g, '"'), 172))),
        ...grep('fhcand2/s5-snapshots.console', /^\s+(mutating prompt 101|Session recoveryBlocked|detach)/).map((l) => cut('1 tracked file, ' + l.trim(), 172)),
        '  (an earlier run kept going: prompts 6..100 all completed with that tool error and the record stayed at 58,421 B)',
      ],
    },
  ],
  footer:
    'Every snapshot lists every tracked file, and each commit stores the snapshots twice (state.snapshots and record.systemPayload.snapshots). With 40 tracked files a Session is over at its 6th mutating prompt; with one file, at its 101st. In MySQL the largest record holds the same 5 snapshots under both keys (27.6 KB each of 64.7 KB). The fifth undo in the receipts block restored all 40 files on disk and then could not store its receipt: pendingUndo stays, the Session and the Workspace are blocked.',
  footColor: '#f85149',
};

// ---- 05: undo refusals and lost volume ---------------------------------------------------------------------------
const undo = {
  id: '06-undo-refusal-and-lost-backups',
  title: `Refused undo and lost backups: what is left behind (head ${HEADSHA} vs candidate)`,
  subtitle: 'Backups live on the worker: <QWEN_HOME of the server account>/file-history/<Harness Session id>/<hash>@vN. The Session Store only keeps the snapshot index and the expected digests.',
  sections: [
    { heading: 'PR head: a backup file is missing, undo is refused after its runtime was acquired', lines: read('fh2/s2-undo-refusal-lease.log').slice(1, 9).map((l) => (/^(PASS|NOTE|FAIL)/.test(l) ? tagged(l.replace(/terminal=turn_error\[.*?\]/, 'terminal=turn_error')) : cut(l.trim(), 172))) },
    { heading: 'PR head + candidate: same scenario', lines: read('fhcand2/s2-undo-refusal-lease.log').slice(1, 9).map((l) => (/^(PASS|NOTE|FAIL)/.test(l) ? tagged(l.replace(/terminal=turn_error\[.*?\]/, 'terminal=turn_error')) : cut(l.trim(), 172))) },
    { heading: 'PR head: undo while another Session of the Workspace is running a Shell command', lines: read('fh2/s2-undo-busy.log').slice(1, 8).map((l) => (/^(PASS|NOTE|FAIL)/.test(l) ? tagged(l) : cut(l.trim(), 172))) },
    { heading: 'PR head + candidate: same scenario', lines: read('fhcand2/s2-undo-busy.log').slice(1, 8).map((l) => (/^(PASS|NOTE|FAIL)/.test(l) ? tagged(l) : cut(l.trim(), 172))) },
    { heading: 'PR head: the backup directory of the Session is gone (ephemeral disk / another host); next prompt only READS an unrelated file', lines: read('fh2/s6-volume-lost-head2.log').slice(1, 12).map((l) => (/^(PASS|NOTE|FAIL)/.test(l) ? tagged(l) : cut(l.trim().replace(/terminal=turn_error\[.*?\]/, 'terminal=turn_error'), 172))) },
    { heading: 'PR head + candidate: same scenario', lines: read('fhcand2/s6-volume-lost-cand2.log').slice(1, 12).map((l) => (/^(PASS|NOTE|FAIL)/.test(l) ? tagged(l) : cut(l.trim().replace(/terminal=turn_error\[.*?\]/, 'terminal=turn_error'), 172))) },
  ],
  footer:
    'No unbacked mutation starts in any of these (the fail-closed claim holds). The cost on the PR head: a refused undo keeps the Workspace lease under its requestId with nothing pending anywhere, so after detach+load the Session looks healthy while every tool turn of every Session of that Workspace fails; and once a backup is missing, the next tool turn of any kind blocks the Session for good, even after the backups are put back.',
  footColor: '#d29922',
};


// ---- 01: reviewer test plan --------------------------------------------------------------------------------------
const s1 = read('fh2/s1-testplan-head2.log');
const s1pick = s1.filter((l) => /^PASS|^FAIL/.test(l) && /\[x2\]|decoy|other Workspace/.test(l)).map(tagged);
const wire = (first('fh2/s1-testplan-head2.log', /wire:/).replace(/^\s+wire: /, '').split(' | ').map((x) => x.replace('/tool-sessions', '').replace('/<id>', '').replace('/executions', ' exec'))).join(' → ');
const step = (f, re = /^(PASS|FAIL)/) => grep(f, re).map(tagged);
const plan = {
  id: '01-test-plan-steps-1-3',
  title: `Reviewer test plan on a real stack: MySQL 8.4.7, packaged Harness + worker, real Java Broker (head ${HEADSHA})`,
  subtitle: 'The author\'s E2E used H2 in MySQL mode. Here every step runs against mysqld 8.4.7 with a scripted model; backups are read back from the worker volume and compared byte for byte.',
  sections: [
    { heading: 'Steps 1–3: two Workspaces with the same relative names (one shown; the other is identical) — ' + first('fh2/s1-testplan-head2.log', /== RESULT/).replace('== RESULT ', ''), lines: [...s1pick, '', cut('wire, one prompt with two batches: ' + wire, 400).replace(/(.{150,170}) → /g, '$1 →\n      ')] },
    { heading: `Same script on main ${BASESHA}: the files change, nothing is backed up, no history or undo route — ` + first('fhbase/s1-testplan-base.log', /== RESULT/).replace('== RESULT ', ''), lines: grep('fhbase/s1-testplan-base.log', /\[b\] base:/).map(tagged) },
  ],
  footer: 'Steps 1–3 hold on real MySQL: one snapshot per prompt that keeps the first preimage, this Workspace\'s own bytes on the worker volume, exact bytes and mode restored, the created file removed, an external edit refused as a conflict with nothing touched, and receipts replayed without a second restoration.',
};
const plan2 = {
  id: '02-test-plan-steps-4-5',
  title: `Reviewer test plan, steps 4–5 and undo semantics on real MySQL 8.4.7 (head ${HEADSHA})`,
  subtitle: 'Faults are injected with a proxy between Harness and Broker (dropped replies) or Harness and Session Store (503), or by removing a backup file from the worker volume.',
  sections: [
    { heading: 'Step 4: missing backups, failed preparation, tool errors, cancellation, unknown effects, incomplete undo', lines: ['cold-missing-backup', 'store-fail-prepare', 'tool-error', 'cancel', 'unknown-snapshot', 'undo-rewind-reply-lost', 'undo-release-reply-lost'].flatMap((f) => step(`fh2/s2-${f}.log`)) },
    { heading: 'Step 5 and undo semantics', lines: [...step('fh2/s3-profiles-head2.log', /^(PASS|FAIL|NOTE)/), ...step('fh2/s7-shell-profile.log'), ...step('fh2/s7-multi-prompt.log', /^(PASS|FAIL|NOTE)/), ...step('fh2/s7-bytes.log', /^(PASS|FAIL|NOTE)/), ...step('fh2/s2-admission.log').slice(0, 9).map((x) => (typeof x === 'object' ? { ...x, text: x.text + (x.detail ? '  (' + x.detail + ')' : ''), detail: undefined } : x))] },
  ],
  footer: 'No mutation starts without a durable backup record; known tool errors and cancellation keep their observed changes and can be undone; unknown effects and unfinished undo stay blocked across reload. rewind(X) means "return to the state at the start of prompt X": later prompts are undone with it, and a later target moves forward again.',
};

// ---- 06: durability ----------------------------------------------------------------------------------------------
const noUptime = (l) => l.replace(/ uptime=Uptimes/, '');
const dur = {
  id: '07-durability-and-rollout',
  title: `What the author's run did not cover: database restart and crash, Harness crash, rollout order, shared core change (head ${HEADSHA})`,
  subtitle: 'MySQL 8.4.7 is stopped or SIGKILLed between the Write and the undo; the Harness is SIGKILLed without detach and a new process cold-loads the Session after the 60 s writer lease.',
  sections: [
    { heading: 'mysqld stopped and restarted between Write and undo', lines: read('fh2/s6-mysql-restart-head2.log').slice(1, -2).map(noUptime).map((l) => (/^(PASS|NOTE|FAIL)/.test(l) ? tagged(l) : cut(l.trim()))) },
    { heading: 'mysqld SIGKILLed between Write and undo', lines: read('fh2/s6-mysql-kill-head2.log').slice(1, -2).map(noUptime).map((l) => (/^(PASS|NOTE|FAIL)/.test(l) ? tagged(l) : cut(l.trim()))) },
    { heading: 'Harness SIGKILLed, cold load in a new Harness process', lines: read('fh2/s6-harness-kill-head2.log').slice(1, -2).map((l) => (/^(PASS|NOTE|FAIL)/.test(l) ? tagged(l) : cut(l.trim()))) },
    { heading: 'Rollout order: Harness and server (Broker + worker) on different builds', lines: [...read('fhbase/s12-skew-harness-head2-server-base.log').slice(1, 5), ...read('fh2/s12-skew-harness-base-server-head2.log').slice(1, 4)].map((l) => cut(l.trimEnd(), 172)) },
    { heading: 'Shared core change (checkOriginFileChanged compares bytes, no mtime shortcut), compiled core of each arm', lines: [...read('s11-core-base.log'), ...read('s11-core-head.log')].filter(Boolean).map((l) => cut(l, 172)) },
  ],
  footer: 'History and undo survive a database restart, a database crash and a Harness crash. A Harness upgraded before the server blocks every files/Shell Session at its first tool turn (the old Broker answers the bind with 400), so the server has to be rolled out first. The core change fixes two wrong restorations that main still has; an unchanged snapshot now reads every tracked file and its backup once per prompt.',
};

// ---- 08: gates, CI, mutation -------------------------------------------------------------------------------------
const mfinal = read('mutation-final.txt').filter((l) => /^(M|C)\d+ /.test(l));
const killed = mfinal.filter((l) => / KILLED /.test(l)), survived = mfinal.filter((l) => / SURVIVED /.test(l));
const gates = {
  id: '08-gates-and-mutation',
  title: `Fault gates on local MySQL 8.4.7 and mutation of the PR's production hunks (head ${HEADSHA})`,
  subtitle: 'Gates: the CI step "-Phosted-harness-mysql … verify" narrowed to the two classes that were red on 32dc814d. Mutation: one change at a time against the PR\'s focused vitest files and the core file-history tests; every Harness-side kill was confirmed with the killing test alone, twice.',
  sections: [
    { heading: 'HostedWorkspaceToolTurnIT + HostedProcessCrashIT', lines: [H('first head 32dc814d (CI red, reproduced locally)'), ...read('round1-32dc814d/it-head-gates.summary.txt').filter(Boolean).slice(0, 8).map((l) => cut('  ' + l)), H(`current head ${HEADSHA}`), ...read('it-head2-gates.summary.txt').filter(Boolean).slice(0, 4).map((l) => cut('  ' + l))] },
    { heading: `TypeScript + core mutants: ${killed.length} killed, ${survived.length} survived of ${mfinal.length}`, lines: [H('survived'), ...survived.map((l) => cut('  ' + l.replace(/ SURVIVED /, ' ').replace(/\s{2,}/g, '  '), 172)), H('killed'), ...killed.map((l) => cut('  ' + l.replace(/ KILLED +/, ' ').replace(/ \(confirmed.*\)$/, '').replace(/\s{2,}/g, '  '), 172))] },
    { heading: 'Java mutants (runtime-broker unit suite, 539 tests)', lines: read('mut-java.log').filter((l) => /^J\d/.test(l)).map((l) => cut('  ' + l.replace(/ Tests run:.*?Skipped: \d+/, '').replace(/com\.alibaba\.qwen\.code\.runtimebroker\./, '').replace(/rc=1/, 'KILLED  ').replace(/rc=0/, 'SURVIVED'), 172)) },
  ],
  footer: 'The five gate failures of the first head are gone on the current head. The surviving mutants are branches that no focused test pins: several back statements of the design (pending undo record before effects, partial restore blocks, denied calls are not prepared, the 100-snapshot bound, refusal when a file changes after preparation).',
  footColor: '#d29922',
};

export const cards = [plan, plan2, refusal, real, budget, undo, dur, gates];
