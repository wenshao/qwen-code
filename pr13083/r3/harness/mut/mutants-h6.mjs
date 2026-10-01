// Mutants for head 912c3b57.
const S = 'packages/cli/src/serve/hosted-harness-session.ts';
const R = 'packages/cli/src/serve/hosted-runtime-recovery.ts';
const C = 'packages/core/src/managed-runtime/managed-session-records.ts';
export const mutants = [
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
  { id: 'R01', what: 'F2 fix removed: no re-attach when nothing is left to drive', file: R,
    from: `    await broker.acquire();
    acquiredRuntime = true;
  }
  const finalAuthorization`,
    to: `  }
  const finalAuthorization` },
  { id: 'R02', what: 'F3 fix removed: a replayed continue is not answered from the stored admission', file: S,
    from: `    if (admittedRecovery?.digest === recoveryDigest) {`,
    to: `    if (Boolean(0) && admittedRecovery?.digest === recoveryDigest) {` },
  { id: 'R03', what: 'R1-1 fix removed: message.delta text validated as plain text again', file: C,
    from: `        role: 'text',
        text: 'rawText',`,
    to: `        role: 'text',
        text: 'text',` },
];
