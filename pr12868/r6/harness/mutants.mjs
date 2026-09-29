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
    find: `                            if (isPreparedProviderCancellation(requested)) {`,
    replace: `                            if (false) {`,
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
    find: `        if (!sessionId.equals(identitySession)
                || !SESSION_ID.matcher(identitySession).matches()`,
    replace: `        if (!SESSION_ID.matcher(identitySession).matches()`,
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
                        || !BINDING_FIELDS`,
    replace: `                if (!BINDING_FIELDS`,
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

// ---- Round 2: the error envelope added by f0f217dfa5 ----------------------
export const round2 = [
  {
    id: 'N1', suite: 'broker', file: `${BROKER}/HttpRuntimeTransport.java`,
    what: 'a known code is accepted with any status',
    find: `            if (response.statusCode() == expectedStatus) {`,
    replace: `            if (expectedStatus != 0) {`,
  },
  {
    id: 'N2', suite: 'broker', file: `${BROKER}/HttpRuntimeTransport.java`,
    what: 'an error body with extra fields is accepted',
    find: `            if (!fields.keySet().equals(Set.of("code", "error"))
                    || !(fields.get("code") instanceof String code)`,
    replace: `            if (!(fields.get("code") instanceof String code)`,
  },
  {
    id: 'N3', suite: 'broker', file: `${BROKER}/HttpRuntimeTransport.java`,
    what: 'a provider error without Cache-Control: no-store is accepted',
    find: `        if (body.overflow()
                || !"no-store".equals(response.headers().firstValue("Cache-Control").orElse(""))`,
    replace: `        if (body.overflow()`,
  },
  {
    id: 'N4', suite: 'broker', file: `${BROKER}/HttpRuntimeTransport.java`,
    what: 'a provider error with Content-Encoding is accepted',
    find: `                || response.headers().firstValue("Content-Encoding").isPresent()) {
            return null;
        }
        try {
            Map<String, Object> fields = ManagedContextProtocol.parse(body.bytes());
            if (!fields.keySet().equals(Set.of("code", "error"))`,
    replace: `                ) {
            return null;
        }
        try {
            Map<String, Object> fields = ManagedContextProtocol.parse(body.bytes());
            if (!fields.keySet().equals(Set.of("code", "error"))`,
  },
  {
    id: 'N5', suite: 'broker', file: `${BROKER}/HttpRuntimeTransport.java`,
    what: 'the 4096-character reason bound is removed',
    find: `                    || message.isEmpty() || message.length() > 4096 || message.indexOf('\\0') >= 0) {`,
    replace: `                    || message.isEmpty() || message.indexOf('\\0') >= 0) {`,
  },
  {
    id: 'N6', suite: 'broker', file: `${BROKER}/HttpRuntimeTransport.java`,
    what: 'a reason holding NUL is accepted',
    find: `                    || message.isEmpty() || message.length() > 4096 || message.indexOf('\\0') >= 0) {`,
    replace: `                    || message.isEmpty() || message.length() > 4096) {`,
  },
  {
    id: 'N7', suite: 'broker', file: `${BROKER}/HttpRuntimeTransport.java`,
    what: 'an empty reason is accepted',
    find: `                    || message.isEmpty() || message.length() > 4096 || message.indexOf('\\0') >= 0) {`,
    replace: `                    || message.length() > 4096 || message.indexOf('\\0') >= 0) {`,
  },
  {
    id: 'N8', suite: 'broker', file: `${BROKER}/HttpRuntimeTransport.java`,
    what: 'provider error parsing applies to every worker route',
    find: `                        ProviderRuntimeProtocol.PATH.equals(path)
                                ? providerFailure(response, responseBody) : null;`,
    replace: `                        providerFailure(response, responseBody);`,
  },
  {
    id: 'N9', suite: 'broker', file: `${BROKER}/HttpRuntimeTransport.java`,
    what: 'an unknown code is accepted with the status it arrived with',
    find: `                default -> 0;`,
    replace: `                default -> response.statusCode();`,
  },
  {
    id: 'N10', suite: 'broker', file: `${BROKER}/HttpRuntimeTransport.java`,
    what: 'provider errors are never parsed (the fix is switched off)',
    find: `                if (providerError != null) {`,
    replace: `                if (false) {`,
  },
  {
    id: 'N11', suite: 'ts', file: `${SERVE}/broker-managed-runtime-provider.ts`,
    what: 'client takes a reason from an envelope with extra fields',
    find: `          Object.keys(body).length === 3 &&`,
    replace: ``,
  },
  {
    id: 'N12', suite: 'ts', file: `${SERVE}/broker-managed-runtime-provider.ts`,
    what: 'client takes a reason regardless of Content-Type',
    find: `          response.headers
            .get('content-type')
            ?.split(';')[0]
            .trim()
            .toLowerCase() === 'application/json' &&`,
    replace: ``,
  },
  {
    id: 'N13', suite: 'ts', file: `${SERVE}/broker-managed-runtime-provider.ts`,
    what: 'client reason bound of 4096 characters is removed',
    find: `          body['error'].length <= 4096 &&`,
    replace: ``,
  },
  {
    id: 'N14', suite: 'ts', file: `${SERVE}/broker-managed-runtime-provider.ts`,
    what: 'client accepts a reason holding NUL',
    find: `          body['error'].length <= 4096 &&
          !body['error'].includes('\\0')`,
    replace: `          body['error'].length <= 4096`,
  },
  {
    id: 'N15', suite: 'ts', file: `${SERVE}/broker-managed-runtime-provider.ts`,
    what: 'client never attaches the reason (the fix is switched off)',
    find: `          reason = body['error'];`,
    replace: `          reason = undefined;`,
  },
  {
    id: 'N16', suite: 'ts', file: `${SERVE}/managed-runtime-provider-worker.ts`,
    what: 'tool preparation errors fall back to the 409 catch-all',
    find: `        } else if (error instanceof ManagedToolPreparationError) {`,
    replace: `        } else if (false) {`,
  },
  {
    id: 'N17', suite: 'ts', file: `${SERVE}/managed-runtime-provider-worker.ts`,
    what: 'conflict errors lose their own code',
    find: `              error instanceof ManagedToolUnavailableError ||
              error instanceof ManagedToolConflictError`,
    replace: `              error instanceof ManagedToolUnavailableError`,
  },
  {
    id: 'N18', suite: 'ts', file: `${SERVE}/managed-runtime-provider-worker.ts`,
    what: 'the catch-all code is identity_conflict again',
    find: `                : 'managed_runtime_provider_operation_failed',`,
    replace: `                : 'managed_runtime_identity_conflict',`,
  },
  {
    id: 'N19', suite: 'ts', file: `${SERVE}/managed-context-worker.ts`,
    what: 'an unsupported profile is a plain error again',
    find: `        throw new ManagedRuntimeProviderProtocolError(
          'Managed Runtime provider configuration is unsupported.',
          501,
          'managed_runtime_provider_unsupported',
        );`,
    replace: `        throw new Error(
          'Managed Runtime provider configuration is unsupported.',
        );`,
  },
  {
    id: 'N20', suite: 'core', file: 'packages/core/src/tools/managed-tool-runtime.ts',
    what: 'an unknown tool is a plain error again',
    find: `    if (!tool)
      throw new ManagedToolPreparationError(
        'Managed Runtime tool is unavailable.',
      );`,
    replace: `    if (!tool) throw new Error('Managed Runtime tool is unavailable.');`,
  },
  {
    id: 'N21', suite: 'core', file: 'packages/core/src/tools/managed-tool-runtime.ts',
    what: 'a tool construction error is rethrown unwrapped',
    find: `      throw new ManagedToolPreparationError(
        error instanceof Error
          ? error.message
          : 'Managed Runtime tool input is invalid.',
      );`,
    replace: `      throw error;`,
  },
];

// ---- Round 3: lines written while resolving the merge with main (ac0b6cf966) ----
export const round3 = [
  {
    id: 'G1', suite: 'broker', file: `${BROKER}/RuntimeBrokerService.java`,
    what: 'a repeated cancel of a prepared provider call is answered from the stored record, without the worker',
    find: `                if (!isPreparedProviderCancellation(stored)) {
                    return CompletableFuture.completedFuture(stored);
                }`,
    replace: `                if (true) {
                    return CompletableFuture.completedFuture(stored);
                }`,
  },
  {
    id: 'G2', suite: 'broker', file: `${BROKER}/RuntimeBrokerService.java`,
    what: 'a cancelled prepared provider call never answers with its receipt (always needs a READY Session)',
    find: `                if (owner == null || owner.getState() != RuntimeSessionRecord.State.READY) {
                    return CompletableFuture.completedFuture(stored);
                }`,
    replace: ``,
  },
  {
    id: 'G3', suite: 'broker', file: `${BROKER}/RuntimeBrokerService.java`,
    what: 'the owner test is inverted (receipt only while the Session is READY)',
    find: `                if (owner == null || owner.getState() != RuntimeSessionRecord.State.READY) {`,
    replace: `                if (owner != null && owner.getState() == RuntimeSessionRecord.State.READY) {`,
  },
  {
    id: 'G4', suite: 'broker', file: `${BROKER}/RuntimeBrokerService.java`,
    what: 'a dispatched call counts as a prepared cancellation (generation test dropped)',
    find: `        return record.isSettled() && record.isCancelRequested()
                && record.getDispatchGeneration() == 0
                && ProviderRuntimeProtocol.isReference(record.getReference());`,
    replace: `        return record.isSettled() && record.isCancelRequested()
                && ProviderRuntimeProtocol.isReference(record.getReference());`,
  },
  {
    id: 'G5', suite: 'broker', file: `${BROKER}/RuntimeBrokerService.java`,
    what: 'a raw call counts as a prepared provider cancellation (reference test dropped)',
    find: `        return record.isSettled() && record.isCancelRequested()
                && record.getDispatchGeneration() == 0
                && ProviderRuntimeProtocol.isReference(record.getReference());`,
    replace: `        return record.isSettled() && record.isCancelRequested()
                && record.getDispatchGeneration() == 0;`,
  },
  {
    id: 'G6', suite: 'broker', file: `${BROKER}/RuntimeBrokerService.java`,
    what: 'reservation receipts ignore the reference (idempotency key alone decides)',
    find: `                if (!BrokerValues.sameJsonMap(receipt.getReference(),
                        immutableMap(reference, "reference"))) {`,
    replace: `                if (false) {`,
  },
  {
    id: 'G7', suite: 'broker', file: `${BROKER}/RuntimeBrokerService.java`,
    what: 'reservation receipts skip the ownership check',
    find: `                requireOwnedExecution(harnessSessionId, runtimeSessionId,
                        receipt.getExecutionCallId());
                if (!BrokerValues.sameJsonMap(`,
    replace: `                if (!BrokerValues.sameJsonMap(`,
  },
  {
    id: 'G8', suite: 'ts', file: `${SERVE}/broker-managed-runtime-provider.ts`,
    what: 'client never marks an execution as abandoned',
    find: `      throw new BrokerResponseError(
        response.status,
        code,
        retryable,
        reason,
        abandoned,
      );`,
    replace: `      throw new BrokerResponseError(
        response.status,
        code,
        retryable,
        reason,
        false,
      );`,
  },
  {
    id: 'G9', suite: 'ts', file: `${SERVE}/broker-managed-runtime-provider.ts`,
    what: 'client drops the reason when building the error (argument lost in the merge)',
    find: `      throw new BrokerResponseError(
        response.status,
        code,
        retryable,
        reason,
        abandoned,
      );`,
    replace: `      throw new BrokerResponseError(
        response.status,
        code,
        retryable,
        undefined,
        abandoned,
      );`,
  },
];

// ---- Round 4: commit cc06ee0e4e (refused acquire, unknown observation) -----
export const round4 = [
  {
    id: 'H1', suite: 'ts', file: `${SERVE}/managed-runtime-provider-worker.ts`,
    what: 'a refused acquire keeps its provider claim (raw admission stays fenced)',
    find: `          .catch((error: unknown) => {
            this.executor.unclaimProviderSession(identity.runtimeSessionId);
            this.sessions.delete(identity.runtimeSessionId);`,
    replace: `          .catch((error: unknown) => {
            this.sessions.delete(identity.runtimeSessionId);`,
  },
  {
    id: 'H2', suite: 'ts', file: `${SERVE}/managed-runtime-provider-worker.ts`,
    what: 'a refused acquire keeps its Session entry',
    find: `          .catch((error: unknown) => {
            this.executor.unclaimProviderSession(identity.runtimeSessionId);
            this.sessions.delete(identity.runtimeSessionId);`,
    replace: `          .catch((error: unknown) => {
            this.executor.unclaimProviderSession(identity.runtimeSessionId);`,
  },
  {
    id: 'H3', suite: 'ts', file: `${SERVE}/managed-runtime-tool-executor.ts`,
    what: 'removing the provisional claim also reopens a released Session',
    find: `  unclaimProviderSession(sessionId: string): void {
    this.providerSessions.delete(sessionId);`,
    replace: `  unclaimProviderSession(sessionId: string): void {
    this.providerSessions.delete(sessionId);
    this.closedSessions.delete(sessionId);`,
  },
  {
    id: 'H4', suite: 'ts', file: `${SERVE}/managed-runtime-provider-worker.ts`,
    what: 'status and cancel use the strict lookup again (no unknown answer)',
    find: `        const status = runtime.findStatus(
          operation.reference,`,
    replace: `        const status = runtime.status(
          operation.reference,`,
  },
  {
    id: 'H5', suite: 'ts', file: `${SERVE}/managed-runtime-provider-worker.ts`,
    what: 'only status answers unknown; cancel of a forgotten call fails',
    find: `        if (!status) return { state: 'unknown' };`,
    replace: `        if (!status && operation.kind === 'status') return { state: 'unknown' };
        if (!status) return runtime.cancel(operation.reference);`,
  },
  {
    id: 'H6', suite: 'ts', file: `${SERVE}/managed-runtime-provider-worker.ts`,
    what: 'the unknown answer carries a second key',
    find: `        if (!status) return { state: 'unknown' };`,
    replace: `        if (!status) return { state: 'unknown', cancelRequested: false };`,
  },
  {
    id: 'H7', suite: 'ts', file: `${SERVE}/managed-runtime-provider-worker.ts`,
    what: 'execute of a forgotten call answers the observation-only unknown',
    find: `      case 'execute':
        return runtime.execute(operation.reference);`,
    replace: `      case 'execute':
        if (!runtime.findStatus(operation.reference)) return { state: 'unknown' };
        return runtime.execute(operation.reference);`,
  },
  {
    id: 'H8', suite: 'ts', file: `${SERVE}/managed-runtime-provider-worker.ts`,
    what: 'status ignores the progress cursor (afterSequence)',
    find: `          operation.kind === 'status' ? operation.afterSequence : 0,`,
    replace: `          0,`,
  },
  {
    id: 'H9', suite: 'ts', file: `${SERVE}/managed-runtime-provider-worker.ts`,
    what: 'cancel of a settled retained call is sent to the runtime again',
    find: `        return operation.kind === 'cancel' && status.state !== 'settled'`,
    replace: `        return operation.kind === 'cancel'`,
  },
  {
    id: 'H10', suite: 'core', file: 'packages/core/src/tools/managed-tool-runtime.ts',
    what: 'a changed reference of a retained call is reported as unknown, not as a conflict',
    find: `    return this.entries.has(reference.invocationId)
      ? this.status(reference, afterSeq)
      : undefined;`,
    replace: `    try {
      return this.status(reference, afterSeq);
    } catch {
      return undefined;
    }`,
  },
  {
    id: 'H11', suite: 'core', file: 'packages/core/src/tools/managed-tool-runtime.ts',
    what: 'findStatus never finds a retained call',
    find: `    return this.entries.has(reference.invocationId)
      ? this.status(reference, afterSeq)
      : undefined;`,
    replace: `    return undefined;`,
  },
];

// ---- Round 5: commits ecacbfe488, 29a2ae66c2, 803761aabd -------------------
export const round5 = [
  {
    id: 'I1', suite: 'broker', file: `${BROKER}/RuntimeBrokerService.java`,
    what: 'the receipt is answered only for a RELEASED Session again (the rule before this head)',
    find: `                if (owner == null || owner.getState() != RuntimeSessionRecord.State.READY) {`,
    replace: `                if (owner != null && owner.getState() == RuntimeSessionRecord.State.RELEASED) {`,
  },
  {
    id: 'I2', suite: 'broker', file: `${BROKER}/RuntimeBrokerService.java`,
    what: 'a missing binding is dereferenced again',
    find: `                RuntimeSessionRecord owner = binding == null ? null : sessionRepository.findById(`,
    replace: `                RuntimeSessionRecord owner = sessionRepository.findById(`,
  },
  {
    id: 'I3', suite: 'broker', file: `${BROKER}/HttpRuntimeTransport.java`,
    what: 'an oversized provider operation is a plain runtime exception again (no 413)',
    find: `            throw new RuntimeBrokerException(413, "runtime_control_operation_too_large",
                    "Runtime provider operation exceeds its size limit.", false);`,
    replace: `            throw tooLarge;`,
  },
  {
    id: 'I4', suite: 'broker', file: `${BROKER}/RuntimeBrokerService.java`,
    what: 'a null value in a deferred reference escapes as a synchronous exception',
    find: `                return CompletableFuture.failedFuture(invalid("runtime_reference_invalid",
                        "Deferred execution reference is invalid"));`,
    replace: `                throw nullValue;`,
  },
  {
    id: 'I5', suite: 'broker', file: `${BROKER}/RuntimeBrokerHttpServer.java`,
    what: 'a malformed reservation envelope is reported as a reference error again',
    find: `            throw new RuntimeBrokerException(400, "runtime_broker_invalid_request",
                    "Prepared execution fields are invalid.", false);`,
    replace: `            throw new RuntimeBrokerException(400, "runtime_reference_invalid",
                    "Prepared execution fields are invalid.", false);`,
  },
  {
    id: 'I6', suite: 'broker', file: `${BROKER}/ProviderRuntimeProtocol.java`,
    what: 'the Broker Session id pattern loses its case-insensitive flag',
    find: `            "[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}",
            Pattern.CASE_INSENSITIVE);`,
    replace: `            "[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}");`,
  },
  {
    id: 'I7', suite: 'ts', file: `${SERVE}/managed-runtime-provider-protocol.ts`,
    what: 'the envelope accepts any runtimeSessionId again',
    find: `  envelopeSessionId(session['runtimeSessionId']);`,
    replace: `  id(session['runtimeSessionId']);`,
  },
  {
    id: 'I8', suite: 'ts', file: `${SERVE}/managed-runtime-provider-protocol.ts`,
    what: 'the envelope accepts any harnessSessionId again',
    find: `  envelopeSessionId(session['harnessSessionId']);`,
    replace: `  id(session['harnessSessionId']);`,
  },
  {
    id: 'I9', suite: 'ts', file: `${SERVE}/managed-runtime-provider-protocol.ts`,
    what: 'an envelope id may hold a slash',
    find: `    value.includes('/') ||
`,
    replace: ``,
  },
  {
    id: 'I23', suite: 'ts', file: `${SERVE}/managed-runtime-provider-protocol.ts`,
    what: 'an envelope id may hold a backslash',
    find: `    value.includes('\\\\') ||
`,
    replace: ``,
  },
  {
    id: 'I24', suite: 'ts', file: `${SERVE}/managed-runtime-provider-protocol.ts`,
    what: 'an envelope id may hold two dots in a row',
    find: `const UNSAFE_SESSION_ID = /[\\0-\\x1f\\x7f-\\x9f\\uD800-\\uDFFF]|\\.\\./;`,
    replace: `const UNSAFE_SESSION_ID = /[\\0-\\x1f\\x7f-\\x9f\\uD800-\\uDFFF]/;`,
  },
  {
    id: 'I25', suite: 'ts', file: `${SERVE}/managed-runtime-provider-protocol.ts`,
    what: 'an envelope id may hold control characters',
    find: `const UNSAFE_SESSION_ID = /[\\0-\\x1f\\x7f-\\x9f\\uD800-\\uDFFF]|\\.\\./;`,
    replace: `const UNSAFE_SESSION_ID = /[\\uD800-\\uDFFF]|\\.\\./;`,
  },
  {
    id: 'I26', suite: 'ts', file: `${SERVE}/managed-runtime-provider-protocol.ts`,
    what: 'an envelope id may hold an unpaired surrogate',
    find: `const UNSAFE_SESSION_ID = /[\\0-\\x1f\\x7f-\\x9f\\uD800-\\uDFFF]|\\.\\./;`,
    replace: `const UNSAFE_SESSION_ID = /[\\0-\\x1f\\x7f-\\x9f]|\\.\\./;`,
  },
  {
    id: 'I27', suite: 'ts', file: `${SERVE}/managed-runtime-provider-protocol.ts`,
    what: 'an envelope id may be a single dot',
    find: `    value === '.' ||
`,
    replace: ``,
  },
  {
    id: 'I28', suite: 'ts', file: `${SERVE}/managed-runtime-provider-protocol.ts`,
    what: 'an envelope id has no length bound',
    find: `    value.length === 0 ||
    value.length > 512 ||
    value === '.' ||`,
    replace: `    value.length === 0 ||
    value === '.' ||`,
  },
  {
    id: 'I10', suite: 'ts', file: `${SERVE}/managed-runtime-provider-worker.ts`,
    what: 'the worker sends the result as it is (no fitting)',
    find: `        const result = fitManagedRuntimeProviderResult(
          request.operation,
          raw,
          limit - envelopeOverhead,
        );`,
    replace: `        const result = raw;`,
  },
  {
    id: 'I11', suite: 'ts', file: `${SERVE}/managed-runtime-provider-worker.ts`,
    what: 'the fitting budget ignores the envelope that carries the result',
    find: `          limit - envelopeOverhead,`,
    replace: `          limit,`,
  },
  {
    id: 'I12', suite: 'ts', file: `${SERVE}/managed-runtime-provider-protocol.ts`,
    what: 'status results are not fitted',
    find: `    operation.kind !== 'execute' &&
    operation.kind !== 'status' &&
    operation.kind !== 'cancel'`,
    replace: `    operation.kind !== 'execute' &&
    operation.kind !== 'cancel'`,
  },
  {
    id: 'I13', suite: 'ts', file: `${SERVE}/managed-runtime-provider-protocol.ts`,
    what: 'cancel results are not fitted',
    find: `    operation.kind !== 'execute' &&
    operation.kind !== 'status' &&
    operation.kind !== 'cancel'`,
    replace: `    operation.kind !== 'execute' &&
    operation.kind !== 'status'`,
  },
  {
    id: 'I14', suite: 'ts', file: `${SERVE}/managed-runtime-provider-protocol.ts`,
    what: 'evicted progress is not announced (progressGap stays as it was)',
    find: `      status['progressGap'] = true;`,
    replace: ``,
  },
  {
    id: 'I15', suite: 'ts', file: `${SERVE}/managed-runtime-provider-protocol.ts`,
    what: 'a cut shell display is not marked truncated',
    find: `      const mark = () => {
        display.truncated = true;
      };`,
    replace: `      const mark = () => {};`,
  },
  {
    id: 'I16', suite: 'ts', file: `${SERVE}/managed-runtime-provider-protocol.ts`,
    what: 'the last-resort stub is never applied',
    find: `  if (!fits() && execution) {
    delete execution['postHook'];`,
    replace: `  if (false && execution) {
    delete execution['postHook'];`,
  },
  {
    id: 'I17', suite: 'ts', file: `${SERVE}/managed-runtime-provider-protocol.ts`,
    what: 'a cut keeps no notice (text is silently shortened)',
    find: `    slot.set(text.slice(0, head) + notice + text.slice(head + omitted));`,
    replace: `    slot.set(text.slice(0, head) + text.slice(head + omitted + notice.length));`,
  },
  {
    id: 'I18', suite: 'ts', file: `${SERVE}/managed-runtime-provider-worker.ts`,
    what: 'worker conflicts carry identity_conflict by default again',
    find: `  code: ManagedToolConflictError['code'] = 'managed_runtime_provider_operation_failed',`,
    replace: `  code: ManagedToolConflictError['code'] = 'managed_runtime_identity_conflict',`,
  },
  {
    id: 'I19', suite: 'ts', file: `${SERVE}/managed-runtime-provider-protocol.ts`,
    what: 'a standalone operation parser no longer bounds the operation size',
    find: `  if (!boundedByCaller)
    managedToolDigest(value, managedRuntimeProviderLimit(kind));`,
    replace: ``,
  },
  {
    id: 'I20', suite: 'broker', file: `${BROKER}/RuntimeBrokerService.java`,
    what: 'a cancellation the worker can never confirm is retryable again',
    find: `                                    : "Runtime did not confirm prepared invocation cancellation",
                            false);`,
    replace: `                                    : "Runtime did not confirm prepared invocation cancellation",
                            true);`,
  },
  {
    id: 'I21', suite: 'broker', file: `${BROKER}/RuntimeBrokerService.java`,
    what: 'an unknown answer confirms the cancellation (becomes not_started evidence)',
    find: `                    Object state = status == null ? null : status.get("state");
                    throw new RuntimeBrokerException(409,`,
    replace: `                    Object state = status == null ? null : status.get("state");
                    if ("unknown".equals(state)) {
                        completion.complete(requested);
                        return;
                    }
                    throw new RuntimeBrokerException(409,`,
  },
  {
    id: 'I22', suite: 'broker', file: `${BROKER}/RuntimeBrokerService.java`,
    what: 'the unconfirmed cancellation carries the old code',
    find: `                            "runtime_execution_cancel_unconfirmed",`,
    replace: `                            "runtime_execution_cancel_failed",`,
  },
];
