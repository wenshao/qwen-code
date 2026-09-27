import com.alibaba.qwen.code.managedagent.store.ManagedExtensionProjection;
import com.alibaba.qwen.code.managedagent.store.ManagedExtensionRecords;
import com.alibaba.qwen.code.runtimebroker.InMemoryToolExecutionRepository;
import com.alibaba.qwen.code.runtimebroker.ToolExecutionRecord;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.time.Duration;
import java.util.Map;

/**
 * Trial merge of #12855 + #12863. Drives the Broker's real in-memory ledger
 * through a never-sent cancel and a sent-then-cancelled call, maps each
 * record with H0c's ManagedExtensionProjection.executionOf, and asks the
 * H0b contract whether the resulting execution step is allowed.
 */
public class CancelMappingProbe {
    static final ObjectMapper JSON = new ObjectMapper();

    static ToolExecutionRecord prepare(InMemoryToolExecutionRepository ledger, String id) {
        return ledger.findOrCreate(ToolExecutionRecord.prepared(id, "idem-" + id,
                "binding-1", 1, "harness-1", "runtime-session-1", "turn-1", "tool-" + id,
                "a".repeat(64), Map.of("sessionId", "runtime-session-1", "promptId", "turn-1",
                        "callId", "tool-" + id, "argsDigest", "a".repeat(64))));
    }

    static String exec(ToolExecutionRecord r) {
        Object status = r.getResult() == null ? null : r.getResult().get("executionStatus");
        return ManagedExtensionProjection.executionOf(r.getState(), (String) status);
    }

    static ObjectNode run(String state, String execution) {
        ObjectNode run = JSON.createObjectNode();
        run.put("state", state).putNull("reason").putNull("definition")
                .put("executionCallId", "call-1").putNull("effectId").putNull("dispatchId")
                .putNull("deliveryId").put("execution", execution);
        if (execution.equals("intent")) run.putNull("runtime");
        else run.putObject("runtime").put("runtimeBindingId", "binding-1").put("generation", "1");
        run.putNull("delivery");
        return run;
    }

    static void report(String label, String runBefore, ToolExecutionRecord first, ToolExecutionRecord last) {
        String from = exec(first), to = exec(last);
        System.out.printf("%s%n  Broker: %s -> %s, executionStatus=%s, dispatchGeneration=%d%n",
                label, first.getState(), last.getState(),
                last.getResult() == null ? null : last.getResult().get("executionStatus"),
                last.getDispatchGeneration());
        System.out.printf("  H0c executionOf: %s -> %s%n", from, to);
        System.out.printf("  H0b isTransitionAllowed(execution, %s, %s) = %s%n", from, to,
                ManagedExtensionRecords.isTransitionAllowed("execution", from, to));
        for (String end : new String[] {to, "not_started_proven"}) {
            System.out.printf("  H0b isRunSuccessor(%s/%s -> cancelled/%s) = %s%s%n", runBefore, from, end,
                    ManagedExtensionRecords.isRunSuccessor(run(runBefore, from), run("cancelled", end)),
                    end.equals(to) ? "   <- H0c mapping" : "   <- the mapping #12863 names for a never-sent call");
            if (!from.equals("intent")) break;
        }
    }

    public static void main(String[] args) {
        InMemoryToolExecutionRepository ledger = new InMemoryToolExecutionRepository();
        ToolExecutionRecord a = prepare(ledger, "call-never-sent");
        ToolExecutionRecord aCancelled = ledger.requestCancel(a.getExecutionCallId(), a.getVersion());
        report("A. cancel a PREPARED call (never sent)", "admitted", a, aCancelled);

        ToolExecutionRecord b = prepare(ledger, "call-sent");
        ToolExecutionRecord claimed = ledger.claimDispatch(b.getExecutionCallId(), "broker-1", Duration.ofMinutes(1));
        ToolExecutionRecord executing = ledger.compareAndSet(claimed,
                claimed.withState(ToolExecutionRecord.State.EXECUTING, false), "broker-1",
                claimed.getDispatchGeneration());
        ToolExecutionRecord requested = ledger.requestCancel(b.getExecutionCallId(), executing.getVersion());
        ToolExecutionRecord settled = ledger.compareAndSet(requested,
                requested.withResult(Map.of("executionStatus", "cancelled"), requested.getLastSequence(),
                        java.time.Instant.now()), "broker-1", claimed.getDispatchGeneration());
        report("B. cancel an EXECUTING call; the Runtime reports cancelled", "running", executing, settled);
    }
}
