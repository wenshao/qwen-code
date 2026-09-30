// S4: what a *definite, pre-dispatch* history refusal does to the Session and its Workspace.
// Each scenario uses a fresh Workspace. The same script runs on the base arm for the A/B.
// usage: DB=<db> [ARM=head|base] node s4-refusals.mjs <scenario> <letter>
import fs from 'node:fs';
import path from 'node:path';
import { Report, Harness, HSession, startModel, startBrokerProxy, ledgerLines, workspace, createWorkspaceSession, storeConnection, script, call, turn, toolTrace, read, holderOf, j, FILES, SHELL, RUN } from './lib.mjs';

const [scenario, letter] = process.argv.slice(2);
const arm = process.env.ARM ?? 'head';
const R = new Report(`s4-${scenario}-${arm}`);
const model = await startModel(`${RUN}/model-s4-${scenario}-${arm}.jsonl`);
const proxy = await startBrokerProxy();
const h = await new Harness({ name: `s4-${scenario}-${arm}`, modelUrl: model.url, brokerUrl: proxy.url, arm }).start();
const w = await workspace(letter);
const mk = async (profile = FILES) => {
  const s = new HSession(h, await createWorkspaceSession(w.workspaceId), storeConnection(h, w.workspaceId), profile);
  const c = await s.create();
  if (c.status !== 200) throw new Error(`create ${c.status} ${j(c.json)}`);
  return s;
};
const f = (rel) => path.join(w.dir, rel);
const seen = (p) => model.requests.at(-1)?.toolResults.map((t) => t.content.replace(/\s+/g, ' ').slice(0, 150));

// Observe the aftermath of the prompt under test.
async function aftermath(s, p, label) {
  R.say(`  ${label}: ${turn(p)}`);
  for (const l of toolTrace(p.events ?? [])) R.say(`      ${l}`);
  const st = await s.status();
  const holder = holderOf(letter);
  R.say(`  Session recoveryBlocked=${st.recoveryBlocked}; Workspace execution lease holder=${holder === '<none>' || holder === '<no row>' ? 'none' : holder === p.promptId ? 'THIS PROMPT (still held)' : holder}`);
  const next = await s.prompt(script([], 'NEXT_OK'));
  R.say(`  next prompt in the same Session: ${turn(next)}`);
  const sib = await mk();
  const sp = await sib.prompt(script([[call('read_file', { file_path: 'sibling.txt' })]], 'SIBLING_OK'));
  R.say(`  another Session in the same Workspace (read_file): ${turn(sp)}`);
  const rl = await s.reload();
  R.say(`  detach -> ${rl.detach}, load -> ${rl.load}${rl.code ? ' ' + rl.code : ''}`);
  const stderr = h.log().split('\n').filter((l) => /requires recovery|recovery/i.test(l)).slice(-2).join(' | ');
  if (stderr) R.say(`  harness stderr: ${stderr.slice(0, 400)}`);
  return { blocked: st.recoveryBlocked, held: holder === p.promptId, next: next.status, sibling: sp.terminal?.[0]?.type, load: rl.load };
}

try {
  fs.writeFileSync(f('sibling.txt'), 'sibling');
  let out;
  if (scenario === 'external-edit') {
    // The model wrote notes.txt in P1; somebody edits it outside the agent; the model edits it again in P2.
    fs.writeFileSync(f('notes.txt'), 'v0');
    const s = await mk();
    const p1 = await s.prompt(script([[call('write_file', { file_path: 'notes.txt', content: 'v1 by agent' })]], 'P1_DONE'));
    R.say(`  P1 write: ${turn(p1)}`);
    fs.writeFileSync(f('notes.txt'), 'v1 by agent\n+ a line the user added in their editor\n');
    const t0 = Date.now();
    const p2 = await s.prompt(script([[call('edit', { file_path: 'notes.txt', old_string: 'v1 by agent', new_string: 'v2 by agent' })]], 'P2_DONE'));
    R.say(`  wire: ${ledgerLines(proxy.ledger, t0).filter((l) => /control|:start|release|acquire/.test(l)).join(' | ')}`);
    out = await aftermath(s, p2, 'P2 edit after the external edit');
    R.say(`  notes.txt on disk: ${j(read(w.dir, 'notes.txt'))}`);
  } else if (scenario === 'directory-path') {
    // The model passes a directory as file_path (a common slip), then would correct itself.
    fs.mkdirSync(f('src'));
    const s = await mk();
    const p = await s.prompt(script([[call('write_file', { file_path: 'src', content: 'x' })], [call('write_file', { file_path: 'src/ok.txt', content: 'corrected' })]], 'CORRECTED'));
    out = await aftermath(s, p, 'write_file file_path="src" (a directory), then corrected path');
    R.say(`  model saw: ${j(seen())}; src/ok.txt=${j(read(w.dir, 'src/ok.txt'))}`);
  } else if (scenario === 'parent-is-file') {
    fs.writeFileSync(f('notes.txt'), 'v0');
    const s = await mk();
    const p = await s.prompt(script([[call('write_file', { file_path: 'notes.txt/child.txt', content: 'x' })], [call('write_file', { file_path: 'ok.txt', content: 'corrected' })]], 'CORRECTED'));
    out = await aftermath(s, p, 'write_file under a regular file, then corrected path');
    R.say(`  model saw: ${j(seen())}; ok.txt=${j(read(w.dir, 'ok.txt'))}`);
  } else if (scenario === 'symlink') {
    // An in-Workspace symlink (e.g. AGENTS.md -> CLAUDE.md is a common repository layout).
    fs.writeFileSync(f('CLAUDE.md'), 'real file');
    fs.symlinkSync('CLAUDE.md', f('AGENTS.md'));
    const s = await mk();
    const p = await s.prompt(script([[call('edit', { file_path: 'AGENTS.md', old_string: 'real file', new_string: 'edited through link' })], [call('edit', { file_path: 'CLAUDE.md', old_string: 'real file', new_string: 'edited directly' })]], 'CORRECTED'));
    out = await aftermath(s, p, 'edit AGENTS.md (symlink to CLAUDE.md inside the Workspace)');
    R.say(`  model saw: ${j(seen())}; CLAUDE.md=${j(read(w.dir, 'CLAUDE.md'))} AGENTS.md is symlink=${fs.lstatSync(f('AGENTS.md')).isSymbolicLink()}`);
  } else if (scenario === 'fifo') {
    // FG6c/FG6d/FG6e hold an in-flight `edit` on a FIFO named proof.txt.
    const { execFileSync } = await import('node:child_process');
    execFileSync('mkfifo', [f('proof.txt')]);
    const s = await mk();
    const sub = await s.submit(script([[call('edit', { file_path: 'proof.txt', old_string: 'x', new_string: 'xx' })]], 'FIFO_DONE'));
    // the gates wait for the tool to open the FIFO for reading
    let entered = false;
    for (let i = 0; i < 100 && !entered; i++) {
      try {
        const fd = fs.openSync(f('proof.txt'), fs.constants.O_WRONLY | fs.constants.O_NONBLOCK);
        entered = true;
        fs.writeSync(fd, 'x');
        fs.closeSync(fd);
      } catch (e) {
        if (e.code !== 'ENXIO') throw e;
        await new Promise((r) => setTimeout(r, 100));
      }
      if ((await s.status()).hasActivePrompt === false) break;
    }
    const st = await s.waitIdle(60_000);
    const events = (await s.transcript()).filter((e) => e.promptId === sub.promptId);
    R.say(`  edit on a FIFO: tool opened the FIFO=${entered}; terminal=${events.filter((e) => e.type.startsWith('turn_')).map((e) => e.type).join(',') || '<none>'} recoveryBlocked=${st.recoveryBlocked}`);
    R.say(`  wire: ${ledgerLines(proxy.ledger).filter((l) => /control|:start|prepare/.test(l)).join(' | ')}`);
    R.say(`  harness stderr: ${h.log().split('\n').filter((l) => /recovery/i.test(l)).slice(-1).join('').slice(0, 300)}`);
    out = { blocked: st.recoveryBlocked, entered };
  } else if (scenario === 'two-sessions') {
    // Two Sessions of one Workspace both edit shared.txt through the agent; no external actor at all.
    fs.writeFileSync(f('shared.txt'), 'v0');
    const a = await mk();
    const b = await mk();
    const a1 = await a.prompt(script([[call('write_file', { file_path: 'shared.txt', content: 'v1 by Session A' })]], 'A1_DONE'));
    R.say(`  Session A writes shared.txt: ${turn(a1)}`);
    const b1 = await b.prompt(script([[call('write_file', { file_path: 'shared.txt', content: 'v2 by Session B' })]], 'B1_DONE'));
    R.say(`  Session B writes shared.txt: ${turn(b1)}`);
    const a2 = await a.prompt(script([[call('read_file', { file_path: 'shared.txt' })], [call('edit', { file_path: 'shared.txt', old_string: 'v2 by Session B', new_string: 'v3 by Session A' })]], 'A2_DONE'));
    out = await aftermath(a, a2, 'Session A reads then edits shared.txt again');
    const b2 = await b.prompt(script([[call('read_file', { file_path: 'shared.txt' })]], 'B2_DONE'));
    R.say(`  Session B afterwards (read_file): ${turn(b2)}`);
    R.say(`  shared.txt on disk: ${j(read(w.dir, 'shared.txt'))}`);
  } else if (scenario === 'shell-chmod') {
    // Shell profile: write a script, make it executable with the Shell tool, then fix it with edit.
    const s = await mk(SHELL);
    const t0 = Date.now();
    const p = await s.prompt(
      script(
        [
          [call('write_file', { file_path: 'run.sh', content: '#!/bin/sh\necho helo\n' })],
          [call('run_shell_command', { command: 'chmod +x run.sh && ./run.sh', description: 'run it' })],
          [call('edit', { file_path: 'run.sh', old_string: 'helo', new_string: 'hello' })],
        ],
        'SCRIPT_FIXED',
      ),
      240_000,
    );
    R.say(`  wire: ${ledgerLines(proxy.ledger, t0).filter((l) => /control|:start|release|acquire/.test(l)).join(' | ')}`);
    out = await aftermath(s, p, 'write_file run.sh -> shell chmod +x && run -> edit run.sh');
    R.say(`  run.sh on disk: ${j(read(w.dir, 'run.sh'))} mode=${(fs.statSync(f('run.sh')).mode & 0o777).toString(8)}`);
  } else if (scenario === 'shell-format') {
    // Shell profile: write a file, a Shell command rewrites it (formatter / sed / codegen), then edit it.
    const s = await mk(SHELL);
    const p = await s.prompt(
      script(
        [
          [call('write_file', { file_path: 'data.json', content: '{"a":1}' })],
          [call('run_shell_command', { command: `printf '{\\n  "a": 1\\n}\\n' > data.json`, description: 'format' })],
          [call('read_file', { file_path: 'data.json' })],
          [call('edit', { file_path: 'data.json', old_string: '"a": 1', new_string: '"a": 2' })],
        ],
        'FORMATTED_EDITED',
      ),
      240_000,
    );
    out = await aftermath(s, p, 'write_file -> shell rewrites the file -> read_file -> edit');
    R.say(`  data.json on disk: ${j(read(w.dir, 'data.json'))}`);
  } else throw new Error(`unknown scenario ${scenario}`);
  R.say(`== RESULT ${scenario}/${arm}: ${j(out)}`);
} catch (e) {
  R.check('probe completed without exception', false, String(e.stack ?? e).slice(0, 800));
  R.say(h.log().slice(-1200));
} finally {
  await h.stop();
  await proxy.close();
  await model.close();
  R.done();
}
