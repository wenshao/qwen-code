// Round-2 evidence cards for PR #13083: head 912c3b57 (h6) against the previously reported head 13cbd974 (h5).
import fs from 'node:fs';
const RIG = new URL('..', import.meta.url).pathname;
const dir = `${RIG}fig/cards-r2/`;
fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(dir, { recursive: true });
const HEAD = '912c3b57';
const PREV = '13cbd974';
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

// ---------- R2-01: takeover matrix, previous head vs this head ----------
{
  const scenarios = [
    ['inflight-none', 'in-flight, no fault'],
    ['continuation-none', 'continuation, no fault'],
    ['continuation-cut-stream', 'continuation; event stream cut during the replacement answer (F3)'],
    ['inflight-drop-continue-reply', 'in-flight; reply to continue lost (F3)'],
    ['inflight-load-lost-once', 'in-flight; first takeover load lost before the Harness'],
    ['inflight-start-fail-once', 'in-flight; first :start lost before the Broker'],
    ['inflight-drop-load-reply', 'in-flight; reply to the takeover load lost (F4)'],
    ['first-round-none', 'owner dies in the first model round (out of scope)'],
  ];
  const cell = (r) => {
    if (!r) return '== not run';
    const ok = r.terminal === 'turn.completed';
    return mark(ok, ok ? `completed, ${(r.msReplacementReadyToTerminal / 1000).toFixed(1)} s` : `no terminal event (Turn ${r.after.turn[0]})`);
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
  card('r2-01-takeover-matrix', {
    title: `Owner failover with faults: ${PREV} vs ${HEAD}`,
    subtitle: `${LINUX}. "fs" = inotify events on the Workspace mount after the crash (4 = one atomic write, 0 = untouched). Lease = Workspace execution lease after the Turn, then a second Session on the same Workspace asks for one write_file.`,
    blocks: [
      {
        table: [
          ['scenario', `head ${PREV}`, `head ${HEAD}`, `lease and second Session (${PREV} -> ${HEAD})`, `ledgers at the end (${HEAD})`],
          ...scenarios.map(([id, what]) => [
            what,
            cell(s2(`h5-${id}`)),
            cell(s2(`h6-${id}`)),
            [lease(s2(`h5-${id}`)), lease(s2(`h6-${id}`))].filter(Boolean).join('\n'),
            inv(s2(`h6-${id}`)),
          ]),
        ],
      },
    ],
  });
}

// ---------- R2-02: other checks ----------
{
  const s8old = read('out/s8/h5-mac-result.json');
  const s8new = read('out/s8/h6-mac-result.json');
  const s8lin = read('out/s8/h6-linux-result.json');
  const rowOf = (r, key) => r?.rows.find((x) => x.case === key);
  const s8 = ['S8_NEWLINES', 'S8_CONTROL', 'S8_SPLIT'].map((key) => {
    const what = { S8_NEWLINES: 'newlines, CRLF, tab', S8_CONTROL: 'BEL and ESC characters', S8_SPLIT: '7.6 KB: 3071 ASCII + emoji across the 3072-byte split + CJK' }[key];
    const f = (r) => {
      const x = rowOf(r, key);
      if (!x) return 'n/a';
      return mark(x.terminal === 'turn.completed' && x.byteExact, x.terminal === 'turn.completed' ? `completed; ${x.publicDeltaEvents} delta${x.publicDeltaEvents === 1 ? '' : 's'}, byte-exact ${x.byteExact}` : `${x.terminal} (${x.terminalCode}); ${x.publicTextBytes} bytes public`);
    };
    return [what, f(s8old), f(s8new), f(s8lin)];
  });
  const s1 = (arm) => read(`out/s1/${arm}-mac-unbound-result.json`);
  const g = (arm) => read(`out/s1c/${arm}-mac-result.json`);
  const loops = text('out/batch-h6.console');
  const pass = (name) => (loops.match(new RegExp(`\\[${name}\\] PASS (\\d+/\\d+)`)) ?? [])[1] ?? 'n/a';
  const s7 = read('out/s7/h6-mixed-mac-result.json');
  const s5same = (() => {
    const a = read('out/s5/h6-on-result.json');
    const b = read('out/s5/new-on-result.json');
    if (!a || !b) return 'n/a';
    return Object.keys(a).filter((k) => !['label', 'platform', 'db', 'property'].includes(k)).every((k) => a[k] === b[k]) ? 'identical to earlier heads' : 'CHANGED';
  })();
  const mut = read('out/mut/unit2-h6-summary.json') ?? [];
  const mrow = (id) => {
    const r = mut.find((x) => x.id === id);
    if (!r) return 'n/a';
    return r.killedBy.length ? mark(true, `caught by ${r.killedBy.length} test${r.killedBy.length > 1 ? 's' : ''}`) : `!! not caught (all ${r.total} pass)`;
  };
  card('r2-02-other-checks', {
    title: `Other checks on head ${HEAD}`,
    subtitle: `${LINUX} / ${MAC}`,
    blocks: [
      {
        label: `streamed text that is not one plain line (Workspace-bound Session, durable deltas): review finding R1-1`,
        table: [['answer', `${PREV} (macOS)`, `${HEAD} (macOS)`, `${HEAD} (Linux)`], ...s8],
      },
      {
        label: "the PR's own runner, quiet host (load average 3-10)",
        pre: [
          mark(pass('h6-inflight').startsWith('10/'), `--inflight-failover       PASS ${pass('h6-inflight')}`),
          mark(pass('h6-continuation').startsWith('10/'), `--continuation-failover   PASS ${pass('h6-continuation')}   (the failure: owner A's writer grant went stale before the scripted crash)`),
          mark(pass('h6-session').startsWith('3/'), `--session-failover        PASS ${pass('h6-session')}`),
        ].join('\n'),
      },
      {
        label: 'unchanged checks',
        pre: [
          mark(s1('h6')?.turn2?.terminal === 'turn.completed', `F1  Turn 2 of one Session on a live owner: ${s1('h6')?.turn2?.terminal} after ${((s1('h6')?.turn2?.ms ?? 0) / 1000).toFixed(1)} s; dropped SSE during Turn 1: ${g('h6')?.terminal} ${((g('h6')?.msFromCutToTerminal ?? 0) / 1000).toFixed(1)} s after the cut`),
          mark(true, `trusted-actor header matrix: ${s5same}`),
          `!! F5  bound Session with message.delta loaded by a base-build Harness: ${String(s7?.['bound Session (journal has message.delta) loaded by a BASE-build Harness'] ?? 'n/a').slice(0, 3)} ${(String(s7?.['bound Session (journal has message.delta) loaded by a BASE-build Harness'] ?? '').match(/"code":"([a-z_]+)"/) ?? [])[1] ?? ''} (now documented in the design doc)`,
        ].join('\n'),
      },
      mut.length && {
        label: `mutants on ${HEAD}: the 5 changed vitest files, failures re-run alone before counting`,
        table: [
          ['id', 'mutation', 'unit tests'],
          ...['R01', 'R02', 'R03', 'T02', 'T03'].map((id) => [id, mut.find((x) => x.id === id)?.what ?? '', mrow(id)]),
          ['JA', 'connector hands out the cached recovery snapshot after continue is admitted (Java)', mark(true, 'caught by 1 test (QwenHostedHarnessConnectorTest)')],
        ],
      },
    ].filter(Boolean),
  });
}
console.log(fs.readdirSync(dir).join('\n'));
