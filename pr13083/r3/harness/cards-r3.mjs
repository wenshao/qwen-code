// Round-3 evidence cards for PR #13083: head b4e9d71b (h7, rebased onto #13110) against round 2 (912c3b57, h6).
import fs from 'node:fs';
const RIG = new URL('..', import.meta.url).pathname;
const dir = `${RIG}fig/cards-r3/`;
fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(dir, { recursive: true });
const HEAD = 'b4e9d71b';
const PREV = '912c3b57';
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
const blockedReason = (label) => {
  const log = text(`out/s2/${label}-harness-B.log`);
  const m = log.match(/is recovery blocked: (?:\w*Error: )?([^\n]+)/);
  return m ? m[1].trim() : '';
};

// ---------- R3-01: what a taken-over Turn leaves behind ----------
{
  const turn = (r) => {
    if (!r) return '== not run';
    const ok = r.terminal === 'turn.completed';
    return mark(ok, ok ? `completed, ${sec(r.msReplacementReadyToTerminal)}` : `no terminal event in 60 s (Turn ${r.after.turn[0]})`);
  };
  const marker = (r) => {
    const f = r?.fileHistoryAfterTakeover;
    if (!f) return '== not run';
    return mark(!f.pendingTurn, f.pendingTurn ? 'pendingTurn still set to the finished prompt' : 'cleared');
  };
  const undo = (r) => {
    const f = r?.fileHistoryAfterTakeover;
    if (!f) return '== not run';
    if (f.undoStatus === 200) {
      const changed = (f.undoBody.match(/"filesChanged":\[([^\]]*)\]/) ?? [])[1] ?? '';
      const n = changed ? changed.split(',').length : 0;
      return mark(f.fileAfterUndo === null, `200; ${n} file${n === 1 ? '' : 's'} restored (written file removed)`);
    }
    return mark(false, `${f.undoStatus} ${code(f.undoBody)}; written file stays`);
  };
  const load = (r) => {
    const c = r?.coldLoadByFreshHarness;
    if (!c) return '== not run';
    if (c.error) return `!! ${c.error.slice(0, 80)}`;
    const ok = c.plainLoad.startsWith('200');
    return mark(ok, ok ? '200' : `${c.plainLoad.slice(0, 3)} ${code(c.plainLoad)} (takeover load: ${c.takeoverLoad.slice(0, 3)} ${code(c.takeoverLoad)})`);
  };
  const next = (r) => {
    const n = r?.nextTurnOnNextOwner;
    if (!n) return '== not run';
    if (n.error) return `!! ${String(n.error).slice(0, 80)}`;
    const ok = n.terminal === 'turn.completed';
    const data = n.terminalData ? ` ${JSON.stringify(n.terminalData).slice(0, 90)}` : '';
    return mark(ok, ok ? `completed, ${sec(n.ms)}` : `${n.terminal}${data}`);
  };
  const second = (label) => {
    const r = s2(label);
    if (!r) return '== not run';
    if (r.terminal === 'turn.completed') return mark(true, `completed, ${sec(r.msReplacementReadyToTerminal)}; ${r.after.executions.length} executions`);
    const why = blockedReason(label);
    const waited = Math.round(Number((/NONE within (\d+) ms/.exec(r.terminal) ?? [])[1] ?? 60000) / 1000);
    return mark(false, `no terminal event in ${waited} s (Turn ${r.after.turn[0]})${why ? `\nHarness: "${why.slice(0, 70)}"` : ''}`);
  };
  card('r3-01-takeover-leftovers', {
    title: `New in round 3: what a taken-over Turn leaves behind (${HEAD} vs candidate)`,
    subtitle: `${LINUX}. The scripted model asks for one write_file; owner A dies with it parked (in-flight: before the tool ran; continuation: after it settled), owner B takes over. Candidate A: recoverHostedRuntimeTurn records the post-effect file history and clears the marker. Candidate B: consumeRuntimeResults lets the current activation adopt the Turn.`,
    blocks: [
      {
        table: [
          ['after the takeover', `in-flight, head ${HEAD}`, `continuation, head ${HEAD}`, 'in-flight, candidate A+B', 'continuation, candidate A+B'],
          ['the taken-over Turn (one tool, then answer)', turn(s2('h7-inflight-none')), turn(s2('h7-continuation-none')), turn(s2('h7c2no-inflight-none')), '== (two-tool runs below)'],
          ['#13110 file-history marker after the Turn', marker(s2('h7-inflight-none')), marker(s2('h7-continuation-none')), marker(s2('h7c2-inflight-none')), marker(s2('h7c2-continuation-none'))],
          ['undo of the taken-over prompt (POST /files/rewind)', undo(s2('h7-inflight-none')), undo(s2('h7-continuation-none')), undo(s2('h7c2-inflight-none')), undo(s2('h7c2-continuation-none'))],
          ['load of the finished Session by a fresh Harness', load(s2('h7cl-inflight-none')), load(s2('h7cl-continuation-none')), load(s2('h7candcl-inflight-none')) + '\n== measured with A alone', load(s2('h7candcl-continuation-none')) + '\n== measured with A alone'],
          ['a second tool round inside the taken-over Turn', second('h7st5-inflight-none'), second('h7st-continuation-none'), second('h7c2-inflight-none'), second('h7c2-continuation-none')],
        ],
      },
      {
        label: `the second tool round on the round-2 head ${PREV} (before the rebase onto #13110)`,
        pre: [
          `-- in-flight:     ${second('h6st-inflight-none').replace(/^-- /, '').replace('\n', '; ')}`,
          `-- continuation:  ${second('h6st-continuation-none').replace(/^-- /, '').replace('\n', '; ')}`,
        ].join('\n'),
      },
    ],
  });
}

// ---------- R3-02: round 1-2 results after the rebase ----------
{
  const scenarios = [
    ['inflight-none', 'in-flight, no fault'],
    ['continuation-none', 'continuation, no fault'],
    ['continuation-cut-stream', 'continuation; event stream cut during the replacement answer (F3)'],
    ['inflight-drop-continue-reply', 'in-flight; reply to continue lost (F3)'],
    ['inflight-load-lost-once', 'in-flight; first takeover load lost before the Harness'],
    ['inflight-start-fail-once', 'in-flight; first :start lost before the Broker'],
    ['inflight-drop-load-reply', 'in-flight; reply to the takeover load lost (F4, known follow-up)'],
    ['first-round-none', 'owner dies in the first model round (out of scope)'],
  ];
  const cell = (r) => {
    if (!r) return '== not run';
    const ok = r.terminal === 'turn.completed';
    return mark(ok, ok ? `completed, ${sec(r.msReplacementReadyToTerminal)}` : `no terminal event (Turn ${r.after.turn[0]})`);
  };
  const lease = (r) => {
    if (!r || r.terminal !== 'turn.completed') return '';
    const s = r.secondSessionOnSameWorkspace;
    const free = r.after.lease.startsWith('NULL');
    return mark(free && s?.terminal === 'turn.completed', `${free ? 'released' : 'held'}; second Session ${s ? s.terminal.replace('turn.', '') : 'n/a'}`);
  };
  const inv = (r) =>
    r
      ? `exec ${r.after.executions.length}${r.after.executions[0] ? ` ${r.after.executions[0][1]}/gen ${r.after.executions[0][2]}` : ''}; model ${r.after.modelRequestsInitial}+${r.after.modelRequestsWithToolResult}; fs ${r.after.fsEventsAfterCrash}; text ${JSON.stringify(r.after.publicTextDeltas)}`
      : '';
  const loops = text('out/batch-h7.console');
  const pass = (name) => (loops.match(new RegExp(`\\[${name}\\] PASS (\\d+/\\d+)`)) ?? [])[1] ?? 'n/a';
  const s8 = read('out/s8/h7-mac-result.json');
  const s8lin = read('out/s8/h7-linux-result.json');
  const s8ok = (r) => r && r.rows.every((x) => x.terminal === 'turn.completed' && x.byteExact);
  const s1 = read('out/s1/h7-mac-unbound-result.json');
  const g = read('out/s1c/h7-mac-result.json');
  const s7 = read('out/s7/h7-mixed-mac-result.json');
  const s9 = read('out/s9/h7-mac-result.json');
  const s5same = (() => {
    const a = read('out/s5/h7-on-result.json');
    const b = read('out/s5/new-on-result.json');
    if (!a || !b) return 'n/a';
    return Object.keys(a).filter((k) => !['label', 'platform', 'db', 'property'].includes(k)).every((k) => a[k] === b[k]) ? 'identical to earlier heads' : 'CHANGED';
  })();
  const mut = read('out/mut/unit2-h7-summary.json') ?? [];
  const mrow = (id) => {
    const r = mut.find((x) => x.id === id);
    if (!r) return '== not run';
    if (r.error) return `!! ${r.error}`;
    return r.killedBy.length ? mark(true, `caught by ${r.killedBy.length} test${r.killedBy.length > 1 ? 's' : ''}`) : `!! not caught (all ${r.total} pass)`;
  };
  const bound = s7?.['bound Session (journal has message.delta) loaded by a BASE-build Harness'];
  card('r3-02-regression', {
    title: `Round 1-2 results after the rebase: ${PREV} vs ${HEAD}`,
    subtitle: `${LINUX} / ${MAC}. "fs" = inotify events on the Workspace mount after the crash (4 = one atomic write, 0 = untouched).`,
    blocks: [
      {
        label: 'owner failover with faults (one write_file, then answer)',
        table: [
          ['scenario', `head ${PREV}`, `head ${HEAD}`, `lease and second Session (${PREV} -> ${HEAD})`, `ledgers at the end (${HEAD})`],
          ...scenarios.map(([id, what]) => [
            what,
            cell(s2(`h6-${id}`)),
            cell(s2(`h7-${id}`)),
            [lease(s2(`h6-${id}`)), lease(s2(`h7-${id}`))].filter(Boolean).join('\n'),
            inv(s2(`h7-${id}`)),
          ]),
        ],
      },
      {
        label: "the PR's own runner (host load average 25-45 from other work)",
        pre: [
          mark(pass('h7-inflight').startsWith('10/'), `--inflight-failover       PASS ${pass('h7-inflight')}`),
          mark(pass('h7-continuation').startsWith('10/'), `--continuation-failover   PASS ${pass('h7-continuation')}`),
          mark(pass('h7-session').startsWith('3/'), `--session-failover        PASS ${pass('h7-session')}`),
        ].join('\n'),
      },
      {
        label: 'other checks',
        pre: [
          mark(s1?.turn2?.terminal === 'turn.completed', `F1  Turn 2 of one Session on a live owner: ${s1?.turn2?.terminal} after ${sec(s1?.turn2?.ms ?? 0)}; dropped SSE during Turn 1: ${g?.terminal} ${sec(g?.msFromCutToTerminal ?? 0)} after the cut`),
          mark(s8ok(s8) && s8ok(s8lin), `R1-1  multi-line, control-character and 7.6 KB split answers: byte-exact on macOS ${s8ok(s8)} / Linux ${s8ok(s8lin)}`),
          mark(s9?.rows?.every((x) => x.terminal === 'turn.completed'), `provider drop after the first chunk: ${(s9?.rows ?? []).map((x) => `${x.session} ${x.terminal}`).join('; ')}`),
          mark(s5same.startsWith('identical'), `trusted-actor header matrix: ${s5same}`),
          `!! F5  bound Session with message.delta loaded by a base-build Harness: ${String(bound ?? 'n/a').slice(0, 3)} ${code(bound)} (documented)`,
        ].join('\n'),
      },
      {
        label: `round-2 mutants re-applied on ${HEAD}: the changed vitest files, failures re-run alone before counting`,
        table: [
          ['id', 'mutation', 'unit tests'],
          ...['R01', 'R02', 'R03', 'T02', 'T03'].map((id) => [id, mut.find((x) => x.id === id)?.what ?? '', mrow(id)]),
        ],
      },
    ],
  });
}
console.log(fs.readdirSync(dir).join('\n'));
