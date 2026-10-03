// Round 5 (#13173 @ b0e8b1e2) candidate C1 for F2: after a failed final handback the cancel route
// still answers 200, but the owed handback is retried in the background with backoff until it is
// confirmed or the Session is closed (whose teardown then owns it).
// usage: node apply-cand-r5.mjs <tree>
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const file = path.join(process.argv[2], 'packages/cli/src/serve/hosted-harness-session.ts');
let text = readFileSync(file, 'utf8');
const swap = (from, to) => {
  const count = text.split(from).length - 1;
  if (count !== 1) throw new Error(`expected 1 match, found ${count}: ${from.slice(0, 60)}`);
  text = text.replace(from, to);
};

swap(
  `  // Awaited variant for exits after which no route can retry the handback`,
  `  // A handback that failed after the cancellation was answered has no later
  // route to retry it: the coordinator saw 200 and sends nothing more, and
  // the Workspace stays pinned until the Session closes. Retry it here with
  // backoff until the release is confirmed or the Session is gone.
  const retryOwedHandback = (
    sessionId: string,
    session: HostedSession,
    attempt = 0,
  ): void => {
    if (attempt >= 10) return;
    const timer = setTimeout(
      () => {
        if (
          sessions.get(sessionId) !== session ||
          session.runtimeLeaseHeld === undefined
        )
          return;
        if (!session.active) releaseRecoveredRuntime(session);
        retryOwedHandback(sessionId, session, attempt + 1);
      },
      Math.min(30_000, 1_000 * 2 ** attempt),
    );
    timer.unref();
  };

  // Awaited variant for exits after which no route can retry the handback`,
);
swap(
  `        if (handedBack)
          // The release discharged the lease the load adopted, or it never
          // existed; the teardown skips what is now a redundant handback.
          session.runtimeLeaseHeld = undefined;`,
  `        if (handedBack)
          // The release discharged the lease the load adopted, or it never
          // existed; the teardown skips what is now a redundant handback.
          session.runtimeLeaseHeld = undefined;
        else retryOwedHandback(sessionId, session);`,
);
writeFileSync(file, text);
console.log('C1: patched', file);
