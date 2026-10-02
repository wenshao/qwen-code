import fs from 'node:fs';
const S = '/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/4bc58a7c-2b06-4022-98dd-e3f296888d77/scratchpad';
const strip = (t) => t.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/\x1b\][^\x07]*\x07/g, '').split(`${S}/`).join('$SCRATCH/');
const wrap = (l, w = 116) => { const out = []; let s = l; while (s.length > w) { let i = s.lastIndexOf(' ', w); if (i < 40) i = w; out.push(s.slice(0, i)); s = '    ' + s.slice(i).trimStart(); } out.push(s); return out; };
const joined = (n, w = 116) => strip(fs.readFileSync(`${S}/shots/wide/${n}.joined.txt`, 'utf8')).split('\n').map((l) => l.trimEnd()).filter(Boolean).flatMap((l) => wrap(l, w));
function frame(n, from, to, boxWidth, cut = 118, dir = 'wide') {
  const ls = strip(fs.readFileSync(`${S}/shots/${dir}/${n}.ansi`, 'utf8')).split('\n').slice(from, to + 1).map((l) => l.trimEnd());
  if (!boxWidth) return ls.map((l) => l.slice(0, cut));
  return ls.map((l) => {
    const m = l.match(/^(\s*)([╭│╰])(.*)$/);
    if (!m) return l;
    if (m[2] === '╭') return `${m[1]}╭${'─'.repeat(boxWidth)}╮`;
    if (m[2] === '╰') return `${m[1]}╰${'─'.repeat(boxWidth)}╯`;
    return `${m[1]}│${m[3].replace(/│\s*$/, '').trimEnd().padEnd(boxWidth)}│`;
  });
}
const tag = (prefix, ls) => ls.map((l) => prefix + l);


const T = (rows, w) => rows.map((r) => (r[3] ?? '.. ') + r.slice(0, 3).map((c, i) => (i < 2 ? c.padEnd(w[i]) : c)).join(''));

export const cards = [
{
  name: 'r3-01-edges-status',
  title: 'Round 3 @ 468cb46644: status of the round-2 edges',
  sub: 'macOS built CLI (TUI in tmux) + Linux container installs, uid 1000 · base a4bf0026 · R2 = 100250049a',
  cols: '1fr 1fr',
  panels: [
    { tone: 'good', badge: 'E1 FIXED', title: 'read-only Workspace settings.json (dir writable), headless relaunches', lines: [
      ...T([
        ['launch', 'R2 head', 'R3 head'],
        ['1', 'starts', 'starts', '++ '],
        ['2', 'exit 52 (EACCES copyfile)', 'starts', '++ '],
        ['3', 'exit 52', 'starts', '++ '],
        ['startup warning', '"…was reset"', '"Workspace settings had invalid JSON"', '++ '],
      ], [18, 28]),
      '',
      '++ TUI Exit and restore on the read-only file: original bytes kept (sha256 283714c2…),',
      '++   copy removed, next launch starts again' ] },
    { tone: 'good', badge: 'E2 FIXED', title: '`qwen sandbox` report now uses the default-command grammar', lines: [
      ...T([
        ['argv', 'R2 head', 'R3 head'],
        ['sandbox --sandbox / -s', '"none"', 'whole-CLI: sandbox-exec', '++ '],
        ['sandbox --sandbox Docker', 'Invalid sandbox command', 'whole-CLI: docker', '++ '],
        ['sandbox --sandbox=TRUE', '—', 'whole-CLI: sandbox-exec', '++ '],
        ['sandbox --sandbox 0', '—', 'none', '++ '],
      ], [26, 25]),
      '',
      '++ R1-4 stays fixed: --debug mcp add -s project … adds; --sandbox=X mcp list → Unknown argument' ] },
    { tone: 'warn', badge: 'E3 DEFERRED', title: 'author deferred all three; observed unchanged', span: 2, lines: [
      '!! release-shaped install (helper root:root 0644), uid 1000: `qwen sandbox -- cat < file` refused, "requires the Linux x64/arm64 input helper"',
      '!! `qwen --sandbox "query"` → exit 44 "Invalid sandbox command" (documented break; no migration hint). Same for published @qwen-code/sdk 0.1.17',
      '!!   when `sandbox: true` is followed by a positional `extraArgs` entry; the SDKs in this PR now emit --sandbox=true',
      '!! write-only stdin (`0>file`): "status could not be confirmed", payload did not run, 1 control + 1 scratch dir kept per run (5/5)' ] },
  ],
},
{
  name: 'r3-02-new-criticals',
  title: 'Round 3: the bot\'s new Critical items, reproduced before and verified after',
  sub: 'R3-1 on macOS (headless, isolated HOME) · R3-2 / R3-5 through `qwen sandbox --` in the Linux container (bwrap closed; Landlock identical)',
  cols: '1fr',
  panels: [
    { tone: 'good', badge: 'R3-1', title: 'malformed Workspace settings.json that is not a plain private file (base = pre-existing bug)', lines: [
      ...T([
        ['shape', 'base a4bf0026', 'R3 head'],
        ['symlink → file outside workspace', 'outside → {} ; its "secret" bytes copied into ws/.qwen', 'exit 52, outside intact, no copy', '++ '],
        ['hard link shared with outside file', 'outside → {} ; bytes copied into ws/.qwen', 'exit 52, outside intact, no copy', '++ '],
        ['.qwen dir is a symlink to outside', 'outside file rewritten, copy left outside', 'exit 52, outside intact, no copy', '++ '],
        ['valid JSON via symlink (control)', 'loads, untouched', 'loads, untouched', '.. '],
        ['private 0600 malformed file', 'copy 0600', 'copy 0600', '.. '],
      ], [37, 56]) ] },
    { tone: 'good', badge: 'R3-2', title: 'payload writes into its own stdin queue (regular-file stdin)', lines: [
      ...T([
        ['payload', 'R2 head (pipe)', 'R3 head (socketpair, SHUT_WR)'],
        ['echo x > /dev/stdin; head -c 5; exit 7  (12 B)', 'exit 1 "could not be confirmed", offset 0', 'ENXIO, exit 7, offset 5', '++ '],
        ['same, 200 KB input', 'HANG (24 s timeout), offset 0', 'ENXIO, exit 7, offset 5', '++ '],
        ['os.write(0, …) after reading 5 B', 'EBADF, exit 7, offset 5', 'EPIPE→SIGPIPE 141, offset 5', '.. '],
      ], [48, 45]) ] },
    { tone: 'good', badge: 'R3-5', title: 'stderr already written (4 MiB + "ERR-TAIL") when stdout hits EPIPE; slow stderr reader', lines: [
      ...T([
        ['arm', 'stderr bytes delivered', 'tail'],
        ['base a4bf0026', '4,194,577 (all)', 'ERR-TAIL', '.. '],
        ['R1 0b81 / R2 1002 heads', '61,441–61,761 (3/3 runs each)', 'lost', '-- '],
        ['R3 head', '4,194,633 / 4,194,647 (bwrap / Landlock)', 'ERR-TAIL', '++ '],
      ], [28, 44]),
      '',
      '!! this regression was present in the heads I verified in rounds 1 and 2; my slow-reader case did not combine EPIPE with pending stderr' ] },
  ],
},
{
  name: 'r3-03-rerun',
  title: 'Round 3: socket-transport stdin bridge re-run (new ELF, arm64 sha256 4a6025dc…)',
  sub: 'colima Linux 6.8 (bwrap 0.8.0 + Landlock) and bare-metal rk3588 5.10 (bwrap 0.6.1), uid 1000, through `qwen sandbox --`',
  cols: '1fr',
  panels: [
    { tone: 'info', badge: 'RE-RUN', title: 'file opened at offset 17; payload reads N bytes', lines: [
      '.. env / backend                   N=0  N=1  N=7  N=4095  N=4096  N=4097  N=4101  N=65536  N=300000  idle FIFO     EPIPE',
      '++ colima 6.8 · bwrap closed        17   18   24   4112    4113    4114    4118    65553    300017    0.52/0.30 s   141',
      '++ colima 6.8 · Landlock open       17   18   24   4112    4113    4114    4118    65553    300017    0.52/0.54 s   141',
      '++ rk3588 5.10 · bwrap 0.6.1        17   18   24   4112    4113    4114    4118    65553    300017    1.63/1.61 s   141',
      '',
      '.. socket-type stdin, 10 programs vs native: cat|wc, wc -l, sort, tail -n 1, awk, bash read, dd, node, python → identical;',
      '..   `stat /dev/stdin` reports "socket" (pipe on R2, regular file natively). 1 MiB sha256 matches; 12.5 MiB + distinct tails intact.' ] },
    { tone: 'good', badge: 'MUTATION', title: 'gcc-built mutants of the new stdio-relay.h swapped into the installed CLI', lines: [
      ".. variant                         my CLI matrix (9 offsets, FIFO, injection)      PR stdio-relay.test.py",
      "++ control                         9/9, FIFO 0.5 s, injection exit 7 / offset 5    10/10",
      "-- M1 drop post-exit lseek         1/9 (offset stays 17)                           —",
      "-- M2 skip child-exit poll         0/9, every case TIMEOUT                         —",
      "-- M3 skip post-exit recv drain    0/9 (offset overshoots, e.g. 180224)            10 failures",
      "!! M4 drop SHUT_WR                 9/9 (survives: reopen blocked by socket type)   1 failure (direct write must EPIPE)",
      "",
      ".. PR suites on the new ELF: stdio-relay.test.py 10/10 · sandbox-stdio.test.py 4/4 (non-root bwrap)" ] },
  ],
},
];
