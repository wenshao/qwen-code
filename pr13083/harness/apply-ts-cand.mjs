// Applies the two TypeScript candidates to a tree: (B') re-attach to the Runtime Session on a
// results_ready takeover so the terminal route can release it, (C) replay the continue admission.
import { readFileSync, writeFileSync } from 'node:fs';
const tree = process.argv[2];
const edit = (file, from, to) => {
  const p = `${tree}/${file}`;
  const s = readFileSync(p, 'utf8');
  if (s.split(from).length !== 2) throw new Error(`anchor not unique in ${file}: ${from.slice(0, 60)}`);
  writeFileSync(p, s.replace(from, to));
};
edit(
  'packages/cli/src/serve/hosted-runtime-recovery.ts',
  `        states.set(item.executionCallId, { state: 'settled' });
      }
    }
  }
  const finalAuthorization`,
  `        states.set(item.executionCallId, { state: 'settled' });
      }
    }
  } else if (!passive && items.length > 0) {
    // Nothing is left to drive, but the dead owner still holds the Runtime
    // Session it prepared these executions in. Re-attach to it so the
    // terminal route can release the Workspace for other Sessions.
    await broker.acquire();
    acquiredRuntime = true;
  }
  const finalAuthorization`,
);
edit(
  'packages/cli/src/serve/hosted-harness-session.ts',
  `    const { promptId, checkpointId, activationId } = request;
    if (session.active) return error(res, 409, 'hosted_turn_active');
    if (session.blocked)
      return error(res, 409, 'hosted_turn_recovery_required');
    if (!session.toolProfile || !brokerOptions)
      return error(res, 409, 'hosted_turn_recovery_required');
    if (!matchesRecovery(session, promptId, checkpointId, activationId)) {
      if (settledReplay(session, promptId, res)) return;
      return error(res, 409, 'hosted_recovery_identity_mismatch');
    }
    const abort = new AbortController();
    session.active = { promptId, digest: '', abort };
    res.status(200).json({`,
  `    const { promptId, checkpointId, activationId } = request;
    // A continuation whose reply was lost is replayed by the coordinator: it
    // must get the watermark it was admitted at, running or settled, or the
    // coordinator would stream from after the Turn's own events.
    const recoveryDigest = \`recovery:\${checkpointId}:\${activationId}\`;
    const admittedRecovery = session.admissions.get(promptId);
    if (admittedRecovery?.digest === recoveryDigest) {
      res.status(200).json({
        accepted: true,
        promptId,
        lastEventId: admittedRecovery.lastEventId,
        eventEpoch: epoch,
      });
      return;
    }
    if (session.active) return error(res, 409, 'hosted_turn_active');
    if (session.blocked)
      return error(res, 409, 'hosted_turn_recovery_required');
    if (!session.toolProfile || !brokerOptions)
      return error(res, 409, 'hosted_turn_recovery_required');
    if (!matchesRecovery(session, promptId, checkpointId, activationId)) {
      if (settledReplay(session, promptId, res)) return;
      return error(res, 409, 'hosted_recovery_identity_mismatch');
    }
    const abort = new AbortController();
    session.active = { promptId, digest: '', abort };
    session.admissions.set(promptId, {
      digest: recoveryDigest,
      lastEventId: session.managed.authority.committedSequence,
    });
    res.status(200).json({`,
);
console.log('TS candidates applied to', tree);
