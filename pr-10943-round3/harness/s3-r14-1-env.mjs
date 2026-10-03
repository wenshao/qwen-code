// S3 — R14-1 end to end: a later shell's `--bg` runs in the FIRST launcher's
// environment because the per-home supervisor is reused.
import * as L from './lib.mjs';

const C = new L.Checks('s3-r14-1-env');
const T = new L.Transcript('s3-r14-1-env');
const UUID = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/;
const sc = L.scenario('head', 's3');
const port = new URL(L.fakeBaseUrl()).port;
const shellA = { OPENAI_API_KEY: 'sk-shellA-REVOKED', PR10943_MARK: 'shellA', OPENAI_BASE_URL: `http://127.0.0.1:${port}/v1` };
const shellB = { OPENAI_API_KEY: 'sk-shellB-CURRENT', PR10943_MARK: 'shellB', OPENAI_BASE_URL: `http://localhost:${port}/v1` };
const extra = {};

async function launch(label, env, file) {
  const target = L.path.join(sc.cwd, file);
  const led0 = L.ledgerLen();
  T.cmd(`qwen --bg "ENVPROBE:${file}"`, `${label}$`);
  const r = L.qwen(sc, ['--bg', `ENVPROBE:${target}`], { env });
  T.out(r.stdout.split('\n')[0]);
  T.err(r.stderr);
  T.exit(r.code, r.ms);
  const sid = UUID.exec(r.stdout)?.[1];
  const wrote = await L.waitFor(() => L.existsSync(target) && L.readFileSync(target, 'utf8').includes('KEY='), { timeout: 40_000 });
  await L.sleep(1200);
  const content = wrote ? L.readFileSync(target, 'utf8') : '';
  const reqs = L.ledgerSince(led0).filter((l) => l.lastUser.includes(target));
  const auths = [...new Set(reqs.map((l) => l.auth))];
  const hosts = [...new Set(reqs.map((l) => l.host))];
  T.note(`  worker shell saw: ${content.trim().replace(/\n/g, '  ')}`);
  T.note(`  model requests for this task: ${reqs.length}, Authorization=${auths.join(',')} Host=${hosts.join(',')}`);
  return { r, sid, content, auths, hosts, n: reqs.length };
}

T.title('R14-1 — shell B\'s --bg runs with shell A\'s environment (real build, head b8387983)');
T.note(`shell A: OPENAI_API_KEY=${shellA.OPENAI_API_KEY} PR10943_MARK=shellA OPENAI_BASE_URL=http://127.0.0.1:${port}/v1`);
T.note(`shell B: OPENAI_API_KEY=${shellB.OPENAI_API_KEY} PR10943_MARK=shellB OPENAI_BASE_URL=http://localhost:${port}/v1`);
T.blank();
const a = await launch('shellA', shellA, 'a.txt');
C.check('A.started', a.r.code === 0 && !!a.sid);
C.check('A.worker-env-is-A', /MARK=shellA/.test(a.content) && /KEY=sk-shellA-REVOKED/.test(a.content), a.content.trim());
C.check('A.model-auth-is-A', a.auths.length === 1 && a.auths[0] === 'Bearer sk-shellA-REVOKED');
const supA = L.scenarioPids(sc).filter((p) => L.role(p) === 'supervisor').map((p) => p.pid);
T.blank();
const b = await launch('shellB', shellB, 'b.txt');
const supB = L.scenarioPids(sc).filter((p) => L.role(p) === 'supervisor').map((p) => p.pid);
C.check('B.started-exit0', b.r.code === 0 && !!b.sid, b.r.stdout.split('\n')[0]);
C.check('B.reused-A-supervisor', supA.length === 1 && supB.length === 1 && supA[0] === supB[0], `${supA} → ${supB}`);
C.check('B.R14-1.worker-env-is-A', /MARK=shellA/.test(b.content) && /KEY=sk-shellA-REVOKED/.test(b.content), b.content.trim());
C.check('B.R14-1.model-auth-is-A', b.auths.length === 1 && b.auths[0] === 'Bearer sk-shellA-REVOKED', b.auths.join(','));
C.check('B.R14-1.model-endpoint-is-A', b.hosts.length === 1 && b.hosts[0] === `127.0.0.1:${port}`, b.hosts.join(','));
const anyB = L.ledgerSince(0).some((l) => l.auth.includes('sk-shellB'));
C.check('B.R14-1.shellB-key-never-used', !anyB);
T.bad(`shell B got exit 0 and "Started", but its task ran with shell A's key, endpoint and env`);

// Control: the only way to get B's environment is a fresh supervisor. There is
// no CLI to stop it, so drive the supervisor's own shutdown RPC.
T.blank();
T.note('control: stop the supervisor via its shutdown RPC (no `qwen` command does this), then launch from B again');
const client = await L.supervisorClient(sc);
await client.shutdown(true).catch(() => {});
await L.waitFor(() => !L.scenarioPids(sc).some((p) => p.pid === supA[0]), { timeout: 10_000 });
const c = await launch('shellB', shellB, 'c.txt');
C.check('control.fresh-supervisor-gets-B-env', /MARK=shellB/.test(c.content) && c.auths[0] === 'Bearer sk-shellB-CURRENT' && c.hosts[0] === `localhost:${port}`, `${c.content.trim()} ${c.auths} ${c.hosts}`);
T.ok('a fresh supervisor started from shell B carries B\'s key/endpoint/env');

extra.a = { sid: a.sid, content: a.content, auths: a.auths, hosts: a.hosts };
extra.b = { sid: b.sid, content: b.content, auths: b.auths, hosts: b.hosts, supA, supB };
extra.c = { content: c.content, auths: c.auths, hosts: c.hosts };
C.save(extra);
L.killScenario(sc);
process.exit(0);
