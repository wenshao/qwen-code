// Round-4 evidence cards for PR #13083: head 7ae1fa05 (h8) against round 3 (b4e9d71b, h7).
import fs from 'node:fs';
const RIG = new URL('..', import.meta.url).pathname;
const dir = `${RIG}fig/cards-r4/`;
fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(dir, { recursive: true });
const HEAD = '7ae1fa05';
const PREV = 'b4e9d71b';
const LINUX =
  'Ubuntu 24.04 container in a dedicated VM (kernel 6.8, arm64, 4 vCPU), JDK 21, Node 24.18, private mysqld 8.0.46; packaged Spring fat jar + dist/cli.js Hosted Harness + durable local workers + scripted local model';
const MAC = 'macOS arm64, JDK 26, Node 24.18, private mysqld (Homebrew); same packaged stack';
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
const sec = (msv) => `${(msv / 1000).toFixed(1)} s`;
const code = (s) => (String(s ?? '').match(/"code":"([a-z_]+)"/) ?? [])[1] ?? '';
const waited = (r) => Math.round(Number((/NONE within (\d+) ms/.exec(r.terminal) ?? [])[1] ?? 60000) / 1000);
const blockedReason = (label) => {
  const m = text(`out/s2/${label}-harness-B.log`).match(/is recovery blocked: (?:\w*Error: )?([^\n]+)/);
  return m ? m[1].trim() : '';
};
const turnCell = (r) => {
  if (!r) return '== not run';
  if (r.terminal === 'turn.completed') return mark(true, `completed, ${sec(r.msReplacementReadyToTerminal)}`);
  return mark(false, `no terminal event in ${waited(r)} s (Turn ${r.after.turn[0]})`);
};
const marker = (r) => {
  const f = r?.fileHistoryAfterTakeover;
  if (!f) return '== not run';
  return mark(!f.pendingTurn, f.pendingTurn ? 'pendingTurn still set' : 'cleared');
};
const undo = (r) => {
  const f = r?.fileHistoryAfterTakeover;
  if (!f) return '== not run';
  if (f.undoStatus === 200) {
    const n = ((f.undoBody.match(/"filesChanged":\[([^\]]*)\]/) ?? [])[1] ?? '').split(',').filter(Boolean).length;
    return mark(f.fileAfterUndo === null, `200; ${n} file${n === 1 ? '' : 's'} restored`);
  }
  return mark(false, `${f.undoStatus} ${code(f.undoBody)}`);
};
const cold = (r) => {
  const c = r?.coldLoadByFreshHarness;
  if (!c) return '== not run';
  const ok = c.plainLoad.startsWith('200');
  return mark(ok, ok ? '200' : `${c.plainLoad.slice(0, 3)} ${code(c.plainLoad)}`);
};
const second = (label) => {
  const r = s2(label);
  if (!r) return '== not run';
  if (r.terminal === 'turn.completed')
    return mark(true, `completed, ${sec(r.msReplacementReadyToTerminal)}; ${r.after.executions.length} executions at gen ${[...new Set(r.after.executions.map((e) => e[2]))].join('/')}`);
  const why = blockedReason(label);
  return mark(false, `no terminal event in ${waited(r)} s${why ? `\nHarness: "${why.slice(0, 64)}"` : ''}`);
};
const inflightFaults = ['inflight-none', 'inflight-drop-continue-reply', 'inflight-load-lost-once', 'inflight-start-fail-once'];
const pendingCount = (prefix) => {
  const rs = inflightFaults.map((id) => s2(`${prefix}-${id}`)).filter((r) => r?.fileHistoryAfterTakeover);
  const bad = rs.filter((r) => r.fileHistoryAfterTakeover.pendingTurn || r.fileHistoryAfterTakeover.undoStatus !== 200).length;
  return mark(bad === 0, `${bad} of ${rs.length} leave the marker / refuse undo`);
};

// ---------- R4-01: the round-3 findings at the new head ----------
card('r4-01-round3-findings', {
  title: `Round-3 findings at ${HEAD} (vs ${PREV})`,
  subtitle: `${LINUX}. The scripted model asks for one write_file (or, for F8, a second one after the parked write); owner A dies with it parked, owner B takes over through the public API's coordinator.`,
  blocks: [
    {
      table: [
        ['check', `head ${PREV}`, `head ${HEAD}`],
        ['F7  in-flight takeover, no fault: file-history marker after the Turn', marker(s2('h7-inflight-none')), marker(s2('h8-inflight-none'))],
        ['F7  undo of the taken-over prompt (POST /files/rewind)', undo(s2('h7-inflight-none')), undo(s2('h8-inflight-none'))],
        ['F7  load of the finished Session by a fresh Harness', cold(s2('h7cl-inflight-none')), cold(s2('h8-inflight-none'))],
        ['F7  in-flight with faults: no fault, lost continue reply, lost takeover load, lost :start', pendingCount('h7'), pendingCount('h8')],
        ['F8  second tool round, in-flight', second('h7st5-inflight-none'), second('h8st-inflight-none')],
        ['F8  second tool round, continuation', second('h7st-continuation-none'), second('h8st-continuation-none')],
        ['F8  second tool round, continuation + stream cut', '== not run', second('h8st-continuation-cut-stream')],
        ['F8  second tool round, in-flight + lost continue reply', '== not run', second('h8st-inflight-drop-continue-reply')],
        ['F8  second tool round, in-flight + lost takeover load', '== not run', second('h8st-inflight-load-lost-once')],
        ['F8  undo after a two-tool takeover (in-flight / continuation)', '== not run', `${undo(s2('h8st-inflight-none'))}\n${undo(s2('h8st-continuation-none'))}`],
      ],
    },
  ],
});

// ---------- R4-02: cancellation takeover on the real stack ----------
{
  const brokerErr = (label) => {
    const counts = {};
    for (const m of text(`out/s2/${label}-harness-B.log`).matchAll(/Runtime Broker returned HTTP (\d+) \(([a-z_]+)\)/g)) counts[`${m[1]} ${m[2]}`] = (counts[`${m[1]} ${m[2]}`] ?? 0) + 1;
    return Object.entries(counts).map(([k, n]) => `${k} x${n}`).join(', ');
  };
  const calls = (r) => {
    const counts = {};
    for (const line of r?.coordinatorToHarnessB ?? []) {
      const m = /POST \/session\/[^/ ]+\/?([a-z/-]*) #\d+ -> (?:upstream )?(\d{3}|DROPPED[^ ]*)/.exec(line);
      if (!m) continue;
      const k = `${m[1] || 'create'} ${m[2]}${code(line) ? ` ${code(line)}` : ''}`;
      counts[k] = (counts[k] ?? 0) + 1;
    }
    const marks = (r?.coordinatorToHarnessB ?? [])
      .filter((line) => /managed-runtime\/cancel #\d+ -> (upstream )?200/.test(line))
      .map((line) => (/"lastEventId":(\d+)/.exec(line) ?? [])[1]);
    const replay = marks.length > 1 ? `\nfirst reply dropped; replay answered at lastEventId ${marks.join(' -> ')}` : '';
    return Object.entries(counts).map(([k, n]) => `${k}${n > 1 ? ` x${n}` : ''}`).join('\n') + replay;
  };
  const cell = (label) => {
    const r = s2(label);
    if (!r) return '== not run';
    const s = r.secondSessionOnSameWorkspace;
    if (r.terminal && !r.terminal.startsWith('NONE')) {
      const ok = r.terminal === 'turn.cancelled';
      return [
        mark(ok, `${r.terminal}, ${sec(r.msReplacementReadyToTerminal)}; fs ${r.after.fsEventsAfterCrash}`),
        mark(r.after.lease.startsWith('NULL') && s?.terminal === 'turn.completed', `lease ${r.after.lease.startsWith('NULL') ? 'released' : 'held'}; second Session ${s ? s.terminal.replace('turn.', '') : 'n/a'}`),
        `== coordinator: ${calls(r).replace(/\n/g, '; ')}`,
      ].join('\n');
    }
    const be = brokerErr(label);
    return [mark(false, `no terminal event in ${waited(r)} s (Turn ${r.after.turn[0]})`), `== coordinator: ${calls(r).replace(/\n/g, '; ')}`, be ? `!! Broker: ${be}` : ''].filter(Boolean).join('\n');
  };
  const rows = [
    ['inflight-db-cancel', 'in-flight: execution parked, not settled'],
    ['inflight-db-cancel-drop-reply', 'in-flight, first cancel reply lost'],
    ['continuation-db-cancel', 'continuation: execution already settled'],
    ['continuation-db-cancel-drop-reply', 'continuation, first cancel reply lost'],
  ];
  card('r4-02-cancel-takeover', {
    title: `Cancellation takeover on the real stack: ${PREV} vs ${HEAD} vs candidate C`,
    subtitle: `${LINUX}. The public API refuses cancel for Workspace Sessions (409 workspace_unavailable), so after owner A dies the rig applies the store's own cancel transition (status CANCELLING, as insertCancelCommand does) and owner B's coordinator runs the passive takeover + managed-runtime/cancel. Candidate C: the passive load adopts the Runtime Session (acquire, no dispatch) before reading status.`,
    blocks: [
      {
        table: [['scenario', `head ${PREV}`, `head ${HEAD}`, `${HEAD} + candidate C`], ...rows.map(([id, what]) => [what, cell(`h7-${id}`), cell(`h8-${id}`), cell(`h8c-${id}`)])],
      },
    ],
  });
}

// ---------- R4-03: everything else at the new head ----------
{
  const scenarios = [
    ['inflight-none', 'in-flight, no fault'],
    ['continuation-none', 'continuation, no fault'],
    ['continuation-cut-stream', 'continuation; stream cut during the replacement answer'],
    ['inflight-drop-continue-reply', 'in-flight; reply to continue lost'],
    ['inflight-load-lost-once', 'in-flight; first takeover load lost'],
    ['inflight-start-fail-once', 'in-flight; first :start lost'],
    ['inflight-drop-load-reply', 'in-flight; takeover-load reply lost (F4, known)'],
    ['first-round-none', 'owner dies in the first model round (out of scope)'],
  ];
  const lease = (r) => {
    if (!r || r.terminal !== 'turn.completed') return '';
    const s = r.secondSessionOnSameWorkspace;
    const free = r.after.lease.startsWith('NULL');
    return mark(free && s?.terminal === 'turn.completed', `${free ? 'released' : 'held'}; second Session ${s ? s.terminal.replace('turn.', '') : 'n/a'}`);
  };
  const inv = (r) =>
    r ? `exec ${r.after.executions.length}${r.after.executions[0] ? ` ${r.after.executions[0][1]}/gen ${r.after.executions[0][2]}` : ''}; model ${r.after.modelRequestsInitial}+${r.after.modelRequestsWithToolResult}; fs ${r.after.fsEventsAfterCrash}` : '';
  const loops = text('out/batch-h8.console');
  const pass = (name) => (loops.match(new RegExp(`\\[${name}\\] PASS (\\d+/\\d+)`)) ?? [])[1] ?? 'n/a';
  const s8 = read('out/s8/h8-mac-result.json');
  const s8lin = read('out/s8/h8-linux-result.json');
  const s8ok = (r) => r && r.rows.every((x) => x.terminal === 'turn.completed' && x.byteExact);
  const s1 = read('out/s1/h8-mac-unbound-result.json');
  const g = read('out/s1c/h8-mac-result.json');
  const s7 = read('out/s7/h8-mixed-mac-result.json');
  const s9 = read('out/s9/h8-mac-result.json');
  const s5same = (() => {
    const a = read('out/s5/h8-on-result.json');
    const b = read('out/s5/new-on-result.json');
    if (!a || !b) return 'n/a';
    return Object.keys(a).filter((k) => !['label', 'platform', 'db', 'property'].includes(k)).every((k) => a[k] === b[k]) ? 'identical to earlier heads' : 'CHANGED';
  })();
  const mut = read('out/mut/unit2-h8-summary.json') ?? [];
  const mrow = (id) => {
    const r = mut.find((x) => x.id === id);
    if (!r) return '== not run';
    // N02 lives in core; its test is core's managed-harness-factory.test.ts (run separately: 1 failed, 31 passed).
    if (id === 'N02' && !r.killedBy.length) return mark(true, `caught by 1 core test (managed-harness-factory); CLI files all ${r.total} pass`);
    return r.killedBy.length ? mark(true, `caught by ${r.killedBy.length} test${r.killedBy.length > 1 ? 's' : ''}`) : `!! not caught (all ${r.total} pass)`;
  };
  const bound = s7?.['bound Session (journal has message.delta) loaded by a BASE-build Harness'];
  card('r4-03-regression', {
    title: `Everything else at ${HEAD}`,
    subtitle: `${LINUX} / ${MAC}. "fs" = inotify events on the Workspace mount after the crash (4 = one atomic write, 0 = untouched).`,
    blocks: [
      {
        label: 'owner failover with faults (one write_file, then answer)',
        table: [
          ['scenario', `head ${PREV}`, `head ${HEAD}`, `lease and second Session (${HEAD})`, `ledgers (${HEAD})`],
          ...scenarios.map(([id, what]) => [what, turnCell(s2(`h7-${id}`)), turnCell(s2(`h8-${id}`)), lease(s2(`h8-${id}`)), inv(s2(`h8-${id}`))]),
        ],
      },
      {
        label: "the PR's own runner (continuation mode now pins exactly 2 continuation requests)",
        pre: [
          mark(pass('h8-inflight').startsWith('10/'), `--inflight-failover       PASS ${pass('h8-inflight')}`),
          mark(pass('h8-continuation').startsWith('10/'), `--continuation-failover   PASS ${pass('h8-continuation')}`),
          mark(pass('h8-session').startsWith('3/'), `--session-failover        PASS ${pass('h8-session')}`),
        ].join('\n'),
      },
      {
        label: 'other checks',
        pre: [
          mark(s1?.turn2?.terminal === 'turn.completed', `F1  Turn 2 on a live owner: ${s1?.turn2?.terminal} after ${sec(s1?.turn2?.ms ?? 0)}; dropped SSE: ${g?.terminal} ${sec(g?.msFromCutToTerminal ?? 0)} after the cut`),
          mark(s8ok(s8) && s8ok(s8lin), `R1-1  multi-line, control-character and split answers byte-exact: macOS ${s8ok(s8)} / Linux ${s8ok(s8lin)}`),
          mark(s9?.rows?.every((x) => x.terminal === 'turn.completed'), `provider drop after the first chunk: ${(s9?.rows ?? []).map((x) => `${x.session} ${x.terminal}`).join('; ')}`),
          mark(s5same.startsWith('identical'), `trusted-actor header matrix: ${s5same}`),
          `!! F5  bound Session with message.delta loaded by a base-build Harness: ${String(bound ?? 'n/a').slice(0, 3)} ${code(bound)} (documented)`,
        ].join('\n'),
      },
      {
        label: `mutants on ${HEAD}: the changed CLI vitest files, failures re-run alone before counting`,
        table: [['id', 'mutation', 'unit tests'], ...['N01', 'N02', 'N03', 'N04', 'N05', 'N06', 'N07', 'N08', 'N09', 'N10', 'R01', 'R02', 'R03', 'T02', 'T03'].map((id) => [id, mut.find((x) => x.id === id)?.what ?? '', mrow(id)])],
      },
    ],
  });
}
console.log(fs.readdirSync(dir).join('\n'));
