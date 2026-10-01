// Candidate B for round 3 (head b4e9d71b): the activation that feeds a taken-over batch's settled results to the
// model adopts the Turn, so the next tool batch of the same Turn is not refused as work of a prior activation.
// usage: node apply-cand-h7b.mjs <tree>
import { readFileSync, writeFileSync } from 'node:fs';
const tree = process.argv[2];
const patch = (file, edits) => {
  let s = readFileSync(`${tree}/${file}`, 'utf8');
  for (const [from, to] of edits) {
    if (s.split(from).length !== 2) throw new Error(`anchor not unique in ${file}: ${from.slice(0, 60)}`);
    s = s.replace(from, to);
  }
  writeFileSync(`${tree}/${file}`, s);
};
patch('packages/core/src/managed-runtime/managed-harness-factory.ts', [
  [
    `      const items = previous.tools?.items ?? [];
      if (
        items.length === 0 ||
        items.every((item) => item.state !== 'settled' || item.consumed)
      ) {
        return previous;
      }
      const identity = this.nextCheckpointIdentity();
      const checkpoint = createConsumedRuntimeResultsHarnessCheckpoint({
        previous,
        ...identity,
      });`,
    `      const items = previous.tools?.items ?? [];
      // A replacement owner that took the Turn over and now feeds the settled
      // batch to the model adopts the Turn. Without this its next tool batch
      // is refused as Runtime work of a prior activation.
      const adopt =
        previous.identity.activationId !== this.activation.activationId &&
        items.length > 0 &&
        items.every((item) => item.state === 'settled');
      if (
        items.length === 0 ||
        (!adopt &&
          items.every((item) => item.state !== 'settled' || item.consumed))
      ) {
        return previous;
      }
      const identity = this.nextCheckpointIdentity();
      const checkpoint = createConsumedRuntimeResultsHarnessCheckpoint({
        previous: adopt
          ? {
              ...previous,
              identity: {
                ...previous.identity,
                activationId: this.activation.activationId,
              },
            }
          : previous,
        ...identity,
      });`,
  ],
]);
patch('packages/core/src/managed-runtime/managed-harness-factory.test.ts', [
  [
    `  it('refuses an approval in an unfinished turn from another activation', async () => {`,
    `  it('lets the activation that consumed a taken-over batch commit the next one', async () => {
    const session = await open(await createWorkspace());
    const previous = createManagedHarnessHandle(session);
    await previous.ensureRunnable();
    const turn = { turnId: 'turn-1', promptId: 'turn-1' };
    await previous.commitAwaitRuntimeBatch(
      [await runtimeCommit(session)],
      turn,
    );
    await previous.detach();
    await session.replaceActivation();
    const next = createManagedHarnessHandle(session);
    await next.resolveAwaitRuntime(
      'ex-1',
      await session.resources.publish(
        'managed-tool-outcome',
        Buffer.from('{}', 'utf8'),
      ),
    );
    const consumed = await next.consumeRuntimeResults();
    expect(consumed?.identity.activationId).toBe(
      session.activation.activationId,
    );

    await expect(
      next.commitAwaitRuntimeBatch(
        [
          {
            ...(await runtimeCommit(session)),
            functionCallId: 'fc-2',
            executionCallId: 'ex-2',
            invocationBindingId: 'bind-2',
            modelMessageId: 'msg-2',
            attemptId: 'att-fc-2',
          },
        ],
        turn,
      ),
    ).resolves.toMatchObject({ kind: 'durable_wait' });
    await session.close();
  });

  it('refuses an approval in an unfinished turn from another activation', async () => {`,
  ],
]);
console.log('round-3 candidate B applied to', tree);
