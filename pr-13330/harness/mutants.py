# Each mutant: (id, file (relative to managed-agent-server/src/main/java/com/alibaba/qwen/code/managedagent), old, new, description)
M = [
 ("m01", "service/ManagedAgentService.java",
  '''                        "The Hosted Harness could not persist the Session title.",
                        error);''',
  '''                        "The Hosted Harness could not persist the Session title.");''',
  "rename 503 drops the chained cause (revert item 7)"),
 ("m02", "harness/QwenHostedHarnessConnector.java",
  '''        if (scheme == null
                || !(scheme.equalsIgnoreCase("http")
                        || scheme.equalsIgnoreCase("https"))
                || baseUri.getHost() == null) {''',
  '''        if (false) {''',
  "no base-URL scheme/host validation (revert item 4)"),
 ("m03", "harness/QwenHostedHarnessConnector.java",
  '''            if (closed) {
                throw new IllegalStateException(
                        "Hosted Harness connector is closed");
            }''',
  '''''',
  "client() builds after close (revert item 3, guard)"),
 ("m04", "harness/QwenHostedHarnessConnector.java",
  '''            client = null;
        } finally {''',
  '''        } finally {''',
  "close() keeps the closed client in the field"),
 ("m05", "service/EmbeddedRuntimeBroker.java",
  '''            if ("ARCHIVED".equals(session.status())
                    || "DELETED".equals(session.status())) {''',
  '''            if (false) {''',
  "no durable ARCHIVED/DELETED fence (revert item 1a)"),
 ("m06", "service/EmbeddedRuntimeBroker.java",
  '''        if (row == null || "CLOSED".equals(row.status())) {
            retired.add(sessionId);
        }''',
  '''        retired.add(sessionId);''',
  "drain retires unconditionally (= base behaviour)"),
 ("m07", "service/EmbeddedRuntimeBroker.java",
  '''        if (row == null || "CLOSED".equals(row.status())) {
            retired.add(sessionId);
        }''',
  '''''',
  "drain never retires (= what the real close path does at head)"),
 ("m08", "service/EmbeddedRuntimeBroker.java",
  '''" is not supported (supported: local-process, static)");''',
  '''" is outside this review slice");''',
  "kubernetes message reverted (item 9)"),
 ("m09", "service/HarnessCoordinator.java",
  '''        if (leaseDuration.isNegative() || leaseDuration.isZero()
                || renewInterval.isNegative() || renewInterval.isZero()
                || renewInterval.compareTo(leaseDuration) >= 0) {''',
  '''        if (false) {''',
  "no lease/renew validation (revert item 6)"),
 ("m10", "service/HarnessCoordinator.java",
  '''renewInterval.compareTo(leaseDuration) >= 0) {''',
  '''renewInterval.compareTo(leaseDuration) > 0) {''',
  "renew == lease accepted (boundary)"),
 ("m11", "service/HarnessEventProjector.java",
  ''': turnId + ":call:" + callId;''',
  ''': turnId + ":" + callId;''',
  "untagged callId identity (revert item 5)"),
 ("m12", "service/MessageMaterializer.java",
  '''                    failures.put(key, streak + 1);
                    continue;''',
  '''                    failures.put(key, streak + 1);''',
  "no skip: attempt on every pass"),
 ("m13", "service/MessageMaterializer.java",
  '''                failures.put(key, Math.min(streak + 1, MAX_BACKOFF_STREAK));
                store.deferMaterializationTarget(target.tenantId(),
                        target.sessionId());''',
  '''                failures.put(key, Math.min(streak + 1, MAX_BACKOFF_STREAK));''',
  "no rotation after a failed attempt"),
 ("m14", "service/MessageMaterializer.java",
  '''            if (streak > 0) {
                store.deferMaterializationTarget(target.tenantId(),
                        target.sessionId());''',
  '''            if (streak > 0) {''',
  "no rotation on skipped passes"),
 ("m15", "service/MessageMaterializer.java",
  '''                failures.remove(key);''',
  '''''',
  "streak not cleared after success"),
 ("m16", "store/ManagedAgentStore.java",
  '''        jdbc.update("UPDATE managed_agent_consumer_progress SET updated_at"
                        + " = ? WHERE tenant_id = ? AND session_id = ? AND"
                        + " consumer_name = ?",
                clock.millis(), tenantId, sessionId, MESSAGE_PROJECTION);''',
  '''''',
  "deferMaterializationTarget is a no-op (store SQL)"),
 ("m17", "store/ManagedAgentStore.java",
  '''        jdbc.update("UPDATE managed_agent_consumer_progress SET updated_at"
                        + " = ? WHERE''',
  '''        jdbc.update("UPDATE managed_agent_consumer_progress SET updated_at"
                        + " = ?, covered_sequence = covered_sequence + 1 WHERE''',
  "defer also advances covered_sequence (breaks gap guard)"),
]
