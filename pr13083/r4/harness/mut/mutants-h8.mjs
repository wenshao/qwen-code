// Mutants for head 7ae1fa05 (round 4).
const S = 'packages/cli/src/serve/hosted-harness-session.ts';
const R = 'packages/cli/src/serve/hosted-runtime-recovery.ts';
const C = 'packages/core/src/managed-runtime/managed-session-records.ts';
const F = 'packages/core/src/managed-runtime/managed-harness-factory.ts';
export const mutants = [
  { id: 'R01', what: 'F2 fix removed: no re-attach when nothing is left to drive', file: R,
    from: `  } else if (!passive && items.length > 0) {`,
    to: `  } else if (Boolean(0) && !passive && items.length > 0) {` },
  { id: 'R02', what: 'F3 fix removed: a replayed continue is not answered from the stored admission', file: S,
    from: `    if (admittedRecovery?.digest === recoveryDigest) {`,
    to: `    if (Boolean(0) && admittedRecovery?.digest === recoveryDigest) {` },
  { id: 'R03', what: 'R1-1 fix removed: message.delta text validated as plain text again', file: C,
    from: `        role: 'text',
        text: 'rawText',`,
    to: `        role: 'text',
        text: 'text',` },
  { id: 'T02', what: 'a message whose text already streamed is projected a second time', file: S,
    from: `      const streamed = streamedDeltaIds.has(message.uuid);`,
    to: `      const streamed = Boolean(0) && streamedDeltaIds.has(message.uuid);` },
  { id: 'T03', what: 'live tool Turns publish no durable text deltas', file: S,
    from: `    const deltas = session.toolProfile
      ? new HostedTextDeltaStream(session.managed, promptId)
      : undefined;`,
    to: `    const deltas = [].length
      ? new HostedTextDeltaStream(session.managed, promptId)
      : undefined;` },
  { id: 'N01', what: 'F7 fix removed: continue does not reconcile the pending file history', file: S,
    from: `          await toolTurn.resumeCommittedResults();
          const result = await runHostedHarnessTextTurn({`,
    to: `          const result = await runHostedHarnessTextTurn({` },
  { id: 'N02', what: 'F8 fix removed: the replacement never adopts the Turn', file: F,
    from: `      const adopt =
        previous.identity.activationId !== this.activation.activationId &&`,
    to: `      const adopt =
        Boolean(0) &&
        previous.identity.activationId !== this.activation.activationId &&` },
  { id: 'N03', what: 'continue answers 200 without proving the checkpoint is continuable', file: S,
    from: `    const continueAuthorization = await session.managed.authority
      .harnessRunAuthorization()
      .catch(() => undefined);`,
    to: `    const continueAuthorization = {
      status: 'runnable',
      checkpoint: { continuation: { phase: 'results_ready' } },
    } as const;` },
  { id: 'N04', what: 'cancel replay is not answered from its admission', file: S,
    from: `    if (admittedCancel?.digest === recoveryDigest) {`,
    to: `    if (Boolean(0) && admittedCancel?.digest === recoveryDigest) {` },
  { id: 'N05', what: 'a rejected final authorization keeps the acquired lease', file: R,
    from: `    // rejection here must hand it back first.
    if (acquiredRuntime) {`,
    to: `    // rejection here must hand it back first.
    if (Boolean(0) && acquiredRuntime) {` },
  { id: 'N06', what: 'a failed re-attach acquire is not handed back', file: R,
    from: `      // may exist rather than stranding it.
      await broker.release().catch(`,
    to: `      // may exist rather than stranding it.
      await Promise.resolve().catch(` },
  { id: 'N07', what: 'drive-loop acquire back outside the release-on-failure try', file: R,
    from: `      try {
        await broker.acquire();
        acquiredRuntime = true;
        const harness = createManagedHarnessHandle(session);`,
    to: `      await broker.acquire();
      acquiredRuntime = true;
      try {
        const harness = createManagedHarnessHandle(session);` },
  { id: 'N08', what: 'continue does not hand session.mcp to the tool turn', file: S,
    from: `          session.mcp,
        );
        let state: 'completed' | 'cancelled' | 'error' = 'completed';`,
    to: `        );
        let state: 'completed' | 'cancelled' | 'error' = 'completed';` },
  { id: 'N09', what: 'a failed cancellation keeps its admission (retry replays instead of re-driving)', file: S,
    from: `        // coordinator's retry re-drives instead of replaying the watermark.
        session.admissions.delete(promptId);`,
    to: `        // coordinator's retry re-drives instead of replaying the watermark.` },
  { id: 'N10', what: 'cancel answers at the current sequence instead of its admission watermark', file: S,
    from: `          lastEventId: session.admissions.get(promptId)!.lastEventId,`,
    to: `          lastEventId: session.managed.authority.committedSequence,` },
];
