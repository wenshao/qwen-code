#!/usr/bin/env python3
"""Round-3 mutants against head 99f74389. usage: mutants_r3.py <tree-root> <id>|--check|--list"""
import sys

MA = "packages/sdk-java/managed-agent-server/src/main/java/com/alibaba/qwen/code/managedagent/"
RB = "packages/sdk-java/runtime-broker/src/main/java/com/alibaba/qwen/code/runtimebroker/"

M = [
 # --- admission fence (R3 split) ---
 ("a01", MA + "service/EmbeddedRuntimeBroker.java",
  "if (admission && LIFECYCLE_FENCED.contains(session.status())) {",
  "if (LIFECYCLE_FENCED.contains(session.status())) {",
  "fence every resolve again (round-2 shape: release/reconcile fenced)"),
 ("a02", MA + "service/EmbeddedRuntimeBroker.java",
  "if (admission && LIFECYCLE_FENCED.contains(session.status())) {",
  "if (false && LIFECYCLE_FENCED.contains(session.status())) {",
  "no durable fence at all"),
 ("a03", MA + "service/EmbeddedRuntimeBroker.java",
  """                    String sessionId, RuntimeLifecycleAuthority authority) {
                return resolveScope(sessionId, true, authority);""",
  """                    String sessionId, RuntimeLifecycleAuthority authority) {
                return resolveScope(sessionId, false, authority);""",
  "authority-carrying admission resolve unfenced"),
 ("a04", MA + "service/EmbeddedRuntimeBroker.java",
  """                    String sessionId) {
                return resolveScope(sessionId, true, null);""",
  """                    String sessionId) {
                return resolveScope(sessionId, false, null);""",
  "one-arg admission resolve unfenced"),
 ("a05", RB + "RuntimeBrokerService.java",
  "        return resolveScope(harnessId, true, authority)\n                .thenCompose(scope -> ensureBinding(",
  "        return resolveScope(harnessId, authority)\n                .thenCompose(scope -> ensureBinding(",
  "Broker warm() takes the plain resolve"),
 ("a06", RB + "HarnessSessionResolver.java",
  """        if (authority == null) {
            return resolveAdmission(harnessSessionId);
        }
        return resolve(harnessSessionId, authority);""",
  """        return resolve(harnessSessionId, authority);""",
  "default two-arg admission ignores a one-arg-only override"),
 ("a07", MA + "service/EmbeddedRuntimeBroker.java",
  """        if (store.findSessionById(sessionId).isEmpty()) {
            retired.add(sessionId);
        }""", "        retired.add(sessionId);", "drain retires unconditionally (base)"),
 ("a08", MA + "service/EmbeddedRuntimeBroker.java",
  """        if (store.findSessionById(sessionId).isEmpty()) {
            retired.add(sessionId);
        }""", "", "drain never retires"),
 # --- materializer (R3-R5) ---
 ("b01", MA + "service/MessageMaterializer.java",
  "store.findMaterializationTargets(TARGET_LIMIT + 1);",
  "store.findMaterializationTargets(TARGET_LIMIT);", "no probe row: never saturated"),
 ("b02", MA + "service/MessageMaterializer.java",
  "boolean saturated = targets.size() > TARGET_LIMIT;",
  "boolean saturated = targets.size() >= TARGET_LIMIT;", "exactly-full window counts as saturated (R4 shape)"),
 ("b03", MA + "service/MessageMaterializer.java",
  """                    if (saturated) {
                        deferQuietly(target);
                    }""", "                    deferQuietly(target);", "skip path always rotates"),
 ("b04", MA + "service/MessageMaterializer.java",
  """                    if (saturated) {
                        deferQuietly(target);
                    }""", "", "skip path never rotates"),
 ("b05", MA + "service/MessageMaterializer.java",
  """                failures.put(key, streak + 1);
                deferQuietly(target);""", "                failures.put(key, streak + 1);",
  "no rotation after a failed attempt"),
 ("b06", MA + "service/MessageMaterializer.java",
  ": targets.subList(0, Math.min(TARGET_LIMIT, targets.size()))) {", ": targets) {",
  "probe row is worked too"),
 ("b07", MA + "service/MessageMaterializer.java",
  """        try {
            store.deferMaterializationTarget(target.tenantId(),
                    target.sessionId());
        } catch (RuntimeException deferError) {
            LOG.warn("Failed to defer Managed Agent session {}: {}",
                    target.sessionId(), deferError.toString());
        }""",
  """        store.deferMaterializationTarget(target.tenantId(),
                target.sessionId());""", "a defer fault aborts the pass"),
 ("b08", MA + "service/MessageMaterializer.java", "                failures.remove(key);\n", "",
  "streak not cleared on success"),
 ("b09", MA + "service/MessageMaterializer.java",
  ": streak % MAX_BACKOFF_STREAK == 0;", ": true;", "past the cap: retry every pass"),
 ("b10", MA + "service/MessageMaterializer.java",
  "boolean due = streak < MAX_BACKOFF_STREAK\n                        ? (streak & (streak - 1)) == 0\n                        : streak % MAX_BACKOFF_STREAK == 0;",
  "boolean due = (streak & (streak - 1)) == 0;", "no cap: pure power-of-two ladder"),
 ("b11", MA + "service/MessageMaterializer.java",
  '@Scheduled(scheduler = "managedMaterializationScheduler",\n            fixedDelayString =',
  '@Scheduled(\n            fixedDelayString =', "tick back on the shared default scheduler"),
 # --- lease validation (R2/R5) ---
 ("c01", MA + "service/HarnessCoordinator.java",
  "|| renewInterval.toMillis() > leaseDuration.toMillis() / 2) {",
  "|| renewInterval.toMillis() >= leaseDuration.toMillis()) {", "round-2 rule: renew < lease"),
 ("c02", MA + "service/HarnessCoordinator.java",
  "if (renewInterval.toMillis() <= 0\n",
  "if (renewInterval.isNegative() || renewInterval.isZero()\n", "sub-millisecond renew accepted"),
 ("c03", MA + "service/HarnessCoordinator.java",
  "|| renewInterval.toMillis() > leaseDuration.toMillis() / 2) {",
  "|| renewInterval.toMillis() >= leaseDuration.toMillis() / 2) {", "exactly half rejected (boundary)"),
 # --- base URL guard (R2/R4) ---
 ("d01", MA + "harness/QwenHostedHarnessConnector.java",
  "                || baseUri.getUserInfo() != null\n", "", "userinfo accepted"),
 ("d02", MA + "harness/QwenHostedHarnessConnector.java",
  "                || baseUri.getQuery() != null\n", "", "query accepted"),
 ("d03", MA + "harness/QwenHostedHarnessConnector.java",
  "                || baseUri.getFragment() != null) {", "                ) {", "fragment accepted"),
 ("d04", MA + "harness/QwenHostedHarnessConnector.java",
  "                || baseUri.getHost() == null\n", "", "host-less URL accepted"),
 ("d05", MA + "harness/QwenHostedHarnessConnector.java",
  """                || !(scheme.equalsIgnoreCase("http")
                        || scheme.equalsIgnoreCase("https"))""",
  """                || !(scheme.equalsIgnoreCase("http"))""", "https rejected"),
 ("d06", MA + "harness/QwenHostedHarnessConnector.java",
  'scheme.equalsIgnoreCase("http")\n', 'scheme.equals("http")\n', "upper-case HTTP rejected"),
 # --- connector close (R2) ---
 ("e01", MA + "harness/QwenHostedHarnessConnector.java",
  "            closed = true;\n            current = client;", "            current = client;",
  "close() never marks closed"),
 ("e02", MA + "harness/QwenHostedHarnessConnector.java",
  """            if (closed) {
                throw new IllegalStateException(
                        "Hosted Harness connector is closed");
            }""", "", "client() builds after close"),
 ("e03", MA + "harness/QwenHostedHarnessConnector.java",
  "            current = client;\n            client = null;\n        } finally {",
  "            current = client;\n        } finally {", "close() keeps the client in the field"),
 ("e04", MA + "harness/QwenHostedHarnessConnector.java",
  """            closed = true;
            current = client;
            client = null;
        } finally {
            clientLock.unlock();
        }""",
  """            closed = true;
            current = client;
            client = null;
            if (current != null) {
                current.close();
                current = null;
            }
        } finally {
            clientLock.unlock();
        }""", "client closed while holding clientLock"),
 # --- rename diagnostics ---
 ("f01", MA + "service/ManagedAgentService.java",
  """                LOG.warn("Managed Agent rename failed tenant={} session={}",
                        tenantId, sessionId, error);
""", "", "no rename WARN"),
 ("f02", MA + "service/ManagedAgentService.java",
  """                        "The Hosted Harness could not persist the Session title.",
                        error);""",
  """                        "The Hosted Harness could not persist the Session title.");""",
  "rename 503 drops the cause"),
 # --- tool identity ---
 ("g01", MA + "service/HarnessEventProjector.java",
  '(turnId + "#source:" + sourceId)', '(turnId + ":source:" + sourceId)', "no-id fallback back to ':source:'"),
 ("g02", MA + "service/HarnessEventProjector.java",
  ": EventIdentity.toolCallItemId(turnId, callId));",
  ': "item_tool_" + UUID.nameUUIDFromBytes((turnId + ":call:" + callId).getBytes(StandardCharsets.UTF_8)));',
  "projector derives its own callId identity"),
 ("g03", MA + "store/EventIdentity.java",
  '(turnId + ":" + callId).getBytes(StandardCharsets.UTF_8));',
  '(turnId + "::" + callId).getBytes(StandardCharsets.UTF_8));', "v1 callId rule changed"),
 # --- defer SQL ---
 ("h01", MA + "store/ManagedAgentStore.java",
  """        jdbc.update("UPDATE managed_agent_consumer_progress SET updated_at"
                        + " = ? WHERE tenant_id = ? AND session_id = ? AND"
                        + " consumer_name = ?",
                clock.millis(), tenantId, sessionId, MESSAGE_PROJECTION);""", "", "defer is a no-op"),
 ("h02", MA + "store/ManagedAgentStore.java",
  """SET updated_at"
                        + " = ? WHERE tenant_id = ? AND session_id = ? AND\"""",
  """SET covered_sequence = covered_sequence + 1, updated_at"
                        + " = ? WHERE tenant_id = ? AND session_id = ? AND\"""", "defer also bumps covered_sequence"),
 ("h03", MA + "store/ManagedAgentStore.java",
  """                        + " = ? WHERE tenant_id = ? AND session_id = ? AND"
                        + " consumer_name = ?",
                clock.millis(), tenantId, sessionId, MESSAGE_PROJECTION);""",
  """                        + " = ? WHERE (tenant_id = ? OR TRUE) AND session_id = ? AND"
                        + " consumer_name = ?",
                clock.millis(), tenantId, sessionId, MESSAGE_PROJECTION);""", "defer ignores the tenant"),
 ("k01", MA + "service/EmbeddedRuntimeBroker.java",
  '" is not supported (supported: local-process, static)");', '" is outside this review slice");',
  "kubernetes wording reverted"),
]


def main():
    root, arg = sys.argv[1], sys.argv[2]
    if arg == "--list":
        for m in M:
            print(m[0], m[4])
        return
    if arg == "--check":
        bad = 0
        for mid, path, old, new, _ in M:
            n = open(f"{root}/{path}").read().count(old)
            if n != 1:
                bad += 1
                print(f"{mid}: anchor count {n} in {path}")
        print("bad", bad, "of", len(M))
        return
    if arg == "m00":
        print("applied m00 (unmutated baseline)")
        return
    for mid, path, old, new, _ in M:
        if mid == arg:
            p = f"{root}/{path}"
            s = open(p).read()
            assert s.count(old) == 1, (mid, s.count(old))
            open(p, "w").write(s.replace(old, new))
            print("applied", mid, path.split("/")[-1])
            return
    raise SystemExit("unknown mutant " + arg)


main()
