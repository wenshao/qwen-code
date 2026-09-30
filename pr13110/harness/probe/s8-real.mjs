// S8: real model (no scripted replies). The provider key is read from the maintainer's own settings at launch and never stored in the rig.
// usage: DB=<db> [ARM=head|base|cand] node s8-real.mjs <task> <letter,letter,...> [tag]
import fs from 'node:fs';
import path from 'node:path';
import { Report, Harness, HSession, workspace, createWorkspaceSession, storeConnection, turn, toolTrace, read, holderOf, j, FILES, SHELL } from './lib.mjs';

const [task, lettersArg, tag = ''] = process.argv.slice(2);
const letters = lettersArg.split(',');
const trialsArg = String(letters.length);
const arm = process.env.ARM ?? 'head';
const MODEL = process.env.REAL_MODEL ?? 'qwen3.8-max';
const R = new Report(`s8-${task}-${arm}${tag}`);
const h = await new Harness({ name: `s8-${task}-${arm}${tag}`, arm, realModel: MODEL }).start();
const TASKS = {
  // Shell profile: write a script, make it executable and run it, then change it.
  script: {
    profile: SHELL,
    seed: () => undefined,
    prompt: 'In the working directory, create a shell script named hello.sh that prints "Hello, <name>!" for its first argument. Make it executable and run it with the argument World to check that it works. Then change the greeting from Hello to Hi and run it again. Tell me the final output.',
    done: (dir) => /Hi/.test(read(dir, 'hello.sh') ?? ''),
  },
  // files profile: an ordinary two-file change, then undo through the private API.
  config: {
    profile: FILES,
    seed: (dir) => {
      fs.writeFileSync(path.join(dir, 'config.json'), '{\n  "name": "demo",\n  "port": 8080\n}\n');
    },
    prompt: 'Read config.json in the working directory, change the port from 8080 to 9090, and create a README.md that documents the name and the port. Use relative paths.',
    done: (dir) => /9090/.test(read(dir, 'config.json') ?? '') && fs.existsSync(path.join(dir, 'README.md')),
  },
};
const T = TASKS[task];
let blocked = 0;
let finished = 0;
try {
  for (let i = 1; i <= Number(trialsArg); i++) {
    const letter = letters[i - 1];
    const w = await workspace(letter);
    T.seed(w.dir);
    const s = new HSession(h, await createWorkspaceSession(w.workspaceId), storeConnection(h, w.workspaceId), T.profile);
    const c = await s.create();
    if (c.status !== 200) throw new Error(`create ${c.status} ${j(c.json)}`);
    const p = await s.prompt(T.prompt, 420_000);
    const st = await s.status();
    const trace = toolTrace(p.events ?? []);
    const calls = trace.filter((l) => l.startsWith('call ')).map((l) => l.slice(5).replace(/\(\{.*$/, (m) => (m.length > 70 ? m.slice(0, 70) + '…' : m)));
    R.say(`trial ${i} [${arm}, ${MODEL}]: ${turn(p)}`);
    R.say(`   tool calls: ${calls.join(' → ')}`);
    const last = trace.at(-1) ?? '';
    if (st.recoveryBlocked) {
      blocked++;
      const holder = holderOf(letter);
      R.say(`   BLOCKED after: ${last.slice(0, 200)}`);
      R.say(`   Workspace lease holder: ${holder === p.promptId ? 'this prompt (still held)' : holder}; task finished on disk: ${T.done(w.dir)}`);
      R.say(`   harness stderr: ${h.log().split('\n').filter((l) => /recovery blocked/i.test(l)).slice(-1).join('').slice(0, 240)}`);
    } else {
      if (T.done(w.dir)) finished++;
      R.say(`   task finished on disk: ${T.done(w.dir)}`);
      if (arm !== 'base') {
        const hist = (await s.history()).json?.history;
        R.say(`   history: snapshots=${hist?.state.snapshots.length ?? 0} tracked=${j(Object.keys(hist?.state.files ?? {}))}`);
        if (task === 'config' && hist) {
          const u = await s.rewind(p.promptId);
          R.say(`   undo: status=${u.status} ${u.json?.code ?? ''} changed=${j(u.json?.filesChanged)} conflict=${u.json?.conflict} -> config.json port 8080 back=${/8080/.test(read(w.dir, 'config.json') ?? '')} README.md exists=${fs.existsSync(path.join(w.dir, 'README.md'))}`);
        }
        if (task === 'script' && hist) {
          const u = await s.rewind(p.promptId);
          R.say(`   undo: status=${u.status} ${u.json?.code ?? ''} changed=${j(u.json?.filesChanged)} conflict=${u.json?.conflict} -> hello.sh exists=${fs.existsSync(path.join(w.dir, 'hello.sh'))}`);
        }
      }
    }
  }
  R.say(`== RESULT ${task}/${arm}: trials=${trialsArg} blocked=${blocked} finished=${finished}`);
} catch (e) {
  R.check('probe completed without exception', false, String(e.stack ?? e).slice(0, 800));
  R.say(h.log().slice(-1200));
} finally {
  await h.stop();
  R.done();
}
