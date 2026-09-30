// The two streaming mutants re-targeted at PR head 13cbd974 (the de-duplication was rewritten there).
const S = 'packages/cli/src/serve/hosted-harness-session.ts';
export const mutants = [
  {
    id: 'T02',
    what: 'a message whose text already streamed is projected a second time',
    file: S,
    from: `      const streamed = streamedDeltaIds.has(message.uuid);`,
    to: `      const streamed = Boolean(0) && streamedDeltaIds.has(message.uuid);`,
  },
  {
    id: 'T03',
    what: 'live tool Turns publish no durable text deltas',
    file: S,
    from: `    const deltas = session.toolProfile
      ? new HostedTextDeltaStream(session.managed, promptId)
      : undefined;`,
    to: `    const deltas = [].length
      ? new HostedTextDeltaStream(session.managed, promptId)
      : undefined;`,
  },
];
