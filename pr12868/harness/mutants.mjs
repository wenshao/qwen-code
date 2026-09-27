// PR #12868 mutation matrix. Each mutant is one faithful edit of a production
// line the PR adds; the suite listed is the repository's own.
const BROKER = 'packages/sdk-java/runtime-broker/src/main/java/com/alibaba/qwen/code/runtimebroker';
const SERVER = 'packages/sdk-java/managed-agent-server/src/main/java/com/alibaba/qwen/code/managedagent/service';
const SERVE = 'packages/cli/src/serve';

export const mutants = [
  // ---- Java: Broker service / HTTP face ---------------------------------
  {
    id: 'J1', suite: 'broker', file: `${BROKER}/RuntimeBrokerService.java`,
    what: 'payload-less start accepts a raw (non-provider) reservation',
    find: `                        if (!ProviderRuntimeProtocol.isReference(record.getReference())) {
                            throw invalid("runtime_payload_invalid", "Deferred execution requires payloadJson");
                        }`,
    replace: `                        if (false) {
                            throw invalid("runtime_payload_invalid", "Deferred execution requires payloadJson");
                        }`,
  },
  {
    id: 'J2', suite: 'broker', file: `${BROKER}/RuntimeBrokerService.java`,
    what: 'payload start accepts a provider reservation',
    find: `                if (!"deferred".equals(record.getReference().get("dispatchMode"))) {
                    throw conflict("runtime_execution_conflict", "Execution was not reserved for deferred dispatch");
                }`,
    replace: `                if (false) {
                    throw conflict("runtime_execution_conflict", "Execution was not reserved for deferred dispatch");
                }`,
  },
  {
    id: 'J3', suite: 'broker', file: `${BROKER}/RuntimeBrokerService.java`,
    what: 'immediate route accepts a seven-field provider reference',
    find: `        if (immutable.containsKey("invocationId") || immutable.containsKey("capabilityDigest")
                || immutable.containsKey("policyRevision")) {`,
    replace: `        if (false) {`,
  },
  {
    id: 'J4', suite: 'broker', file: `${BROKER}/RuntimeBrokerHttpServer.java`,
    what: 'reservation body is no longer a closed field set',
    find: `        if (prepare && !body.keySet().equals(Set.of("protocolVersion", "requestId", "idempotencyKey",`,
    replace: `        if (false && !body.keySet().equals(Set.of("protocolVersion", "requestId", "idempotencyKey",`,
  },
  {
    id: 'J5', suite: 'broker', file: `${BROKER}/RuntimeBrokerHttpServer.java`,
    what: 'start body is no longer a closed field set',
    find: `            if (!body.keySet().equals(fields)) {`,
    replace: `            if (false) {`,
  },
  {
    id: 'J6', suite: 'broker', file: `${BROKER}/RuntimeBrokerService.java`,
    what: 'cancel of a prepared provider reservation never reaches the worker',
    find: `                        if (requested.isSettled() && requested.isCancelRequested()
                                && requested.getDispatchGeneration() == 0
                                && ProviderRuntimeProtocol.isReference(requested.getReference())) {`,
    replace: `                        if (false) {`,
  },
  {
    id: 'J7', suite: 'broker', file: `${BROKER}/RuntimeBrokerService.java`,
    what: 'prepared cancellation is acknowledged on cancel_requested without waiting',
    find: `                } else if (status != null && ("prepared".equals(status.get("state"))
                        || "executing".equals(status.get("state"))
                        || "cancel_requested".equals(status.get("state")))) {
                    scheduler.schedule(() -> {`,
    replace: `                } else if (status != null && "cancel_requested".equals(status.get("state"))) {
                    completion.complete(requested);
                } else if (status != null && ("prepared".equals(status.get("state"))
                        || "executing".equals(status.get("state")))) {
                    scheduler.schedule(() -> {`,
  },
  {
    id: 'J8', suite: 'broker', file: `${BROKER}/HttpRuntimeTransport.java`,
    what: 'generic control skips the worker acquire',
    find: `        return provider(lease, session, Map.of("kind", "acquire"))
                .thenCompose(value -> {
                    if (!Boolean.TRUE.equals(value)) {
                        throw protocol("Managed Runtime acquire response is invalid.");
                    }
                    return provider(lease, session, immutable);
                });`,
    replace: `        return provider(lease, session, immutable);`,
  },
  {
    id: 'J9', suite: 'broker', file: `${BROKER}/HttpRuntimeTransport.java`,
    what: 'release is acknowledged locally without asking the worker',
    find: `        return provider(lease, session, Map.of("kind", "release"))
                .thenApply(value -> {
                    if (!Boolean.TRUE.equals(value)) {
                        throw protocol("Managed Runtime did not confirm Session release.");
                    }
                    return true;
                });`,
    replace: `        return CompletableFuture.completedFuture(true);`,
  },
  {
    id: 'J10', suite: 'broker', file: `${BROKER}/HttpRuntimeTransport.java`,
    what: 'a false release answer from the worker is accepted',
    find: `                    if (!Boolean.TRUE.equals(value)) {
                        throw protocol("Managed Runtime did not confirm Session release.");
                    }`,
    replace: `                    if (false) {
                        throw protocol("Managed Runtime did not confirm Session release.");
                    }`,
  },
  {
    id: 'J11', suite: 'broker', file: `${BROKER}/HttpRuntimeTransport.java`,
    what: 'provider response identity (version/protocol/session) is not checked',
    find: `                            || !identity.equals(response.get("session"))) {`,
    replace: `                            || false) {`,
  },
  {
    id: 'J12', suite: 'broker', file: `${BROKER}/ProviderRuntimeProtocol.java`,
    what: 'a reference for another Runtime Session passes the Broker check',
    find: `        if (!sessionId.equals(identity.get("sessionId"))
                || !string(identity, "sessionId").matches(`,
    replace: `        if (!string(identity, "sessionId").matches(`,
  },
  {
    id: 'J13', suite: 'broker', file: `${BROKER}/ProviderRuntimeProtocol.java`,
    what: 'unknown fields in a control operation are accepted',
    find: `            if (!required.contains(key) && !optional.contains(key)) {
                throw invalid();
            }`,
    replace: `            if (false) {
                throw invalid();
            }`,
  },
  {
    id: 'J14', suite: 'broker', file: `${BROKER}/ProviderRuntimeProtocol.java`,
    what: 'file-history owner is not tied to the Session',
    find: `                if (!sessionId.equals(string(binding, "ownerRuntimeSessionId"))
                        || !harnessSessionId.equals(string(binding, "ownerSessionId"))
                        || !Set.of(`,
    replace: `                if (!Set.of(`,
  },
  {
    id: 'J15', suite: 'broker', file: `${BROKER}/HttpRuntimeTransport.java`,
    what: 'history observation also acquires (reopens) the worker Session',
    find: `        if ("history".equals(immutable.get("kind"))) {
            return provider(lease, session, immutable);
        }`,
    replace: ``,
  },
  // ---- Java: Workspace transport ------------------------------------------
  {
    id: 'J16', suite: 'server', file: `${SERVER}/WorkspaceRuntimeTransport.java`,
    what: 'Workspace release skips the worker acknowledgement',
    find: `        return delegate.release(lease, session).thenCompose(released -> {
            if (!Boolean.TRUE.equals(released)) {
                throw WorkspaceExecutionStore.unavailable();
            }
            return delegate.activateWorkspace(context.runtime(), context.session(), context.binding(), false);
        })`,
    replace: `        return delegate.activateWorkspace(context.runtime(), context.session(), context.binding(), false)`,
  },
  {
    id: 'J17', suite: 'server', file: `${SERVER}/WorkspaceRuntimeTransport.java`,
    what: 'Workspace deactivates before the worker closes admission',
    find: `        return delegate.release(lease, session).thenCompose(released -> {
            if (!Boolean.TRUE.equals(released)) {
                throw WorkspaceExecutionStore.unavailable();
            }
            return delegate.activateWorkspace(context.runtime(), context.session(), context.binding(), false);
        })`,
    replace: `        return delegate.activateWorkspace(context.runtime(), context.session(), context.binding(), false)
                .thenCompose(ignored -> delegate.release(lease, session)).thenApply(released -> {
            if (!Boolean.TRUE.equals(released)) {
                throw WorkspaceExecutionStore.unavailable();
            }
            return released;
        })`,
  },
  {
    id: 'J18', suite: 'server', file: `${SERVER}/WorkspaceRuntimeTransport.java`,
    what: 'Workspace control no longer requires storage ownership',
    find: `        if (managed(session) && !"history".equals(operation.get("kind"))) {
            Context context = context(lease, session, true);
            ownership.assertHeld(context.binding(), context.session());
        }`,
    replace: ``,
  },
  // ---- TypeScript: worker / executor / protocol / provider ---------------
  {
    id: 'T1', suite: 'ts', file: `${SERVE}/managed-runtime-provider-worker.ts`,
    what: 'worker release skips cleanup of prepared invocations',
    find: `        await entry.value?.runtime.releasePrepared();
`,
    replace: ``,
  },
  {
    id: 'T2', suite: 'ts', file: `${SERVE}/managed-runtime-provider-worker.ts`,
    what: 'worker release does not close admission in the executor',
    find: `        await entry.value?.runtime.releasePrepared();
        this.executor.closeSessionAdmission(identity.runtimeSessionId);`,
    replace: `        await entry.value?.runtime.releasePrepared();`,
  },
  {
    id: 'T3', suite: 'ts', file: `${SERVE}/managed-runtime-provider-worker.ts`,
    what: 'provider acquire does not claim the Session against the raw protocol',
    find: `        this.executor.claimProviderSession(identity.runtimeSessionId);
`,
    replace: ``,
  },
  {
    id: 'T4', suite: 'ts', file: `${SERVE}/managed-runtime-tool-executor.ts`,
    what: 'raw calls may enter provider-owned or closed Sessions',
    find: `    if (
      this.providerSessions.has(sessionId) ||
      this.closedSessions.has(sessionId)
    ) {
      throw new ManagedToolConflictError('Managed Runtime protocol conflicts.');
    }`,
    replace: ``,
  },
  {
    id: 'T5', suite: 'ts', file: `${SERVE}/managed-runtime-tool-executor.ts`,
    what: 'provider claim ignores existing raw entries of the Session',
    find: `      this.closedSessions.has(sessionId) ||
      [...this.entries.values()].some(
        (entry) => entry.reference.sessionId === sessionId,
      )`,
    replace: `      this.closedSessions.has(sessionId)`,
  },
  {
    id: 'T6', suite: 'ts', file: `${SERVE}/managed-runtime-provider-worker.ts`,
    what: 'a released Session still admits new controls',
    find: `    if ((this.closing || session.closed || session.release) && !observes)`,
    replace: `    if (this.closing && !observes)`,
  },
  {
    id: 'T7', suite: 'ts', file: `${SERVE}/managed-runtime-provider-worker.ts`,
    what: 'new work no longer rechecks the Workspace context',
    find: `      if (!observes) await this.assertContext(identity.runtimeSessionId, value);`,
    replace: ``,
  },
  {
    id: 'T8', suite: 'ts', file: `${SERVE}/managed-runtime-provider-worker.ts`,
    what: 'release with pending controls is allowed',
    find: `      if (session.pending > 0)
        conflict('Managed Runtime Session still owns unfinished work.');`,
    replace: ``,
  },
  {
    id: 'T9', suite: 'ts', file: `${SERVE}/managed-runtime-provider-worker.ts`,
    what: 'background shell preparation is admitted',
    find: `            normalized['is_background'] === true`,
    replace: `            false`,
  },
  {
    id: 'T10', suite: 'ts', file: `${SERVE}/managed-runtime-provider-worker.ts`,
    what: 'file-history binding accepts another execution directory',
    find: `      binding.executionCwd !== value.context.directory ||`,
    replace: `      false ||`,
  },
  {
    id: 'T11', suite: 'ts', file: `${SERVE}/managed-runtime-provider-worker.ts`,
    what: 'a conflicting file-history rebind is accepted',
    find: `      if (value.historyBinding !== digest)
        conflict('Managed Runtime file history binding conflicts.');`,
    replace: ``,
  },
  {
    id: 'T12', suite: 'ts', file: `${SERVE}/managed-runtime-provider-worker.ts`,
    what: 'Session identity (Harness / turn kind) is not compared on lookup',
    find: `      (session.identity.harnessSessionId !== identity.harnessSessionId ||
        session.identity.turnKind !== identity.turnKind)`,
    replace: `      false`,
  },
  {
    id: 'T13', suite: 'ts', file: `${SERVE}/managed-runtime-provider-protocol.ts`,
    what: 'foreign-Session identities pass the protocol parser',
    find: `  if (identity.sessionId !== session.runtimeSessionId)
    throw new ManagedRuntimeProviderProtocolError(
      'Managed Runtime provider Session identity conflicts.',`,
    replace: `  if (false)
    throw new ManagedRuntimeProviderProtocolError(
      'Managed Runtime provider Session identity conflicts.',`,
  },
  {
    id: 'T14', suite: 'ts', file: `${SERVE}/managed-runtime-provider-protocol.ts`,
    what: 'unknown fields pass the protocol parser',
    find: `    Object.keys(value).some(
      (key) => !required.includes(key) && !optional.includes(key),
    )`,
    replace: `    false`,
  },
  {
    id: 'T15', suite: 'ts', file: `${SERVE}/managed-runtime-provider-protocol.ts`,
    what: 'manifest digest is not verified',
    find: `        managedToolDigest(result['tools'], 1024 * 1024) !==
          result['capabilityDigest']`,
    replace: `        false`,
  },
  {
    id: 'T16', suite: 'ts', file: `${SERVE}/managed-runtime-provider-protocol.ts`,
    what: 'prepare result argsDigest is not verified against params',
    find: `        managedToolDigest(result['params']) !== result['argsDigest'] ||`,
    replace: `        false ||`,
  },
  {
    id: 'T17', suite: 'ts', file: `${SERVE}/broker-managed-runtime-provider.ts`,
    what: 'idempotency key no longer includes the invocation id',
    find: `    .update(reference.argsDigest)
    .update('\\0')
    .update(reference.invocationId)`,
    replace: `    .update(reference.argsDigest)`,
  },
  {
    id: 'T18', suite: 'ts', file: `${SERVE}/managed-runtime-provider-worker.ts`,
    what: 'oversized provider responses are sent anyway',
    find: `        if (Buffer.byteLength(json) > limit) {`,
    replace: `        if (false) {`,
  },
  {
    id: 'T19', suite: 'ts', file: `${SERVE}/managed-runtime-tool-executor.ts`,
    what: 'executor no longer reports provider work as active',
    find: `      this.provider?.hasActiveSession(sessionId) === true ||`,
    replace: `      false ||`,
  },
  {
    id: 'T20', suite: 'core', file: 'packages/core/src/tools/managed-tool-runtime.ts',
    what: 'releasePrepared ignores running executions',
    find: `      [...this.entries.values()].some(
        (entry) => entry.execution !== undefined && !entry.result,
      )
    ) {
      throw new Error('Managed Runtime still owns unfinished execution.');`,
    replace: `      false
    ) {
      throw new Error('Managed Runtime still owns unfinished execution.');`,
  },
  {
    id: 'T21', suite: 'core', file: 'packages/core/src/tools/managed-tool-runtime.ts',
    what: 'releasePrepared does not cancel unfinished preparations',
    find: `      if (!entry.result) this.requestCancel(entry);
    }
    await Promise.all(`,
    replace: `    }
    await Promise.all(`,
  },
  {
    id: 'T22', suite: 'core', file: 'packages/core/src/tools/managed-tool-runtime.ts',
    what: 'a cancelled shell display is no longer reported as cancelled',
    find: `          isShellResultDisplay(raw.returnDisplay) &&
          raw.returnDisplay.outcome === 'cancelled'`,
    replace: `          false`,
  },
];
