package probe.external;

import com.alibaba.qwen.code.runtimebroker.InMemoryToolExecutionRepository;
import com.alibaba.qwen.code.runtimebroker.ToolExecutionRecord;
import java.lang.management.ManagementFactory;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Allocation per renewDispatch and per settle (public API), small vs 2,000-row payloads. */
public final class AllocProbe {
    static final com.sun.management.ThreadMXBean MX =
            (com.sun.management.ThreadMXBean) ManagementFactory.getThreadMXBean();
    static final Clock CLOCK = Clock.fixed(Instant.parse("2026-09-21T00:00:00Z"), ZoneOffset.UTC);
    static final Duration LONG_LEASE = Duration.ofHours(1);

    static Map<String, Object> ref(boolean large) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("sessionId", "session");
        m.put("promptId", "turn");
        m.put("callId", "tool");
        m.put("argsDigest", "digest");
        if (large) {
            m.put("rows", rows());
        }
        return m;
    }

    static List<Object> rows() {
        List<Object> rows = new ArrayList<>();
        for (int i = 0; i < 2000; i++) {
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("id", i);
            row.put("name", "row-" + i);
            row.put("score", i * 0.5d);
            row.put("tags", List.of("a", "b"));
            row.put("meta", Map.of("k", "v"));
            rows.add(row);
        }
        return rows;
    }

    static long renewBytes(boolean large, int n) {
        InMemoryToolExecutionRepository repo = new InMemoryToolExecutionRepository(CLOCK);
        repo.findOrCreate(ToolExecutionRecord.prepared("e", "k", "binding", 1, "harness",
                "session", "turn", "tool", "digest", ref(large)));
        ToolExecutionRecord c = repo.claimDispatch("e", "owner", LONG_LEASE);
        for (int i = 0; i < n; i++) {                       // warm-up
            repo.renewDispatch("e", "owner", c.getDispatchGeneration(), LONG_LEASE);
        }
        long t0 = System.nanoTime();
        long b0 = MX.getCurrentThreadAllocatedBytes();
        for (int i = 0; i < n; i++) {
            repo.renewDispatch("e", "owner", c.getDispatchGeneration(), LONG_LEASE);
        }
        long bytes = MX.getCurrentThreadAllocatedBytes() - b0;
        long ns = System.nanoTime() - t0;
        System.out.printf("  renewDispatch x%d, %s reference : %,d B/call  %,d ns/call%n", n,
                large ? "2,000-row" : "4-key", bytes / n, ns / n);
        return bytes / n;
    }

    static long settleBytes(boolean largeResult, int n) {
        InMemoryToolExecutionRepository repo = new InMemoryToolExecutionRepository(CLOCK);
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("executionStatus", "success");
        if (largeResult) {
            result.put("rows", rows());
        }
        List<ToolExecutionRecord> claimed = new ArrayList<>();
        for (int i = 0; i < n * 2; i++) {
            repo.findOrCreate(ToolExecutionRecord.prepared("e" + i, "k" + i, "binding", 1,
                    "harness", "session", "turn", "tool", "digest", ref(false)));
            claimed.add(repo.claimDispatch("e" + i, "owner", LONG_LEASE));
        }
        for (int i = 0; i < n; i++) {                       // warm-up on the first half
            ToolExecutionRecord c = claimed.get(i);
            repo.compareAndSet(c, c.withResult(result, 0, CLOCK.instant()));
        }
        long t0 = System.nanoTime();
        long b0 = MX.getCurrentThreadAllocatedBytes();
        for (int i = n; i < n * 2; i++) {
            ToolExecutionRecord c = claimed.get(i);
            repo.compareAndSet(c, c.withResult(result, 0, CLOCK.instant()));
        }
        long bytes = MX.getCurrentThreadAllocatedBytes() - b0;
        long ns = System.nanoTime() - t0;
        System.out.printf("  settle (withResult + CAS) x%d, %s result : %,d B/settle  %,d ns/settle%n",
                n, largeResult ? "2,000-row" : "1-key", bytes / n, ns / n);
        return bytes / n;
    }

    public static void main(String[] args) {
        System.out.println("arm=" + args[0] + " java " + System.getProperty("java.version"));
        renewBytes(false, 2000);
        renewBytes(true, 2000);
        settleBytes(false, 500);
        settleBytes(true, 500);
    }
}
