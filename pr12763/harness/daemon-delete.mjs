// Real `qwen serve` A/B of the daemon delete path (executeWorktreeCleanup),
// which this PR re-points from its private checkoutHasWork to the shared
// worktreeHasWork. usage: node daemon-delete.mjs <arm> <worktree> <modelPort> <daemonPort> <outdir>
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const [arm, WT, modelPort, daemonPort, OUT] = process.argv.slice(2);
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const H = path.join(OUT, 'home');
fs.mkdirSync(path.join(H, '.qwen'), { recursive: true });
fs.mkdirSync(path.join(H, 'runtime'), { recursive: true });
fs.writeFileSync(
  path.join(H, '.qwen', 'settings.json'),
  JSON.stringify({
    privacy: { usageStatisticsEnabled: false },
    security: { auth: { selectedType: 'openai' } },
    model: { name: 'dummy' },
  }),
);
const PATHV = `${path.dirname(process.execPath)}:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin`;
const baseEnv = { HOME: H, PATH: PATHV, TERM: 'dumb', NO_COLOR: '1' };
const git = (cwd, ...a) => execFileSync('git', a, { cwd, env: baseEnv, encoding: 'utf8' });

const repo = path.join(OUT, 'repo');
fs.mkdirSync(repo);
git(repo, 'init', '-q');
git(repo, 'symbolic-ref', 'HEAD', 'refs/heads/main');
git(repo, 'config', 'user.email', 't@e.com');
git(repo, 'config', 'user.name', 't');
git(repo, 'config', 'commit.gpgsign', 'false');
fs.writeFileSync(path.join(repo, '.gitignore'), 'secret.env\nnode_modules/\n');
fs.writeFileSync(path.join(repo, 'README.md'), '# fixture\n');
git(repo, 'add', '-A');
git(repo, 'commit', '-qm', 'init');

const errLog = fs.openSync(path.join(OUT, 'daemon.err'), 'w');
const outLog = fs.openSync(path.join(OUT, 'daemon.out'), 'w');
const daemon = spawn(
  process.execPath,
  [path.join(WT, 'dist/cli.js'), 'serve', '--port', daemonPort, '--no-web'],
  {
    cwd: repo,
    env: {
      ...baseEnv,
      QWEN_HOME: path.join(H, '.qwen'),
      QWEN_RUNTIME_DIR: path.join(H, 'runtime'),
      OPENAI_API_KEY: 'dummy',
      OPENAI_BASE_URL: `http://127.0.0.1:${modelPort}/v1`,
      OPENAI_MODEL: 'dummy',
    },
    stdio: ['ignore', outLog, errLog],
  },
);
fs.writeFileSync(path.join(OUT, 'daemon.pid'), String(daemon.pid));
const base = `http://127.0.0.1:${daemonPort}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function call(method, p, body) {
  const res = await fetch(base + p, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const t = await res.text();
  let j;
  try { j = JSON.parse(t); } catch { j = t; }
  return { status: res.status, body: j };
}

const lines = [];
const say = (s) => { lines.push(s); console.log(s); };
try {
  for (let i = 0; i < 120; i++) {
    try { const r = await fetch(base + '/health'); if (r.ok) break; } catch {}
    await sleep(500);
  }
  const cases = [
    { slug: 'probe-ignored', label: 'only git-ignored secret.env', write: (w) => fs.writeFileSync(path.join(w, 'secret.env'), 'AWS_KEY=x\n'), probe: 'secret.env' },
    { slug: 'probe-nodemods', label: 'only node_modules/ (disposable)', write: (w) => { fs.mkdirSync(path.join(w, 'node_modules', 'x'), { recursive: true }); fs.writeFileSync(path.join(w, 'node_modules', 'x', 'i.js'), '//\n'); } },
    { slug: 'probe-untracked', label: 'only untracked notes.md', write: (w) => fs.writeFileSync(path.join(w, 'notes.md'), 'notes\n'), probe: 'notes.md' },
    { slug: 'probe-clean', label: 'clean (marker only)', write: () => {} },
  ];
  say(`[${arm}] daemon ${WT}/dist/cli.js serve (pid ${daemon.pid})`);
  for (const c of cases) {
    const created = await call('POST', '/session', { cwd: repo, worktree: { slug: c.slug } });
    const id = created.body?.sessionId ?? created.body?.id;
    const wtPath = created.body?.worktree?.path ?? path.join(repo, '.qwen', 'worktrees', c.slug);
    if (created.status >= 300 || !id) { say(`create ${c.slug}: ${created.status} ${JSON.stringify(created.body).slice(0, 300)}`); continue; }
    const prompted = await call('POST', `/session/${id}/prompt`, { prompt: [{ type: 'text', text: 'hello' }] });
    c.write(wtPath);
    const closed = await call('DELETE', `/session/${id}`);
    await sleep(300);
    const del = await call('POST', '/sessions/delete', { sessionIds: [id] });
    await sleep(300);
    const kept = fs.existsSync(wtPath);
    let branch = 'deleted';
    try { git(repo, 'show-ref', '--verify', '--quiet', `refs/heads/worktree-${c.slug}`); branch = 'kept'; } catch {}
    say(`${c.slug.padEnd(16)} ${kept ? 'KEPT   ' : 'REMOVED'} branch=${branch.padEnd(7)} ${c.label}  (prompt ${prompted.status}, close ${closed.status}, delete ${del.status} removed=${JSON.stringify(del.body?.removed ?? del.body)})`);
  }
} finally {
  daemon.kill('SIGTERM');
  await sleep(1500);
  const err = fs.readFileSync(path.join(OUT, 'daemon.err'), 'utf8');
  for (const l of err.split('\n').filter((l) => /worktree cleanup/.test(l))) say(`daemon: ${l.trim()}`);
  fs.writeFileSync(path.join(OUT, 'result.txt'), lines.join('\n') + '\n');
}
