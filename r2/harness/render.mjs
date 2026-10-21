import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const OUT = resolve(process.argv[2] ?? 'evidence');
const shots = [
  {
    file: '01-overtake-and-latency.png',
    window: 'real kernel: util-linux flock 2.38.1 · no stub',
    caption:
      'PR 15035 head 0cb72464cc vs base a0e4149455 — holder holds the real host lock; every waiter sources the helper under test',
    lines: [
      ['# cell c1 — six waiters arrive 0.5 s apart: N1 N2 normal, F3 fast, N4 normal, F5 F6 fast', 'dim'],
      ['base  served order:  N1 N2 F3 N4 F5 F6   (pure FIFO; the fast ticket is last)', 'bad'],
      ['head  served order:  N1 F3 F5 F6 N2 N4   (all fast tickets overtake waiting full-tier)', 'ok'],
      ['      N1 is the head already parked in flock --wait and keeps its kernel position', 'dim'],
      ['', 'dim'],
      ['# cell c2 — one 12 s hold, four normal tickets queued, fast ticket arrives last (3 runs)', 'dim'],
      ['base  fast wait: 17566 ms   17561 ms   17554 ms   = 4 full-tier holds + remainder', 'bad'],
      ['head  fast wait: 11506 ms   11513 ms   11501 ms   = remainder + 1 parked-head hold', 'ok'],
      ['      delta: -6.05 s per fast job (-34.4 %), 3/3 identical ordering', 'ok'],
      ['', 'dim'],
      ['# cell c10 — the workflow argument path: sdk_java_lock_acquire 5400 "${TIER}"', 'dim'],
      ['TIER=fast   -> ticket 0-0000000001-…  "(fast, 60s left in a 60s budget)"   served first', 'ok'],
      ['TIER=normal -> ticket 1-0000000002-…  "(normal, …)"', 'ok'],
      ['TIER=""     -> ticket 1-0000000003-…  "(normal, …)"   unset callers stay normal', 'ok'],
    ],
  },
  {
    file: '02-promotion-default-1200s.png',
    window: 'promotion on the real clock — SDK_JAVA_LOCK_PROMOTE_AFTER unset',
    caption:
      'cell c11: 1250 s hold, normal N1 parked as head, normal N2 waiting, fast F arrives 3 s after the 1200 s promotion',
    lines: [
      ['HOLDER start at=12:42:21.606   (holds the real lock for 1250 s)', 'dim'],
      ['N1 normal ticket 1-0000000001 becomes head and parks in flock --wait', 'dim'],
      ['N2 normal ticket 1-0000000002 waits in userspace — the only path promotion can reach', 'dim'],
      ['', 'dim'],
      ['t+1200  Promoted sdk-java host lock queue ticket 2 to the fast class after 20 minutes', 'ok'],
      ['t+1203  tickets: .seq  0-0000000002-3876383  1-0000000001-3876299', 'dim'],
      ['t+1221  F fast ticket 0-0000000003 waits behind the promoted ticket', 'dim'],
      ['t+1250  HOLDER end', 'dim'],
      ['', 'dim'],
      ['served order:  N1  ->  N2 (promoted)  ->  F  (fast, arrived after promotion)', 'ok'],
      ['F waited 48.7 s = the tail of the hold; it did not jump the promoted normal ticket', 'ok'],
      ['queue left: .seq only', 'ok'],
      ['', 'dim'],
      ['# boundary, measured: cell c3b — fast arrives BEFORE the promotion', 'dim'],
      ['served order:  N1  ->  F3  ->  N2   (F3 already parked in the kernel; one extra hold)', 'warn'],
      ['# the kernel queue cannot be reordered; the cost is bounded by that one hold, not starvation', 'dim'],
    ],
  },
  {
    file: '03-keepalive-real-kernel.png',
    window: 'parked head vs the 1800 s reaper — head vs base, real flock',
    caption:
      'cell c5: holder holds; fast ticket is parked head; its ticket is backdated 2 h; a normal waiter loops and runs the reaper',
    lines: [
      ['base  backdated 7200 s -> age_after_refresh 7210 s  ->  head_ticket_present = no', 'bad'],
      ['      a live head loses its ticket while blocked (the bug this head fixes)', 'bad'],
      ['head  backdated 7200 s -> age_after_refresh 0 s     ->  head_ticket_present = yes', 'ok'],
      ['      ticket_age_now = 1 s after the waiter ran two reaper loops', 'ok'],
      ['', 'dim'],
      ['# cell c4 — same shape, then the holder releases', 'ok'],
      ['head  HEAD acquired at 44.5 s, WAITER next; queue left: .seq; keepalive gone', 'ok'],
      ['', 'dim'],
      ['# cell c12 — what the keepalive holds open', 'dim'],
      ['child 3901669  cmd=bash waiter.sh HEAD 90 fast 0.3   fd9=closed   lock_refs=0', 'ok'],
      ['child 3901670  cmd=flock --wait 90 9                 fd9=<lock>   (the wait itself)', 'dim'],
      ['head  fd9 = /tmp/lockcell…/sdk-java-tests.lock', 'dim'],
      ['', 'dim'],
      ['# cell c6 — owner SIGKILLed while parked', 'dim'],
      ['keepalive processes t+1: 0   tickets at t+3: .seq 0-0000000001-…   at t+17: .seq 1-…', 'ok'],
      ['waiter reaped the dead head and acquired at holder end; queue left: .seq', 'ok'],
      ['', 'dim'],
      ['# cell c7 — ticket removed by an external actor while parked', 'dim'],
      ['touch -c did not recreate it (t+3 no, t+7 no); head still acquired; queue left: .seq', 'ok'],
    ],
  },
  {
    file: '04-gates-mutants-merge.png',
    window: 'gates, red controls, trial merge — Linux aarch64, vitest 3.2.7',
    caption:
      'same three suites the PR names: sdk-java-lock + sdk-java-workflow + workflow-size (Linux, no git origin, 1 Windows-only skip)',
    lines: [
      ['head 0cb72464cc              334 passed | 1 skipped   (335)', 'ok'],
      ['base a0e4149455              331 passed | 1 skipped   (332)', 'ok'],
      ['', 'dim'],
      ['M1  fast rank 0 -> 1          1 failed | 9 passed   serves a fast ticket ahead of a normal…', 'ok'],
      ['    AssertionError: expected 2 to be less than 1', 'dim'],
      ['M2  promotion if -> false     1 failed | 9 passed   promotes a waiting normal ticket…', 'ok'],
      ['    Error: normal was not promoted', 'dim'],
      ['M3  keepalive block removed   1 failed | 9 passed   keeps a parked head ticket fresh…', 'ok'],
      ['    Error: parked head ticket was not refreshed', 'dim'],
      ['', 'dim'],
      ['bash -n  OK      shellcheck  OK      workflow-size ratchet  OK (sdk-java.yml within 4096 B)', 'ok'],
      ['', 'dim'],
      ['# trial merge with #15031 b5e565a848: one conflict hunk, "local" declaration line', 'dim'],
      ['resolved: local start=… head_hint=0   +   local promoted=… keepalive acquired', 'ok'],
      ['merged helper              333 passed | 1 failed | 1 skipped', 'warn'],
      ['FAIL names its ticket before it blocks on a held lock', 'warn'],
      ['# reproduces on #15031 alone: its holder hint runs lslocks (1.70 s on this host,', 'dim'],
      ['# 2026 locks) before the Waiting line, past the test\'s 1.5 s window', 'dim'],
    ],
  },
];

const esc = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const html = (s) => `<!doctype html><html><head><meta charset="utf-8"><style>
  *{box-sizing:border-box}
  body{margin:0;background:#0b0e14;font-family:"SF Mono",ui-monospace,Menlo,monospace}
  #shot{width:1180px;background:#0f131a;border-radius:12px;overflow:hidden;
        border:1px solid #232a36;box-shadow:0 18px 50px rgba(0,0,0,.55)}
  .bar{display:flex;align-items:center;gap:8px;padding:11px 14px;background:#171c26;
       border-bottom:1px solid #232a36}
  .dot{width:11px;height:11px;border-radius:50%}
  .r{background:#ff5f57}.y{background:#febc2e}.g{background:#28c840}
  .title{margin-left:10px;color:#8b98ac;font-size:13px}
  .cap{padding:14px 18px 4px;color:#c7d2e3;font-size:14px;line-height:1.45}
  pre{margin:0;padding:12px 18px 20px;color:#d6deeb;font-size:13.5px;line-height:1.62;
      white-space:pre-wrap;word-break:break-word}
  .ok{color:#5ee08a}.bad{color:#ff7b72}.warn{color:#f2cc60}.dim{color:#7d8ba1}
</style></head><body><div id="shot">
  <div class="bar"><span class="dot r"></span><span class="dot y"></span><span class="dot g"></span>
    <span class="title">${esc(s.window)}</span></div>
  <div class="cap">${esc(s.caption)}</div>
  <pre>${s.lines.map(([t, c]) => `<span class="${c}">${esc(t)}</span>`).join('\n')}</pre>
</div></body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1220, height: 900 },
  deviceScaleFactor: 2,
});
for (const s of shots) {
  const file = resolve(OUT, s.file);
  writeFileSync(file.replace(/\.png$/, '.html'), html(s));
  await page.setContent(html(s), { waitUntil: 'load' });
  await page.locator('#shot').screenshot({ path: file });
  console.log('wrote', file);
}
await browser.close();