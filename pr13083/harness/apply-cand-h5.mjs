// Applies the candidate to a tree at PR head 13cbd974:
//  (A') the connector hands a cached recovery snapshot out only until its continue/cancel is admitted,
//  (B') recovery re-attaches to the Runtime Session on a results_ready takeover so it can be released,
//  (C)  the continue route replays its admission.
// usage: node apply-cand-h5.mjs <tree> [--ts-only]
import { readFileSync, writeFileSync } from 'node:fs';
const tree = process.argv[2];
const tsOnly = process.argv.includes('--ts-only');
const edit = (file, from, to) => {
  const p = `${tree}/${file}`;
  const s = readFileSync(p, 'utf8');
  if (s.split(from).length !== 2) throw new Error(`anchor not unique in ${file}: ${from.slice(0, 60)}`);
  writeFileSync(p, s.replace(from, to));
};
const J = 'packages/sdk-java/managed-agent-server/src/main/java/com/alibaba/qwen/code/managedagent/harness/QwenHostedHarnessConnector.java';
const JT = 'packages/sdk-java/managed-agent-server/src/test/java/com/alibaba/qwen/code/managedagent/harness/QwenHostedHarnessConnectorTest.java';
if (!tsOnly) {
  edit(J, `import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;`, `import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;`);
  edit(J, `    private final Map<AttachmentKey, HarnessSessionRef> attachments =`, `    // Sessions whose takeover load reported parked Runtime work that no
    // continue/cancel has been admitted for yet.
    private final Set<AttachmentKey> pendingRecovery =
            ConcurrentHashMap.newKeySet();
    private final Map<AttachmentKey, HarnessSessionRef> attachments =`);
  edit(J, `        PromptReceipt receipt = client().continueManagedRuntime(
                attachment(tenantId, sessionId), promptId, checkpointId,
                activationId);
        return new Admission(`, `        PromptReceipt receipt = client().continueManagedRuntime(
                attachment(tenantId, sessionId), promptId, checkpointId,
                activationId);
        pendingRecovery.remove(new AttachmentKey(tenantId, sessionId));
        return new Admission(`);
  edit(J, `                new CancelManagedRuntime(attachment(tenantId, sessionId),
                        promptId, checkpointId, activationId));
        return new Admission(`, `                new CancelManagedRuntime(attachment(tenantId, sessionId),
                        promptId, checkpointId, activationId));
        pendingRecovery.remove(new AttachmentKey(tenantId, sessionId));
        return new Admission(`);
  edit(J, `        attachments.remove(new AttachmentKey(tenantId, sessionId));
        HostedHarnessClient current = client();`, `        attachments.remove(new AttachmentKey(tenantId, sessionId));
        pendingRecovery.remove(new AttachmentKey(tenantId, sessionId));
        HostedHarnessClient current = client();`);
  edit(J, `        attachments.clear();
    }`, `        attachments.clear();
        pendingRecovery.clear();
    }`);
  edit(J, `            // A Session this Harness already serves is healthy, not parked on
            // a dead owner: reuse the attachment instead of re-loading it.
            return new Attachment(cached.getHarnessBootId(),
                    cached.getRuntimeRecovery(),
                    cached.getHarnessLastEventId(),
                    cached.getHarnessEventEpoch());
        }
        HarnessSessionRef attached = load(session, cancellation,
                !cancellation);
        attachments.put(key, attached);`, `            // A Session this Harness already serves is healthy, not parked on
            // a dead owner: reuse the attachment instead of re-loading it.
            // The snapshot of the takeover load that created it is handed
            // out again only until its continue or cancel has been admitted;
            // after that a re-entered Turn just resumes its stream.
            return new Attachment(cached.getHarnessBootId(),
                    pendingRecovery.contains(key)
                            ? cached.getRuntimeRecovery() : null,
                    cached.getHarnessLastEventId(),
                    cached.getHarnessEventEpoch());
        }
        HarnessSessionRef attached = load(session, cancellation,
                !cancellation);
        attachments.put(key, attached);
        if (attached.getRuntimeRecovery() != null) {
            pendingRecovery.add(key);
        } else {
            pendingRecovery.remove(key);
        }`);
  edit(JT, `    private static QwenHostedHarnessConnector connector(
            HostedHarnessClient client) {`, `    @Test
    void takeoverSnapshotIsReportedUntilItsContinuationIsAdmitted() {
        HostedHarnessClient client = mock(HostedHarnessClient.class);
        HostedHarnessCapabilities capabilities =
                mock(HostedHarnessCapabilities.class);
        HarnessSessionRef session = mock(HarnessSessionRef.class);
        HarnessRuntimeRecovery recovery = mock(HarnessRuntimeRecovery.class);
        PromptReceipt receipt = mock(PromptReceipt.class);
        when(capabilities.getBootId()).thenReturn(BOOT_ID);
        when(client.capabilities()).thenReturn(capabilities);
        when(client.loadSession(any(LoadHarnessSession.class)))
                .thenReturn(session);
        when(client.continueManagedRuntime(any(), any(), any(), any()))
                .thenReturn(receipt);
        when(session.getHarnessBootId()).thenReturn(BOOT_ID);
        when(session.getRuntimeRecovery()).thenReturn(recovery);
        QwenHostedHarnessConnector connector = connector(client);

        assertThat(connector.recoverManagedRuntime("tenant-a", SESSION_ID,
                false).runtimeRecovery()).isSameAs(recovery);
        // Re-entered before the continuation was admitted: still pending.
        assertThat(connector.recoverManagedRuntime("tenant-a", SESSION_ID,
                false).runtimeRecovery()).isSameAs(recovery);
        connector.continueManagedRuntime("tenant-a", SESSION_ID,
                "44444444-4444-4444-8444-444444444444", "checkpoint",
                "activation");
        // Re-entered after admission (stream gap, lost reply): the Turn is
        // already continuing, so it must not be retracted and continued again.
        assertThat(connector.recoverManagedRuntime("tenant-a", SESSION_ID,
                false).runtimeRecovery()).isNull();
        verify(client).loadSession(any(LoadHarnessSession.class));
    }

    private static QwenHostedHarnessConnector connector(
            HostedHarnessClient client) {`);
  edit(JT, `import com.alibaba.qwen.code.daemon.HarnessSessionRef;`, `import com.alibaba.qwen.code.daemon.HarnessRuntimeRecovery;
import com.alibaba.qwen.code.daemon.HarnessSessionRef;`);
  edit(JT, `import com.alibaba.qwen.code.daemon.LoadHarnessSession;`, `import com.alibaba.qwen.code.daemon.LoadHarnessSession;
import com.alibaba.qwen.code.daemon.PromptReceipt;`);
}
edit(
  'packages/cli/src/serve/hosted-runtime-recovery.ts',
  `        if (cause instanceof RecoveryDeclined) return undefined;
        throw cause;
      }
    }
  }
  const finalAuthorization`,
  `        if (cause instanceof RecoveryDeclined) return undefined;
        throw cause;
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
console.log('candidate applied to', tree, tsOnly ? '(TS only)' : '');
