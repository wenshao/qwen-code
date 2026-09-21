package com.alibaba.qwen.code.runtimebroker;

import com.alibaba.qwen.code.runtimebroker.ToolExecutionRecord.State;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.LinkedHashMap;
import java.util.Map;

/** Can the lease holder enter and leave UNKNOWN itself, using only public record methods? */
public final class UnknownSideDoorProbe {
    static final Instant T0 = Instant.parse("2026-09-21T00:00:00Z");
    static final Duration LEASE = Duration.ofSeconds(30);

    static final class MClock extends Clock {
        Instant now = T0;
        @Override public ZoneId getZone() { return ZoneOffset.UTC; }
        @Override public Clock withZone(ZoneId zone) { return this; }
        @Override public Instant instant() { return now; }
    }

    static Map<String, Object> ref() {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("sessionId", "session");
        m.put("promptId", "turn");
        m.put("callId", "tool");
        m.put("argsDigest", "digest");
        return m;
    }

    static Method cas4;

    static String cas(InMemoryToolExecutionRepository repo, ToolExecutionRecord e, ToolExecutionRecord r) {
        try {
            Object o = cas4.invoke(repo, e, r, "owner-a", 1L);
            return o == null ? "refused (null)" : "accepted " + ((ToolExecutionRecord) o).getState()
                    + " owner=" + ((ToolExecutionRecord) o).getDispatchOwner();
        } catch (InvocationTargetException x) {
            return "refused (" + x.getCause().getMessage() + ")";
        } catch (IllegalAccessException x) {
            throw new IllegalStateException(x);
        }
    }

    static void run(boolean expireFirst) {
        MClock clock = new MClock();
        InMemoryToolExecutionRepository repo = new InMemoryToolExecutionRepository(clock);
        repo.findOrCreate(ToolExecutionRecord.prepared("x", "k", "binding", 1, "harness", "session",
                "turn", "tool", "digest", ref()));
        ToolExecutionRecord v1 = repo.claimDispatch("x", "owner-a", LEASE);
        String viaWithUnknown = cas(repo, v1, v1.withUnknown());
        ToolExecutionRecord cur = repo.findByExecutionCallId("x");
        String viaWithState = cas(repo, cur, cur.withState(State.UNKNOWN, false));
        cur = repo.findByExecutionCallId("x");
        ToolExecutionRecord renew = repo.renewDispatch("x", "owner-a", 1, LEASE);
        if (expireFirst) {
            clock.now = clock.now.plusSeconds(31);
        }
        String viaResolve = cas(repo, cur, cur.resolveUnknown(Map.of("executionStatus", "success"), clock.instant()));
        cur = repo.findByExecutionCallId("x");
        String viaWithResult = cur.getState() == State.UNKNOWN
                ? cas(repo, cur, cur.withResult(Map.of("executionStatus", "success"), 0, clock.instant()))
                : "n/a";
        System.out.printf("%s | enter: withUnknown()=%s ; withState(UNKNOWN,false)=%s ; renewDispatch=%s ; "
                + "exit: resolveUnknown()=%s ; withResult()=%s ; active=%s%n",
                expireFirst ? "lease expired before exit" : "exit within the lease",
                viaWithUnknown, viaWithState, renew == null ? "null" : "renewed", viaResolve, viaWithResult,
                repo.hasActiveByRuntimeSession("session"));
    }

    public static void main(String[] args) throws Exception {
        for (Method m : InMemoryToolExecutionRepository.class.getMethods()) {
            if (m.getName().equals("compareAndSet") && m.getParameterCount() == 4) {
                cas4 = m;
            }
        }
        System.out.println("arm=" + args[0]);
        run(false);
        run(true);
    }
}
