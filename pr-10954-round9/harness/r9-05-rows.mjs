// Fix #4 (a merged row is dated by the process, not the session) and
// fix #8 (the controller recipe selects the interactive session), on a
// real daemon + the shipped bin.
//   node r9-05-rows.mjs prefix head
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  ARMS,
  freshDir,
  storeModule,
  registryProcess,
  killAll,
  startDaemon,
  getAgents,
  ps,
  writeManaged,
  iso,
  out,
  ROOT,
} from './lib.mjs';

const M = 'cccccccc-3333-4333-8333-000000000003';
const I = 'dddddddd-4444-4444-8444-000000000004';
const THREE_HOURS = 3 * 3600_000;
const results = [];

for (const arm of process.argv.slice(2)) {
  const dir = freshDir('rows', arm);
  const home = path.join(dir, 'home');
  const ws = path.join(dir, 'ws');
  fs.mkdirSync(ws, { recursive: true });
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(path.join(home, 'settings.json'), '{}');
  const store = await storeModule(arm);
  const pids = [];
  const sockM = path.join(dir, 'managed.sock');
  const sockI = path.join(dir, 'interactive.sock');
  const received = { [sockM]: [], [sockI]: [] };
  const servers = [sockM, sockI].map((p) =>
    net.createServer((c) => c.on('data', (d) => received[p].push(String(d)))).listen(p),
  );
  let daemon;
  try {
    // A managed session first launched three hours ago whose worker was
    // re-spawned just now: the live worker registers itself (with ipcPath,
    // as a TUI with peer messaging does) and is the pid worker.json records.
    const worker = await registryProcess(arm, home, { sessionId: M, cwd: ws, kind: 'tui', ipcPath: sockM });
    pids.push(worker.pid);
    await writeManaged(store, home, {
      id: M,
      cwd: ws,
      name: 'long-running audit',
      createdAt: iso(THREE_HOURS),
      worker: { workerPid: worker.pid },
    });
    // An ordinary interactive session with peer messaging.
    const tui = await registryProcess(arm, home, { sessionId: I, cwd: ws, kind: 'tui', ipcPath: sockI });
    pids.push(tui.pid);

    daemon = await startDaemon(arm, home, ws);
    const route = await getAgents(daemon);
    const table = ps(arm, home);
    const json = ps(arm, home, true);
    const agent = route.body.agents?.find((a) => a.sessionId === M);

    // Both recipes, literally, through bash + real jq, with `qwen` on PATH
    // being this arm's shipped bin. socat/uuidgen are not installed here,
    // so small shims stand in for them (they only move bytes).
    const shimDir = path.join(dir, 'bin');
    fs.mkdirSync(shimDir, { recursive: true });
    fs.writeFileSync(path.join(shimDir, 'qwen'), `#!/bin/sh\nexec ${process.execPath} ${ARMS[arm]}/scripts/cli-entry.js "$@"\n`, { mode: 0o755 });
    fs.writeFileSync(
      path.join(shimDir, 'socat'),
      `#!/bin/sh\nexec ${process.execPath} -e 'const s=require("net").connect(process.argv[1].replace(/^UNIX-CONNECT:/,""));process.stdin.pipe(s);s.on("finish",()=>process.exit(0));' "$2"\n`,
      { mode: 0o755 },
    );
    fs.writeFileSync(path.join(shimDir, 'uuidgen'), `#!/bin/sh\nexec ${process.execPath} -e 'console.log(require("crypto").randomUUID())'\n`, { mode: 0o755 });
    const env = { ...process.env, QWEN_HOME: home, PATH: `${shimDir}:${process.env.PATH}`, QWEN_CONTROLLER_TOKEN: 'tok' };
    const recipes = {
      'round-4 docs (4ae0857a8f)': `SESSION_IPC_PATH="$(qwen sessions ps --json | jq -r 'select(.ipcPath) | .ipcPath' | head -1)"`,
      'current docs (b98dfa1927)': `SESSION_IPC_PATH="$(qwen sessions ps --json | jq -r 'select(.managed == false and .ipcPath) | .ipcPath' | head -1)"`,
    };
    const recipeResults = {};
    for (const [label, assign] of Object.entries(recipes)) {
      received[sockM].length = 0;
      received[sockI].length = 0;
      const script = `${assign}
{ printf '%s\\n' \\
    '{"msgV":1,"type":"auth","token":"'"$QWEN_CONTROLLER_TOKEN"'"}' \\
    '{"msgV":1,"msgId":"'"$(uuidgen)"'","type":"user","priority":"next","message":{"role":"user","content":"open the failing test"}}'; \\
} | socat - UNIX-CONNECT:"$SESSION_IPC_PATH"
echo "SESSION_IPC_PATH=$SESSION_IPC_PATH"`;
      const r = spawnSync('bash', ['-c', script], { env, encoding: 'utf8', timeout: 60_000 });
      await new Promise((res) => setTimeout(res, 300));
      recipeResults[label] = {
        exit: r.status,
        resolved: /SESSION_IPC_PATH=(.*)/.exec(r.stdout)?.[1],
        deliveredTo: received[sockM].length ? 'MANAGED session socket' : received[sockI].length ? 'interactive session socket' : 'nothing',
      };
    }

    const row = {
      arm,
      createdAt: iso(THREE_HOURS).slice(0, 16),
      workerRecordStartedAt: new Date(worker.r?.record?.startedAt ?? Date.now()).toISOString().slice(0, 16),
      routeAgent: agent,
      psTable: table.stdout.trimEnd(),
      psJsonManaged: json.stdout.split('\n').filter(Boolean).map((l) => JSON.parse(l)).map((o) => ({ sessionId: o.sessionId, managed: o.managed, pid: o.pid, startedAt: o.startedAt ? new Date(o.startedAt).toISOString() : undefined, ipcPath: o.ipcPath ? path.basename(o.ipcPath) : undefined, taskState: o.taskState })),
      recipes: recipeResults,
    };
    results.push(row);
    console.log(JSON.stringify(row, null, 2));
  } finally {
    daemon?.stop();
    killAll(pids);
    servers.forEach((s) => s.close());
  }
}
out(`${ROOT}/run/rows/results.json`, results);
