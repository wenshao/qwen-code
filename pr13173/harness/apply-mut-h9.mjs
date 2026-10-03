// Round 5 (#13173 @ b0e8b1e2): apply one source mutant to a cloned tree (no git involved).
// usage: node apply-mut-h9.mjs <tree> <M1|M2|M3>
//   M1  re-add the first push's compensation release on a failed passive status read (R1-1 / R2)
//   M2  revert the redriven-cancel re-admission to the full matchesRecovery fence (R4-1)
//   M3  fold the final handback back into the cancel body's try (R4-6)
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const [tree, mutant] = process.argv.slice(2);
const swap = (rel, from, to) => {
  const file = path.join(tree, rel);
  const text = readFileSync(file, 'utf8');
  const count = text.split(from).length - 1;
  if (count !== 1) throw new Error(`${mutant}: expected 1 match in ${rel}, found ${count}`);
  writeFileSync(file, text.replace(from, to));
  console.log(`${mutant}: patched ${rel}`);
};
const recovery = 'packages/cli/src/serve/hosted-runtime-recovery.ts';
const route = 'packages/cli/src/serve/hosted-harness-session.ts';

if (mutant === 'M1') {
  swap(
    recovery,
    `    if (passive) {
      for (const item of pending) {
        const status = await broker.status(item.executionCallId);
        states.set(
          item.executionCallId,
          status?.state === 'unknown' ? undefined : status,
        );
      }
    } else {`,
    `    if (passive) {
      try {
        for (const item of pending) {
          const status = await broker.status(item.executionCallId);
          states.set(
            item.executionCallId,
            status?.state === 'unknown' ? undefined : status,
          );
        }
      } catch (cause) {
        // MUTANT M1: the first push's compensation release
        await broker.release().catch(() => undefined);
        acquiredRuntime = false;
        throw cause;
      }
    } else {`,
  );
} else if (mutant === 'M2') {
  swap(
    route,
    `    if (!attachedToUnsettled) {
      if (settledReplay(session, promptId, res)) {`,
    `    void attachedToUnsettled;
    if (!matchesRecovery(session, promptId, checkpointId, activationId)) {
      // MUTANT M2: the pre-round-5 fence
      if (settledReplay(session, promptId, res)) {`,
  );
} else if (mutant === 'M3') {
  swap(
    route,
    `        const handedBack = await broker.release().then(
          () => true,
          (cause: unknown) => {
            if (
              cause instanceof HostedWorkspaceBrokerRejection &&
              cause.status === 404
            )
              return true;`,
    `        // MUTANT M3: the handback shares the cancel body's try again
        const handedBack = await broker.release().then(
          () => true,
          (cause: unknown) => {
            if (
              cause instanceof HostedWorkspaceBrokerRejection &&
              cause.status === 404
            )
              return true;
            throw cause;`,
  );
} else {
  throw new Error(`unknown mutant ${mutant}`);
}
