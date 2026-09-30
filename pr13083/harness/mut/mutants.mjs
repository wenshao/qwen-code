// Mutants for PR #13083 (TypeScript side). Each entry: id, what it breaks, file, exact `from` text, `to` text.
const S = 'packages/cli/src/serve/hosted-harness-session.ts';
const R = 'packages/cli/src/serve/hosted-runtime-recovery.ts';
const M = 'packages/cli/src/serve/hosted-harness-model.ts';
export const mutants = [
  {
    id: 'T01',
    what: 'load ignores the takeover request (no recovery on load)',
    file: S,
    from: `      const takeover =
        body?.['passiveManagedRuntimeRecovery'] === true ||
        body?.['driveRuntimeRecovery'] === true;`,
    to: `      const takeover = Boolean(0);`,
  },
  {
    id: 'T02',
    what: 'a committed message whose text already streamed is projected a second time',
    file: S,
    from: `        message.message?.parts?.some((part) => part.functionCall) ||
        streamed
      ) {`,
    to: `        message.message?.parts?.some((part) => part.functionCall)
      ) {`,
  },
  {
    id: 'T03',
    what: 'live tool Turns stop publishing durable text deltas',
    file: S,
    from: `    const deltas = session.toolProfile
      ? new HostedTextDeltaStream(session.managed, promptId)
      : undefined;`,
    to: `    const deltas = [].length
      ? new HostedTextDeltaStream(session.managed, promptId)
      : undefined;`,
  },
  {
    id: 'T04',
    what: 'recovery drives the parked execution without acquiring the Runtime Session',
    file: R,
    from: `      await broker.acquire();
      acquiredRuntime = true;`,
    to: `      acquiredRuntime = true;`,
  },
  {
    id: 'T05',
    what: 'recovery journals the tool result even when it is already journaled',
    file: R,
    from: `        if (!journaled.has(item.functionCallId)) {
          await session.sink.write(record);
        }`,
    to: `        await session.sink.write(record);`,
  },
  {
    id: 'T06',
    what: 'continue/cancel accept any checkpoint and activation identity',
    file: S,
    from: `    session.managed.authority.latestCheckpoint?.checkpointId === checkpointId &&
    session.managed.activation.activationId === activationId &&
    unsettledPromptId(session) === promptId;`,
    to: `    unsettledPromptId(session) === promptId;`,
  },
  {
    id: 'T07',
    what: 'the Runtime Session acquired by recovery is never released',
    file: S,
    from: `          session.runtimeLeaseHeld = recovered.acquiredRuntime;`,
    to: `          session.runtimeLeaseHeld = false;`,
  },
  {
    id: 'T08',
    what: 'a passive (cancellation) load dispatches executions like a continuation load',
    file: S,
    from: `            passive: body?.['passiveManagedRuntimeRecovery'] === true,`,
    to: `            passive: false,`,
  },
  {
    id: 'T09',
    what: 'recovery re-dispatches a parked Shell execution instead of refusing',
    file: R,
    from: `      if (pending.some((item) => item.toolName === 'run_shell_command')) {
        return undefined;
      }`,
    to: ``,
  },
  {
    id: 'T10',
    what: 'a model fallback silently retracts an already published attempt',
    file: M,
    from: `        } else if (event.type === LlmEventType.ModelFallback) {
          if (input.textDeltas?.published()) {
            throw new Error(
              'Hosted Harness cannot retract a published model attempt.',
            );
          }`,
    to: `        } else if (event.type === LlmEventType.ModelFallback) {`,
  },
  {
    id: 'T11',
    what: 'a replayed continue/cancel of a settled Turn is refused instead of answered',
    file: S,
    from: `    if (
      !hasAcceptedInput(session, promptId) ||
      unsettledInputs(session).has(promptId)
    ) {
      return false;
    }`,
    to: `    if (promptId) return false;`,
  },
  {
    id: 'T12',
    what: 'the continuation resumes with the whole turn history instead of only the parked round',
    file: S,
    from: `        const parkedRound = new Set(turnRecords.slice(lastCallIndex + 1));`,
    to: `        const parkedRound = new Set(turnRecords.slice(turnRecords.length));`,
  },
];
