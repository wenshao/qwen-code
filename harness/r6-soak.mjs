/**
 * R6 — soak: with the scheduler held busy by a real executing tool, fire N
 * pre-aborted schedule() calls, then release the hold and check that the
 * active batch still completes normally and nothing leaked.
 */
const [worktree, nRaw = '200'] = process.argv.slice(2);
const N = Number(nRaw);
const { Config, CoreToolScheduler, ApprovalMode } = await import(
  `${worktree}/packages/core/dist/index.js`
);
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let unhandled = 0;
process.on('unhandledRejection', () => unhandled++);

const ws = mkdtempSync(join(tmpdir(), 'h11483-soak-'));
writeFileSync(join(ws, 'b.txt'), 'beta\n');

const config = new Config({
  sessionId: 'h11483-soak', targetDir: ws, cwd: ws, model: 'harness-model',
  debugMode: false, interactive: true, chatRecording: false,
  telemetry: { enabled: false }, approvalMode: ApprovalMode.YOLO,
  usageStatisticsEnabled: false,
});
await config.initialize();

const completions = [];
let everSeenExecuting = false;
const scheduler = new CoreToolScheduler({
  config,
  getPreferredEditor: () => undefined,
  onEditorClose: () => {},
  onToolCallsUpdate: (calls) => {
    if (calls.some((c) => c.status === 'executing')) everSeenExecuting = true;
  },
  onAllToolCallsComplete: async (calls) => {
    completions.push(calls.map((c) => `${c.request.callId}:${c.status}`));
  },
});

const holdCtrl = new AbortController();
const holdDone = scheduler.schedule(
  [{
    callId: 'hold', name: 'run_shell_command',
    args: { command: 'node -e "setTimeout(()=>{},4000)"', description: 'hold' },
    isClientInitiated: false, prompt_id: 'p-hold',
  }],
  holdCtrl.signal,
).then(() => 'resolved').catch((e) => 'rejected: ' + e.message);

for (let i = 0; i < 400 && !everSeenExecuting; i++) {
  await new Promise((r) => setTimeout(r, 25));
}

const outcomes = { rejected: 0, resolved: 0, pending: 0 };
const messages = new Set();
const settled = [];
for (let i = 0; i < N; i++) {
  const c = new AbortController();
  c.abort();
  settled.push(
    scheduler
      .schedule(
        [{ callId: `pre-${i}`, name: 'read_file', args: { file_path: join(ws, 'b.txt') },
           isClientInitiated: false, prompt_id: `p-${i}` }],
        c.signal,
      )
      .then(() => { outcomes.resolved++; })
      .catch((e) => { outcomes.rejected++; messages.add(e.message); }),
  );
}
await new Promise((r) => setTimeout(r, 300));
const queueAfterBurst = scheduler.requestQueue.length;
const toolCallsAfterBurst = scheduler.toolCalls.length;

const holdResult = await holdDone;
await new Promise((r) => setTimeout(r, 500));
outcomes.pending = N - outcomes.rejected - outcomes.resolved;

console.log(JSON.stringify({
  worktree, N, outcomes,
  distinctRejectMessages: [...messages],
  queueLengthDuringBurst: queueAfterBurst,
  toolCallsDuringBurst: toolCallsAfterBurst,
  holdBatch: holdResult,
  completionBatches: completions.length,
  completionsSample: completions.slice(0, 3).concat(completions.length > 3 ? [['...']] : []),
  cancelledCompletions: completions.filter((c) => c.some((x) => x.endsWith(':cancelled'))).length,
  queueLengthAtEnd: scheduler.requestQueue.length,
  unhandledRejections: unhandled,
}));
process.kill(process.pid, 'SIGKILL');
