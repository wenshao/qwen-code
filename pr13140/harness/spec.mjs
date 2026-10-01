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

export const cards = [
{
  name: '01-operator-settings',
  title: 'Malformed / unreadable operator settings → one repair message, exit 52',
  sub: 'Built CLI, macOS arm64, isolated HOME + System paths · base a4bf0026 (merge-base) vs head 0b81fc58 · real tmux TTY frames',
  cols: '1fr 1fr',
  panels: [
    { tone: 'bad', badge: 'BEFORE base', title: 'interactive `qwen`, malformed User settings.json', lines: [...tag('-- ', joined('op-base', 92).slice(0, 2)), ...joined('op-base', 92).slice(2, -1), '-- ' + joined('op-base', 92).at(-1)] },
    { tone: 'good', badge: 'AFTER head', title: 'same fixture', lines: [...joined('op-pr', 92).slice(0, -1), '', '++ ' + joined('op-pr', 92).at(-1)] },
    { tone: 'info', badge: 'MATRIX', title: '3 operator scopes × {malformed, unreadable} × 5 non-TTY entries = 30 cases per arm', span: 2, lines: [
      '## entries: qwen -p · qwen mcp list · qwen serve --port 0 · qwen --acp · qwen sandbox   (scopes: User, System, SystemDefaults)',
      '',
      '                                   base a4bf0026                      head 0b81fc58',
      'exit code                          1 in 30/30                         52 in 30/30',
      'stack trace printed                24/30 (7 frames each)              0/30',
      '"unexpected critical error"        18/30 (-p, serve, --acp)           0/30',
      'repair instruction in message      0/30                               30/30 ("Repair the JSON object…" / "Restore read access…")',
      'original bytes + mode unchanged    30/30                              30/30',
      'interactive TTY (tmux)             stack, EXIT=1                      single message, EXIT=52',
    ] },
  ],
  note: 'Paths are shortened: $SCRATCH = the session scratchpad. Bytes were already preserved on base; the change is the error shape and exit code.',
},
];

cards.push({
  name: '02-workspace-recovery',
  title: 'Workspace-only corruption recovery reaches the dialog; stale User markers no longer revive',
  sub: 'Built CLI TUI in tmux (230 cols), macOS arm64 · malformed <ws>/.qwen/settings.json = {"ui": {"hideTips": true,  (sha256 283714c2…)',
  cols: '1fr 1fr',
  panels: [
    { tone: 'bad', badge: 'BEFORE base', title: 'malformed Workspace settings → TUI starts, no dialog', lines: [
      ...frame('ws-base', 1, 6, 0, 100), ...frame('ws-base', 13, 15, 0, 100),
      '', '-- <ws>/.qwen/settings.json silently rewritten to {}',
      '-- copy kept as settings.json.corrupted but never offered (dialog read the User result)' ] },
    { tone: 'good', badge: 'AFTER head', title: 'same fixture → recovery dialog', lines: [
      ...frame('ws-pr', 0, 9, 100), '',
      '++ Enter (Exit and restore) → settings.json back to the original bytes (sha256 283714c2…),',
      '++ .corrupted copy removed, process exits (EXIT=1)' ] },
    { tone: 'bad', badge: 'BEFORE base', title: 'inherited stale USER marker (QWEN_CODE_SETTINGS_CORRUPTED_PATH) + valid User settings', lines: [
      ...frame('mk-base', 0, 9, 100), '',
      '-- default Enter overwrote the VALID User settings.json with the stale copy:',
      '-- {"old": "stale corrupted copy from an earlier run"' ] },
    { tone: 'good', badge: 'AFTER head', title: 'same marker → ignored (only a matching Workspace copy is offered)', lines: [
      ...frame('mk-pr', 1, 6, 0, 100), ...frame('mk-pr', 13, 15, 0, 100), '',
      '++ no dialog; User settings.json untouched (auth/model keys intact)' ] },
    { tone: 'warn', badge: 'TRADE-OFF', title: 'triage Stage 2 items #1 / #2 reproduced (qwen -p, unreachable fake model)', span: 2, lines: [
      'case                                             base a4bf0026                               head 0b81fc58',
      'read-only <ws>/.qwen dir (copy cannot be made)   starts, Workspace settings silently ignored  exit 52 "Cannot preserve malformed workspace settings …"',
      'read-only settings.json in a writable dir        starts, .corrupted copy left                 exit 52 "EACCES … open …", .corrupted copy left behind',
      'operator policy present + malformed Workspace    exit 52, no copy, bytes kept                 exit 52, no copy, bytes kept (unchanged)',
      '',
      '!! Workspace settings cannot affect confinement; a read-only checkout with a bad .qwen/settings.json now cannot start at all.' ] },
  ],
  note: 'Paths shortened ($SCRATCH = session scratchpad). Base "exit 1" in the trade-off rows is the unreachable fake model after a successful start.',
});

cards.push({
  name: '03-stdin-bridge',
  title: 'Host-backed stdin through `qwen sandbox --` on real Linux kernels',
  sub: 'Installed npm tarballs of base/head, uid 1000 · colima VM kernel 6.8 (Landlock LSM on), bwrap 0.8.0 · bare-metal rk3588 5.10 bwrap 0.6.1',
  cols: '1fr',
  panels: [
    { tone: 'info', badge: 'E2E', title: 'payload reads N bytes from a regular file opened at offset 17; caller checks the shared offset afterwards', lines: [
      '.. environment / backend           arm    N=0 → 17      N=7 → 24      N=4101 → 4118   1 MiB sha256   idle-FIFO writer      dir stdin → fd0',
      '++ colima 6.8 · bwrap closed       head   17            24            4118            match          0.61 s / 0.62 s       pipe:',
      '-- colima 6.8 · bwrap closed       base   262161        262161        262161          match          TIMEOUT 20 s ×2       socket:',
      '++ colima 6.8 · Landlock open      head   17            24            4118            match          0.63 s / 0.64 s       pipe:',
      '-- colima 6.8 · Landlock open      base   262161        262161        262161          match          TIMEOUT 20 s ×2       socket:',
      '++ rk3588 5.10 · bwrap closed      head   17            24            4118            match          1.67 s / 1.89 s       pipe:',
      '-- rk3588 5.10 · bwrap closed      base   262161        262161        262161          match          TIMEOUT 20 s ×2       socket:',
      '',
      '== both arms: a connected TCP stdin stays readable+writable; a fresh IP connect is refused under bwrap closed (allowed under Landlock open);',
      '== 12.5 MiB stdout + distinct TAIL-OUT/TAIL-ERR through slow readers intact; `qwen sandbox -- yes | head -1` → 141.',
      '!! limitation (not a regression): `head -n 1` leaves native offset 10 but 8192 through the pipe (base: 20000).' ] },
    { tone: 'good', badge: 'MUTATION', title: 'helper rebuilt with gcc from head source, swapped into the installed head CLI (bwrap closed)', lines: [
      '.. helper variant                                   N=7 offset   N=4101 offset   idle-FIFO cases',
      '++ control (unmodified source)                   24           4118            0.63 s / 0.69 s',
      '-- M1: post-exit lseek removed                   17           17              0.60 s / 0.62 s',
      '-- M2: child-exit poll skipped until FIFO EOF    TIMEOUT      TIMEOUT         TIMEOUT 20 s ×2',
      '',
      '== the CLI path really runs relay → qwen-landlock-run --relay-stdin → backend → payload; both mutants are caught.',
      '== PR tests on Linux arm64: stdio-relay.test.py 9/9, sandbox-stdio.test.py 4/4 (non-root bwrap).' ] },
  ],
});

cards.push({
  name: '04-install-shape',
  title: 'Finding: bwrap now hard-depends on an executable Landlock helper in the install',
  sub: 'Published @qwen-code/qwen-code@0.24.7 tarball ships every file 0644 · `npm i -g` as root → helper root:root 0644 · CLI run by uid 1000',
  cols: '1fr',
  panels: [
    { tone: 'warn', badge: 'FINDING', title: 'tools.executionSandbox = {bwrap | auto, workspace-write, closed}; no stdin redirect involved', lines: [
      '.. install (root-owned)                         arm    qwen sandbox -- echo   sandbox --verify   qwen -p (fake model, shell tool)',
      '.. repo-packed tarball, helper 0755          base   ok                     4/4                tool ran, turn done',
      '.. repo-packed tarball, helper 0755          head   ok                     4/4                tool ran, turn done',
      '.. release-shaped tarball, helper 0644       base   ok                     4/4                tool ran, turn done',
      '-- release-shaped tarball, helper 0644       head   exit 1                 exit 1             exit 1, stack, 0 model requests',
      '',
      '-- Sandbox capability probe failed: bwrap: EPERM: operation not permitted, chmod',
      "--   '/opt/head-rel/lib/node_modules/@qwen-code/qwen-code/vendor/landlock-run/arm64-linux/qwen-landlock-run'",
      '',
      '== executeBwrap() → resolveStdinBridge() → resolveLandlockRunner() → chmodSync(0o755): the probe itself takes this path.',
      '== One root run heals it (644 → 755), and CI runs from a git checkout (0755) — which is why neither CI nor the author saw it.',
      '== Landlock already had this dependency on base (base-rel Landlock also fails); the PR extends it to bwrap.' ] },
    { tone: 'good', badge: 'CANDIDATE', title: 'resolveStdinBridge(): treat an unresolvable helper as absent (try { … } catch { return undefined })', lines: [
      '++ release-shaped head + candidate, uid 1000: probe passed, --verify 4/4, `qwen -p` tool turn done, piped stdin ok',
      '++ host-backed file stdin still fails closed: "Host-backed stdin requires the Linux x64/arm64 input helper." (exit 1)',
      '== helper stays root:root 0644 throughout (no install mutation needed).' ] },
  ],
});

cards.push({
  name: '05-args-prompt-about',
  title: 'Named --sandbox values, prompt network policy, About and TMPDIR wording',
  sub: 'Built CLI · flags on macOS (isolated HOME) · prompt/About/TMPDIR in the Linux container, bwrap closed unless noted',
  cols: '1fr',
  panels: [
    { tone: 'info', badge: 'ARGS', title: '`qwen sandbox <flag>` report line (no executionSandbox configured)', lines: [
      'flag                          base a4bf0026                                         head 0b81fc58',
      '--sandbox docker              sandbox-exec; "docker" run as a command (exit 1)      whole-CLI backend: docker (exit 0)',
      '--sandbox=docker              "none" (selection dropped)                            whole-CLI backend: docker',
      '-s docker / --sandbox Docker  sandbox-exec, exit 1                                  whole-CLI backend: docker',
      '--sandbox sandbox-exec        exit 1 (value became a command)                       sandbox-exec, exit 0',
      '--sandbox bwrap -p hi         migration message, exit 1                             migration message, exit 52',
      '--sandbox BWRAP -p hi         "Cannot use both a positional prompt and -p"          migration message, exit 52',
      '-p hi -- --sandbox bwrap      literal tokens, no refusal                            literal tokens, no refusal',
      'SANDBOX=Docker (inherited)    "none"                                                "inherited whole-CLI marker: Docker" (verbatim case)' ] },
    { tone: 'warn', badge: 'R1-4', title: 'normalizeSandboxArguments rewrites -s/--sandbox for every subcommand (bot review, confirmed)', lines: [".. argv (isolated HOME, no auth)               base a4bf0026                           head 0b81fc58","-- --debug mcp add -s project srv npx -y foo   server added to project settings (0)    Unknown argument: sandbox (exit 1), nothing added",".. mcp add -s project srv npx -y foo           added (0)                               added (0)   (MCP fast path, normalizer not used)","-- --sandbox=sandbox-exec mcp list             mcp usage error (exit 1)                relaunched under Seatbelt as a PROMPT \"mcp list\"","-- --sandbox sandbox-exec mcp list             mcp usage error (exit 1)                same: no mcp dispatch, agent prompt path","","== bot review R1-4 entrances (1) and (2) reproduce end-to-end; entrance (3) (token eaten from a positional prompt) not re-run."] },
    { tone: 'info', badge: 'PROMPT', title: 'system prompt recorded by a fake OpenAI server (real headless session + one shell tool call)', lines: [
      '-- base  bwrap closed : "command network access follows the operator policy"',
      '++ head  bwrap closed : "command network policy is closed. Closed networking prevents new ordinary IP connections, not',
      '++                       access through existing caller-provided standard streams."   (tool: fresh connect → errno 101)',
      '++ head  Landlock open: "Command network policy is open."                            (tool: fresh connect → 0)' ] },
    { tone: 'info', badge: 'ABOUT / VERIFY', title: '/about in the TUI and `qwen sandbox --verify` with TMPDIR naming an ordinary file', lines: [
      '-- base  Runtime  Node.js v22.23.2 / npm unavailable in tool sandbox',
      '++ head  Runtime  Node.js v22.23.2 / npm not probed (tool execution sandbox active)',
      '-- base  TMPDIR=~/not-a-dir: "Sandbox capability probe failed: bwrap: ENOTDIR … mkdtemp …"',
      '++ head  TMPDIR=~/not-a-dir: "Cannot create verification fixture in host temporary directory /home/node/not-a-dir: ENOTDIR …',
      '++        Check TMPDIR and its permissions; this failure does not test the sandbox boundary."   (exit 1 both)' ] },
  ],
});
