package com.alibaba.qwen.code.runtimebroker;

import com.alibaba.qwen.code.runtimebroker.ToolExecutionRecord.State;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.LinkedHashMap;
import java.util.Map;

/** After each unlisted-but-accepted move, let the lease expire and see what a takeover does. */
public final class UnlistedTakeoverProbe {
    static final class MClock extends Clock {
        Instant now = Instant.parse("2026-09-21T00:00:00Z");
        @Override public ZoneId getZone() { return ZoneOffset.UTC; }
        @Override public Clock withZone(ZoneId z) { return this; }
        @Override public Instant instant() { return now; }
    }

    public static void main(String[] args) {
        String[][] moves = {{"DISPATCHING", "CANCEL_REQUESTED"}, {"CANCEL_REQUESTED", "EXECUTING"},
            {"EXECUTING", "EXECUTING"}, {"CANCEL_REQUESTED", "CANCEL_REQUESTED"}};
        Duration lease = Duration.ofSeconds(30);
        for (String[] mv : moves) {
            MClock clock = new MClock();
            InMemoryToolExecutionRepository repo = new InMemoryToolExecutionRepository(clock);
            Map<String, Object> ref = new LinkedHashMap<>();
            ref.put("sessionId", "session"); ref.put("promptId", "turn"); ref.put("callId", "tool"); ref.put("argsDigest", "digest");
            repo.findOrCreate(ToolExecutionRecord.prepared("x", "k", "binding", 1, "harness", "session", "turn", "tool", "digest", ref));
            ToolExecutionRecord cur = repo.claimDispatch("x", "owner-a", lease);
            State from = State.valueOf(mv[0]); State to = State.valueOf(mv[1]);
            if (from != State.DISPATCHING) {
                cur = repo.compareAndSet(cur, cur.withState(State.EXECUTING, false), "owner-a", 1);
            }
            if (from == State.CANCEL_REQUESTED) {
                cur = repo.requestCancel("x", cur.getVersion());
            }
            boolean flag = from == State.CANCEL_REQUESTED || to == State.CANCEL_REQUESTED;
            ToolExecutionRecord after = repo.compareAndSet(cur, cur.withState(to, flag), "owner-a", 1);
            clock.now = clock.now.plusSeconds(31);
            ToolExecutionRecord b = repo.claimDispatch("x", "owner-b", lease);
            ToolExecutionRecord stored = repo.findByExecutionCallId("x");
            System.out.printf("%s->%s accepted=%s ; after expiry claim(owner-b)=%s ; stored %s gen=%d%n", mv[0], mv[1],
                    after != null, b == null ? "refused" : "GRANTED " + b.getState(), stored.getState(), stored.getDispatchGeneration());
        }
    }
}
