#!/usr/bin/env python3
"""Round-4 mutants against head 51a87ac9 (delta of 99f74389..51a87ac9 + F1 revert + baseline).
usage: mutants_r4.py <tree-root> <id>|--check|--list"""
import sys

MA = "packages/sdk-java/managed-agent-server/src/main/java/com/alibaba/qwen/code/managedagent/"
RB = "packages/sdk-java/runtime-broker/src/main/java/com/alibaba/qwen/code/runtimebroker/"

M = [
 # --- admission fence (files changed by the main merge or the F1 fix) ---
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
 ("a09", RB + "RuntimeBrokerService.java",
  "        return resolveScope(harnessId, true, authority).thenCompose(scope -> {\n"
  "            RuntimeSession session = new RuntimeSession(harnessId,",
  "        return resolveScope(harnessId, authority).thenCompose(scope -> {\n"
  "            RuntimeSession session = new RuntimeSession(harnessId,",
  "F1 revert: fresh acquire takes the plain resolve"),
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
 # --- rename diagnostics (ManagedAgentService changed in the merge) ---
 ("f01", MA + "service/ManagedAgentService.java",
  """                LOG.warn("Managed Agent rename failed tenant={} session={}",
                        tenantId, sessionId, error);
""", "", "no rename WARN"),
 ("f02", MA + "service/ManagedAgentService.java",
  """                        "The Hosted Harness could not persist the Session title.",
                        error);""",
  """                        "The Hosted Harness could not persist the Session title.");""",
  "rename 503 drops the cause"),
 # --- defer SQL (ManagedAgentStore changed in the merge) ---
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
