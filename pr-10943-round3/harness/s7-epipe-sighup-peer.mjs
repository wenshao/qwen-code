// S7 — three behaviours the earlier rounds left uncovered or covered only on
// macOS: a reader that leaves early (EPIPE), the launching terminal hanging
// up (SIGHUP) on Linux, and a real cross-session send_message into a
// background worker.
import * as L from './lib.mjs';
import { createRequire } from 'node:module';

const C = new L.Checks('s7-epipe-sighup-peer');
const T = new L.Transcript('s7-epipe-sighup-peer');
const UUID = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/;
const extra = {};

// ---- EPIPE --------------------------------------------------------------
{
  const sc = L.scenario('head', 's7a');
  const out = L.path.join(sc.cwd, 'epipe.txt');
  T.title('EPIPE — reader gone before the success line (head b8387983, Linux)');
  T.cmd(`qwen --bg "BGWRITE:${out}" | true; echo "qwen exit=\${PIPESTATUS[0]}"`);
  const bash = L.execFileSync(
    'bash',
    ['-c', `${JSON.stringify(L.NODE)} ${JSON.stringify(sc.entry)} --bg ${JSON.stringify(`BGWRITE:${out}`)} 2>${JSON.stringify(L.path.join(sc.base, 'err.txt'))} | true; echo "\${PIPESTATUS[0]}"`],
    { cwd: sc.cwd, env: sc.env },
  ).toString();
  const code = Number(bash.trim());
  const err = L.readFileSync(L.path.join(sc.base, 'err.txt'), 'utf8');
  T.out(`qwen exit=${code}`);
  T.err(err);
  const wrote = await L.waitFor(() => L.existsSync(out), { timeout: 40_000 });
  C.check('epipe.exit0', code === 0, `exit ${code}`);
  C.check('epipe.no-crash-on-stderr', err.trim() === '', err.slice(0, 200));
  C.check('epipe.session-ran', !!wrote);
  T.ok(`exit 0, stderr empty, worker still ran (${L.path.basename(out)} written)`);
  extra.epipe = { code, err };
  L.killScenario(sc);
}

// ---- SIGHUP -------------------------------------------------------------
{
  const req = createRequire(L.path.join(L.armDir('head'), 'package.json'));
  const pty = req('@lydell/node-pty');
  const sc = L.scenario('head', 's7b');
  T.blank();
  T.title('SIGHUP — the launching terminal goes away');
  const term = pty.spawn('bash', ['--norc', '-i'], { name: 'xterm-256color', cols: 160, rows: 40, cwd: sc.cwd, env: { ...sc.env, PS1: '$ ' } });
  let screen = '';
  term.onData((d) => (screen += d));
  await L.sleep(500);
  term.write(`${L.NODE} ${sc.entry} --bg "BGHOLD hup"\r`);
  await L.waitFor(() => /Started background session/.test(screen), { timeout: 30_000 });
  const sid = UUID.exec(screen.slice(screen.indexOf('Started')))?.[1];
  const bashPid = term.pid;
  await L.sleep(800);
  const before = L.scenarioPids(sc).filter((p) => p.pid !== bashPid);
  T.cmd('qwen --bg "BGHOLD hup"   # typed into an interactive bash inside a PTY');
  T.out(`Started background session ${sid}`);
  term.kill('SIGHUP');
  try {
    term.destroy?.();
  } catch {
    /* already gone */
  }
  await L.sleep(2500);
  const bashAlive = (() => {
    try {
      process.kill(bashPid, 0);
      return true;
    } catch {
      return false;
    }
  })();
  const after = L.scenarioPids(sc);
  const roles = (ps) => ps.map((p) => L.role(p)).sort().join(',');
  const st = L.sessionFiles(sc, sid).state;
  T.note(`PTY destroyed + SIGHUP → bash alive=${bashAlive}; survivors: ${after.map((p) => `${L.role(p)}(${p.pid}, ppid ${p.ppid})`).join('  ')}`);
  T.note(`state.json: ${st?.sessionState}/${st?.processState}`);
  C.check('sighup.bash-gone', !bashAlive);
  C.check('sighup.all-three-survive', roles(after) === 'pty-host,supervisor,worker' && before.every((b) => after.some((a) => a.pid === b.pid)), roles(after));
  C.check('sighup.supervisor-reparented', after.find((p) => L.role(p) === 'supervisor')?.ppid === 1);
  C.check('sighup.session-still-working', st?.sessionState === 'working', `${st?.sessionState}`);
  extra.sighup = { sid, survivors: after.map((p) => ({ role: L.role(p), pid: p.pid, ppid: p.ppid })) };
  L.killScenario(sc);
}

// ---- cross-session send_message into a --bg worker -----------------------
{
  const sc = L.scenario('head', 's7c');
  T.blank();
  T.title('send_message from another session into a --bg worker');
  T.cmd('qwen --bg "PEERWAIT idle worker"');
  const r = L.qwen(sc, ['--bg', 'PEERWAIT idle worker']);
  T.out(r.stdout.split('\n')[0]);
  const sid = UUID.exec(r.stdout)?.[1];
  const reg = await L.waitFor(
    () => {
      const j = L.qwen(sc, ['sessions', 'ps', '--json']);
      const rows = j.stdout.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
      return rows.find((x) => x.sessionId === sid && x.kind === 'tui' && x.ipcPath);
    },
    { timeout: 30_000, interval: 500 },
  );
  C.check('peer.worker-registered-with-inbox', !!reg, reg ? `name=${reg.name} ipcPath=${reg.ipcPath}` : 'not registered');
  await L.sleep(2000);
  const led0 = L.ledgerLen();
  const marker = `m${Date.now().toString(36)}`;
  // A headless `-p` sender has no inbox ("cross-session messaging is not
  // active in this session"), so the sender is a second --bg worker.
  T.cmd(`qwen --bg "SENDTO:${sid.slice(0, 8)}…:${marker}"   # 2nd bg session; its model calls send_message to [ref]`);
  const s = L.qwen(sc, ['--bg', `SENDTO:${sid}:${marker}`], { timeout: 90_000 });
  T.out(s.stdout.split('\n')[0]);
  T.exit(s.code, s.ms);
  const done = await L.waitFor(() => L.ledgerSince(led0).find((l) => l.kind === 'sendto-done'), { timeout: 40_000 });
  const got = await L.waitFor(() => L.ledgerSince(led0).find((l) => l.kind === 'peer-received'), { timeout: 30_000 });
  await L.sleep(1500);
  const client = await L.supervisorClient(sc);
  const strip = (t) => t.replace(/\x1b\][^\x07]*\x07/g, '').replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/\r/g, '');
  const screen = strip((await client.logs(sid).catch(() => ({ output: '' }))).output ?? '');
  const banner = screen.split('\n').reverse().find((l) => l.includes(`PEERMSG:${marker}`)) ?? '';
  const ack = screen.includes(`ACK ${marker}`);
  C.check('peer.receiver-screen-shows-message-and-reply', /Message from another session/.test(banner) && ack, banner.trim());
  T.note(`receiver's own screen (supervisor logs RPC):`);
  T.out(`  ${banner.trim()}`);
  if (ack) T.out(`  ◆ ACK ${marker}`);
  C.check('peer.sender-tool-result-sent', !!done && /^Sent to /.test(done.lastTool ?? ''), (done?.lastTool ?? 'no tool result').slice(0, 160));
  C.check('peer.worker-model-received-message', !!got, got ? 'receiver took a model turn on the peer envelope' : 'no worker turn with the marker');
  if (done) T.note(`send_message result: ${(done.lastTool ?? '').slice(0, 120)}…`);
  if (got) T.ok(`worker ${sid.slice(0, 8)} took a new model turn carrying PEERMSG:${marker} → replied ACK`);
  else T.bad('the worker never took a turn with the message');
  extra.peer = { sid, reg, sender: { code: s.code, stdout: s.stdout }, toolResult: done?.lastTool, received: got };
  L.killScenario(sc);
}

C.save(extra);
process.exit(0);
