// VERIFICATION RIG ONLY (PR #13247) S3: settlement probe verdicts on real filesystem shapes (macOS APFS host).
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { Report, ensureWorkspace, createSession, waitTurn, j, RUN, WS, ST } from './lib.mjs';
import { pubChange, opId, waitCwdOp, binding, cwdOpRow, ctxEvents, mkdirWs } from './cwd.mjs';

const R = new Report(process.env.NAME ?? 's3-settlement');
ensureWorkspace(WS, `st-${ST}`);
const root = fs.realpathSync(`${RUN}/ws/${ST}`);
const outside = `${RUN}/outside-${Date.now()}`;
fs.mkdirSync(outside, { recursive: true });
const tag = Date.now() % 100000;
const P = (n) => `s3-${tag}-${n}`;
mkdirWs(ST, `${P('ok')}/sub`);
fs.writeFileSync(`${root}/${P('file')}`, 'x');
fs.symlinkSync(`${root}/${P('ok')}`, `${root}/${P('link-in')}`);
fs.symlinkSync(outside, `${root}/${P('link-out')}`);
fs.symlinkSync(`${root}/${P('ok')}/sub`, `${root}/${P('link-rel')}`);
mkdirWs(ST, `café-${tag}`); // NFC on disk
mkdirWs(ST, `目录 with space-${tag}`);
mkdirWs(ST, P('locked'));
fs.symlinkSync(`${root}/${P('loop-b')}`, `${root}/${P('loop-a')}`);
fs.symlinkSync(`${root}/${P('loop-a')}`, `${root}/${P('loop-b')}`);
fs.symlinkSync(`${root}/${P('nowhere')}`, `${root}/${P('dangling')}`);
mkdirWs(ST, `${P('lockedp')}/child`);
fs.chmodSync(`${root}/${P('lockedp')}`, 0o000);
fs.chmodSync(`${root}/${P('locked')}`, 0o000);
spawnSync('mkfifo', [`${root}/${P('fifo')}`]);
mkdirWs(ST, `${P('ok')}/a`.replace('/a', '') + '/b/c/d/e/f/g/h');

const c = await createSession('public', WS, 'PLAIN');
const s = c.session;
await waitTurn(s);

const cases = [
  // [label, target, expect: 'completed' | 'failed']
  ['missing directory', P('nope'), 'failed'],
  ['regular file', P('file'), 'failed'],
  ['FIFO', P('fifo'), 'failed'],
  ['symlink → dir inside the Workspace (alias)', P('link-in'), 'failed'],
  ['symlink → dir outside the Workspace', P('link-out'), 'failed'],
  ['path through an inner symlink (link-in/sub)', `${P('link-in')}/sub`, 'failed'],
  ['symlink → nested dir', P('link-rel'), 'failed'],
  ['case alias of an existing dir (APFS case-insensitive)', P('OK').toUpperCase().replace('S3-', 's3-'), 'failed'],
  ['Unicode NFD alias of an NFC dir', `café-${tag}`, 'failed'],
  ['ancestor is a regular file (ENOTDIR)', `${P('file')}/lib`, 'failed'],
  ['ancestor is a symlink loop (ELOOP)', `${P('loop-a')}/lib`, 'failed'],
  ['ancestor has mode 000 (EACCES)', `${P('lockedp')}/child`, 'failed'],
  ['ancestor is a dangling symlink', `${P('dangling')}/lib`, 'failed'],
  ['valid NFC Unicode dir', `café-${tag}`, 'completed'],
  ['valid dir with CJK + spaces', `目录 with space-${tag}`, 'completed'],
  ['nested valid dir', `${P('ok')}/b/c/d/e/f/g/h`, 'completed'],
  ['Workspace root "."', '.', 'completed'],
  ['same directory again (re-validation)', '.', 'completed'],
  ['dir with mode 000 (refused since the F1 fix)', P('locked'), 'failed'],
];
let rev = binding(s).rev;
let events = ctxEvents(s).length;
for (const [i, [label, target, want]] of cases.entries()) {
  const before = binding(s);
  const a = await pubChange(s, target, rev, { key: `s3-${tag}-case${i}` });
  if (a.status !== 202) {
    R.check(`${label}: admitted (202)`, false, `${a.status} ${j(a.json)}`);
    continue;
  }
  const w = await waitCwdOp(s, opId(a));
  const after = binding(s);
  const row = cwdOpRow(opId(a));
  const ev = ctxEvents(s).length;
  if (want === 'failed') {
    R.check(
      `${label} → failed workspace_unavailable; binding+revision unchanged; no event`,
      w.json.status === 'failed' && w.json.failure_code === 'workspace_unavailable' && !('result_context_revision' in w.json) && after.cwd === before.cwd && after.rev === before.rev && ev === events && row.attempts === 0,
      `${w.ms} ms ${w.json.status}/${w.json.failure_code} cwd ${before.cwd}→${after.cwd} rev ${before.rev}→${after.rev} events ${events}→${ev} attempts=${row.attempts}`,
    );
  } else {
    R.check(
      `${label} → completed; rev ${rev}→${rev + 1}; one event`,
      w.json.status === 'completed' && w.json.result_context_revision === rev + 1 && after.rev === rev + 1 && ev === events + 1,
      `${w.ms} ms ${w.json.status} cwd ${before.cwd}→${after.cwd} rev ${before.rev}→${after.rev} events ${events}→${ev}`,
    );
    rev++;
    events = ev;
  }
}
fs.chmodSync(`${root}/${P('locked')}`, 0o755);
fs.chmodSync(`${root}/${P('lockedp')}`, 0o755);
R.done({ session: s, root });
