import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { fork } from 'node:child_process';

const [tree, output, mode = 'head'] = process.argv.slice(2);
assert(tree && output, 'Usage: node runtime-harness.mjs TREE OUTPUT [head|base]');
const require = createRequire(path.join(tree, 'package.json'));
const lockfile = require('proper-lockfile');
const load = (relative) => import(pathToFileURL(path.join(tree, 'packages/core/dist/src', relative)));
const tasks = await load('agents/team/tasks.js');
const { TaskUpdateTool } = await load('tools/task-update.js');
const { TeamManager } = await load('agents/team/TeamManager.js');
const { FakeBackend } = await load('agents/team/test-utils/fake-backend.js');
const { AgentStatus } = await load('agents/runtime/agent-types.js');
const { runWithTeammateIdentity } = await load('agents/team/identity.js');
await fs.mkdir(output, { recursive: true });

function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

async function bounded(promise, description) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Timeout: ${description}`)), 3000);
    })]);
  } finally {
    clearTimeout(timer);
  }
}

const records = [];
const runId = `${Date.now().toString(36)}-${process.pid}`;
let sequence = 0;
async function scenario(name, check) {
  const teamName = `pr10237-${mode}-${runId}-${++sequence}`;
  const backend = new FakeBackend();
  await backend.init();
  const manager = new TeamManager(backend, {
    name: teamName, createdAt: Date.now(), leadAgentId: `leader@${teamName}`, members: [],
  });
  for (const name of ['alice', 'bob']) {
    backend.setScript(`${name}@${teamName}`, {
      onStart: (agent) => agent.setStatus(AgentStatus.RUNNING),
      onMessage: () => 'stay_running',
    });
    await manager.spawnTeammate({ name, cwd: output });
  }
  const agent = (name) => backend.getAgent(`${name}@${teamName}`);
  const received = () => Object.fromEntries(['alice', 'bob'].map((name) => [name, [...agent(name).getReceivedMessages()]]));
  let snapshotObserver;
  const tool = new TaskUpdateTool({
    getTeamContext: () => ({ teamName }),
    getApprovalMode: () => 'default',
    getTeamManager: () => { snapshotObserver?.(); return manager; },
  });
  const update = (params) => tool.build(params).execute(new AbortController().signal);
  const make = (extra = {}) => tasks.createTask(teamName, {
    subject: 'A single logical task', description: 'Record this assignment receipt; do not perform external work.', ...extra,
  });
  const asTeammate = (name, fn) => runWithTeammateIdentity({
    agentName: name, agentId: `${name}@${teamName}`, teamName, isTeamLead: false,
  }, fn);
  // Holding the real OS file lock lets both pre-update reads finish. The
  // injected Config accessor only observes the existing post-read seam;
  // no product module, filesystem function, lock or dispatch is replaced.
  async function race(task, paramsList) {
    const release = await lockfile.lock(tasks.getTaskPath(teamName, task.id), { stale: 5000 });
    const observed = deferred();
    let count = 0;
    snapshotObserver = () => { if (++count === paramsList.length) observed.resolve(); };
    const results = paramsList.map((params) => update({ taskId: task.id, ...params }));
    try { await bounded(observed.promise, 'both initial snapshots'); }
    finally { snapshotObserver = undefined; await release(); }
    return Promise.all(results);
  }
  async function stale(task, mutation, params) {
    const release = await lockfile.lock(tasks.getTaskPath(teamName, task.id), { stale: 5000 });
    const observed = deferred();
    snapshotObserver = () => observed.resolve();
    // Start the competing production writer first so it owns the first
    // position in the in-process mutex queue, behind our real OS lock.
    const winner = mutation();
    const pending = update({ taskId: task.id, ...params });
    try { await bounded(observed.promise, 'leader initial snapshot'); }
    finally { snapshotObserver = undefined; await release(); }
    return { winner: await winner, result: await pending };
  }
  const started = Date.now();
  try {
    const detail = await check({ teamName, manager, agent, received, update, make, race, stale, asTeammate });
    const record = { name, pass: true, elapsedMs: Date.now() - started, ...detail };
    records.push(record);
    console.log(`PASS ${name}: ${JSON.stringify(detail)}`);
  } catch (error) {
    records.push({ name, pass: false, error: error.stack });
    console.error(`FAIL ${name}: ${error.stack}`);
  } finally {
    await fs.writeFile(path.join(output, `${sequence}-${name}.json`), JSON.stringify({
      record: records.at(-1), tasks: await tasks.listTasks(teamName), received: received(),
    }, null, 2) + '\n');
    await manager.cleanup();
  }
}

function assertResult(result, expectedError) {
  if (expectedError) {
    assert(result.error, 'conflicting tool call must return an error');
    assert.equal(result.llmContent, result.error.message, 'model must receive exact error');
    assert.equal(result.returnDisplay, result.error.message, 'UI must receive exact error');
    assert.match(result.error.message, /before this update committed/);
    assert.match(result.error.message, /Re-read the task before retrying/);
  } else {
    assert.equal(result.error, undefined);
  }
}

for (let i = 1; i <= 20; i++) {
  await scenario(`concurrent-leader-${String(i).padStart(2, '0')}`, async (h) => {
    const task = await h.make();
    const results = await h.race(task, [
      { status: 'in_progress', owner: i % 2 ? 'alice' : 'bob' },
      { status: 'in_progress', owner: i % 2 ? 'bob' : 'alice' },
    ]);
    const stored = await tasks.getTask(h.teamName, task.id);
    const owners = Object.entries(h.received()).flatMap(([owner, prompts]) => prompts.map(() => owner));
    assert.equal(results.filter((r) => r.error).length, mode === 'head' ? 1 : 0);
    assert.equal(owners.length, mode === 'head' ? 1 : 2);
    assert.equal(stored.status, 'in_progress');
    if (mode === 'head') {
      assert.deepEqual(owners, [stored.owner]);
      assertResult(results.find((r) => r.error), true);
    } else {
      assert.deepEqual([...owners].sort(), ['alice', 'bob']);
    }
    return { ownerOnDisk: stored.owner, promptRecipients: owners, errors: results.filter((r) => r.error).map((r) => r.error.message) };
  });
}

await scenario('leader-versus-auto-claim', async (h) => {
  const task = await h.make();
  const { winner, result } = await h.stale(task,
    () => tasks.claimTask(h.teamName, task.id, `alice@${h.teamName}`, { ownerName: 'alice' }),
    { status: 'in_progress', owner: 'bob' });
  assert(winner);
  assert.equal(await h.manager.dispatchAssignedTask(winner), true);
  assertResult(result, mode === 'head');
  const stored = await tasks.getTask(h.teamName, task.id);
  const counts = Object.fromEntries(Object.entries(h.received()).map(([n, messages]) => [n, messages.length]));
  assert.deepEqual(counts, mode === 'head' ? { alice: 1, bob: 0 } : { alice: 1, bob: 1 });
  assert.equal(stored.owner, mode === 'head' ? 'alice' : 'bob');
  return { ownerOnDisk: stored.owner, receivedCounts: counts, result };
});

await scenario('sequential-reassignment-and-retry', async (h) => {
  const task = await h.make();
  assertResult(await h.update({ taskId: task.id, status: 'in_progress', owner: 'alice' }), false);
  assertResult(await h.update({ taskId: task.id, status: 'in_progress', owner: 'alice' }), false);
  h.agent('alice').goIdle();
  assert.equal(h.received().alice.length, 1);
  assertResult(await h.update({ taskId: task.id, owner: 'bob' }), false);
  h.agent('bob').goIdle();
  assertResult(await h.update({ taskId: task.id, owner: 'bob' }), false);
  assert.deepEqual(Object.values(h.received()).map((messages) => messages.length), [1, 1]);
  assert.equal((await tasks.getTask(h.teamName, task.id)).owner, 'bob');
  return { ownerOnDisk: 'bob', receivedCounts: { alice: 1, bob: 1 }, contract: 'Intentional reassignment does not retract the first prompt; same-owner retries do not re-deliver.' };
});

await scenario('idle-scan-versus-stale-leader', async (h) => {
  const task = await h.make();
  const gate = path.join(output, `release-${h.teamName}`);
  await fs.rm(gate, { force: true });
  const child = fork(path.join(output, '..', 'cross-process-harness.mjs'), [
    tree, output, mode, h.teamName, 'bob', task.id, gate,
  ], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  const ready = deferred();
  const ended = deferred();
  let childResult;
  let childError = '';
  child.stderr.on('data', (data) => { childError += data; });
  child.on('message', (message) => {
    if (message.kind === 'snapshot-read') ready.resolve();
    if (message.kind === 'result') childResult = message;
  });
  child.on('exit', (code) => ended.resolve(code));
  try {
    await bounded(ready.promise, 'separate leader snapshot before idle scan');
    // A real status event drives TeamManager -> flushNextMessage ->
    // tryAutoClaimTask -> claimTask -> enqueueWithIdentity, unmodified.
    h.agent('alice').setStatus(AgentStatus.IDLE);
    await bounded(h.agent('alice').waitForMessageCount(1), 'actual auto-claim prompt');
    assert.equal((await tasks.getTask(h.teamName, task.id)).owner, 'alice');
  } finally { await fs.writeFile(gate, 'release\n'); }
  assert.equal(await bounded(ended.promise, 'stale leader completion'), 0, childError);
  assertResult(childResult.result, mode === 'head');
  const stored = await tasks.getTask(h.teamName, task.id);
  assert.equal(h.received().alice.length, 1);
  assert.equal(childResult.received.bob.length, mode === 'head' ? 0 : 1);
  assert.equal(stored.owner, mode === 'head' ? 'alice' : 'bob');
  return { ownerOnDisk: stored.owner, actualAutoClaimPrompts: h.received().alice.length,
    staleLeaderBobPrompts: childResult.received.bob.length, childResult,
    scheduling: 'Separate leader pauses at Config accessor after real pre-read; real manager IDLE event completes auto-claim before leader resumes.' };
});

await scenario('stale-owner-only-update', async (h) => {
  const task = await h.make();
  const { result } = await h.stale(task,
    () => tasks.claimTask(h.teamName, task.id, `alice@${h.teamName}`, { ownerName: 'alice' }),
    { owner: 'bob' });
  assertResult(result, mode === 'head');
  const stored = await tasks.getTask(h.teamName, task.id);
  assert.equal(stored.owner, mode === 'head' ? 'alice' : 'bob');
  assert.equal(h.received().bob.length, mode === 'head' ? 0 : 1);
  return { ownerOnDisk: stored.owner, bobPrompts: h.received().bob.length, result };
});

await scenario('inactive-owner-recovery', async (h) => {
  const task = await h.make({ owner: 'alice' });
  await tasks.updateTask(h.teamName, task.id, { status: 'in_progress' });
  h.agent('alice').abort();
  // Wait for the real manager's terminal-status cleanup before recovery.
  await new Promise((resolve) => setTimeout(resolve, 100));
  assertResult(await h.update({ taskId: task.id, status: 'in_progress', owner: 'bob' }), false);
  assert.equal((await tasks.getTask(h.teamName, task.id)).owner, 'bob');
  assert.equal(h.received().bob.length, 1);
  return { ownerOnDisk: 'bob', bobPrompts: 1 };
});

await scenario('stale-status-does-not-resurrect-completion', async (h) => {
  const task = await h.make({ owner: 'alice' });
  await tasks.updateTask(h.teamName, task.id, { status: 'in_progress' });
  const { result } = await h.stale(task,
    () => tasks.updateTask(h.teamName, task.id, { status: 'completed' }, { callerName: 'alice' }),
    { status: 'in_progress', owner: 'bob', description: 'Stale leader description' });
  assertResult(result, mode === 'head');
  const stored = await tasks.getTask(h.teamName, task.id);
  assert.equal(stored.status, mode === 'head' ? 'completed' : 'in_progress');
  assert.equal(stored.owner, mode === 'head' ? 'alice' : 'bob');
  assert.equal(h.received().bob.length, mode === 'head' ? 0 : 1);
  if (mode === 'head') assert.equal(stored.description, task.description);
  return { ownerOnDisk: stored.owner, statusOnDisk: stored.status, bobPrompts: h.received().bob.length, result };
});

await scenario('stale-status-only-update', async (h) => {
  const task = await h.make();
  const { result } = await h.stale(task,
    () => tasks.claimTask(h.teamName, task.id, `alice@${h.teamName}`, { ownerName: 'alice' }),
    { status: 'completed' });
  assertResult(result, mode === 'head');
  const stored = await tasks.getTask(h.teamName, task.id);
  assert.equal(stored.status, mode === 'head' ? 'in_progress' : 'completed');
  assert.deepEqual(Object.values(h.received()).map((messages) => messages.length), [0, 0]);
  return { ownerOnDisk: stored.owner, statusOnDisk: stored.status, result };
});

await scenario('stale-content-only-update', async (h) => {
  const task = await h.make();
  const { winner, result } = await h.stale(task,
    () => tasks.claimTask(h.teamName, task.id, `alice@${h.teamName}`, { ownerName: 'alice' }),
    { subject: 'Updated content', description: 'Current description' });
  assert(winner);
  assertResult(result, false);
  const stored = await tasks.getTask(h.teamName, task.id);
  assert.equal(stored.subject, 'Updated content');
  assert.equal(stored.description, 'Current description');
  assert.equal(stored.owner, 'alice');
  assert.equal(stored.status, 'in_progress');
  assert.equal(h.received().alice.length, mode === 'head' ? 0 : 1);
  return { ownerOnDisk: 'alice', alicePromptsFromContentUpdate: h.received().alice.length, result };
});

await scenario('teammate-ownership-guard', async (h) => {
  const task = await h.make({ owner: 'alice' });
  await tasks.updateTask(h.teamName, task.id, { status: 'in_progress' });
  const denied = await h.asTeammate('bob', () => h.update({ taskId: task.id, status: 'completed', description: 'Unauthorized' }));
  assert.match(denied.error.message, /owned by "alice"/);
  assert.equal(denied.llmContent, denied.error.message);
  assert.equal((await tasks.getTask(h.teamName, task.id)).description, task.description);
  assertResult(await h.asTeammate('alice', () => h.update({ taskId: task.id, status: 'completed' })), false);
  assert.equal((await tasks.getTask(h.teamName, task.id)).status, 'completed');
  return { unauthorizedUpdate: denied, ownerCompletion: 'success' };
});

await scenario('stale-empty-owner-recovery-message', async (h) => {
  const task = await h.make();
  const { result } = await h.stale(task,
    () => tasks.claimTask(h.teamName, task.id, `alice@${h.teamName}`, { ownerName: 'alice' }),
    { owner: '', description: 'Deferred edit' });
  assertResult(result, mode === 'head');
  return { observation: 'Diagnostic coverage only: an empty explicit owner also gets the content-only hint.', result };
});

const summary = {
  mode, sourceTree: tree, platform: process.platform, architecture: process.arch, node: process.version,
  passed: records.filter((r) => r.pass).length, total: records.length, records,
  boundary: 'Compiled production TaskUpdateTool, task persistence, real in-process mutex and proper-lockfile OS lock, TeamManager lifecycle and dispatch; repository FakeBackend/FakeAgent replace only teammate LLM execution. No product-source edits or module mocks.',
};
await fs.writeFile(path.join(output, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
console.log(`RESULT ${summary.passed}/${summary.total} scenario expectations passed (${mode})`);
process.exitCode = summary.passed === summary.total ? 0 : 1;
