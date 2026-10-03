// Round-5 evidence cards for PR #13173 (head b0e8b1e2): passive cancellation takeover on the packaged stack.
import fs from 'node:fs';
const RIG = new URL('..', import.meta.url).pathname;
const dir = `${RIG}fig/cards-r5/`;
fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(dir, { recursive: true });
const LINUX =
  'Ubuntu 24.04 container in a dedicated VM (arm64, 4 vCPU), JDK 21, Node 24.18, private mysqld 8.0; packaged Spring fat jar + dist/cli.js Hosted Harness + Runtime Broker with durable local workers + scripted local model';
const card = (name, c) => fs.writeFileSync(`${dir}${name}.json`, JSON.stringify(c, null, 1));
const read = (label) => {
  try {
    return JSON.parse(fs.readFileSync(`${RIG}out/s2r5/${label}-result.json`, 'utf8'));
  } catch {
    return undefined;
  }
};
const mark = (ok, s) => `${ok ? '++ ' : '-- '}${s}`;
const sec = (v) => `${(v / 1000).toFixed(1)} s`;
const code = (s) => (String(s ?? '').match(/"code":"([a-z_]+)"/) ?? [])[1] ?? '';
const waited = (r) => Math.round(Number((/NONE within (\d+) ms/.exec(r.terminal) ?? [])[1] ?? 90000) / 1000);

// "load 409, load 200, cancel 503 ×5" from the coordinator->Harness B ledger
function coordinator(r) {
  const steps = [];
  for (const line of r.coordinatorToHarnessB) {
    const m = / POST \S+?\/(load|managed-runtime\/cancel|managed-runtime\/continue|cancel) #\d+ -> (?:upstream )?(\d{3})(.*)$/.exec(line);
    if (!m) continue;
    const kind = m[1] === 'cancel' ? 'live-cancel' : m[1].replace('managed-runtime/', '');
    let what = `${kind} ${m[2]}`;
    const c = code(m[3]);
    if (m[2] !== '200' && c) what += ` ${c}`;
    if (/reply DROPPED/.test(m[3])) what += ' (reply lost)';
    const wm = /"lastEventId":(\d+)/.exec(m[3]);
    if (kind === 'cancel' && m[2] === '200' && wm) what += ` @${wm[1]}`;
    const last = steps[steps.length - 1];
    if (last && last.what === what) last.n += 1;
    else steps.push({ what, n: 1 });
  }
  return wrap(steps.map((s) => (s.n > 1 ? `${s.what} ×${s.n}` : s.what)));
}
// Lines of at most 78 columns, items joined by ", ".
function wrap(items, width = 78) {
  const lines = [];
  let cur = '';
  for (const item of items) {
    const next = cur ? `${cur}, ${item}` : item;
    if (cur && next.length > width) {
      lines.push(cur + ',');
      cur = item;
    } else cur = next;
  }
  if (cur) lines.push(cur);
  return lines.join('\n== ');
}
// Order-free totals, for ledgers where concurrent paths interleave.
function coordinatorTotals(r) {
  const totals = new Map();
  for (const line of r.coordinatorToHarnessB) {
    const m = / POST \S+?\/(load|managed-runtime\/cancel|managed-runtime\/continue|cancel) #\d+ -> (?:upstream )?(\d{3})(.*)$/.exec(line);
    if (!m) continue;
    const kind = m[1] === 'cancel' ? 'live-cancel' : m[1].replace('managed-runtime/', '');
    const c = code(m[3]);
    const what = `${kind} ${m[2]}${m[2] !== '200' && c ? ' ' + c : ''}`;
    totals.set(what, (totals.get(what) ?? 0) + 1);
  }
  return wrap([...totals].map(([w, n]) => (n > 1 ? `${w} ×${n}` : w)));
}
function broker(r) {
  const steps = [];
  for (const line of r.harnessBToBroker) {
    const m = /ms (GET|POST) \/internal\/runtime-broker\/v1\/(\S+?)(?:\?\S*)? #\d+ -> (?:upstream )?(injected )?(\d{3})(.*)$/.exec(line);
    if (!m) continue;
    let op = m[2];
    if (op.endsWith(':acquire')) op = 'acquire';
    else if (op.endsWith(':release')) op = 'release';
    else if (op.endsWith(':cancel')) op = 'cancel';
    else if (op.startsWith('executions/')) op = 'status';
    let what = `${op} ${m[4]}${m[3] ? ' (injected)' : ''}`;
    const c = code(m[5]);
    if (m[4] !== '200' && c && !m[3]) what += ` ${c}`;
    const last = steps[steps.length - 1];
    if (last && last.what === what) last.n += 1;
    else steps.push({ what, n: 1 });
  }
  return wrap(steps.map((s) => (s.n > 1 ? `${s.what} ×${s.n}` : s.what)));
}
const outcome = (r) => {
  if (!r) return '== not run';
  if (r.terminal === 'turn.cancelled') return mark(true, `turn.cancelled in ${sec(r.msReplacementReadyToTerminal)}`);
  if (r.terminal === 'turn.completed') return mark(true, `turn.completed in ${sec(r.msReplacementReadyToTerminal)}`);
  return mark(false, `no terminal event in ${waited(r)} s — Turn ${r.after.turn[0]}, retry_count ${r.after.turn[2]}`);
};
const lease = (r) => (r.after.lease.startsWith('NULL') ? mark(true, 'Workspace lease released') : mark(false, "Workspace lease still held by the dead owner's Runtime Session"));
const second = (r) => {
  const s = r.secondSessionOnSameWorkspace;
  if (!s) return '== second Session not probed (no terminal)';
  return s.terminal === 'turn.completed'
    ? mark(true, `2nd Session on the Workspace: completed (${sec(s.ms)})`)
    : mark(false, `2nd Session on the Workspace: ${s.terminal} ${s.terminalData?.code ?? ''}`);
};
const cell = (label, extra = []) => {
  const r = read(label);
  if (!r) return '== not run';
  const lines = [outcome(r), `== ${coordinator(r)}`];
  if (r.cancelPost) lines.push(`== public cancel: ${r.cancelPost.status} -> Turn ${String(r.counters.cancelTransition ?? '').replace(/^public \d+ -> /, '')}`);
  lines.push(lease(r));
  if (r.terminal !== 'turn.cancelled' && r.terminal !== 'turn.completed') return lines.join('\n');
  lines.push(second(r));
  return [...lines, ...extra].join('\n');
};
const cellShort = (label, totals = false, extra = []) => {
  const r = read(label);
  if (!r) return '== not run';
  return [outcome(r), `== ${totals ? coordinatorTotals(r) : coordinator(r)}`, ...extra, lease(r)].join('\n');
};

// ---------- 01: the fix itself ----------
const base = read('b9w3-inflight-db-cancel') ? 'b9w3' : 'b9';
card('r5-01-cancel-takeover', {
  title: 'Passive cancellation takeover: merge-base (no fix) vs PR head b0e8b1e2',
  subtitle: `${LINUX}. Owner A parks a write_file Turn and is SIGKILLed (Harness tree + Spring JVM; the durable worker survives). The Turn is moved to CANCELLING with the store's own cancel transition (the public API still refused Workspace cancel at the merge-base), then owner B starts behind recording taps.`,
  blocks: [
    {
      table: [
        ['Scenario', 'merge-base b3dda468 (main before #13112, no fix)', 'PR head b0e8b1e2'],
        ['in-flight: :start held, execution parked', cellShort(`${base}-inflight-db-cancel`, false, ['== Harness B: Broker 404 runtime_session_not_found on the status read']), cell('h9-inflight-db-cancel')],
        ['in-flight: execution already settled on the\nBroker, checkpoint item still in_progress', cellShort('b9set-inflight-db-cancel'), cell('h9set-inflight-db-cancel')],
        ['continuation: tool settled before the crash', cellShort('b9-continuation-db-cancel', false, ['== Harness B: release 503 runtime_reconciliation_required']), cell('h9-continuation-db-cancel')],
        ['in-flight + first cancel reply lost', '== not run (no cancel is ever admitted)', cell('h9-inflight-db-cancel-drop-reply')],
        ['continuation + first cancel reply lost', '== not run (no cancel is ever admitted)', cell('h9-continuation-db-cancel-drop-reply')],
      ],
    },
    {
      note: 'Base: the passive load never adopts the dead owner\'s Runtime Session, so the replacement Broker refuses it (continuation: release 503 runtime_reconciliation_required on every retry) and the Turn stays CANCELLING with the Workspace pinned. Head: acquire → status → cancel → settle → release; a lost cancel reply replays at the same watermark (@N = lastEventId of the original and the replay).',
    },
  ],
});

// ---------- 02: public cancel on main ----------
card('r5-02-public-cancel', {
  title: 'Since #13112 (merged 2026-10-03 01:42Z) the same path is reachable through the public cancel API',
  subtitle: `${LINUX}. Same crash, but owner B receives a real POST /v1/agents/sessions/{id}/events {type: agent.session.cancel} from the Session's creator — no SQL. main 2b15eac8 vs the test merge of b0e8b1e2 into it (3add8a65, clean, Java identical to main).`,
  blocks: [
    {
      table: [
        ['Scenario (public cancel)', 'main 2b15eac8 (no fix)', 'test merge main + #13173'],
        ['in-flight: execution parked', cellShort('m9pub-inflight-db-cancel', true, ['== Harness B: Broker 404 runtime_session_not_found on the status read']), cell('x9pub-inflight-db-cancel')],
        ['continuation: tool settled before the crash', cellShort('m9pub-continuation-db-cancel', true, ['== Harness B: release 503 runtime_reconciliation_required']), cell('x9pub-continuation-db-cancel')],
        ['in-flight + first cancel reply lost', '== not run (no cancel is ever admitted)', cell('x9pub-inflight-db-cancel-drop-reply')],
        ['continuation + first cancel reply lost', '== not run (no cancel is ever admitted)', cell('x9pub-continuation-db-cancel-drop-reply')],
      ],
    },
    {
      note: 'live-cancel = the #13112 path (POST /session/{id}/cancel plus its own passive loads, 409 already_attached while the takeover load is opening). The PR description still says the path is unreachable publicly ("Workspace cancel still answers 409 workspace_unavailable"). That stopped being true with #13112: on current main a creator cancelling a Workspace Turn whose owner died wedges it exactly as in #13171. This PR is now a live fix.',
    },
  ],
});

// ---------- 03: review-round claims under injected faults ----------
const faultRow = (claim, fault, headLabel, mutLabel, mutName) => [
  `${claim}\n== fault: ${fault}`,
  cellShort(headLabel) + (read(headLabel) ? `\n== Broker: ${broker(read(headLabel))}` : ''),
  `${mutName}\n` + cellShort(mutLabel) + (read(mutLabel) ? `\n== Broker: ${broker(read(mutLabel))}` : ''),
];
card('r5-03-round-claims', {
  title: 'Review-round fixes under injected faults: PR head vs a mutant that reverts just that fix',
  subtitle: `${LINUX}. Faults are injected on owner B only (Harness→Broker and Harness→Session Store taps); each mutant is the head bundle with one hunk reverted.`,
  blocks: [
    {
      table: [
        ['Claim', 'PR head b0e8b1e2', 'Mutant'],
        faultRow(
          'R2: no compensation release on a failed\npassive load (retry re-acquires idempotently)',
          'execution settled on the Broker; the first\nexecution-status read of the passive load → 503',
          'h9set-inflight-db-cancel-load-status-fail',
          'h9M1set-inflight-db-cancel-load-status-fail',
          '== M1: first push\'s compensation release',
        ),
        faultRow(
          'R5: re-admit the redriven cancel after the\ncheckpoint advanced',
          'store read 503 after op=commitCheckpoint,\nbefore the terminal record (file-history read)',
          'h9-inflight-db-cancel-history-read-fail',
          'h9M2-inflight-db-cancel-history-read-fail',
          '== M2: full matchesRecovery fence (pre-R5)',
        ),
      ],
    },
  ],
});

// ---------- 04: F1 terminal write ----------
const tw = read('h9-inflight-db-cancel-terminal-write-fail');
const twx = read('x9pub-inflight-db-cancel-terminal-write-fail');
const storeLines = (r) =>
  (r?.storeLedgerFromFirstCancel ?? [])
    .filter((l) => /transactions:commit op=(commitMessage|commitCheckpoint|commitFileHistory|settleTurn)/.test(l))
    .slice(0, 8)
    .map((l) => {
      const m = /^(\d+)ms POST \S+ op=(\w+).*?( -> INJECTED 503)?$/.exec(l);
      return m ? `${m[3] ? '-- ' : '== '}${m[1]}ms commit op=${m[2]}${m[3] ? '  -> 503 (injected)' : ''}` : l;
    });
const coordLines = (r) =>
  (r?.coordinatorToHarnessB ?? [])
    .filter((l) => /\/(load|cancel) #/.test(l))
    .map((l) => {
      const m = /^(\d+)ms POST \S+\/(load|managed-runtime\/cancel) #(\d+) -> (\d{3}) (.*)$/.exec(l);
      return m ? `${m[4] === '200' ? '++ ' : '-- '}${m[1]}ms ${m[2].replace('managed-runtime/', '')} #${m[3]} -> ${m[4]} ${m[4] === '200' ? '' : code(m[5])}` : l;
    });
const stderr = (r) => [...new Set((r?.harnessBStderr ?? []).map((l) => l.replace(/^qwen serve: Hosted Harness turn \S+ /, '').replace(/ManagedSession\w*Error: /, '')))].map((l) => `!! ${l.slice(0, 150)}`);
card('r5-04-terminal-write-wedge', {
  title: 'F1: a store failure on the terminal record still wedges the Turn (the redriven cancel cannot write)',
  subtitle: `${LINUX}. PR head b0e8b1e2, SQL-flipped CANCELLING; the Session Store answers 503 to the cancel route's terminal transaction (op=settleTurn, i.e. the turn_result record) for its three attempts (~0.5 s), then recovers.`,
  blocks: [
    { label: 'Harness B → Session Store (cancel route writes)', pre: storeLines(tw).join('\n') },
    { label: 'Coordinator → Harness B', pre: coordLines(tw).join('\n') },
    { label: 'Harness B stderr (deduplicated)', pre: stderr(tw).join('\n') },
    {
      label: 'Outcome',
      pre: [
        outcome(tw),
        tw ? lease(tw) : '',
        twx ? `== same fault through the public cancel API on the test merge: ${outcome(twx).slice(3)}` : '',
      ].filter(Boolean).join('\n'),
    },
    {
      note: 'The R5 re-admission works (cancels #1..#5 get past the identity fence), but ManagedSessionAuthority latches writeFailure after any failed append, so every redriven attempt dies on "session log writes stopped". The coordinator reuses the attachment and never re-loads, so nothing ever opens a fresh authority. The unit test "keeps the adoption owed through a failed terminal write and settles on the redriven cancel" passes only because it throws from a ManagedSessionRecordSink.write stub above the authority, so the latch is never set.',
    },
  ],
});

// ---------- 05: F2 handback ----------
const timeline = (label) => {
  const r = read(label);
  if (!r) return ['== not run'];
  return (r.leaseTimelineAfterTurn ?? []).map((l) => {
    const m = /^(\+\d+s) (\S+) (\S+)$/.exec(l);
    if (!m) return l;
    return m[2] === 'NULL' ? `++ ${m[1].padStart(5)} lease free` : `-- ${m[1].padStart(5)} held by Runtime Session ${m[3].slice(0, 8)}…`;
  });
};
const f2cell = (label, name) => {
  const r = read(label);
  if (!r) return `${name}\n== not run`;
  return [name, outcome(r), `== ${coordinator(r)}`, `== Broker: ${broker(r)}`, ...timeline(label).slice(-3), second(r), r.fileHistoryAfterTakeover ? `${r.fileHistoryAfterTakeover.undoStatus === 200 ? '++' : '--'} undo of the cancelled Turn: ${r.fileHistoryAfterTakeover.undoStatus}` : ''].filter(Boolean).join('\n');
};
const longest = read('h9long-inflight-db-cancel-release-fail');
card('r5-05-handback-pinned', {
  title: 'F2: after a failed final handback the cancel answers 200, but nothing retries the release — the Workspace stays pinned',
  subtitle: `${LINUX}. The Broker answers 503 once to the cancel route's release (after the terminal record is durable); lease row sampled afterwards, then a second Session is created on the same Workspace.`,
  blocks: [
    {
      table: [
        ['PR head b0e8b1e2 (R4-6: handback has its own failure path)', 'M3: handback back in the shared try (pre-R4-6)', 'candidate C1: head + background retry of the owed handback'],
        [
          f2cell('h9-inflight-db-cancel-release-fail', '## in-flight'),
          f2cell('h9M3-inflight-db-cancel-release-fail', '## in-flight'),
          f2cell('h9C1-inflight-db-cancel-release-fail', '## in-flight'),
        ],
        [
          f2cell('h9-continuation-db-cancel-release-fail', '## continuation'),
          '== not run',
          f2cell('h9C1-continuation-db-cancel-release-fail', '## continuation'),
        ],
      ],
    },
    ...(longest
      ? [{ label: 'PR head, long watch (same fault)', pre: timeline('h9long-inflight-db-cancel-release-fail').join('\n') }]
      : []),
    {
      note: 'The coordinator got 200, so it sends no replay; the Hosted Session has no idle reaper (the 30-minute reaper in the log belongs to the ACP bridge), so the owed lease is only handed back at Session close or Harness restart. Meanwhile every other Session in the Workspace fails (Harness B: "Runtime Broker returned HTTP 409 (workspace_busy)") and undo of the cancelled Turn answers 409. Pre-R4-6 code (M3) healed through the coordinator retry (settled replay → release); its 38 s includes three unrelated load 503s (writer grant stale under host load) before the takeover load. C1 keeps the 200 and retries the owed handback with backoff until confirmed or the Session closes.',
    },
  ],
});

// ---------- 06: regression ----------
const e2e = (prefix, n) => {
  let pass = 0;
  let total = 0;
  for (let i = 1; i <= n; i++) {
    try {
      fs.readFileSync(`${RIG}out/e2e/${prefix}-${i}.out`);
      total += 1;
    } catch {
      continue;
    }
  }
  try {
    const log = fs.readFileSync(`${RIG}out/batch-r5b.log`, 'utf8');
    const m = new RegExp(`\\[${prefix}\\] PASS (\\d+)/(\\d+)`).exec(log);
    if (m) return mark(m[1] === m[2], `${m[1]}/${m[2]} passed`);
  } catch {}
  return total ? `== ${total} runs, result not parsed` : '== not run';
};
const unit = (file) => {
  try {
    const t = fs.readFileSync(`${RIG}out/${file}`, 'utf8');
    const m = /Tests\s+(?:(\d+) failed \| )?(\d+) passed \((\d+)\)/.exec(t);
    if (!m) return '== not parsed';
    return m[1] ? `-- ${m[1]} failed, ${m[2]} passed (${m[3]})` : `++ ${m[2]} passed (${m[3]})`;
  } catch {
    return '== not run';
  }
};
const drive = (label) => {
  const r = read(label);
  if (!r) return '== not run';
  return `${outcome(r)}; ${r.after.executions.length} executions settled; 2nd Session ${r.secondSessionOnSameWorkspace?.terminal === 'turn.completed' ? 'completed' : r.secondSessionOnSameWorkspace?.terminal}; undo ${r.fileHistoryAfterTakeover?.undoStatus}`;
};
card('r5-06-regression', {
  title: 'Regression: continuation drive path, the PR\'s own runner, unit suites',
  subtitle: `${LINUX} (rig runs); unit suites on macOS arm64, Node 24.`,
  blocks: [
    {
      table: [
        ['Check', 'Result'],
        ['S2 drive path, in-flight, second tool round (head)', drive('h9d-inflight-none')],
        ['S2 drive path, continuation, second tool round (head)', drive('h9d-continuation-none')],
        ['runner --inflight-failover (test merge)', e2e('x9-inflight', 3)],
        ['runner --continuation-failover (test merge)', e2e('x9-continuation', 3)],
        ['runner --session-failover (test merge)', e2e('x9-session', 2)],
        ['vitest hosted-harness-session + hosted-runtime-recovery (head)', unit('unit-h9.log')],
        ['the same two PR test files on merge-base source', unit('unit-b9-prtests.log').replace(/^-- /, '!! ') + '\n== expected: the new and flipped pins need the fix'],
        ['the two files on the test merge (3 full runs + isolated reruns)', process.env.X9UNIT ?? '== see report'],
        ['hosted-harness-session.test.ts with candidate C1', unit('unit-h9-C1.log')],
      ],
    },
  ],
});
console.log('cards written to', dir);
