import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { fork } from 'node:child_process';

const [tree, output, mode, workerTeam, workerOwner, workerTask, snapshotGate] = process.argv.slice(2);
const load = (relative) => import(pathToFileURL(path.join(tree, 'packages/core/dist/src', relative)));
const tasks = await load('agents/team/tasks.js');

if (workerTeam) {
  const { TaskUpdateTool } = await load('tools/task-update.js');
  const { TeamManager } = await load('agents/team/TeamManager.js');
  const { FakeBackend } = await load('agents/team/test-utils/fake-backend.js');
  const { AgentStatus } = await load('agents/runtime/agent-types.js');
  const backend = new FakeBackend();
  for (const name of ['alice', 'bob']) {
    backend.setScript(`${name}@${workerTeam}`, {
      onStart: (agent) => agent.setStatus(AgentStatus.RUNNING),
      onMessage: () => 'stay_running',
    });
    await backend.spawnAgent({ agentId: `${name}@${workerTeam}`, command: '', args: [], cwd: output });
  }
  const manager = new TeamManager(backend, {
    name: workerTeam, createdAt: Date.now(), leadAgentId: `leader@${workerTeam}`,
    members: ['alice', 'bob'].map((name) => ({ name, agentId: `${name}@${workerTeam}` })),
  });
  const tool = new TaskUpdateTool({
    getTeamContext: () => ({ teamName: workerTeam }), getApprovalMode: () => 'default',
    getTeamManager: () => {
      process.send({ kind: 'snapshot-read', pid: process.pid });
      if (snapshotGate) {
        const deadline = Date.now() + 10000;
        const waitCell = new Int32Array(new SharedArrayBuffer(4));
        while (!existsSync(snapshotGate)) {
          if (Date.now() > deadline) throw new Error('Snapshot gate timed out');
          Atomics.wait(waitCell, 0, 0, 10);
        }
      }
      return manager;
    },
  });
  const result = await tool.build({ taskId: workerTask, status: 'in_progress', owner: workerOwner }).execute(new AbortController().signal);
  const received = Object.fromEntries(['alice', 'bob'].map((name) => [name, [...backend.getAgent(`${name}@${workerTeam}`).getReceivedMessages()]]));
  process.send({ kind: 'result', pid: process.pid, owner: workerOwner, result, received });
  await manager.cleanup();
  process.disconnect();
} else {
  const require = createRequire(path.join(tree, 'package.json'));
  const lockfile = require('proper-lockfile');
  await fs.mkdir(output, { recursive: true });
  const records = [];
  const runId = `${Date.now().toString(36)}-${process.pid}`;
  for (let i = 1; i <= 5; i++) {
    const team = `pr10237-cross-${mode}-${runId}-${i}`;
    const task = await tasks.createTask(team, { subject: 'Cross-process assignment', description: 'Observe the actual prompt at the teammate boundary.' });
    const release = await lockfile.lock(tasks.getTaskPath(team, task.id), { stale: 5000, update: 1000 });
    const spawn = (owner) => {
      const child = fork(fileURLToPath(import.meta.url), [tree, output, mode, team, owner, task.id], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
      let ready, result, fail;
      const snapshot = new Promise((resolve) => { ready = resolve; });
      const completion = new Promise((resolve, reject) => { result = resolve; fail = reject; });
      let returned;
      let stderr = '';
      child.stderr.on('data', (data) => { stderr += data; });
      child.on('message', (message) => {
        if (message.kind === 'snapshot-read') ready(message);
        if (message.kind === 'result') returned = message;
      });
      child.on('error', fail);
      child.on('exit', (code) => { if (code === 0 && returned) result(returned); else fail(new Error(`Worker ${owner} exit ${code}: ${stderr}`)); });
      return { child, snapshot, completion };
    };
    const workers = [spawn('alice'), spawn('bob')];
    let timer;
    try {
      await Promise.race([Promise.all(workers.map((w) => w.snapshot)), new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Workers failed to reach both stale snapshots')), 15000);
      })]);
    } finally { clearTimeout(timer); await release(); }
    const results = await Promise.all(workers.map((w) => w.completion));
    const stored = await tasks.getTask(team, task.id);
    const owners = results.flatMap((entry) => Object.entries(entry.received).flatMap(([owner, prompts]) => prompts.map(() => owner)));
    const conflicts = results.filter((entry) => entry.result.error);
    assert.equal(conflicts.length, mode === 'head' ? 1 : 0);
    assert.equal(owners.length, mode === 'head' ? 1 : 2);
    if (mode === 'head') {
      assert.deepEqual(owners, [stored.owner]);
      assert.equal(conflicts[0].result.llmContent, conflicts[0].result.error.message);
      assert.equal(conflicts[0].result.returnDisplay, conflicts[0].result.error.message);
    } else assert.deepEqual([...owners].sort(), ['alice', 'bob']);
    const record = { iteration: i, pass: true, ownerOnDisk: stored.owner, promptRecipients: owners, processes: results.map((r) => r.pid), results, stored };
    records.push(record);
    await fs.writeFile(path.join(output, `pair-${i}.json`), JSON.stringify(record, null, 2) + '\n');
    console.log(`PASS cross-process pair ${i}: ${JSON.stringify({ ownerOnDisk: stored.owner, promptRecipients: owners, conflicts: conflicts.length, processes: record.processes })}`);
  }
  await fs.writeFile(path.join(output, 'summary.json'), JSON.stringify({ mode, passed: records.length, total: 5, boundary: 'Two separate Node processes each execute the real compiled TaskUpdateTool and TeamManager dispatch, sharing real JSON files and proper-lockfile locks. FakeBackend/FakeAgent simulate only teammate LLM execution.', records }, null, 2) + '\n');
  console.log(`RESULT ${records.length}/5 cross-process pairs passed (${mode})`);
}
