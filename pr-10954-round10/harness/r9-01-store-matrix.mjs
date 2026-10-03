// Store matrix: the same on-disk store, a real `qwen serve` per cell and
// per arm, plus `qwen sessions ps` through the shipped bin for contrast.
//   node r9-01-store-matrix.mjs head prefix cand
import fs from 'node:fs';
import path from 'node:path';
import {
  freshDir,
  storeModule,
  liveProcess,
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

const arms = process.argv.slice(2);
const A = 'aaaaaaaa-1111-4111-8111-000000000001';
const B = 'bbbbbbbb-2222-4222-8222-000000000002';

// Each cell: build(store, home, ws, pids) → sets up the store.
const CELLS = [
  {
    id: 'C1',
    title: 'healthy: one live agent',
    async build(store, home, ws, pids) {
      const pid = liveProcess();
      pids.push(pid);
      await writeManaged(store, home, { id: A, cwd: ws, name: 'agent-A', worker: { workerPid: pid } });
    },
  },
  {
    id: 'C2',
    title: "B's state.json corrupt, A healthy",
    async build(store, home, ws, pids) {
      const pid = liveProcess();
      pids.push(pid);
      await writeManaged(store, home, { id: A, cwd: ws, name: 'agent-A', worker: { workerPid: pid } });
      await writeManaged(store, home, { id: B, cwd: ws, name: 'agent-B-waiting', sessionState: 'needs_input', worker: { workerPid: pid } });
      fs.writeFileSync(store.getAgentViewSessionPaths(B, { globalDir: home }).statePath, '{ not json');
    },
  },
  {
    id: 'C3',
    title: "B's state.json unreadable (EISDIR), A healthy",
    async build(store, home, ws, pids) {
      const pid = liveProcess();
      pids.push(pid);
      await writeManaged(store, home, { id: A, cwd: ws, name: 'agent-A', worker: { workerPid: pid } });
      await writeManaged(store, home, { id: B, cwd: ws, name: 'agent-B-waiting', sessionState: 'needs_input', worker: { workerPid: pid } });
      const p = store.getAgentViewSessionPaths(B, { globalDir: home }).statePath;
      fs.rmSync(p);
      fs.mkdirSync(p);
    },
  },
  {
    id: 'C4',
    title: 'roster.json corrupt',
    async build(store, home, ws, pids) {
      const pid = liveProcess();
      pids.push(pid);
      await writeManaged(store, home, { id: A, cwd: ws, name: 'agent-A', worker: { workerPid: pid } });
      fs.writeFileSync(store.getAgentViewStorePaths({ globalDir: home }).rosterPath, '{ not json');
    },
  },
  {
    id: 'C5',
    title: 'stray regular file jobs/notes.txt, A healthy',
    async build(store, home, ws, pids) {
      const pid = liveProcess();
      pids.push(pid);
      await writeManaged(store, home, { id: A, cwd: ws, name: 'agent-A', worker: { workerPid: pid } });
      fs.writeFileSync(path.join(store.getAgentViewStorePaths({ globalDir: home }).jobsDir, 'notes.txt'), 'x');
    },
  },
  {
    id: 'C6',
    title: 'empty session dir (no state.json yet), A healthy',
    async build(store, home, ws, pids) {
      const pid = liveProcess();
      pids.push(pid);
      await writeManaged(store, home, { id: A, cwd: ws, name: 'agent-A', worker: { workerPid: pid } });
      fs.mkdirSync(path.join(store.getAgentViewStorePaths({ globalDir: home }).jobsDir, B));
    },
  },
  {
    id: 'C7',
    title: "R13-4: live A, A's worker.json corrupt",
    async build(store, home, ws, pids) {
      const pid = liveProcess();
      pids.push(pid);
      await writeManaged(store, home, { id: A, cwd: ws, name: 'agent-A', worker: { workerPid: pid } });
      fs.writeFileSync(store.getAgentViewSessionPaths(A, { globalDir: home }).workerPath, '{ not json');
    },
  },
  {
    id: 'C8a',
    title: 'R4-4 control: pid only in a live registry record, registry healthy',
    async build(store, home, ws, pids, arm) {
      await writeManaged(store, home, { id: A, cwd: ws, name: 'agent-A', worker: {} });
      const reg = await registryProcess(arm, home, { sessionId: A, cwd: ws, kind: 'tui' });
      pids.push(reg.pid);
    },
  },
  {
    id: 'C8b',
    title: 'R4-4: same, registry dir unreadable (ENOTDIR)',
    async build(store, home, ws, pids, arm) {
      await writeManaged(store, home, { id: A, cwd: ws, name: 'agent-A', worker: {} });
      const reg = await registryProcess(arm, home, { sessionId: A, cwd: ws, kind: 'tui' });
      pids.push(reg.pid);
      fs.renameSync(path.join(home, 'sessions'), path.join(home, 'sessions.moved'));
      fs.writeFileSync(path.join(home, 'sessions'), '');
    },
  },
  {
    id: 'C9',
    title: 'R4-4 reach: registry unreadable, worker.json has the live pid',
    async build(store, home, ws, pids) {
      const pid = liveProcess();
      pids.push(pid);
      await writeManaged(store, home, { id: A, cwd: ws, name: 'agent-A', worker: { workerPid: pid } });
      fs.writeFileSync(path.join(home, 'sessions'), '');
    },
  },
  {
    id: 'C10',
    title: 'no jobs dir at all',
    async build() {},
  },
];

function summarize(r) {
  if (r.status !== 200) return `${r.status} ${r.body?.code ?? ''}`.trim();
  const a = r.body.agents;
  if (!a.length) return '200 []';
  return `200 [${a.map((x) => `${x.name}:${x.taskState}${x.pid ? '/pid' : ''}`).join(', ')}]`;
}

function psSummary(p) {
  const lines = p.stdout.trim().split('\n').filter(Boolean);
  const rows = lines.filter((l) => !/^NAME\b/.test(l));
  const err = p.stderr.trim().split('\n').filter((l) => l && !/DeprecationWarning|node --trace/.test(l));
  return `exit ${p.code}; ${rows.length} row(s)${err.length ? `; stderr: ${err.join(' | ').slice(0, 140)}` : ''}`;
}

const results = [];
for (const cell of CELLS) {
  for (const arm of arms) {
    const dir = freshDir('matrix', cell.id, arm);
    const home = path.join(dir, 'home');
    const ws = path.join(dir, 'ws');
    fs.mkdirSync(home, { recursive: true });
    fs.mkdirSync(ws, { recursive: true });
    fs.writeFileSync(path.join(home, 'settings.json'), '{}');
    const store = await storeModule(arm);
    const pids = [];
    let daemon;
    try {
      await cell.build(store, home, ws, pids, arm);
      // The daemon registers itself too; start it only after the store is
      // arranged, so a cell that breaks `sessions/` breaks it for the daemon
      // exactly as it would in the field.
      daemon = await startDaemon(arm, home, ws);
      const route = await getAgents(daemon);
      const cli = ps(arm, home);
      const row = {
        cell: cell.id,
        title: cell.title,
        arm,
        route: summarize(route),
        routeBody: route.body,
        ps: psSummary(cli),
        psStdout: cli.stdout,
        psStderr: cli.stderr,
      };
      results.push(row);
      console.log(`${cell.id.padEnd(4)} ${arm.padEnd(6)} route=${row.route.padEnd(48)} ps: ${row.ps}`);
    } finally {
      daemon?.stop();
      killAll(pids);
    }
  }
}
out(`${ROOT}/run/matrix/results.json`, results);
