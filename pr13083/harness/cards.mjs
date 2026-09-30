// Builds the evidence cards (cards/*.json) for PR #13083 from the rig's result files.
// Arms: h5 = PR head 13cbd974, h5cand = that head + candidate, h4 = previous head fcd2dc2c,
// base2 = main 3b18cfe5, new = head 1606fe07 (full matrix and mutants), pr = first head eb06f7f9.
import fs from 'node:fs';
const RIG = new URL('..', import.meta.url).pathname;
const dir = `${RIG}fig/cards/`;
fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(dir, { recursive: true });
const HEAD = '13cbd974';
const PREV = 'fcd2dc2c';
const LINUX =
  'Ubuntu 24.04 container in a dedicated VM (kernel 6.8, arm64, 4 vCPU), JDK 21, Node 24.18, private mysqld 8.0.46; packaged Spring fat jar + dist/cli.js Hosted Harness + durable local workers + scripted local model';
const MAC = 'macOS arm64, JDK 26, Node 24.18, private mysqld (Homebrew); packaged Spring fat jar + dist/cli.js Hosted Harness + scripted local model';
const card = (name, c) => fs.writeFileSync(`${dir}${name}.json`, JSON.stringify(c, null, 1));
const read = (p) => {
  try {
    return JSON.parse(fs.readFileSync(`${RIG}${p}`, 'utf8'));
  } catch {
    return undefined;
  }
};
const text = (p) => {
  try {
    return fs.readFileSync(`${RIG}${p}`, 'utf8');
  } catch {
    return '';
  }
};
const s2 = (label) => read(`out/s2/${label}-result.json`);
const mark = (ok, s) => `${ok ? '++ ' : '-- '}${s}`;

// ---------- 01: the PR's central claim ----------
{
  const loops = [
    [`head ${HEAD}; host load average 50-100 from unrelated concurrent builds`, text('out/batch-h5.console') + text('out/batch-h5c.console'), 'h5'],
    ['head 1606fe07 (earlier rebase of the same change), second pass; host load average 20-70', text('out/batch-new-b.console'), 'new2'],
    ['first head eb06f7f9; quiet host', text('out-eb06/e2e/loop-pr.console'), 'pr'],
  ];
  const line = (log, prefix, mode) => {
    const name = `${prefix}-${mode}`;
    const pass = (log.match(new RegExp(`\\[${name}\\] PASS (\\d+/\\d+)`)) ?? [])[1];
    if (!pass) return null;
    const t = [...log.matchAll(new RegExp(`\\[${name}\\] run \\d+ exit=0 (\\d+) ms`, 'g'))].map((m) => Number(m[1]) / 1000);
    const [ok, all] = pass.split('/').map(Number);
    return (
      `${ok === all ? '++ ' : '!! '}  --${mode}-failover`.padEnd(30) +
      `PASS ${pass}`.padEnd(13) +
      (t.length ? `${Math.min(...t).toFixed(0)}-${Math.max(...t).toFixed(0)} s per passing run` : '')
    );
  };
  const pre = [];
  for (const [title, log, prefix] of loops) {
    const lines = ['inflight', 'continuation', 'session'].map((m) => line(log, prefix, m)).filter(Boolean);
    if (lines.length) pre.push(`## ${title}`, ...lines);
  }
  pre.push(`## GitHub CI on head ${HEAD}, job "Hosted process fault gates / MySQL 8.4 / Java 21"`);
  pre.push('++   Hosted ITs 13/13, Broker fault gates 44/44, both failover modes ran and printed their audit');
  pre.push('## base commit');
  pre.push('==   both tool-driven modes exit at once with the stale "not yet enabled" error');
  const a = s2('h5-inflight-none');
  const b = s2('h5-continuation-none');
  const col = (r) =>
    r
      ? [
          `${r.beforeCrash.executions[0]?.slice(1, 3).join(' gen ')} -> ${r.after.executions[0]?.slice(1, 3).join(' gen ')}`,
          r.after.sameExecutionCallId ? 'original id, 1 row' : 'DIFFERENT',
          `${r.after.modelRequestsInitial} + ${r.after.modelRequestsWithToolResult}`,
          `${r.counters.replacementStarts}`,
          `${r.after.fsEventsAfterCrash}${
            r.beforeCrash.sideEffectStat
              ? r.beforeCrash.sideEffectStat === r.after.sideEffectStat
                ? ' (inode, mtime, ctime unchanged)'
                : ' (file changed)'
              : ' (create tmp, write, rename = one atomic write)'
          }`,
          JSON.stringify(r.after.publicTextDeltas),
          String(r.after.terminalEventsInStore),
          `${r.msReplacementReadyToTerminal} ms`,
        ]
      : Array(8).fill('n/a');
  const names = [
    'Broker execution row, before crash -> after',
    'executionCallId',
    'model requests (initial + with tool result)',
    ':start calls reaching the replacement Broker',
    'inotify events on the Workspace mount after the crash',
    'public text deltas at the end',
    'terminal events in the store',
    'replacement Harness ready -> terminal',
  ];
  const ca = col(a);
  const cb = col(b);
  card('01-central-claim', {
    title: `Both failover modes reproduced on Linux, and re-checked with independent oracles (head ${HEAD})`,
    subtitle: LINUX,
    blocks: [
      { label: "the PR's own runner (scripts/run-managed-agent-server-e2e.ts), repeated", pre: pre.join('\n') },
      {
        label:
          'the same two scenarios re-implemented in the rig: own driver, taps on Harness->Broker and coordinator->Harness, inotify watcher on the Workspace mount',
        table: [
          ['oracle', 'in-flight (:start held, both owners killed)', 'continuation (killed after the first text chunk)'],
          ...names.map((n, i) => [n, ca[i], cb[i]]),
        ],
      },
      {
        note:
          'In-flight: the tool runs once, on the replacement, under the original id. Continuation: nothing is executed again (no Broker call, the file is untouched), the dead owner\'s chunk is blanked in the public projection ("" plus a stream.reconciled event) and only the replacement\'s answer remains. "1 + 2" model requests = the dead owner\'s interrupted request plus the replacement\'s. Runner runs that failed on the loaded host stopped on "The Managed Session writer grant is stale" (the runner\'s 1 s writer lease).',
      },
    ],
  });
}

// ---------- 02: F1 ----------
{
  const arms = [
    ['base (main 3b18cfe5)', 'base2'],
    [`previous head ${PREV}`, 'h4'],
    [`current head ${HEAD}`, 'h5'],
    [`${HEAD} + candidate`, 'h5cand'],
  ];
  const rows = arms.map(([name, arm]) => {
    const t = read(`out/s1/${arm}-mac-unbound-result.json`);
    const g = read(`out/s1c/${arm}-mac-result.json`);
    const t2 = t?.turn2;
    const ok2 = t2?.terminal === 'turn.completed';
    const okg = g?.terminal === 'turn.completed';
    const row = g?.['turnRow(status,error_code,retry_count,submission_attempted)'];
    return [
      name,
      t ? mark(ok2, `${t2.terminal}${t2.terminalData?.code ? ` (${t2.terminalData.code})` : ''} after ${(t2.ms / 1000).toFixed(1)} s`) : 'n/a',
      t ? `${t.modelRequests}` : '',
      t ? `${t['coordinatorToHarness(load/create)'].filter((l) => l.includes('/load')).length}` : '',
      g ? mark(okg, okg ? `turn.completed ${(g.msFromCutToTerminal / 1000).toFixed(1)} s after the cut` : `no terminal in 75 s; Turn ${row[0]}, retry ${row[2]}`) : 'n/a',
    ];
  });
  const n = read('out/s1/h4-mac-unbound-result.json');
  card('02-f1-live-owner', {
    title: `Later Turns and re-entered Turns on a live owner: broken on ${PREV}, fixed on ${HEAD}`,
    subtitle: `${MAC}. One unbound Session, same Spring and same Harness the whole time; nothing is killed.`,
    blocks: [
      {
        table: [
          ['build', 'Turn 2 of the same Session', 'model requests\nafter the run', 'load calls to\nthe Harness', 'one dropped coordinator->Harness SSE\nconnection during Turn 1'],
          ...rows,
        ],
      },
      n && {
        label: `coordinator -> Harness calls on ${PREV}, second Turn (ms since rig start)`,
        pre: n['coordinatorToHarness(load/create)']
          .map((l) => l.replace('[coordinator->harness] ', '').replace(/\{"sessionId".*/, '{...}').replace(/("code":"[a-z_]+").*/, '$1}'))
          .map((l) => (l.includes('409') ? `-- ${l}` : `== ${l}`))
          .join('\n'),
      },
      {
        note: `On ${PREV} the coordinator sent a takeover load for every Turn of a Session that had been attached before, and the Harness refuses to load a Session it already holds. ${HEAD} reuses the cached attachment, which fixes both columns. What is left of this family is on the takeover path itself (next image): a Turn that was taken over and is then re-entered.`,
      },
    ].filter(Boolean),
  });
}

// ---------- 03: fault matrix ----------
{
  const scenarios = [
    ['inflight-none', 'in-flight, no fault'],
    ['continuation-none', 'continuation, no fault'],
    ['inflight-load-lost-once', 'in-flight; first takeover load lost before the Harness'],
    ['inflight-start-fail-once', 'in-flight; first :start lost before the Broker'],
    ['continuation-cut-stream', 'continuation; event stream cut during the replacement answer'],
    ['inflight-drop-continue-reply', 'in-flight; reply to continue lost'],
    ['inflight-drop-load-reply', 'in-flight; reply to the takeover load lost'],
    ['first-round-none', 'owner dies in the first model round (text only, no tool yet)'],
  ];
  const cell = (r) => {
    if (!r) return '== not run';
    const ok = r.terminal === 'turn.completed';
    return mark(ok, ok ? `completed, ${(r.msReplacementReadyToTerminal / 1000).toFixed(1)} s` : `no terminal event (Turn ${r.after.turn[0]}, retry ${r.after.turn[2]})`);
  };
  const inv = (r) =>
    r
      ? `exec rows ${r.after.executions.length}${r.after.executions[0] ? ` ${r.after.executions[0][1]} gen ${r.after.executions[0][2]}` : ''}; model ${r.after.modelRequestsInitial}+${r.after.modelRequestsWithToolResult}; fs ${r.after.fsEventsAfterCrash}; text ${JSON.stringify(r.after.publicTextDeltas)}`
      : '';
  card('03-fault-matrix', {
    title: `Faults injected on the replacement owner (head ${HEAD}): nothing is executed twice; a re-entered takeover does not finish`,
    subtitle: `${LINUX}. "fs" = inotify events on the Workspace mount after the crash (4 = one atomic write, 0 = untouched). "text" = public text deltas at the end.`,
    blocks: [
      {
        table: [
          ['scenario', `head ${HEAD}`, `ledgers at the end (head ${HEAD})`, `${HEAD} + candidate`],
          ...scenarios.map(([id, what]) => [what, cell(s2(`h5-${id}`)), inv(s2(`h5-${id}`)), cell(s2(`h5cand-${id}`))]),
        ],
      },
    ],
  });
}

// ---------- 04: F2 lease ----------
{
  const rows = [
    ['in-flight takeover', s2('h5-inflight-none'), s2('h5cand-inflight-none')],
    ['continuation takeover', s2('h5-continuation-none'), s2('h5cand-continuation-none')],
  ].map(([name, n, c]) => {
    const f = (r) => {
      if (!r) return ['n/a', 'n/a'];
      const s = r.secondSessionOnSameWorkspace;
      const free = r.after.lease.startsWith('NULL');
      return [
        mark(free, free ? 'released' : `still held by the finished Turn`),
        s ? mark(s.terminal === 'turn.completed', `${s.terminal}${s.terminalData?.code ? ` (${s.terminalData.code})` : ''}; file written: ${s.fileWritten}`) : 'n/a',
      ];
    };
    return [name, ...f(n), ...f(c)];
  });
  const n = s2('h5-continuation-none');
  card('04-f2-workspace-lease', {
    title: `F2: after a continuation takeover the Workspace stays locked for every other Session (head ${HEAD})`,
    subtitle: `${LINUX}. After the taken-over Turn ends, a second Session bound to the same Workspace asks for one write_file.`,
    blocks: [
      {
        table: [
          ['', `${HEAD}: Workspace\nexecution lease`, `${HEAD}: second Session`, 'candidate: lease', 'candidate: second Session'],
          ...rows,
        ],
      },
      n && {
        label: `Harness -> Broker calls of the replacement, continuation takeover on ${HEAD} (whole Turn)`,
        pre:
          n.harnessBToBroker.map((l) => `== ${l.slice(0, 150)}`).join('\n') +
          "\n-- no tool-sessions:acquire and no :release: the dead owner's Runtime Session is never released",
      },
      {
        note:
          'When the tool had already settled before the crash, recovery has nothing to drive, so it never acquires the Runtime Session and the terminal route has nothing to release. The lease row has no expiry; the next Session gets 409 workspace_busy from the Broker and its Turn ends as hosted_turn_failed. --continuation-failover does not look at the lease.',
      },
    ].filter(Boolean),
  });
}

// ---------- 05: other measurements ----------
{
  const on = read('out/s5/h5-on-result.json');
  const off = read('out/s5/h5-off-result.json');
  const base = read('out/s5/base2-on-result.json');
  const keys = on ? Object.keys(on).filter((k) => !['label', 'platform', 'db', 'property'].includes(k)) : [];
  const s6 = read('out/s6/h5-mac-result.json') ?? read('out/s6/h4-mac-result.json');
  const s6quiet = read('out-eb06/s6/pr-mac-result.json');
  const s7 = read('out/s7/h5-mixed-mac-result.json');
  card('05-actor-header-rollback-cost', {
    title: `Trusted-actor header, rollback compatibility and the cost of durable text deltas (head ${HEAD})`,
    subtitle: MAC,
    blocks: [
      on && {
        label: 'qwen.managed-agent.trusted-actor-header on the packaged server (real Spring + MySQL)',
        table: [
          ['request', 'property set', 'property unset (default)', 'base build, env set'],
          ...keys.map((k) => [k, String(on[k]), String(off?.[k] ?? ''), String(base?.[k] ?? '')]),
        ],
      },
      s7 && {
        label: 'a Session journaled by the PR build, then loaded by a Harness of another build (base = main 3b18cfe5)',
        pre: Object.entries(s7)
          .filter(([k]) => k.includes('loaded by'))
          .map(([k, v]) =>
            mark(
              String(v).startsWith('200'),
              `${k.padEnd(74)} ${String(v).slice(0, 3)} ${(String(v).match(/"code":"([a-z_]+)"/) ?? [])[1] ?? 'session loaded'}`,
            ),
          )
          .join('\n'),
      },
      s6 && {
        label: `one Turn whose answer arrives as N small chunks (the model emits without pacing); loaded-host column measured on ${read('out/s6/h5-mac-result.json') ? HEAD : PREV}`,
        table: [
          ['model chunks', 'Session', 'first public text', 'Turn total,\nloaded host', 'Turn total, quiet host\n(first head)', 'journal\ntransactions', 'journal bytes', 'public delta\nevents'],
          ...s6.rows.map((r, i) => [
            r.modelChunks,
            r.session,
            `${r.firstPublicTextMs} ms`,
            `${(r.totalMs / 1000).toFixed(1)} s`,
            s6quiet?.rows?.[i] ? `${(s6quiet.rows[i].totalMs / 1000).toFixed(1)} s` : '',
            r.journalTransactions,
            r.journalBytes.toLocaleString('en-US'),
            r.publicDeltaEvents,
          ]),
        ],
      },
    ].filter(Boolean),
  });
}

// ---------- 06: mutation ----------
{
  const m = read('out/mut/summary.json');
  const h5 = read('out/mut/unit2-h5-summary.json');
  if (m) {
    const recheck = (id) => {
      const r = h5?.find((x) => x.id === id);
      if (!r) return '';
      return r.killedBy.length
        ? `\n++ on ${HEAD}: caught by ${r.killedBy.length} test${r.killedBy.length > 1 ? 's' : ''}`
        : `\n!! on ${HEAD}: still not caught (all ${r.total} pass)`;
    };
    card('06-mutation', {
      title: 'What the new tests and the two E2E modes pin (mutants on head 1606fe07)',
      subtitle: `Each mutant is compiled into the bundle (J02: into the jar). unit = the 5 vitest files this PR changes (J02: HarnessCoordinatorTest); the two modes = the PR runner in the Linux container. T02 and T03 were re-checked against the unit tests of ${HEAD}.`,
      blocks: [
        {
          table: [
            ['id', 'mutation', 'unit tests', '--inflight-failover', '--continuation-failover'],
            ...m.map((r) => [r.id, r.what, r.unit + (['T02', 'T03'].includes(r.id) ? recheck(r.id) : ''), r.inflight, r.continuation]),
          ],
        },
        {
          note:
            'T01: both modes depend on the takeover path. T02 and T03 (text de-duplication, durable deltas of live Turns) are caught only by --continuation-failover, which runs on Linux only. T07 is caught by one unit test for the in-flight case but passes both modes, because neither looks at the Workspace lease; the case where nothing was left to drive (F2) has no test.',
        },
      ],
    });
  }
}
console.log(fs.readdirSync(dir).join('\n'));
