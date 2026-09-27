import com.alibaba.qwen.code.runtimebroker.InMemoryToolExecutionRepository;
import com.alibaba.qwen.code.runtimebroker.ToolExecutionRecord;
import java.util.Map;

/** Cancels a PREPARED execution in the Broker's real ledger and prints how it settles. */
public class BrokerCancelProbe {
    public static void main(String[] args) {
        InMemoryToolExecutionRepository ledger = new InMemoryToolExecutionRepository();
        ToolExecutionRecord prepared = ledger.findOrCreate(ToolExecutionRecord.prepared(
                "call-1", "idem-1", "binding-1", 1, "harness-1", "runtime-session-1",
                "turn-1", "tool-call-1", "a".repeat(64), Map.of("sessionId", "runtime-session-1",
                        "promptId", "turn-1", "callId", "tool-call-1", "argsDigest", "a".repeat(64))));
        System.out.println("before: state=" + prepared.getState() + " settled=" + prepared.isSettled());
        ToolExecutionRecord after = ledger.requestCancel("call-1", prepared.getVersion());
        System.out.println("after requestCancel: state=" + after.getState()
                + " settled=" + after.isSettled() + " result=" + after.getResult());
    }
}
