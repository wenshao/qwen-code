/**
 * Runs against the BUILT core dist (no vitest, no transform, no mocks of
 * teamHelpers/Storage). Reproduces #10208's interleaving, then SIGKILLs
 * itself the instant the failed spawn rejects — the crash window the
 * ghost member survives in.
 */
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

const ARM = process.argv[2];
const HOME = process.argv[3];
const TEAM = 'crash-team';
process.env.QWEN_HOME = HOME;

const dist = path.join(ARM, 'packages/core/dist/src');
const { TeamManager } = await import(path.join(dist, 'agents/team/TeamManager.js'));
const { FakeBackend } = await import(path.join(dist, 'agents/team/test-utils/fake-backend.js'));
const { AgentStatus } = await import(path.join(dist, 'agents/runtime/agent-types.js'));
const { formatAgentId } = await import(path.join(dist, 'agents/team/teamHelpers.js'));

const teamDir = path.join(HOME, 'teams', TEAM);
await fs.mkdir(path.join(teamDir, 'inboxes'), { recursive: true });
await fs.mkdir(path.join(HOME, 'tasks', TEAM), { recursive: true });
const teamFile = {
  name: TEAM,
  createdAt: Date.now(),
  leadAgentId: formatAgentId('leader', TEAM),
  members: [],
};
await fs.writeFile(path.join(teamDir, 'config.json'), JSON.stringify(teamFile, null, 2) + '\n', 'utf-8');

const backend = new FakeBackend();
await backend.init();
const manager = new TeamManager(backend, teamFile);

let release;
const gate = new Promise((r) => (release = r));
backend.setScript(formatAgentId('beta', TEAM), {
  onStart: async (agent) => {
    await gate;
    agent.setError('backend refused to start the teammate');
    agent.setStatus(AgentStatus.FAILED);
  },
});

const read = async () =>
  JSON.parse(await fs.readFile(path.join(teamDir, 'config.json'), 'utf-8'))
    .members.map((m) => m.name);

const a = manager.spawnTeammate({ name: 'alpha', cwd: HOME });
const b = manager.spawnTeammate({ name: 'beta', cwd: HOME });
await a;
console.log(`[${path.basename(ARM)}] after alpha's success write   : ${JSON.stringify(await read())}`);

release();
try {
  await b;
  console.log('UNEXPECTED: beta resolved');
} catch (e) {
  console.log(`[${path.basename(ARM)}] beta rejected with           : ${e.message}`);
}
console.log(`[${path.basename(ARM)}] in-memory roster             : ${JSON.stringify(manager.getTeamFile().members.map((m) => m.name))}`);
console.log(`[${path.basename(ARM)}] on-disk roster               : ${JSON.stringify(await read())}`);
console.log(`[${path.basename(ARM)}] --> SIGKILL now (crash window)`);
process.kill(process.pid, 'SIGKILL');
