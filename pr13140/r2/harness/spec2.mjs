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
  name: 'r2-01-findings-status',
  title: 'Round 2 @ 100250049a: status of the round-1 findings',
  sub: 'Same rig as round 1: repo-packed and release-shaped (all files 0644) npm installs, uid 1000; colima Linux 6.8 + bare-metal rk3588 5.10; macOS TUI in tmux',
  cols: '1fr 1fr',
  panels: [
    { tone: 'good', badge: 'F1 FIXED', title: 'release-shaped root install, uid 1000, helper stays root:root 0644', lines: [
      ...T([
        ['case', 'base', 'head 0b81 → 1002'],
        ['sandbox -- echo (no redirect)', 'ok', 'EPERM chmod → ok', '++ '],
        ['sandbox --verify', '4/4', 'exit 1 → 4/4', '++ '],
        ['piped stdin', 'ok', 'exit 1 → ok', '++ '],
        ['qwen -p session, bwrap closed', 'tool turn', '0 requests → tool turn', '++ '],
        ['qwen -p session, bwrap open', 'tool turn', 'tool turn', '++ '],
        ['`cmd < file` (host-backed)', 'ok', 'exit 1 → refused, exit 1', '!! '],
        ['Landlock backend', 'fails', 'fails (pre-existing)', '== '],
      ], [32, 12]) ] },
    { tone: 'good', badge: 'F2 FIXED', title: 'scanner removed; yargs owns --sandbox per command', lines: [
      ...T([
        ['argv', 'base', 'head 0b81 → 1002'],
        ['--debug mcp add -s project srv …', 'added', 'Unknown arg → added', '++ '],
        ['--sandbox=sandbox-exec mcp list', 'usage error', 'prompt → Unknown argument', '++ '],
        ['--sandbox docker / =docker / -s docker', 'lost', 'docker → docker', '++ '],
        ['-p hi --sandbox podman', 'positional err', 'podman', '++ '],
        ['--sandbox bwrap|BWRAP -p hi', 'exit 1', 'exit 52 → exit 52', '++ '],
        ['--sandbox "fix the bug" (old form)', 'seatbelt+prompt', 'exit 44 "Invalid sandbox command"', '!! '],
      ], [41, 16]) ] },
    { tone: 'good', badge: 'F3 PARTLY', title: 'read-only settings.json (dir writable): first launch now tolerated → dialog', lines: [
      ...frame('g-rofile', 0, 9, 96, 118, 'r2'), '',
      '-- but the copy inherits 0444: launch 2 and every later launch → exit 52',
      '-- "Cannot preserve malformed workspace settings … EACCES copyfile"',
      '== read-only .qwen dir: still exit 52 (author: deliberate, documented)' ] },
    { tone: 'warn', badge: 'F4', title: 'R1-3: setup failures now attested separately', lines: [
      '++ native pre-exec failures write {"state":"stdio-setup-failed"} + 125',
      '++   → parsed as payloadExitObserved:false (dirs cleaned)',
      '!! write-only stdin (`0>file`, bridge pread fails after fork), 5/5 runs:',
      '!!   "Sandbox execution status could not be confirmed. The command may',
      '!!    have run; do not automatically retry it."  payload side effect: none',
      '!!   1 sandbox-control-* + 1 qwen-sandbox-* dir retained per run',
      '== conservative and safe; a pre-fork O_ACCMODE check would make it a',
      '== clean setup failure instead (optional)' ] },
  ],
  note: 'Base = merge-base a4bf0026; "0b81 → 1002" = round-1 head vs round-2 head. $SCRATCH = session scratchpad.',
},
{
  name: 'r2-02-rerun',
  title: 'Round 2 @ 100250049a: round-1 claims re-run on the new code and helper ELF',
  sub: 'Helper ELF changed (arm64 sha256 ab54fa6b…); CI x64/arm64 pinned-Zig rebuild + Native Linux/Windows jobs green on this head',
  cols: '1fr',
  panels: [
    { tone: 'info', badge: 'RE-RUN', title: 'everything below is head 100250049a; base numbers unchanged from round 1', lines: [
      '++ operator settings (3 scopes × 2 faults × 5 entries)   exit 52 30/30, stack 0/30, repair hint 30/30, bytes+mode unchanged 30/30',
      '++ Workspace malformed → TUI dialog, Exit and restore    dialog shown; original bytes back (sha256 283714c2…)',
      '++ stale User corruption marker                          ignored (no dialog), User settings untouched',
      '',
      '.. stdin via `qwen sandbox --` (offset 17 + N)    N=0    N=7    N=4101   idle FIFO        1 MiB sha   EPIPE',
      '++ colima 6.8 · bwrap closed                       17     24     4118     0.71 s / 0.79 s  match       141',
      '++ colima 6.8 · Landlock open                      17     24     4118     0.75 s / 0.73 s  match       141',
      '++ rk3588 5.10 · bwrap 0.6.1 closed                17     24     4118     1.89 s / 1.62 s  match       141',
      '',
      '.. gcc mutants of the new stdio-relay.h            control 24/4118, FIFO ok · M1 (no lseek) 17/17 · M2 (no exit poll) TIMEOUT ×5',
      '.. PR python suites on the new arm64 ELF           stdio-relay.test.py 9/9 · sandbox-stdio.test.py 4/4 (non-root bwrap)',
      '.. prompt (fake-model ledger)                      bwrap closed: "…is closed. Closed networking prevents…" · bwrap open: "…is open" (no',
      '..                                                 closed-network sentence) · Landlock open: "Command network policy is open"',
      '.. unit, macOS                                     CLI 995 passed / 4 skipped · core prompts+sandbox 342 passed / 12 skipped' ] },
  ],
},
{
  name: 'r2-03-new-edges',
  title: 'Round 2: remaining edges (none blocking on their own)',
  sub: 'macOS built CLI + Linux container; each row reproduced end to end',
  cols: '1fr',
  panels: [
    { tone: 'warn', badge: 'E1', title: 'read-only Workspace settings.json: tolerated once, then permanent exit 52', lines: [
      '.. launch 1  exit 1 (started; fake model unreachable)   settings.json 0444, settings.json.corrupted 0444 (copyFileSync keeps mode)',
      '-- launch 2  exit 52 "Cannot preserve malformed workspace settings … EACCES … copyfile"',
      '-- launch 3  exit 52 (same)',
      '.. writable control: launch 1 resets to {}, launch 2 starts normally',
      '!! launch 1 also prints "Settings file had invalid JSON and was reset" although the reset failed',
      '== fix idea: remove an existing copy first, or chmod the copy to 0600 after copyFileSync' ] },
    { tone: 'warn', badge: 'E2', title: '`qwen sandbox` diagnostic subcommand no longer matches the default command', lines: [
      '.. argv                          base                         head 1002                     default command on head',
      '-- sandbox --sandbox / -s        whole-CLI: sandbox-exec      "none"                        --sandbox -p hi → Seatbelt',
      '-- sandbox --sandbox Docker      sandbox-exec (exit 1)        Invalid sandbox command       --sandbox Docker -p hi → docker',
      '== coerce/lowercasing is attached only to the default command; the subcommand reads the raw string' ] },
    { tone: 'warn', badge: 'E3', title: 'host-backed stdin on a release-shaped install; old `--sandbox "query"` form', lines: [
      '!! uid 1000, helper root:root 0644: `qwen sandbox -- cat < file` → "Host-backed stdin requires the Linux x64/arm64',
      '!!   input helper." on arm64 (helper present but not executable); base copied the bytes. Packaging the helper 0755',
      '!!   (the published tarball strips all exec bits) would remove this and the Landlock case.',
      '!! `qwen --sandbox "fix the bug"` → exit 44 "Invalid sandbox command \'fix the bug\'. Must be one of docker, podman,',
      '!!   sandbox-exec" — documented break; the error could name `--sandbox=true "query"` / `--sandbox -p`.' ] },
  ],
},
];
