// S15 (round 3): fee8f8763d / 560752cad0 on the real stack.
//   A: drift rebaselined at the next Write/Edit prompt (content, mode, deletion, another Session, a busy tracked file).
//   B: a pending turn whose results are already durable is settled at load; real crashes in that window.
// usage: DB=<db> ARM=<arm> node s15-r3.mjs <scenario> <letter>
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { Report, Harness, HSession, startModel, startBrokerProxy, startStoreProxy, ledgerLines, workspace, createWorkspaceSession, storeConnection, script, call, turn, toolTrace, backups, backupDir, read, holderOf, sleep, j, FILES, SHELL, RIG, RUN, NODE } from './lib.mjs';

const [scenario, letter] = process.argv.slice(2);
const arm = process.env.ARM ?? 'head4';
const R = new Report(`s15-${scenario}-${arm}`);
const model = await startModel(`${RUN}/model-s15-${scenario}-${arm}.jsonl`);
const proxy = await startBrokerProxy();
const store = await startStoreProxy();
let h = await new Harness({ name: `s15-${scenario}-${arm}`, modelUrl: model.url, brokerUrl: proxy.url, arm }).start();
const w = await workspace(letter);
const f = (rel) => path.join(w.dir, rel);
const mk = async (profile = FILES, harness = h) => {
  const s = new HSession(harness, await createWorkspaceSession(w.workspaceId), storeConnection(harness, w.workspaceId, store.url), profile);
  const c = await s.create();
  if (c.status !== 200) throw new Error(`create ${c.status} ${j(c.json)}`);
  return s;
};
const mode = (rel) => (fs.existsSync(f(rel)) ? (fs.statSync(f(rel)).mode & 0o777).toString(8) : 'absent');
const lease = () => (['<none>', '<no row>'].includes(holderOf(letter)) ? 'free' : `held by ${holderOf(letter).slice(0, 8)}…`);
const ok = (p) => p.terminal?.[0]?.type === 'turn_complete' && !p.status2?.recoveryBlocked;
const results = (p) => toolTrace(p.events ?? []).filter((l) => l.startsWith('result ')).map((l) => l.slice(7).replace(/\\"/g, '"').slice(0, 190));
const undo = async (s, p, label) => {
  const u = await s.rewind(p.promptId);
  return { ...u, text: `${label}: ${u.status}${u.json?.code ? ' ' + u.json.code : ''}${u.json?.conflict ? ' conflict' : ''}${u.json?.filesChanged ? ' changed=' + j(u.json.filesChanged) : ''}` };
};
const starts = () => proxy.ledger.filter((e) => /:start$/.test(e.url) && String(e.status).startsWith('200')).length;
const hist = async (s) => (await s.history()).json?.history;
const pend = async (s) => {
  const x = await hist(s);
  return x ? `pendingTurn=${x.pendingTurn ? x.pendingTurn.slice(0, 8) + '…' : null} pendingMessageId=${x.pendingMessageId ? 'set' : 'none'} snapshots=${x.state.snapshots.length}` : 'history unavailable';
};
const sh = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim().split('\n').at(-1);

// Cold load in a new Harness: retries while the old writer lease is live, stops on a recovery refusal.
async function coldLoad(s2, maxMs = 180_000) {
  const t0 = Date.now();
  const codes = [];
  let l;
  for (;;) {
    l = await s2.load();
    if (l.status === 200) break;
    codes.push(`${l.status} ${l.json?.code ?? ''}`.trim());
    if (/recovery_required|refused/.test(l.json?.code ?? '') || Date.now() - t0 > maxMs) break;
    await sleep(3000);
  }
  return { l, text: `load=${l.status} ${l.json?.code ?? ''} after ${((Date.now() - t0) / 1000).toFixed(0)} s; earlier answers: ${j([...new Set(codes)])}` };
}
// Hold one Store request matched by `match` until released; the held request never reaches the Store.
function holdStore(match) {
  let release;
  const gate = new Promise((r) => (release = r));
  const st = { held: null };
  store.state.hook = async (entry, parsed, body) => {
    if (!st.held && match(entry, body.toString())) {
      st.held = `${entry.method} ${entry.url.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, '<id>')} op=${entry.operation ?? ''} bytes=${entry.bytes}`;
      await gate;
      return 'fail-503';
    }
    return 'forward';
  };
  return {
    st,
    release: () => {
      store.state.hook = null;
      release();
    },
    wait: async (ms = 120_000) => {
      for (let i = 0; i < ms / 100 && !st.held; i++) await sleep(100);
      return st.held;
    },
  };
}
const afterStart = (t0) => proxy.ledger.some((e) => e.t >= t0 && /:start$/.test(e.url));
const isFh = (b) => b.includes('commitFileHistory');

// After a load that may resume the original prompt: wait until idle, then report what happened to that prompt.
async function afterRecovery(s2, p, expectFile) {
  const st = await s2.waitIdle(180_000);
  const events = (await s2.transcript()).filter((e) => e.promptId === p.promptId);
  const terms = events.filter((e) => e.type.startsWith('turn_')).map((e) => `${e.type}${e.data?.stopReason ? `(${e.data.stopReason})` : ''}`);
  const step1 = model.requests.filter((r) => r.step === 1);
  R.say(`  after load: recoveryBlocked=${st.recoveryBlocked} terminals of the original prompt=${j(terms)} model follow-up calls=${step1.length} last follow-up saw ${j(step1.at(-1)?.toolResults.map((t) => t.content.slice(0, 90)))}`);
  return { st, terms, step1 };
}

try {
  if (scenario === 'sniff') {
    fs.writeFileSync(f('notes.txt'), 'original');
    const s = await mk();
    const t0 = Date.now();
    const p = await s.prompt(script([[call('write_file', { file_path: 'notes.txt', content: 'after P1' })]], 'P1'));
    R.say(`  ${turn(p)}`);
    const all = [...store.ledger.filter((e) => e.t >= t0).map((e) => ({ t: e.t, l: `STORE ${e.method} ${e.url.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, '<id>')} op=${e.operation ?? ''} bytes=${e.bytes} -> ${e.status}` })), ...proxy.ledger.filter((e) => e.t >= t0).map((e) => ({ t: e.t, l: `BROKER ${e.method} ${e.url.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, '<id>')}${e.op ? ` [${e.op}]` : ''} -> ${e.status}` }))].sort((a, b) => a.t - b.t);
    for (const x of all) R.say(`  +${x.t - t0}ms ${x.l}`);
  } else if (scenario === 'rebase-external-edit') {
    fs.writeFileSync(f('notes.txt'), 'original\n');
    const s = await mk();
    const p1 = await s.prompt(script([[call('write_file', { file_path: 'notes.txt', content: 'after P1\n' })]], 'P1'));
    fs.writeFileSync(f('notes.txt'), 'user edit\n');
    const u0 = await undo(s, p1, 'undo(P1) right after the user edit');
    R.check('direct undo across an outside edit is still refused (nothing restored)', u0.status === 409 && read(w.dir, 'notes.txt') === 'user edit\n', u0.text);
    const p2 = await s.prompt(script([[call('edit', { file_path: 'notes.txt', old_string: 'user edit', new_string: 'after P2' })]], 'P2'));
    R.check('the next Write/Edit prompt edits the file the user changed', ok(p2) && read(w.dir, 'notes.txt') === 'after P2\n', `${turn(p2)} model saw ${j(results(p2))}`);
    const u2 = await undo(s, p2, 'undo(P2)');
    R.check("undo(P2) restores the user's edit (P2's preimage)", u2.status === 200 && read(w.dir, 'notes.txt') === 'user edit\n', u2.text);
    const u1 = await undo(s, p1, 'undo(P1)');
    R.check('undo(P1) then restores the original', u1.status === 200 && read(w.dir, 'notes.txt') === 'original\n', `${u1.text} notes=${j(read(w.dir, 'notes.txt'))}`);
  } else if (scenario === 'rebase-untouched-drift') {
    fs.writeFileSync(f('a.txt'), 'a0');
    fs.writeFileSync(f('b.txt'), 'b0');
    const s = await mk();
    const p1 = await s.prompt(script([[call('write_file', { file_path: 'a.txt', content: 'a1' }), call('write_file', { file_path: 'b.txt', content: 'b1' })]], 'P1'));
    fs.writeFileSync(f('b.txt'), 'b changed by the user');
    const p2 = await s.prompt(script([[call('edit', { file_path: 'a.txt', old_string: 'a1', new_string: 'a2' })]], 'P2'));
    R.check('P2 edits only a.txt and completes', ok(p2) && read(w.dir, 'a.txt') === 'a2', turn(p2));
    const u2 = await undo(s, p2, 'undo(P2)');
    R.note('undo(P2) (b.txt was changed by the user before P2, P2 did not touch it)', `${u2.text}; a=${j(read(w.dir, 'a.txt'))} b=${j(read(w.dir, 'b.txt'))}`);
    const u1 = await undo(s, p1, 'undo(P1)');
    R.note("undo(P1): what happens to the user's b.txt change", `${u1.text}; a=${j(read(w.dir, 'a.txt'))} b=${j(read(w.dir, 'b.txt'))}`);
    const after = await hist(s);
    const u2again = await undo(s, p2, 'undo(P2) again');
    R.note('is the user\'s b.txt content still reachable?', `snapshots after undo(P1)=${after?.state.snapshots.length} ${u2again.text}; b=${j(read(w.dir, 'b.txt'))}; backup files holding it: ${backups(s.sessionId).filter((x) => fs.readFileSync(path.join(backupDir(s.sessionId), x), 'utf8') === 'b changed by the user').length}`);
  } else if (scenario === 'rebase-delete') {
    fs.writeFileSync(f('b.txt'), 'b0');
    const s = await mk();
    const p1 = await s.prompt(script([[call('write_file', { file_path: 'a.txt', content: 'a1' }), call('write_file', { file_path: 'b.txt', content: 'b1' })]], 'P1'));
    fs.rmSync(f('b.txt'));
    const u0 = await undo(s, p1, 'undo(P1) right after the user deleted b.txt');
    R.check('direct undo across an outside delete is refused', u0.status === 409 && read(w.dir, 'a.txt') === 'a1', u0.text);
    const p2 = await s.prompt(script([[call('edit', { file_path: 'a.txt', old_string: 'a1', new_string: 'a2' })]], 'P2'));
    R.check('the next Write/Edit prompt completes', ok(p2) && read(w.dir, 'a.txt') === 'a2', turn(p2));
    const u2 = await undo(s, p2, 'undo(P2)');
    R.check('undo(P2): a.txt back to a1, b.txt stays deleted (P2 preimage)', u2.status === 200 && read(w.dir, 'a.txt') === 'a1' && read(w.dir, 'b.txt') === null, `${u2.text} a=${j(read(w.dir, 'a.txt'))} b=${j(read(w.dir, 'b.txt'))}`);
    const u1 = await undo(s, p1, 'undo(P1)');
    R.check('undo(P1): a.txt removed, b.txt original', u1.status === 200 && read(w.dir, 'a.txt') === null && read(w.dir, 'b.txt') === 'b0', `${u1.text} a=${j(read(w.dir, 'a.txt'))} b=${j(read(w.dir, 'b.txt'))}`);
  } else if (scenario === 'rebase-mode') {
    fs.writeFileSync(f('tool.sh'), '#!/bin/sh\necho v0\n', { mode: 0o644 });
    fs.chmodSync(f('tool.sh'), 0o644);
    const s = await mk();
    const p1 = await s.prompt(script([[call('edit', { file_path: 'tool.sh', old_string: 'v0', new_string: 'v1' }), call('write_file', { file_path: 'new.sh', content: '#!/bin/sh\necho n1\n' })]], 'P1'));
    R.say(`  after P1: tool.sh ${mode('tool.sh')}, new.sh ${mode('new.sh')}; ${turn(p1)}`);
    fs.chmodSync(f('tool.sh'), 0o755);
    fs.chmodSync(f('new.sh'), 0o755);
    const u0 = await undo(s, p1, 'undo(P1) right after chmod 755');
    R.check('direct undo after a mode-only change is refused', u0.status === 409 && read(w.dir, 'tool.sh').includes('v1'), u0.text);
    const p2 = await s.prompt(script([[call('edit', { file_path: 'tool.sh', old_string: 'v1', new_string: 'v2' }), call('edit', { file_path: 'new.sh', old_string: 'n1', new_string: 'n2' })]], 'P2'));
    R.check('the next prompt edits both files after the mode change', ok(p2) && read(w.dir, 'tool.sh').includes('v2') && read(w.dir, 'new.sh').includes('n2'), `${turn(p2)} modes after P2: tool.sh ${mode('tool.sh')} new.sh ${mode('new.sh')}`);
    const u2 = await undo(s, p2, 'undo(P2)');
    R.check('undo(P2) restores content and keeps mode 755 (the preimage)', u2.status === 200 && read(w.dir, 'tool.sh').includes('v1') && mode('tool.sh') === '755' && mode('new.sh') === '755', `${u2.text} tool.sh ${mode('tool.sh')} new.sh ${mode('new.sh')}`);
    const u1 = await undo(s, p1, 'undo(P1)');
    R.check('undo(P1) restores the original content and mode 644, removes new.sh', u1.status === 200 && read(w.dir, 'tool.sh').includes('v0') && mode('tool.sh') === '644' && mode('new.sh') === 'absent', `${u1.text} tool.sh ${mode('tool.sh')} ${j(read(w.dir, 'tool.sh'))} new.sh ${mode('new.sh')}`);
  } else if (scenario === 'shell-same-and-next') {
    const s = await mk(SHELL);
    const p1 = await s.prompt(
      script([[call('write_file', { file_path: 'run.sh', content: '#!/bin/sh\necho helo\n' })], [call('run_shell_command', { command: 'chmod +x run.sh && ./run.sh', description: 'run it' })], [call('edit', { file_path: 'run.sh', old_string: 'helo', new_string: 'hello' })]], 'P1'),
      240_000,
    );
    R.check('same prompt: write, chmod +x, edit -> the edit is refused, the turn completes', ok(p1) && read(w.dir, 'run.sh').includes('helo\n'), `${turn(p1)} edit result: ${results(p1).at(-1)}`);
    const p2 = await s.prompt(script([[call('edit', { file_path: 'run.sh', old_string: 'helo', new_string: 'hello' })]], 'P2'), 240_000);
    R.check('next prompt: the same edit succeeds', ok(p2) && read(w.dir, 'run.sh').includes('hello\n'), `${turn(p2)} result: ${results(p2).at(-1)} mode=${mode('run.sh')}`);
    const p3 = await s.prompt(script([[call('run_shell_command', { command: './run.sh', description: 'run again' })]], 'P3'), 240_000);
    R.say(`  P3 runs it: ${results(p3).at(-1)}`);
    const u2 = await undo(s, p2, 'undo(P2)');
    R.check('undo(P2): back to helo, still executable', u2.status === 200 && read(w.dir, 'run.sh').includes('helo\n') && mode('run.sh') === '755', `${u2.text} mode=${mode('run.sh')}`);
    const u1 = await undo(s, p1, 'undo(P1)');
    R.check('undo(P1): run.sh removed', u1.status === 200 && mode('run.sh') === 'absent', `${u1.text} run.sh ${mode('run.sh')}`);
  } else if (scenario === 'two-sessions-undo') {
    fs.writeFileSync(f('shared.txt'), 'orig');
    const A = await mk();
    const B = await mk();
    const a1 = await A.prompt(script([[call('write_file', { file_path: 'shared.txt', content: 'A1' })]], 'A1'));
    const b1 = await B.prompt(script([[call('edit', { file_path: 'shared.txt', old_string: 'A1', new_string: 'B1' })]], 'B1'));
    R.say(`  A writes A1 (${turn(a1)}); B edits it to B1 (${turn(b1)}); shared=${j(read(w.dir, 'shared.txt'))}`);
    const a2 = await A.prompt(script([[call('write_file', { file_path: 'other.txt', content: 'A2' })]], 'A2'));
    R.say(`  A's next prompt writes only other.txt: ${turn(a2)}`);
    const ua1 = await undo(A, a1, "A undo(A1)");
    R.note("A undo(A1) after B's change", `${ua1.text}; shared=${j(read(w.dir, 'shared.txt'))} other=${j(read(w.dir, 'other.txt'))}`);
    const ub1 = await undo(B, b1, 'B undo(B1)');
    R.note('B undo(B1) afterwards', `${ub1.text}; shared=${j(read(w.dir, 'shared.txt'))}`);
    const ua2 = await undo(A, a2, 'A undo(A2)');
    R.note("then A undo(A2): is B's edit reachable from A's history?", `${ua2.text}; shared=${j(read(w.dir, 'shared.txt'))} other=${j(read(w.dir, 'other.txt'))}`);
  } else if (scenario === 'busy-tracked-file') {
    fs.writeFileSync(f('log.txt'), 'start\n');
    fs.writeFileSync(f('x.txt'), 'x0');
    const s = await mk();
    const p1 = await s.prompt(script([[call('write_file', { file_path: 'log.txt', content: 'p1\n' }), call('write_file', { file_path: 'x.txt', content: 'x1' })]], 'P1'));
    R.say(`  P1 writes log.txt and x.txt: ${turn(p1)}`);
    let prev = 'x1';
    for (const every of [5, 200]) {
      const writer = spawn(NODE, ['-e', `const fs=require('fs');setInterval(()=>fs.appendFileSync(${j(f('log.txt'))},'tick '+Date.now()+'\\n'),${every})`], { stdio: 'ignore' });
      await sleep(300);
      let done = 0;
      const seen = [];
      for (let i = 0; i < 5; i++) {
        const next = `x-${every}-${i}`;
        const p = await s.prompt(script([[call('edit', { file_path: 'x.txt', old_string: prev, new_string: next })]], 'PX'));
        if (read(w.dir, 'x.txt') === next) (done++, (prev = next));
        seen.push(`${p.terminal?.[0]?.type}${p.status2?.recoveryBlocked ? ' BLOCKED' : ''}: ${(results(p).at(-1) ?? '').slice(0, 120)}`);
      }
      writer.kill();
      R.note(`a background process appends to the tracked log.txt every ${every} ms; 5 prompts each edit only x.txt`, `${done}/5 edits applied; ${j([...new Set(seen)])}`);
    }
    await sleep(300);
    const last = await s.prompt(script([[call('edit', { file_path: 'x.txt', old_string: prev, new_string: 'x-final' })]], 'PX'));
    R.check('after the writer stops, the next edit succeeds', ok(last) && read(w.dir, 'x.txt') === 'x-final', turn(last));
  } else if (scenario === 'settle-store-503' || scenario === 'settle-harness-kill' || scenario === 'settle-mysql-kill' || scenario === 'settle-worker-lost' || scenario === 'unsettled-harness-kill' || scenario === 'settle-shell-kill') {
    const shell = scenario === 'settle-shell-kill';
    fs.writeFileSync(f('notes.txt'), 'original');
    const s = await mk(shell ? SHELL : FILES);
    const t0 = Date.now();
    const settleWindow = scenario !== 'unsettled-harness-kill';
    const hold = settleWindow
      ? holdStore((e, b) => afterStart(t0) && isFh(b))
      : holdStore((e, b) => afterStart(t0) && e.method === 'POST' && !isFh(b));
    const steps = shell
      ? [[call('run_shell_command', { command: 'echo ran >> ran.log', description: 'append once' }), call('write_file', { file_path: 'notes.txt', content: 'after P1' })]]
      : [[call('write_file', { file_path: 'notes.txt', content: 'after P1' })]];
    const sub = await s.submit(script(steps, 'P1 finished'));
    const held = await hold.wait();
    R.say(`  held Store request (${settleWindow ? 'settle window: results durable, history commit not yet' : 'first Store write after the tool started'}): ${held}`);
    R.say(`  on disk now: notes=${j(read(w.dir, 'notes.txt'))}${shell ? ` ran.log=${j(read(w.dir, 'ran.log'))}` : ''}; tool starts so far=${starts()}`);
    const p = { promptId: sub.promptId };
    let s2 = s;
    if (scenario === 'settle-store-503') {
      hold.release();
      const st = await s.waitIdle(180_000);
      R.check('the history commit fails (Store 503): the Session blocks, the model is not called again', st.recoveryBlocked === true && model.requests.filter((r) => r.step === 1).length === 0, `recoveryBlocked=${st.recoveryBlocked} ${await pend(s)} lease=${lease()}`);
      const tries = [];
      for (let i = 0; i < 5; i++) {
        const d = await s.detach();
        tries.push(`${d.status} ${d.json?.code ?? ''}`.trim());
        if (d.status === 204) break;
        await sleep(2000);
      }
      const l = await s.load();
      R.note('detach + load in the same Harness (5 tries over 10 s)', `detach=${j([...new Set(tries)])} load=${l.status} ${l.json?.code ?? ''}`);
      if (l.status !== 200) {
        await h.stop();
        R.say('  Harness restarted (SIGTERM, then a new process)');
        h = await new Harness({ name: `s15-${scenario}-${arm}-b`, modelUrl: model.url, brokerUrl: proxy.url, arm }).start();
        s2 = new HSession(h, s.sessionId, storeConnection(h, w.workspaceId, store.url));
        const c = await coldLoad(s2);
        R.check('after a Harness restart, cold load settles the durable batch', c.l.status === 200, c.text);
      }
    } else {
      if (scenario === 'settle-mysql-kill') {
        R.say(`  ${sh(`${RIG}/mysql.sh`, ['kill'])}`);
        store.state.hook = null;
      }
      if (scenario === 'settle-worker-lost') {
        const springPid = fs.readFileSync(`${RUN}/spring.pid`, 'utf8').trim();
        const pids = execFileSync('/bin/ps', ['-axo', 'pid=,ppid=,command='], { encoding: 'utf8' })
          .split('\n')
          .map((l) => l.trim().split(/\s+/))
          .filter((x) => x[1] === springPid && x.slice(2).join(' ').includes(`${RIG}/dist/`) && x.includes('managed-runtime-worker'))
          .map((x) => Number(x[0]));
        for (const pid of pids) process.kill(pid, 'SIGKILL');
        R.say(`  worker processes of this server killed: ${j(pids)}`);
      }
      await h.stop('SIGKILL');
      hold.release();
      R.say('  Harness killed with SIGKILL inside the window');
      if (scenario === 'settle-mysql-kill') {
        await sleep(1500);
        R.say(`  ${sh(`${RIG}/mysql.sh`, ['start'])}`);
        await sleep(3000);
      }
      h = await new Harness({ name: `s15-${scenario}-${arm}-b`, modelUrl: model.url, brokerUrl: proxy.url, arm }).start();
      s2 = new HSession(h, s.sessionId, storeConnection(h, w.workspaceId, store.url), shell ? SHELL : FILES);
      const c = await coldLoad(s2);
      R.check(settleWindow ? 'cold load in a new Harness settles the durable batch' : 'cold load stays blocked (results were not durable)', settleWindow ? c.l.status === 200 : c.l.status === 409, c.text);
    }
    const loaded = s2.clientId && (await s2.status())?.recoveryBlocked === false;
    if (loaded) {
      const r = await afterRecovery(s2, p);
      const okRun = shell ? read(w.dir, 'ran.log') === 'ran\n' : true;
      R.check('the original prompt finishes from the saved results: tools not rerun, model called once with them', r.terms.some((t) => t.startsWith('turn_complete')) && starts() === (shell ? 2 : 1) && r.step1.length === 1 && okRun && read(w.dir, 'notes.txt') === 'after P1', `starts=${starts()} notes=${j(read(w.dir, 'notes.txt'))}${shell ? ` ran.log=${j(read(w.dir, 'ran.log'))}` : ''}`);
      R.check('history settled durably (pending cleared, one snapshot)', /pendingTurn=null .*snapshots=1/.test(await pend(s2)), await pend(s2));
      const u = await undo(s2, p, 'undo(P1)');
      R.check('undo of the recovered prompt restores the original', u.status === 200 && read(w.dir, 'notes.txt') === 'original', u.text);
      const p2 = await s2.prompt(script([[call('write_file', { file_path: 'notes.txt', content: 'after P2' })]], 'P2'));
      R.check('the Session takes new Write prompts afterwards', ok(p2) && read(w.dir, 'notes.txt') === 'after P2', `${turn(p2)} lease=${lease()}`);
    } else {
      const st = s2.clientId ? await s2.status() : null;
      R.note('Session after the load', `recoveryBlocked=${st?.recoveryBlocked ?? 'not loaded'} ${s2.clientId ? await pend(s2) : ''} lease=${lease()}`);
      R.check('no replay: the tool ran once and the model was not called again', starts() === (shell ? 2 : 1) && model.requests.filter((r) => r.step === 1).length === 0 && read(w.dir, 'notes.txt') === 'after P1', `starts=${starts()} model follow-ups=${model.requests.filter((r) => r.step === 1).length}`);
      R.say(`  harness stderr: ${h.log().split('\n').filter((l) => /recover|history/i.test(l)).slice(-2).join(' | ').slice(0, 300)}`);
    }
  } else if (/^crash-at-\d+$/.test(scenario)) {
    // Crash sweep: hold the k-th Store commit after the prompt is submitted (it never reaches the Store), SIGKILL the
    // Harness, cold load in a new Harness and record what the original prompt, the files, the history and the tools do.
    const k = Number(scenario.split('-').at(-1));
    fs.writeFileSync(f('notes.txt'), 'original');
    const s = await mk();
    let n = 0;
    let held = null;
    let release;
    const gate = new Promise((r) => (release = r));
    store.state.hook = async (entry) => {
      if (entry.method === 'POST' && /transactions:commit$/.test(entry.url) && ++n === k) {
        held = `#${k} ${entry.operation}`;
        await gate;
        return 'fail-503';
      }
      return 'forward';
    };
    const sub = await s.submit(script([[call('write_file', { file_path: 'notes.txt', content: 'after P1' })]], 'P1 finished'));
    for (let i = 0; i < 1200 && !held; i++) await sleep(100);
    const before = `notes=${j(read(w.dir, 'notes.txt'))} starts=${starts()} history=${await pend(s).catch(() => '?')}`;
    await h.stop('SIGKILL');
    store.state.hook = null;
    release();
    h = await new Harness({ name: `s15-${scenario}-${arm}-b`, modelUrl: model.url, brokerUrl: proxy.url, arm }).start();
    const s2 = new HSession(h, s.sessionId, storeConnection(h, w.workspaceId, store.url));
    const c = await coldLoad(s2);
    let outcome = `load=${c.l.status}${c.l.json?.code ? ' ' + c.l.json.code : ''}`;
    let undoText = '';
    if (c.l.status === 200) {
      const st = await s2.waitIdle(180_000);
      const events = (await s2.transcript()).filter((e) => e.promptId === sub.promptId);
      const terms = events.filter((e) => e.type.startsWith('turn_')).map((e) => e.type);
      outcome += ` prompt=${terms.join(',') || 'none'} blocked=${st.recoveryBlocked}`;
      if (!st.recoveryBlocked && read(w.dir, 'notes.txt') === 'after P1') {
        const u = await s2.rewind(sub.promptId);
        undoText = ` undo=${u.status}${u.json?.code ? ' ' + u.json.code : ''}${read(w.dir, 'notes.txt') === 'original' ? ' restored' : ''}`;
      }
    }
    const after = `starts=${starts()} notes=${j(read(w.dir, 'notes.txt'))} model follow-ups=${model.requests.filter((r) => r.step === 1).length} lease=${lease()}`;
    R.say(`== CRASH ${JSON.stringify({ k, held, before, outcome, after, undo: undoText.trim(), earlier: c.text.replace(/^.*earlier answers: /, '') })}`);
    R.check('no replay: the tool started at most once', starts() <= 1, after);
  } else if (scenario === 'snapshot-reply-lost') {
    // The worker took the post-effect snapshot but its reply was lost: blocked, then detach + load in the same Harness.
    fs.writeFileSync(f('notes.txt'), 'original');
    const s = await mk();
    proxy.state.hook = (entry) => (entry.op === 'raw-file-history:snapshot' ? 'drop-reply' : 'forward');
    const p = await s.prompt(script([[call('write_file', { file_path: 'notes.txt', content: 'after P1' })]], 'P1 finished'));
    proxy.state.hook = null;
    R.check('lost snapshot reply: blocked, the effect ran once, the model not called again', p.status2.recoveryBlocked === true && starts() === 1 && model.requests.filter((r) => r.step === 1).length === 0, `${turn(p)} ${await pend(s)}`);
    const rl = await s.reload();
    R.note('detach + load in the same Harness', j(rl));
    if (rl.load === 200) {
      const r = await afterRecovery(s, p);
      R.check('the prompt finishes from the saved results, the tool is not rerun', r.terms.some((t) => t.startsWith('turn_complete')) && starts() === 1 && r.step1.length === 1, `starts=${starts()} ${await pend(s)}`);
      const u = await undo(s, p, 'undo(P1)');
      R.check('undo of the recovered prompt restores the original', u.status === 200 && read(w.dir, 'notes.txt') === 'original', u.text);
    }
  } else if (scenario === 'release-reply-lost' || scenario === 'release-request-lost') {
    // The case 80f8cfe3f5 re-aligned in the IT: the runtime release after a settled turn loses its reply once,
    // or its request is dropped every time.
    fs.writeFileSync(f('notes.txt'), 'original');
    const s = await mk();
    const persistent = scenario === 'release-request-lost';
    let drops = 0;
    proxy.state.hook = (entry) => (/:release$/.test(entry.url) && (persistent || drops === 0) ? (drops++, persistent ? 'drop-request' : 'drop-reply') : 'forward');
    const p = await s.prompt(script([[call('write_file', { file_path: 'notes.txt', content: 'after P1' })]], 'P1 finished'));
    const releases = () => proxy.ledger.filter((e) => /:release$/.test(e.url)).length;
    R.say(`  first run: ${turn(p)} ${await pend(s)} releases=${releases()} lease=${lease()}`);
    if (!persistent) proxy.state.hook = null;
    const rl = await s.reload();
    R.say(`  detach + load: ${j(rl)}`);
    let st = null;
    let terms = [];
    if (rl.load === 200) {
      st = await s.waitIdle(180_000);
      terms = (await s.transcript()).filter((e) => e.promptId === p.promptId && e.type.startsWith('turn_')).map((e) => e.type);
    }
    const tail = `terminals=${j(terms)} blocked=${st?.recoveryBlocked ?? 'not loaded'} starts=${starts()} model follow-ups=${model.requests.filter((r) => r.step === 1).length} releases=${releases()} lease=${lease()} notes=${j(read(w.dir, 'notes.txt'))}`;
    if (persistent) R.check('release request dropped every time: stays blocked, no terminal, lease kept, nothing replayed', terms.length === 0 && starts() === 1 && model.requests.filter((r) => r.step === 1).length === 1 && lease() !== 'free', tail);
    else R.check('release reply lost once: reload completes the prompt exactly once, no tool or model replay', terms.length === 1 && terms[0] === 'turn_complete' && st?.recoveryBlocked === false && starts() === 1 && model.requests.filter((r) => r.step === 1).length === 1 && lease() === 'free', tail);
    proxy.state.hook = null;
  } else if (scenario === 'reservation-conflict') {
    fs.writeFileSync(f('notes.txt'), 'original');
    fs.writeFileSync(f('other.txt'), 'o0');
    const s = await mk();
    let injected = 0;
    proxy.state.hook = (entry) => (entry.method === 'POST' && /\/executions:prepare$/.test(entry.url) && injected++ === 0 ? { respond: { status: 409, body: { code: 'runtime_execution_conflict', error: 'injected: execution identity is already in use' } } } : 'forward');
    const p1 = await s.prompt(script([[call('write_file', { file_path: 'notes.txt', content: 'P1' })]], 'P1'));
    R.check('a 409 runtime_execution_conflict on prepare: tool error, turn completes, nothing started, lease free', ok(p1) && read(w.dir, 'notes.txt') === 'original' && starts() === 0 && lease() === 'free', `${turn(p1)} model saw ${j(results(p1))} starts=${starts()} ${await pend(s)}`);
    injected = 0;
    const p2 = await s.prompt(script([[call('write_file', { file_path: 'notes.txt', content: 'P2' }), call('write_file', { file_path: 'other.txt', content: 'o2' })]], 'P2'));
    R.check('mixed batch: the refused call is skipped, the other one runs', ok(p2) && read(w.dir, 'notes.txt') === 'original' && read(w.dir, 'other.txt') === 'o2', `${turn(p2)} model saw ${j(results(p2))} ${await pend(s)}`);
    proxy.state.hook = null;
    const rl = await s.reload();
    R.check('detach + load afterwards', rl.load === 200, j(rl));
    const u = await undo(s, p2, 'undo(P2)');
    R.check('undo(P2) restores other.txt', u.status === 200 && read(w.dir, 'other.txt') === 'o0', u.text);
  } else if (scenario === 'legacy-pending') {
    // A Session blocked by 263859b004 (pending without batch identity) is loaded by the new Harness.
    fs.writeFileSync(f('notes.txt'), 'original');
    const old = await new Harness({ name: `s15-${scenario}-old`, modelUrl: model.url, brokerUrl: proxy.url, arm: process.env.OLD_ARM ?? 'head3' }).start();
    const s = await mk(FILES, old);
    const t0 = Date.now();
    store.state.hook = (e, parsed, b) => (afterStart(t0) && isFh(b.toString()) ? 'fail-503' : 'forward');
    const p = await s.prompt(script([[call('write_file', { file_path: 'notes.txt', content: 'after P1' })]], 'P1'));
    store.state.hook = null;
    R.say(`  old Harness (${process.env.OLD_ARM ?? 'head3'}): ${turn(p)} ${await pend(s)}`);
    await s.detach();
    await old.stop();
    const s2 = new HSession(h, s.sessionId, storeConnection(h, w.workspaceId, store.url));
    const c = await coldLoad(s2);
    R.check('the new Harness keeps the legacy pending record blocked', c.l.status === 409, c.text);
    R.check('no replay', starts() === 1 && read(w.dir, 'notes.txt') === 'after P1', `starts=${starts()}`);
  } else throw new Error(`unknown scenario ${scenario}`);
} catch (e) {
  R.check('probe completed without exception', false, String(e.stack ?? e).slice(0, 800));
  R.say(h.log().slice(-1500));
} finally {
  await h.stop();
  await proxy.close();
  await store.close();
  await model.close();
  R.done();
}
