// node cards.mjs > cards.json — round-2 cards for PR #13311 @ 2f2298bc6e.
const env = 'Linux x86_64 · 16 cores · Node 22.22.2 · each arm its own pnpm install + build';
const cards = [
  {
    id: '01-f1-append-path-closed',
    title: 'F1 / R4-1 append half: closed on the real authority',
    subtitle: `LocalManagedSessionAuthority.appendExecution on a real writer lease + on-disk JSONL log · cancel.requested, target = N levels of t = {a: t, b: t} · ${env}`,
    blocks: [
      {
        kind: 'table',
        caption: 'One event per append (the R4-1 thread example is N=40)',
        head: ['N', 'round-1 head 8daf1f67', 'current head 2f2298bc', 'log bytes written (head)', 'read-back after (head)'],
        rows: [
          ['24', '[r] refused after 1,912 ms: "exceeds 1048576 bytes", 735 MB RSS', '[g] REFUSED 0.2 ms: "expands past 8388608 bytes through shared references", 62 MB RSS', '0', 'OK'],
          ['28', '[r] refused after 26,544 ms: untyped RangeError: Invalid string length', '[g] REFUSED 0.3 ms: same typed ManagedSessionRecordError', '0', 'OK'],
          { hl: true, cells: ['40', '[r] NO RETURN (killed by the 90 s timeout)', '[g] REFUSED 0.3 ms: same typed ManagedSessionRecordError', '0', 'OK'] },
        ],
      },
      {
        kind: 'table',
        caption: 'R2-1 "bound is scoped to one call", reproduced: one appendExecution with 256 events sharing ONE DAG (test-only path; production appends are single-event)',
        head: ['shape', 'base 5ddfacc9', 'round-1 head 8daf1f67', 'current head 2f2298bc'],
        rows: [
          ['256 × 18-level {leaf:1}', '[r] typed refusal after 283,843 ms, 1,462 MB', '[a] typed refusal after 7,441 ms, 1,430 MB', '[a] typed refusal after 6,811 ms, 1,429 MB'],
          ['256 × 13-level, leaf = 1000 × NUL', '[r] process ABORT: V8 heap OOM (18.4 s)', '[r] process ABORT: V8 heap OOM (7.5 s)', '[r] process ABORT: V8 heap OOM (4.1 s)'],
          ['64 × 13-level, leaf = 1000 × NUL', '—', '—', '[a] typed refusal after 2,794 ms, 3,159 MB'],
        ],
      },
      {
        kind: 'note',
        tone: 'good',
        text: 'Every single-event shape now fails in validation with a typed error before commit() serializes anything. The multi-event aggregate is still unbounded before events.map(JSON.stringify), and with escape-heavy leaves it aborts the process. That is the same on base, so it is not a regression. It is the open R2-1 item.',
      },
    ],
  },
  {
    id: '02-f2-and-new-guards',
    title: 'F2 closed, and the guards 2f2298bc6e added behave as described',
    subtitle: `parseManagedSessionEvent on each arm's built core, plus the same records driven through the real authority (logBytes = bytes appended to the JSONL) · ${env}`,
    blocks: [
      {
        kind: 'table',
        caption: 'F2: one chain reached twice under target.shell.{first,second} (deepest object at event depth 4 + k)',
        head: ['case', 'base 5ddfacc9', 'round-1 head 8daf1f67', 'current head 2f2298bc'],
        rows: [
          { hl: true, cells: ['shared chain k=60 (deepest at 64)', 'ACCEPT / COMMITTED', 'REFUSED "…shell.second exceeds the maximum JSON depth of 64"', 'ACCEPT / COMMITTED'] },
          ['unshared copy k=60', 'ACCEPT', 'ACCEPT', 'ACCEPT'],
          ['JSON.parse(JSON.stringify(shared)) k=60', 'ACCEPT', 'ACCEPT', 'ACCEPT'],
          ['shared / unshared / round-trip k=61 (deepest at 65)', '[g] REJECT', '[g] REJECT', '[g] REJECT'],
        ],
      },
      {
        kind: 'table',
        caption: 'Guards new in 2f2298bc6e (authority rows: refused = 0 bytes written)',
        head: ['record', 'base', 'round-1 head', 'current head'],
        rows: [
          ['R1-11 activation.changed, payload.subject = turn', '[a] COMMITTED (+1,686 B)', '[a] COMMITTED (+1,682 B)', '[g] REFUSED "payload.subject must identify the activation it changes."'],
          ['R1-11 activation.changed, payload.subject = hook_operation', 'ACCEPT', 'ACCEPT', 'ACCEPT (stays legal, hosted Hook path)'],
          ['R1-9 wake.requested, sourceEventId === eventId', '[a] COMMITTED (+1,453 B)', '[a] COMMITTED (+1,449 B)', '[g] REFUSED "payload.sourceEventId must not name itself."'],
          ['R1-9 control: sourceEventId names an earlier event', 'COMMITTED', 'COMMITTED', 'COMMITTED'],
          ['R1-5 envelope vs payload subject differs only in scopeId / activationId / epoch', '[a] ACCEPT ×3 (no cross-check)', '[g] REJECT ×3', '[g] REJECT ×3'],
          ['R1-5 hook_operation subject differs only in operationId / occurrenceId', '[a] ACCEPT ×2 (no cross-check)', '[g] REJECT ×2', '[g] REJECT ×2'],
        ],
      },
    ],
  },
  {
    id: '03-n1-depth-write-read-asymmetry',
    title: 'N1 (new, pre-existing since #12302): a record at the depth limit commits, then the log cannot be reopened',
    subtitle: `cancel.requested with target = { shell: { first: <unshared chain of k objects> } } · commit, append once more, close, cold-reopen from disk · ${env}`,
    blocks: [
      {
        kind: 'table',
        caption: 'Real authority: commit, then LocalManagedSessionAuthority.open on the same transcript',
        head: ['k (deepest at event depth)', 'arm', 'commit', 'next append, same process', 'cold reopen'],
        rows: [
          ['59 (63)', 'base', 'COMMITTED', 'COMMITTED', 'OK committed=3'],
          ['59 (63)', 'head', 'COMMITTED', 'COMMITTED', 'OK committed=3'],
          { hl: true, cells: ['60 (64)', 'base', 'COMMITTED', 'COMMITTED', 'FAILED "record exceeds the maximum JSON depth of 64."'] },
          { hl: true, cells: ['60 (64)', 'head', 'COMMITTED', 'COMMITTED', 'FAILED "record exceeds the maximum JSON depth of 64."'] },
        ],
      },
      {
        kind: 'table',
        caption: 'Why: the persisted line wraps the event one level deeper than the event-level walk counts',
        head: ['persisted line', 'max nesting', 'parseManagedSessionEvent(line.managedSession)', 'parseManagedSessionRecordJson(line)'],
        rows: [
          ['managed_session_event_v1 cancel.requested (k=60)', '65', 'ACCEPT', 'REJECT "record exceeds the maximum JSON depth of 64."'],
          ['managed_session_event_v1 wake.requested (control)', '4', 'ACCEPT', 'ACCEPT'],
        ],
      },
      {
        kind: 'pre',
        text: `write : assertJsonValue(event, 'event')          -> event object = depth 1, limit 64 counts from the EVENT
read  : assertNoDuplicateJsonKeys(line) (records.ts:1571)  -> record wrapper = depth 1, limit 64 counts from the LINE
        { …, "subtype": "managed_session_event_v1", "managedSession": { <event> } }   <- one extra level`,
      },
      {
        kind: 'note',
        tone: 'warn',
        text: 'Base does the same for unshared input, so this PR did not introduce it. But the F2 fix now also admits the shared form, and the new test pins "60-chain accepted at exact 64" at the event level. That shape cannot be read back once persisted. The live process keeps appending, so the problem only shows at restart or failover. Today only cancel.requested.target is free-form JSON, and no production code emits cancel.requested.',
      },
    ],
  },
  {
    id: '04-real-stack-linux',
    title: 'Real stack on Linux: Spring + MySQL 8.4 + each arm\'s bundled dist/cli.js',
    subtitle: 'scripts/run-managed-agent-server-e2e.ts (keep-tmp copy) · fake OpenAI model, no paid provider · JDK 21.0.12 · MySQL 8.4.11 · jar built from the head (sdk-java identical on both arms)',
    blocks: [
      {
        kind: 'table',
        caption: '11 interleaved runs, all exit 0 (in-flight / continuation modes are Linux-only, so round 1 on macOS could not run them)',
        head: ['mode', 'head 2f2298bc', 'base 5ddfacc9', 'what the mode asserts'],
        rows: [
          ['--session-failover', 'PASS ×2 (22 s, 23 s)', 'PASS ×1 (21 s)', 'writer generation 1→2, restored first-turn context, 2 terminal turns'],
          ['--inflight-failover', 'PASS ×2 (26 s, 24 s)', 'PASS ×2 (25 s, 25 s)', 'tool call SETTLED once across owner death, promptReplayed=false'],
          ['--continuation-failover', 'PASS ×2 (23 s, 27 s)', 'PASS ×2 (25 s, 24 s)', 'replacement owner continues the turn: CONTINUATION_TURN_RECOVERED'],
        ],
      },
      {
        kind: 'table',
        caption: 'Every Session Store transaction dumped from MySQL (qwen_managed_session_journal_tx.record_bytes), replayed through describeTransaction() of each build',
        head: ['reader', 'head-written (6 runs, 147 tx)', 'base-written (5 runs, 128 tx)', 'total'],
        rows: [
          ['base 5ddfacc9', 'OK 147/147', 'OK 128/128', 'OK 275/275'],
          ['round-1 head 8daf1f67', 'OK 147/147', 'OK 128/128', 'OK 275/275'],
          ['current head 2f2298bc', 'OK 147/147', 'OK 128/128', 'OK 275/275'],
        ],
      },
      {
        kind: 'pre',
        text: `guard census over the 275 real transactions (the current head's reader ran each check):
  activation.changed with activation payload subject (R3-3 id/epoch check)     81
  activation.changed with turn payload subject (R1-11 now refuses)              0
  activation.changed with hook_operation payload subject (stays legal)          0
  envelope subject on activation.changed / wake.requested (R1-5 cross-check)    0
  wake.requested, sourceEventId checked against eventId (R1-9)                 14
  wake.requested with sourceEventId === eventId (R1-9 now refuses)              0
  message.committed with non-null parentMessageId (R3-4)                       33
  checkpoint.committed with non-null previousCheckpointId (R3-4)               46
kinds seen: activation.changed 81, checkpoint.committed 57, message.committed 44, model.attempt 32,
            domain.committed 16, input.accepted 14, wake.requested 14, turn.settled 14, message.delta 12, tool.intent 8`,
      },
    ],
  },
  {
    id: '05-test-strength',
    title: 'Test strength of the 2f2298bc6e delta: 15/19 mutants killed, 4 survivors (all already filed)',
    subtitle: 'Each mutant = a copy of the head module + its own test file under src/managed-runtime/__mut__/ in a hardlinked copy of the head; one vitest run; tracked files untouched',
    blocks: [
      {
        kind: 'table',
        head: ['mutant', 'result', 'killed by'],
        rows: [
          ['F2: primitive child charged one level (?? 0 → ?? 1)', 'KILLED', 'walks a shared-reference graph once per distinct object'],
          ['F2: memo depth check > → >=', 'KILLED', 'same'],
          ['F1: drop the expansion bound', 'KILLED', 'same'],
          ['R1-4: array branch forgets its shape', 'KILLED', 'same (after 66.9 s: the walk cannot be interrupted)'],
          ['R1-11: drop turn refusal / overshoot: refuse hook_operation too', 'KILLED ×2', 'requires the payload subject to identify the activation it changes'],
          ['R1-9: drop the sourceEventId self-reference guard', 'KILLED', 'rejects a predecessor reference that cannot hold'],
          ['R1-5: hook_operation → true; drop scopeId / activationId / epoch', 'KILLED ×4', 'requires the envelope subject to match the payload subject'],
          ['R1-3/R1-7: cross-check never runs; subject not captured', 'KILLED ×2', 'same'],
          ['R1-4 inbox: private depth copy at 65 / at 63', 'KILLED ×2', 'bounds payload depth at the shared managed-session JSON depth limit'],
          { hl: true, cells: ['R2-2: drop the `shared &&` exemption', 'SURVIVED', '85/85 green'] },
          { hl: true, cells: ['R2-1: drop `|| shape?.shared === true`', 'SURVIVED', '85/85 green'] },
          { hl: true, cells: ['R2-1: string leaf charged 1', 'SURVIVED', '85/85 green'] },
          { hl: true, cells: ['R2-1: key bytes charged 0', 'SURVIVED', '85/85 green'] },
        ],
      },
      {
        kind: 'table',
        caption: 'R2-5 reproduced on the new authority test (-t "refuses a shared-reference expansion")',
        head: ['arm', 'result', 'what refused the append'],
        rows: [
          ['as filed: class matcher', 'PASS', 'expansion guard'],
          { hl: true, cells: ['+ expectedSequence: 0, class matcher', 'PASS', 'assertExpectedSequence: the guard is never reached'] },
          ['+ expectedSequence: 0, /expands past .* bytes through shared references/', 'FAILED', 'detects it'],
          ['intact command, message matcher', 'PASS', 'safe to adopt today'],
        ],
      },
      {
        kind: 'pre',
        text: `gates on 2f2298bc: vitest src/managed-runtime + src/config/managed-session-log.test.ts  35 files, 1988 passed | 1 skipped
                  tsc --noEmit (core) exit 0 · eslint --max-warnings 0 (5 changed files) exit 0 · prettier --check clean
R1-6 compile witness: add { type: 'session'; sessionId } to ManagedSessionSubject
  current head -> error TS2322 at subjectsEqual's default arm (records.ts:647)  · round-1 head -> compiles silently`,
      },
    ],
  },
  {
    id: '06-bound-arithmetic-and-cost',
    title: 'R2-1 arithmetic reproduced, and what the memo costs unshared input',
    subtitle: `parseManagedSessionEvent on the head's built core; perf = 3 interleaved rounds × 15 reps per arm, median of round medians · ${env}`,
    blocks: [
      {
        kind: 'table',
        caption: 'Largest single shared DAG the guard accepts (bound named in the message: 8,388,608; maxEventBytes: 1,048,576)',
        head: ['leaf', 'largest accepted N', 'real JSON.stringify(event) bytes', '× maxTransactionBytes', '× maxEventBytes'],
        rows: [
          ['1000 × NUL', '13', '49,332,473', '[a] 5.88×', '[a] 47.0×'],
          ['1000 × CJK', '13', '24,756,473', '[a] 2.95×', '[a] 23.6×'],
          ['1000 × ASCII', '13', '8,372,473', '1.00×', '[a] 8.0×'],
        ],
      },
      {
        kind: 'table',
        caption: 'Large unshared trees (no sharing, so only the memo overhead is measured)',
        head: ['input', 'base 5ddfacc9', 'round-1 head 8daf1f67', 'current head 2f2298bc', 'head vs base'],
        rows: [
          ['parseManagedSessionRecordJson, 7.68 MB body (40k rows, 120k containers)', '282 ms', '329 ms', '337 ms', '[a] +20 % (≈ +55 ms)'],
          ['parseManagedSessionEvent, 0.89 MB event (10k objects)', '25.3 ms', '30.7 ms', '30.7 ms', '[a] +21 % (≈ +5 ms)'],
        ],
      },
      {
        kind: 'note',
        tone: 'good',
        text: 'The estimate is a true lower bound, so nothing the real byte limits accept is newly refused. The overhead on unshared input is about 20 %, and most of it was already in the round-1 head. Neither blocks the merge.',
      },
    ],
  },
];
console.log(JSON.stringify(cards, null, 2));
