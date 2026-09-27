// Single-site mutants of the PR's production changes. Each anchor must match exactly once.
const B = 'packages/sdk-java/runtime-broker/src/main/java/com/alibaba/qwen/code/runtimebroker/';
const S = 'packages/sdk-java/managed-agent-server/src/main/java/com/alibaba/qwen/code/managedagent/';
export const MUTANTS = [
  { id: 'M01', what: 'rebooted() ignores the host id (another machine with another boot id counts as a reboot)', file: B + 'LocalRuntimeStore.java',
    find: `        return identity.hostId().equals(registration.handle().getValue().get("hostId"))
                && !identity.bootId().equals(registration.handle().getValue().get("bootId"));`,
    replace: `        return !identity.bootId().equals(registration.handle().getValue().get("bootId"));` },
  { id: 'M02', what: 'rebooted() ignores the boot id (same boot counts as a reboot)', file: B + 'LocalRuntimeStore.java',
    find: `        return identity.hostId().equals(registration.handle().getValue().get("hostId"))
                && !identity.bootId().equals(registration.handle().getValue().get("bootId"));`,
    replace: `        return identity.hostId().equals(registration.handle().getValue().get("hostId"));` },
  { id: 'M03', what: 'reboot evidence is produced although the option is off', file: B + 'LocalProcessRuntimeProvisioner.java',
    find: `if (trustedRebootRecovery && store.rebooted(registration)) {`, replace: `if (store.rebooted(registration)) {` },
  { id: 'M04', what: 'evidence is returned without tombstoning the original registration', file: B + 'LocalProcessRuntimeProvisioner.java',
    find: `                    resource.save(registration.withState(LocalRuntimeStore.State.RETIRED));
                    return RuntimeObservation.notFound(localEvidence(seed, handle,
                            RuntimeRecoveryEvidence.Fact.JOURNAL_LOST, "trusted-host-reboot"),`,
    replace: `                    return RuntimeObservation.notFound(localEvidence(seed, handle,
                            RuntimeRecoveryEvidence.Fact.JOURNAL_LOST, "trusted-host-reboot"),` },
  { id: 'M05', what: 'worker-only death also returns writer-stop evidence', file: B + 'LocalProcessRuntimeProvisioner.java',
    find: `                    return RuntimeObservation.notFound(localEvidence(seed, handle,
                            RuntimeRecoveryEvidence.Fact.JOURNAL_LOST, "registered-process-exit"), null);`,
    replace: `                    return RuntimeObservation.notFound(localEvidence(seed, handle,
                            RuntimeRecoveryEvidence.Fact.JOURNAL_LOST, "registered-process-exit"),
                            localEvidence(seed, handle, RuntimeRecoveryEvidence.Fact.WRITERS_STOPPED, "registered-process-exit"));` },
  { id: 'M06', what: 'releaseLost accepts a stale record version', file: S + 'store/WorkspaceExecutionStore.java',
    find: `                            && saved.getVersion() == row.getLong("record_version")`, replace: `` },
  { id: 'M07', what: 'releaseLost accepts another owner / operation generation', file: S + 'store/WorkspaceExecutionStore.java',
    find: `                            && saved.getOperationOwner().equals(row.getString("operation_owner"))
                            && saved.getOperationGeneration() == row.getLong("operation_generation")`, replace: `` },
  { id: 'M08', what: 'releaseLost clears whatever holder is present', file: S + 'store/WorkspaceExecutionStore.java',
    find: `                        } else if (saved.getBindingId().equals(bindingId) && saved.getGeneration() == generation) {`,
    replace: `                        } else if (true) {` },
  { id: 'M09', what: 'releaseLost ignores executions that are not terminal yet', file: S + 'store/WorkspaceExecutionStore.java',
    find: `                            Long.class, saved.getBindingId(), saved.getGeneration()) != 0) {`,
    replace: `                            Long.class, saved.getBindingId(), saved.getGeneration()) < 0) {` },
  { id: 'M10', what: 'claim no longer requires a READY binding (late acquire can recreate the holder)', file: S + 'store/WorkspaceExecutionStore.java',
    find: `                            && "READY".equals(row.getString("binding_state")) && !row.getBoolean("drain_requested")`, replace: `` },
  { id: 'M11', what: 'claim no longer checks the Runtime Session row', file: S + 'store/WorkspaceExecutionStore.java',
    find: `            if (active.size() != 1 || !active.getFirst()) {`, replace: `            if (active.size() > 1) {` },
  { id: 'M12', what: 'ordinary release is allowed again for a managed LOST generation (admission)', file: B + 'RuntimeAdmission.java',
    find: `                        && (binding.getRequest().isManagedContext() || !binding.hasStoppedWriters())) {`,
    replace: `                        && !binding.hasStoppedWriters()) {` },
  { id: 'M13', what: 'ordinary release is allowed again for a managed LOST generation (service)', file: B + 'RuntimeBrokerService.java',
    find: `                            && !binding.getRequest().isManagedContext()
`, replace: `` },
  { id: 'M14', what: 'JDBC recoverLost retires a managed generation without holder cleanup', file: B + 'JdbcRuntimeBindingRepository.java',
    find: `            if (!holdersCleared || !current.hasStoppedWriters()`, replace: `            if (!current.hasStoppedWriters()` },
  { id: 'M15', what: 'in-memory recoverLost retires a managed generation without holder cleanup', file: B + 'InMemoryRuntimeBindingRepository.java',
    find: `                if (!holdersCleared || !current.hasStoppedWriters()`, replace: `                if (!current.hasStoppedWriters()` },
  { id: 'M16', what: 'the provisioner default allows managed cleanup (fail-open default)', file: B + 'RuntimeProvisioner.java',
    find: `        if (binding.getRequest().isManagedContext()) {
            return CompletableFuture.failedFuture(new RuntimeBrokerException(409,
                    "runtime_broker_recovery_blocked", "Workspace recovery cleanup is unavailable.", false));
        }
        return CompletableFuture.completedFuture(null);`,
    replace: `        return CompletableFuture.completedFuture(null);` },
  { id: 'M17', what: 'the Workspace wrapper reports cleanup without clearing the SQL holder', file: S + 'service/WorkspaceRuntimeProvisioner.java',
    find: `        executionStore.releaseLost(binding);
`, replace: `` },
  { id: 'M18', what: 'a late cleanup completion may finish although the claim is gone', file: B + 'RuntimeBrokerService.java',
    find: `                || !ownsOperation(current, claimed.getOperationGeneration()) || !current.isActive()) {`,
    replace: `                || !current.isActive()) {` },
  { id: 'M19', what: 'recoverBinding ignores the expected generation', file: B + 'RuntimeBrokerService.java',
    find: `        if (record == null || record.getGeneration() != expectedGeneration
`, replace: `        if (record == null
` },
  { id: 'M20', what: 'the scan cursor never advances', file: S + 'service/RuntimeRecoveryCoordinator.java',
    find: `            cursor = candidates.size() < BATCH_SIZE ? null : candidates.getLast().getBindingId();`, replace: `            cursor = null;` },
  { id: 'M21', what: 'scan batches may overlap', file: S + 'service/RuntimeRecoveryCoordinator.java',
    find: `        if (closed || !running.compareAndSet(false, true)) {`, replace: `        if (closed) {` },
  { id: 'M22', what: 'reboot recovery may be enabled without durable local provisioning', file: S + 'service/EmbeddedRuntimeBroker.java',
    find: `        if (broker.isTrustedLocalRebootRecovery()
                && (!broker.isDurableLocalProcess() || !"local-process".equals(broker.getProvisioner()))) {`,
    replace: `        if (false) {` },
  { id: 'M23', what: 'JDBC candidates include released generations', file: B + 'JdbcRuntimeBindingRepository.java',
    find: `                    + " AND binding_state IN ('PROVISIONING', 'READY', 'DRAINING', 'RECOVERY_BLOCKED', 'LOST')"`,
    replace: `                    + " AND binding_state IN ('PROVISIONING', 'READY', 'DRAINING', 'RECOVERY_BLOCKED', 'LOST', 'RELEASED')"` },
  { id: 'M24', what: 'JDBC candidates ignore the cursor', file: B + 'JdbcRuntimeBindingRepository.java',
    find: `                statement.setString(2, afterBindingId == null ? "" : afterBindingId);`, replace: `                statement.setString(2, "");` },
  { id: 'M25', what: 'evidence matches any lease', file: B + 'RuntimeRecoveryEvidence.java',
    find: `                && (lease == null || seed.matches(lease))`, replace: `` },
  { id: 'M26', what: 'abandons executions but also finishes while the cleanup callback failed', file: B + 'RuntimeBrokerService.java',
    find: `                return safeStage(() -> provisioner.recoverResources(terminalized))
                        .toCompletableFuture().orTimeout(operationLeaseDuration.toMillis(), TimeUnit.MILLISECONDS)
                        .thenApply(ignored -> {`,
    replace: `                return safeStage(() -> provisioner.recoverResources(terminalized))
                        .toCompletableFuture().orTimeout(operationLeaseDuration.toMillis(), TimeUnit.MILLISECONDS)
                        .handle((ignored, cleanupFailure) -> {` },
  { id: 'M27', what: 'M06 + M07 together: releaseLost accepts a stale version AND another claim', file: S + 'store/WorkspaceExecutionStore.java',
    find: `                            && saved.getVersion() == row.getLong("record_version")
                            && saved.getOperationOwner().equals(row.getString("operation_owner"))
                            && saved.getOperationGeneration() == row.getLong("operation_generation")`, replace: `` },
  { id: 'M28', what: 'M27 plus no lease-expiry check: releaseLost trusts any saved LOST record', file: S + 'store/WorkspaceExecutionStore.java',
    find: `                            && saved.getVersion() == row.getLong("record_version")
                            && saved.getOperationOwner().equals(row.getString("operation_owner"))
                            && saved.getOperationGeneration() == row.getLong("operation_generation")
                            && row.getTimestamp("operation_lease_until") != null
                            && row.getTimestamp("operation_lease_until", java.util.Calendar.getInstance(
                                    java.util.TimeZone.getTimeZone("UTC"))).toInstant().isAfter(java.time.Instant.ofEpochSecond(
                                            row.getLong("db_seconds"), row.getLong("db_micros") * 1000))`, replace: `` },
];
