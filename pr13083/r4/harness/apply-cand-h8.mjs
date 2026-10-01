// Candidate C for round 4 (head 7ae1fa05): the cancellation (passive) takeover adopts the dead owner's Runtime
// Session before it reads execution status. A replacement Broker answers status, cancel and release only for a
// Runtime Session it has adopted; acquiring dispatches nothing.
// usage: node apply-cand-h8.mjs <tree>
import { readFileSync, writeFileSync } from 'node:fs';
const tree = process.argv[2];
const patch = (file, edits) => {
  let s = readFileSync(`${tree}/${file}`, 'utf8');
  for (const [from, to, count = 1] of edits) {
    if (s.split(from).length !== count + 1) throw new Error(`anchor count in ${file}: ${from.slice(0, 70)}`);
    s = s.replaceAll(from, to);
  }
  writeFileSync(`${tree}/${file}`, s);
};
const releaseQuietly = (indent) =>
  `${indent}await broker.release().catch((releaseCause) => {
${indent}  writeStderrLineSafe(
${indent}    \`qwen serve: Hosted Harness recovery could not release the Runtime Session: \${String(releaseCause)}\`,
${indent}  );
${indent}});`;
patch('packages/cli/src/serve/hosted-runtime-recovery.ts', [
  [
    `  let acquiredRuntime = false;
  if (pending.length > 0) {
    if (passive) {
      for (const item of pending) {
        const status = await broker.status(item.executionCallId);
        states.set(
          item.executionCallId,
          status === undefined ? undefined : { state: status.state },
        );
      }
    } else {`,
    `  let acquiredRuntime = false;
  if (passive && items.length > 0) {
    // A replacement Broker answers status, cancel and release only for a
    // Runtime Session it has adopted, so the cancellation path re-attaches
    // to the dead owner's one first. Acquiring dispatches nothing.
    try {
      await broker.acquire();
      acquiredRuntime = true;
    } catch (cause) {
${releaseQuietly('      ')}
      throw cause;
    }
  }
  if (pending.length > 0) {
    if (passive) {
      try {
        for (const item of pending) {
          const status = await broker.status(item.executionCallId);
          states.set(
            item.executionCallId,
            status === undefined ? undefined : { state: status.state },
          );
        }
      } catch (cause) {
${releaseQuietly('        ')}
        acquiredRuntime = false;
        throw cause;
      }
    } else {`,
  ],
]);
// The passive unit tests stub the Broker; give them an acquire stub, and flip the one assertion that pinned
// "a passive load never acquires" (the real Broker cannot answer status or release without it).
patch('packages/cli/src/serve/hosted-runtime-recovery.test.ts', [
  [
    `        passive: true,
      });`,
    `        passive: true,
      });
      expect(HostedWorkspaceBroker.prototype.acquire).toHaveBeenCalled();`,
    3,
  ],
  [
    `  it('reports parked executions without dispatching on a passive load', async () => {
    await parkAtAwaitRuntime();`,
    `  it('reports parked executions without dispatching on a passive load', async () => {
    await parkAtAwaitRuntime();
    vi.spyOn(HostedWorkspaceBroker.prototype, 'acquire').mockResolvedValue();`,
  ],
  [
    `  it('reports an execution the Broker cannot account for as unknown', async () => {
    await parkAtAwaitRuntime();`,
    `  it('reports an execution the Broker cannot account for as unknown', async () => {
    await parkAtAwaitRuntime();
    vi.spyOn(HostedWorkspaceBroker.prototype, 'acquire').mockResolvedValue();`,
  ],
  [
    `  it('reports only the state, never the result payload, from a passive read', async () => {
    await parkAtAwaitRuntime();`,
    `  it('reports only the state, never the result payload, from a passive read', async () => {
    await parkAtAwaitRuntime();
    vi.spyOn(HostedWorkspaceBroker.prototype, 'acquire').mockResolvedValue();`,
  ],
]);
patch('packages/cli/src/serve/hosted-harness-session.test.ts', [
  [
    `    const { server, loaded } = await loadReplacement(true);
    expect(loaded.status).toBe(200);
    expect(acquireSpy).not.toHaveBeenCalled();`,
    `    const { server, loaded } = await loadReplacement(true);
    expect(loaded.status).toBe(200);
    // The cancellation path adopts the Runtime Session; it still dispatches nothing.
    expect(acquireSpy).toHaveBeenCalled();`,
  ],
]);
console.log('round-4 candidate C applied to', tree);
