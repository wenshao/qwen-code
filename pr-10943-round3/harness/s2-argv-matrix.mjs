// S2 — entry argv matrix on the shipped bin, both arms, one fresh home per row.
import * as L from './lib.mjs';

const ARM = process.env.ARM;
if (ARM !== 'head' && ARM !== 'base') throw new Error('ARM=head|base required');
const C = new L.Checks(`s2-argv-${ARM}`);
const T = new L.Transcript(`s2-argv-${ARM}`);
const VERSION = /^\d+\.\d+\.\d+\S*\n$/;
const UNKNOWN_BG = /Unknown arguments?: .*\bbg\b/;

// [id, argv, expectations per arm]. `d` = a session must (true) / must not
// (false) be dispatched. Rows tagged with an open thread id reproduce it.
const ROWS = [
  ['bare --bg', ['--bg'], {
    head: { code: 1, err: /qwen --bg needs a prompt/, d: false, sup: false },
    base: { code: 1, err: UNKNOWN_BG, d: false } }],
  ['flag-led prompt', ['--bg', 'BGPONG flag-led'], {
    head: { code: 0, out: /^Started background session/, d: true, prompt: 'BGPONG flag-led' },
    base: { code: 1, err: UNKNOWN_BG, d: false } }],
  ['prompt-led prompt', ['BGPONG prompt-led', '--bg'], {
    head: { code: 0, out: /^Started background session/, d: true, prompt: 'BGPONG prompt-led' },
    base: { code: 1, err: UNKNOWN_BG, d: false } }],
  ['dash prompt after --', ['--bg', '--', '-repro'], {
    head: { code: 0, d: true, prompt: '-repro' },
    base: { code: 1, err: UNKNOWN_BG, d: false } }],
  ['quoted -v inside one token', ['--bg', 'BGPONG audit -v release'], {
    head: { code: 0, d: true, prompt: 'BGPONG audit -v release' },
    base: { code: 1, err: UNKNOWN_BG, d: false } }],
  ['flag-led prompt ending in help', ['--bg', 'BGPONG', 'write', 'help'], {
    head: { code: 0, d: true, prompt: 'BGPONG write help' },
    base: { code: 0, out: /^Usage: qwen/, d: false } }],
  ['--bg after -- is data', ['-p', 'BGPONG data', '--', '--bg'], { parity: true, head: { d: false }, base: { d: false } }],
  ['other flag declines by name', ['--bg', '--model', 'x', 'task'], {
    head: { code: 1, err: /does not honor --model/, d: false },
    base: { code: 1, err: UNKNOWN_BG, d: false } }],
  ['main-merged recovery flag declines', ['--bg', '--workspace-recovery-worker'], {
    head: { code: 1, err: /does not honor --workspace-recovery-worker/, d: false },
    base: { code: 1, err: /Unknown arguments?:/, d: false } }],
  ['--bg false = off', ['--bg', 'false', 'hello'], { parity: true, head: { d: false }, base: { d: false } }],
  ['--bg=true (attached ON)', ['--bg=true', 'audit'], { parity: true, head: { d: false }, base: { d: false } }],
  ['--version --bg keeps version', ['--version', '--bg'], {
    head: { code: 0, out: VERSION, d: false }, base: { code: 0, out: VERSION, d: false } }],
  ['--bg -v audit declines (fixed earlier)', ['--bg', '-v', 'audit'], {
    head: { code: 1, err: /does not honor -v/, d: false },
    base: { code: 0, out: VERSION, d: false } }],
  ['R10-3 fixed half: audit this --bg -v', ['audit', 'this', '--bg', '-v'], {
    head: { code: 1, err: /does not honor -v/, d: false },
    base: { code: 0, out: VERSION, d: false } }],
  ['R10-3 OPEN: audit -v this --bg', ['audit', '-v', 'this', '--bg'], {
    head: { code: 0, out: VERSION, d: false, silent: true },
    base: { code: 0, out: VERSION, d: false } }],
  ['R15-1 OPEN: help me fix the build --bg', ['help', 'me', 'fix', 'the', 'build', '--bg'], { parity: true, head: { d: false }, base: { d: false } }],
  ['R15-1 OPEN: help me fix --bg -v', ['help', 'me', 'fix', '--bg', '-v'], {
    head: { code: 0, out: VERSION, d: false, silent: true },
    base: { code: 0, out: VERSION, d: false } }],
  ['R13-2 fixed: --yolo --internal-agent-view-supervisor', ['--yolo', '--internal-agent-view-supervisor'], {
    head: { code: 1, err: /Unknown arguments?:/, d: false, sup: false },
    base: { code: 1, err: /Unknown arguments?:/, d: false } }],
  ['R13-2 fixed: --yolo --internal-agent-view-pty-host do it', ['--yolo', '--internal-agent-view-pty-host', 'do', 'it'], {
    head: { code: 1, err: /Unknown arguments?:/, d: false },
    base: { code: 1, err: /Unknown arguments?:/, d: false } }],
  ['subcommand-led keeps parser: sessions ps --bg', ['sessions', 'ps', '--bg'], { parity: true, head: { d: false }, base: { d: false } }],
];

function jobs(sc) {
  try {
    return L.execFileSync('ls', [L.jobsDir(sc)]).toString().trim().split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

const observed = [];
let n = 0;
for (const [id, argv, exp] of ROWS) {
  const sc = L.scenario(ARM, `s2-${String(++n).padStart(2, '0')}`);
  const r = L.qwen(sc, argv, { timeout: 45_000 });
  await L.sleep(600);
  const j = jobs(sc);
  const sup = L.scenarioPids(sc).some((p) => L.role(p) === 'supervisor');
  const launch = j[0] ? L.readJson(L.path.join(L.jobsDir(sc), j[0], 'launch.json')) : undefined;
  const promptArg = launch?.argv?.find((a) => a.startsWith('--prompt-interactive='))?.slice('--prompt-interactive='.length);
  const errLine = r.stderr.split('\n').map((l) => l.trim()).filter((l) => l && !/^(at |Node\.js|\^|DeprecationWarning)/.test(l));
  const o = { id, argv, code: r.code, stdout: r.stdout.slice(0, 300), stderr: errLine.slice(0, 4).join(' | ').slice(0, 400), dispatched: j.length, supervisor: sup, prompt: promptArg, ms: r.ms };
  observed.push(o);
  const e = exp[ARM];
  let ok = true;
  const why = [];
  if (e.code !== undefined && r.code !== e.code) (ok = false), why.push(`code ${r.code}≠${e.code}`);
  if (e.out && !e.out.test(r.stdout)) (ok = false), why.push(`stdout ${JSON.stringify(r.stdout.slice(0, 80))}`);
  if (e.err && !e.err.test(r.stderr)) (ok = false), why.push(`stderr ${JSON.stringify(o.stderr.slice(0, 120))}`);
  if (e.d !== undefined && (j.length > 0) !== e.d) (ok = false), why.push(`dispatched=${j.length}`);
  if (e.sup === false && sup) (ok = false), why.push('supervisor started');
  if (e.prompt !== undefined && promptArg !== e.prompt) (ok = false), why.push(`prompt ${JSON.stringify(promptArg)}`);
  if (e.silent && r.stderr.trim() !== '') (ok = false), why.push('not silent');
  C.check(`${ARM}: ${id}`, ok, `${o.code} ${why.join('; ')}`);
  T.cmd(`qwen ${argv.map((a) => (/[\s]/.test(a) ? JSON.stringify(a) : a)).join(' ')}`);
  T.out(r.stdout.trim().split('\n').slice(0, 2).join('\n'));
  T.err(errLine.slice(0, 1).join('\n').slice(0, 150));
  T.w(`\x1b[2m[exit ${r.code}] dispatched=${j.length}${promptArg !== undefined ? ` prompt=${JSON.stringify(promptArg)}` : ''}\x1b[0m\n`);
  L.killScenario(sc);
}

C.save({ observed });
process.exit(0);
