import fs from 'node:fs';
const tbl = (W, rows) => rows.map(([p, a]) => p + a.slice(0, -1).map((x, i) => x.padEnd(W[i])).join('') + a.at(-1));
const c1 = {
  name: 'r12-01-status',
  title: 'Round 12 @ af423eb7 on the macOS rig: R5-1 fixed in its window, one earlier sibling still blocks O2, regression clean',
  subtitle: 'PR head as-is (e13b415b bot merge of main #12868 + af423eb7 R5-1); rebuilt bundle and jars for e13b415b and af423eb7; fresh MySQL 8.4.7 schemas; OSS double; fault proxy; JVM forward proxy on Broker -> worker',
  lines: [
    '## Fixed on this head',
    '++ R5-1  ownership lost between publication install and executeV3: before, execution UNKNOWN, Session blocked, load 409;',
    '++        now not_started ("Runtime Shell did not start."), tool.receipt, reload and next turn OK; no /v3/execute reached the worker',
    '',
    '## New (low)',
    '!! R12-1 ownership refused by installPublication itself (lease changed before :start): O2 :start 409 workspace_busy -> Session',
    '!!       blocked, load 409, on both e13b415b and af423eb7; the local path now returns "refused before dispatch" and continues',
    '',
    '## Still holding after the bot merge',
    '== R9-1 correctable arguments | R2-5 unstarted receipt | R2-6 raw ESC | preview + UTF-8 tail same as round 10 | gate 2',
    '== R6-2  80 past O2 Shell calls: 816 Store requests, 0 ACKs, 0 warnings',
    '',
    '## Regression (all pass)',
    '== O2     echo 2/2 | 100 MiB + 5 MiB exit 7 exact | 1 GiB exact | crash after receipt | lost segment | lost admission reply',
    '==        control chars + crash | reload + second turn | ACK request lost | mixed 2 O2 + 2 local x 64 MiB: 4/4, 0 deadlocks',
    "== local  echo 2/2 | 100 MiB + 5 MiB exit 7 | reload + second turn | author's six-Workspace driver 2/2",
    '== real qwen3.8-max failing 3,000-line build: O2 4/4, local 2/2 with the error quoted',
    '',
    '## Still open (deferred by the author)',
    '!! gate 1 (load 409 for 151 s) | R7-1 #12957 (still reproduces) | #12969 | F3 | B2/B4 | #12986 | #13019 | lone surrogates #13010',
  ],
  note: 'Mutants on af423eb7: 2 of 2 killed (the transport throwing the refusal again; the Broker ignoring a settled not_started answer). The Linux rounds 10-11 posted by the parallel run cover the bot merge; this round adds the R5-1 A/B.',
  noteColor: '#3fb950',
};
const W2 = [56, 30, 34];
const c2 = {
  name: 'r12-02-r51',
  title: 'R5-1 on the real stack: where the Workspace ownership refusal happens decides the outcome',
  subtitle: 'The execution lease row of the Session\'s storage is handed to another holder by SQL at one of two points; everything else is the normal Hosted Shell turn',
  lines: [
    ...tbl(W2, [
      ['## ', ['Ownership lost ...', 'e13b415b O2', 'af423eb7 O2']],
      ['++ ', ['after /v3/publications:install, before executeV3', 'UNKNOWN -> Session blocked', 'not_started, receipt, reload OK']],
      ['++ ', ['  (the R5-1 window; SQL run by the JVM forward proxy)', 'load 409 recovery_required', 'next turn completes']],
      ['-- ', ['before :start (installPublication\'s own check)', ':start 409 -> blocked', ':start 409 -> blocked']],
      ['-- ', ['  (SQL run by the Broker proxy on :start)', 'load 409 recovery_required', 'load 409 recovery_required']],
    ]),
    '',
    '== local path, before :start on af423eb7: "Workspace execution was refused before dispatch.", turn completes, reload OK',
    '',
    '## Why R12-1 remains (WorkspaceRuntimeTransport, af423eb7)',
    '== installPublication (line 135) still calls requireOwnedWorkspace() and throws; RuntimeBrokerService.startExecution:382',
    '== runs it before dispatch, so the new not_started conversion in executeV3 (line 144) is never reached on O2.',
    '== The Harness then cancels (settled) and still ends in HostedToolRecoveryRequiredError.',
  ],
  note: 'Both windows are narrow and need the lease to change hands under a running turn, for example when the binding transfers. The install-time refusal is just as provably pre-dispatch as R5-1, so it could take the same not_started path.',
  noteColor: '#d29922',
};
fs.writeFileSync(new URL('./cards.json', import.meta.url), JSON.stringify([c1, c2], null, 1));
