/**
 * R1 — real CoreToolScheduler (built dist) + real Config + real tools.
 *
 * Scenario from issue #11146: batch A parks the scheduler in `awaiting_approval`
 * (an unbounded hold — nothing releases it but a user answering the prompt).
 * Batch B is then scheduled with a signal that was ALREADY aborted.
 *
 * Prints one JSON line describing what B did.
 *
 *   node r1-core-real.mjs <worktree> <hold-mode> <observe-ms> <release-after-ms>
 *     hold-mode: approval | executing
 */
const [worktree, holdMode = 'approval', observeMsRaw = '3000', releaseAfterRaw = '0'] =
  process.argv.slice(2);
const observeMs = Number(observeMsRaw);
const releaseAfterMs = Number(releaseAfterRaw);

const core = await import(`${worktree}/packages/core/dist/index.js`);
const { Config, CoreToolScheduler, ApprovalMode, ToolConfirmationOutcome } = core;

import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ws = mkdtempSync(join(tmpdir(), 'h11483-'));
writeFileSync(join(ws, 'a.txt'), 'alpha\n');
writeFileSync(join(ws, 'b.txt'), 'beta\n');

const config = new Config({
  sessionId: 'h11483',
  targetDir: ws,
  cwd: ws,
  model: 'harness-model',
  debugMode: false,
  interactive: true,
  chatRecording: false,
  telemetry: { enabled: false },
  approvalMode: holdMode === 'executing' ? ApprovalMode.YOLO : ApprovalMode.DEFAULT,
  usageStatisticsEnabled: false,
});
await config.initialize();

const events = [];
let updates = 0;
let lastStatuses = [];
const everSeen = new Set();
const completions = [];

const scheduler = new CoreToolScheduler({
  config,
  getPreferredEditor: () => undefined,
  onEditorClose: () => {},
  onToolCallsUpdate: (calls) => {
    updates++;
    lastStatuses = calls.map((c) => `${c.request.callId}:${c.status}`);
    for (const s of lastStatuses) everSeen.add(s);
    events.push({ t: Date.now(), kind: 'update', statuses: lastStatuses });
  },
  onAllToolCallsComplete: async (calls) => {
    completions.push(calls.map((c) => `${c.request.callId}:${c.status}`));
    events.push({
      t: Date.now(),
      kind: 'complete',
      calls: calls.map((c) => `${c.request.callId}:${c.status}`),
      errors: calls.map((c) => c.response?.error?.message ?? c.response?.resultDisplay ?? null),
    });
  },
});

const t0 = Date.now();
const rel = (t) => t - t0;

// ---- Batch A: real tool that holds the scheduler busy -----------------------
const reqA =
  holdMode === 'approval'
    ? {
        callId: 'A-approval',
        name: 'write_file',
        args: { file_path: join(ws, 'created-by-harness.txt'), content: 'hello from harness\n' },
        isClientInitiated: false,
        prompt_id: 'prompt-A',
      }
    : {
        callId: 'A-executing',
        name: 'run_shell_command',
        args: {
          command: 'node -e "setTimeout(()=>{}, 600000)"',
          description: 'long executing hold',
        },
        isClientInitiated: false,
        prompt_id: 'prompt-A',
      };

const ctrlA = new AbortController();
const aSettled = { state: 'pending' };
const aPromise = scheduler
  .schedule([reqA], ctrlA.signal)
  .then(() => (aSettled.state = 'resolved'))
  .catch((e) => (aSettled.state = `rejected: ${e.message}`));

// wait until the scheduler is genuinely busy
const targetStatus = holdMode === 'approval' ? 'awaiting_approval' : 'executing';
const busyAt = await (async () => {
  for (let i = 0; i < 400; i++) {
    if ([...everSeen].some((s) => s.endsWith(`:${targetStatus}`))) return Date.now();
    if (aSettled.state !== 'pending') return null;
    await new Promise((r) => setTimeout(r, 25));
  }
  return null;
})();

if (busyAt === null) {
  console.log(
    JSON.stringify({
      worktree,
      holdMode,
      error: `scheduler never reached ${targetStatus}`,
      lastStatuses,
      everSeen: [...everSeen],
      aState: aSettled.state,
      events,
      toolCalls: scheduler.toolCalls?.map((c) => `${c.request.callId}:${c.status}:${c.response?.error?.message ?? ''}`),
    }),
  );
  process.kill(process.pid, 'SIGKILL');
}

// ---- Batch B: signal aborted BEFORE schedule() ------------------------------
const ctrlB = new AbortController();
ctrlB.abort();
const bScheduledAt = Date.now();
let bOutcome = 'pending';
let bSettledAt = null;
const bPromise = scheduler
  .schedule(
    [
      {
        callId: 'B-pre-aborted',
        name: 'read_file',
        args: { file_path: join(ws, 'b.txt') },
        isClientInitiated: false,
        prompt_id: 'prompt-B',
      },
    ],
    ctrlB.signal,
  )
  .then(() => {
    bOutcome = 'resolved';
    bSettledAt = Date.now();
  })
  .catch((e) => {
    bOutcome = `rejected: ${e.message}`;
    bSettledAt = Date.now();
  });

// observe
await new Promise((r) => setTimeout(r, observeMs));
const outcomeAtObserve = bOutcome;
const queueLen = scheduler.requestQueue?.length ?? 'n/a';
const completionsAtObserveSnapshot = completions.map((c) => [...c]);

// optionally release A and see whether B settles late
let outcomeAfterRelease = null;
let releasedAt = null;
if (releaseAfterMs > 0) {
  releasedAt = Date.now();
  if (holdMode === 'approval') {
    // Answer the real confirmation prompt the way a user pressing "No" would.
    const call = scheduler.toolCalls.find((c) => c.status === 'awaiting_approval');
    if (call?.confirmationDetails?.onConfirm) {
      await call.confirmationDetails.onConfirm(ToolConfirmationOutcome.Cancel);
    }
  } else {
    ctrlA.abort();
  }
  await new Promise((r) => setTimeout(r, releaseAfterMs));
  outcomeAfterRelease = bOutcome;
}

console.log(
  JSON.stringify(
    {
      worktree,
      holdMode,
      observeMs,
      busyAtMs: rel(busyAt),
      bScheduledAtMs: rel(bScheduledAt),
      bOutcomeAtObserve: outcomeAtObserve,
      bSettledAtMsFromSchedule: bSettledAt === null ? null : bSettledAt - bScheduledAt,
      requestQueueLengthAtObserve: queueLen,
      completionsAtObserve: completionsAtObserveSnapshot,
      releasedAtMs: releasedAt === null ? null : rel(releasedAt),
      bOutcomeAfterRelease: outcomeAfterRelease,
      completionsAfterRelease: releaseAfterMs > 0 ? completions : null,
      aState: aSettled.state,
    },
    null,
    0,
  ),
);
process.kill(process.pid, 'SIGKILL');
