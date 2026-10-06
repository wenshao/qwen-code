# Round 2 mutants against head 924484ef29. (id, file under .../managedagent, old, new, description)
FENCE = '''    private static final Set<String> LIFECYCLE_FENCED = Set.of("CLOSING",
            "CLOSED", "ARCHIVING", "ARCHIVED", "DELETING", "DELETED");'''
STATUSES = ["CLOSING", "CLOSED", "ARCHIVING", "ARCHIVED", "DELETING", "DELETED"]


def fence_without(status):
    kept = ", ".join(f'"{s}"' for s in STATUSES if s != status)
    return f'    private static final Set<String> LIFECYCLE_FENCED = Set.of({kept});'


DRAIN = '''        if (store.findSessionById(sessionId).isEmpty()) {
            retired.add(sessionId);
        }'''
M = [
 ("m01", "service/ManagedAgentService.java",
  '''                        "The Hosted Harness could not persist the Session title.",
                        error);''',
  '''                        "The Hosted Harness could not persist the Session title.");''',
  "rename 503 drops the chained cause"),
 ("m02", "harness/QwenHostedHarnessConnector.java",
  '''        if (scheme == null
                || !(scheme.equalsIgnoreCase("http")
                        || scheme.equalsIgnoreCase("https"))
                || baseUri.getHost() == null) {''',
  '''        if (false) {''', "no base-URL scheme/host validation"),
 ("m03", "harness/QwenHostedHarnessConnector.java",
  '''            if (closed) {
                throw new IllegalStateException(
                        "Hosted Harness connector is closed");
            }''', '''''', "client() builds after close"),
 ("m04", "harness/QwenHostedHarnessConnector.java",
  '''            client = null;
        } finally {''', '''        } finally {''', "close() keeps the closed client in the field"),
 ("m05", "service/EmbeddedRuntimeBroker.java",
  '''            if (LIFECYCLE_FENCED.contains(session.status())) {''', '''            if (false) {''',
  "no durable lifecycle fence at all"),
 ("m06", "service/EmbeddedRuntimeBroker.java", DRAIN, '''        retired.add(sessionId);''',
  "drain retires unconditionally (base behaviour)"),
 ("m07", "service/EmbeddedRuntimeBroker.java", DRAIN, '''''', "drain never retires (vanished row unfenced)"),
 ("m08", "service/EmbeddedRuntimeBroker.java",
  '''" is not supported (supported: local-process, static)");''', '''" is outside this review slice");''',
  "kubernetes message reverted"),
 ("m09", "service/HarnessCoordinator.java",
  '''        if (leaseDuration.isNegative() || leaseDuration.isZero()
                || renewInterval.isNegative() || renewInterval.isZero()
                || renewInterval.compareTo(leaseDuration) >= 0) {''', '''        if (false) {''',
  "no lease/renew validation"),
 ("m10", "service/HarnessCoordinator.java",
  '''renewInterval.compareTo(leaseDuration) >= 0) {''', '''renewInterval.compareTo(leaseDuration) > 0) {''',
  "renew == lease accepted (boundary)"),
 ("m11", "service/HarnessEventProjector.java",
  ''': turnId + ":" + callId;''', ''': turnId + ":call:" + callId;''',
  "callId identity back to the round-1 ':call:' form (F1)"),
 ("m12", "service/MessageMaterializer.java",
  '''                if (!due) {
                    failures.put(key, streak + 1);
                    continue;''',
  '''                if (!due) {
                    failures.put(key, streak + 1);''', "no skip: attempt on every pass"),
 ("m13", "service/MessageMaterializer.java",
  '''                failures.put(key, streak + 1);
                store.deferMaterializationTarget(target.tenantId(),
                        target.sessionId());
                LOG.warn(''',
  '''                failures.put(key, streak + 1);
                LOG.warn(''', "no rotation after a failed attempt"),
 ("m14", "service/MessageMaterializer.java",
  '''            if (streak > 0) {
                store.deferMaterializationTarget(target.tenantId(),
                        target.sessionId());''', '''            if (streak > 0) {''',
  "no rotation on skipped passes"),
 ("m15", "service/MessageMaterializer.java", '''                failures.remove(key);''', '''''',
  "streak not cleared after success"),
 ("m16", "store/ManagedAgentStore.java",
  '''        jdbc.update("UPDATE managed_agent_consumer_progress SET updated_at"
                        + " = ? WHERE tenant_id = ? AND session_id = ? AND"
                        + " consumer_name = ?",
                clock.millis(), tenantId, sessionId, MESSAGE_PROJECTION);''', '''''',
  "deferMaterializationTarget is a no-op"),
 ("m17", "store/ManagedAgentStore.java",
  '''        jdbc.update("UPDATE managed_agent_consumer_progress SET updated_at"
                        + " = ? WHERE''',
  '''        jdbc.update("UPDATE managed_agent_consumer_progress SET updated_at"
                        + " = ?, covered_sequence = covered_sequence + 1 WHERE''',
  "defer also advances covered_sequence"),
] + [
 (f"n0{i + 1}", "service/EmbeddedRuntimeBroker.java", FENCE, fence_without(s), f"fence set drops {s}")
 for i, s in enumerate(STATUSES)
] + [
 ("n07", "service/HarnessEventProjector.java",
  '''? turnId + "#source:" + sourceId''', '''? turnId + ":source:" + sourceId''',
  "no-id fallback back to ':source:' (collides with callId 'source:N')"),
 ("n08", "service/MessageMaterializer.java",
  ''': streak % MAX_BACKOFF_STREAK == 0;''', ''': true;''', "at the cap: retry every pass (10 Hz flood)"),
 ("n09", "service/MessageMaterializer.java",
  ''': streak % MAX_BACKOFF_STREAK == 0;''', ''': false;''', "at the cap: never retry again"),
 ("n10", "service/MessageMaterializer.java",
  '''            } catch (RuntimeException error) {
                failures.put(key, streak + 1);''',
  '''            } catch (RuntimeException error) {
                failures.put(key, Math.min(streak + 1, MAX_BACKOFF_STREAK));''',
  "failure counter re-clamped at the cap (round-2 shape)"),
 ("n11", "service/ManagedAgentService.java",
  '''                        tenantId, sessionId, error);''', '''                        tenantId, sessionId);''',
  "rename WARN logged without the throwable"),
 ("n12", "service/ManagedAgentService.java",
  '''                LOG.warn("Hosted Harness rename failed tenant={} session={}",
                        tenantId, sessionId, error);''', '''''', "rename WARN removed"),
 ("n13", "service/MessageMaterializer.java",
  '''? (streak & (streak - 1)) == 0''', '''? true''', "below the cap: retry every pass"),
]
