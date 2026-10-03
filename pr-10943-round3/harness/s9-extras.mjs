// S9 — edges the earlier rounds did not drive: the exact trigger shape of the
// two silent-exit-0 threads, an oversize prompt, and concurrent cold launches.
import * as L from './lib.mjs';

const C = new L.Checks('s9-extras');
const T = new L.Transcript('s9-extras');
const VERSION = /^\d+\.\d+\.\d+\S*\n$/;
const jobs = (sc) => {
  try {
    return L.execFileSync('ls', [L.jobsDir(sc)]).toString().trim().split('\n').filter(Boolean);
  } catch {
    return [];
  }
};
const extra = {};

T.title('Trigger shape of R10-3 / R15-1: a separate -v/--version argv word (prompt-led, or after a leading help)');
for (const [id, argv, want] of [
  ['bot example: document the --version flag --bg', ['document', 'the', '--version', 'flag', '--bg'], 'silent'],
  ['word-split $TASK="audit -v this" then --bg', ['audit', '-v', 'this', '--bg'], 'silent'],
  ['same text quoted as one word', ['BGPONG audit -v this', '--bg'], 'dispatch'],
  ['help-led, no version word', ['help', 'me', 'fix', 'the', 'build', '--bg'], 'loud'],
  ['prompt-led ending in help (bounced to parser by design)', ['audit', 'help', '--bg'], 'usage'],
]) {
  const sc = L.scenario('head', `s9-${id.replace(/[^a-z]/gi, '').slice(0, 12)}`);
  const r = L.qwen(sc, argv);
  await L.sleep(500);
  const d = jobs(sc).length;
  T.cmd(`qwen ${argv.map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(' ')}`);
  T.out(r.stdout.split('\n')[0]);
  T.err(r.stderr.split('\n').find((l) => l.trim()) ?? '');
  T.w(`\x1b[2m[exit ${r.code}] sessions=${d}\x1b[0m\n`);
  const ok =
    want === 'silent'
      ? r.code === 0 && VERSION.test(r.stdout) && r.stderr.trim() === '' && d === 0
      : want === 'dispatch'
        ? r.code === 0 && d === 1
        : want === 'usage'
          ? r.code === 0 && /^Usage: qwen/m.test(r.stdout) && d === 0
          : r.code === 1 && /Unknown argument: bg/.test(r.stderr) && d === 0;
  C.check(`${want}: ${id}`, ok, `exit ${r.code} sessions=${d}`);
  L.killScenario(sc);
}

// Oversize prompt: refused before anything is recorded, exit 1 (not 2).
{
  const sc = L.scenario('head', 's9-big');
  const big = 'BGPONG ' + 'x'.repeat(20 * 1024);
  const r = L.qwen(sc, ['--bg', big]);
  await L.sleep(500);
  T.blank();
  T.cmd('qwen --bg "<20 KiB prompt>"');
  T.err(r.stderr.trim().slice(0, 200));
  T.exit(r.code, r.ms);
  C.check('oversize-prompt.refused-exit1-nothing-recorded', r.code === 1 && jobs(sc).length === 0 && r.stderr.trim() !== '', `exit ${r.code}: ${r.stderr.trim().slice(0, 140)}`);
  extra.oversize = { code: r.code, stderr: r.stderr.trim().slice(0, 400) };
  L.killScenario(sc);
}

// Three cold launches at once into one home: one supervisor, three sessions.
{
  const sc = L.scenario('head', 's9-conc');
  const runs = await Promise.all(
    [1, 2, 3].map(
      (i) =>
        new Promise((resolve) => {
          const t0 = Date.now();
          const c = L.spawn(L.NODE, [sc.entry, '--bg', `BGWRITE:${L.path.join(sc.cwd, `c${i}.txt`)}`], { cwd: sc.cwd, env: sc.env });
          let out = '';
          let err = '';
          c.stdout.on('data', (d) => (out += d));
          c.stderr.on('data', (d) => (err += d));
          c.on('exit', (code) => resolve({ i, code, out, err, ms: Date.now() - t0 }));
        }),
    ),
  );
  await L.sleep(1000);
  const sups = L.scenarioPids(sc).filter((p) => L.role(p) === 'supervisor');
  const files = await L.waitFor(() => [1, 2, 3].every((i) => L.existsSync(L.path.join(sc.cwd, `c${i}.txt`))), { timeout: 40_000 });
  T.blank();
  T.cmd('for i in 1 2 3; do qwen --bg "BGWRITE:c$i.txt" & done; wait   # cold, same home');
  for (const r of runs) T.out(`#${r.i} exit ${r.code} ${(r.ms / 1000).toFixed(2)} s  ${(r.out.split('\n')[0] || r.err.trim()).slice(0, 90)}`);
  T.note(`supervisors: ${sups.length}; sessions recorded: ${jobs(sc).length}; all three files written: ${!!files}`);
  C.check('concurrent-cold.all-exit0', runs.every((r) => r.code === 0), runs.map((r) => r.code).join(','));
  C.check('concurrent-cold.one-supervisor', sups.length === 1, `${sups.length}`);
  C.check('concurrent-cold.three-sessions-ran', jobs(sc).length === 3 && !!files);
  extra.concurrent = runs;
  L.killScenario(sc);
}
C.save(extra);
process.exit(0);
