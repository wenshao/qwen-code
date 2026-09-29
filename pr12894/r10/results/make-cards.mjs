import fs from 'node:fs';
const IMAGE = process.env.IMAGE_LINE ?? '== real docker build of 0172d5ec: pending';
const tbl = (W, rows) => rows.map(([p, a]) => p + a.slice(0, -1).map((x, i) => x.padEnd(W[i])).join('') + a.at(-1));
const c1 = {
  name: 'r10-01-status',
  title: 'Round 10 @ 0172d5ec on the full real stack: R9-1 fixed, the result schema reaches the server image, regression clean',
  subtitle: 'PR head as-is (bf8a99b4 R9-1 fix + merge of main with #12975 Broker payload validation and #12869); rebuilt bundle and jar; fresh MySQL 8.4.7 schema; OSS double; fault proxy',
  lines: [
    '## Fixed on this head',
    '++ R9-1  invalid Shell arguments on O2 now come back to the model as a correctable error (round 9: turn_error)',
    '++ R3-2  the Docker build context now carries managed-tool-result-v1.schema.json into the server jar',
    '',
    '## Lone surrogates (tracked in #13010, outside this PR)',
    "!! main's #12975 now rejects the payload at the Broker (400 runtime_payload_invalid), but the Harness still blocks the Session:",
    '!!   O2 immediately; local path only after ~3 min of polling ("did not settle within its observation window")',
    '',
    '## Still holding',
    '== R2-5 unstarted receipt | R2-6 raw ESC | preview matrix and UTF-8 tail same as round 9 | gate 2 correctable refusal',
    '== R6-2  80 past O2 Shell calls: 816 Store requests, 0 ACKs, 0 warnings',
    '',
    '## Regression (all pass)',
    '== O2     echo 2/2 | 100 MiB + 5 MiB exit 7 exact | 1 GiB exact | crash after receipt | lost segment | lost admission reply',
    '==        control chars + crash | reload + second turn | ACK request lost | mixed 2 O2 + 2 local x 64 MiB: 4/4, 0 deadlocks',
    "== local  echo 2/2 | 100 MiB + 5 MiB exit 7 | reload + second turn | author's six-Workspace driver 2/2",
    '== real qwen3.8-max failing 3,000-line build: O2 4/4, local 2/2 with the error quoted',
    '',
    '## Still open (deferred by the author)',
    '!! gate 1 (load 409 for 151 s) | R7-1 #12957 (still reproduces) | #12969 | F3 | B2/B4 MySQL tests | R2-11..20 #12986',
    '!! R2-7 / R3-117 expired publication candidate: #13019, left to the maintainer before a remote rollout',
  ],
  note: 'Mutants on bf8a99b4: 2 of 2 killed (throwing the validation error again; dropping the O2 is_background refusal). One harmless difference remains: is_background: false runs on the local path and is refused, correctably, on O2.',
  noteColor: '#3fb950',
};
const W2 = [46, 26, 30];
const c2 = {
  name: 'r10-02-details',
  title: 'R9-1 and R3-2 on the real stack: before and after',
  subtitle: 'R9-1: a fake model sends one Shell call per fresh Session. R3-2: the exact COPY set of each Dockerfile built with the same Maven commands, then the jar run in the rig',
  lines: [
    ...tbl(W2, [
      ['## ', ['Shell call on the O2 path', '3da25b7c (round 9)', '0172d5ec']],
      ['++ ', ['timeout 900000 / timeout 0', 'turn_error', 'correctable error, turn completes']],
      ['++ ', ['timeout 150000.5 / timeout 1e21', 'turn_error', 'correctable error, turn completes']],
      ['++ ', ['is_background: false', 'turn_error', '"requires one foreground command"']],
      ['++ ', ['unsupported key "directory"', 'turn_error', 'correctable error, turn completes']],
    ]),
    '',
    ...tbl([48, 42], [
      ['## ', ['Server jar built from the Dockerfile COPY set', 'bf8a99b4 Dockerfile', '0172d5ec Dockerfile']],
      ['== ', ['Maven build', 'succeeds', 'succeeds']],
      ['++ ', ['contracts/managed-tool-result-v1.schema.json', 'missing', 'present']],
      ['++ ', ['start with tool publication enabled', 'fails: ToolPublicationContract.<clinit>', 'UP; O2 echo completes, REFERENCED']],
      ['== ', ['start with tool publication disabled', 'UP', '-']],
    ]),
    IMAGE,
  ],
  note: "Before the fix, the image would build cleanly and then fail at startup wherever tool publication is enabled: 'toolPublicationStore' -> 'embeddedRuntimeBroker' -> the whole context. Deployments with publication disabled were not affected.",
  noteColor: '#3fb950',
};
fs.writeFileSync(new URL('./cards.json', import.meta.url), JSON.stringify([c1, c2], null, 1));
