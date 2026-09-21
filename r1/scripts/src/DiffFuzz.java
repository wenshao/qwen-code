package com.alibaba.qwen.code.runtimebroker;

import java.net.URI;
import java.sql.Connection;
import java.sql.Statement;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Random;
import java.util.TreeMap;
import java.util.concurrent.atomic.AtomicLong;
import java.util.stream.Collectors;

/**
 * Differential fuzz: the in-memory reference repositories vs the JDBC ones.
 * Every random operation is applied to both worlds; outcomes (normalised
 * record projection, or exception class + message) must match.
 *
 * args: &lt;h2|jdbc-url&gt; &lt;label&gt; &lt;sequences&gt; &lt;opsPerSequence&gt; &lt;seed&gt;
 */
public final class DiffFuzz {
    private static final Instant BASE = Instant.parse("2026-09-20T00:00:00Z");

    private static final class MutableClock extends Clock {
        private Instant now = Instant.parse("2030-01-01T00:00:00Z");

        @Override
        public ZoneId getZone() {
            return ZoneOffset.UTC;
        }

        @Override
        public Clock withZone(ZoneId zone) {
            return this;
        }

        @Override
        public Instant instant() {
            return now;
        }
    }

    private static final class World {
        RuntimeBindingRepository bindings;
        RuntimeSessionRepository sessions;
        final List<RuntimeBindingRecord> bindingHandles = new ArrayList<>();
        final List<RuntimeSessionRecord> sessionHandles = new ArrayList<>();
    }

    private static RuntimeScope[] scopes;
    private static RuntimeProvisionRequest[] requests;

    public static void main(String[] args) throws Exception {
        String target = args[0];
        String label = args[1];
        int sequences = Integer.parseInt(args[2]);
        int ops = Integer.parseInt(args[3]);
        long seed = Long.parseLong(args[4]);
        Map<String, Long> opCounts = new TreeMap<>();
        Map<String, Long> shapes = new TreeMap<>();
        Map<String, Long> divergences = new TreeMap<>();
        Map<String, String> firstExample = new TreeMap<>();
        long totalOps = 0;
        long cleanSequences = 0;
        long started = System.currentTimeMillis();
        for (int s = 0; s < sequences; s++) {
            long sequenceSeed = seed + s;
            Random random = new Random(sequenceSeed);
            String run = "f" + Long.toString(sequenceSeed, 36);
            scopes = new RuntimeScope[] {
                new RuntimeScope(run + "-t0", "ws", "g", "/w", "cap", "session"),
                new RuntimeScope(run + "-t1", "ws", "g", "/w", "cap", "session"),
                new RuntimeScope(run + "-t2", "ws", "g", "/w", "cap", "workspace"),
            };
            requests = new RuntimeProvisionRequest[] {
                new RuntimeProvisionRequest(scopes[0], "iso-a"),
                new RuntimeProvisionRequest(scopes[0], "iso-b"),
                new RuntimeProvisionRequest(scopes[1], "iso-a"),
                new RuntimeProvisionRequest(scopes[2], null),
            };
            MutableClock clock = new MutableClock();
            AtomicLong memIds = new AtomicLong();
            AtomicLong jdbcIds = new AtomicLong();
            World mem = new World();
            mem.bindings = new InMemoryRuntimeBindingRepository(clock,
                    () -> run + "-b" + memIds.incrementAndGet());
            mem.sessions = new InMemoryRuntimeSessionRepository();
            SimpleDs ds = "h2".equals(target)
                    ? SimpleDs.of("jdbc:h2:mem:" + run
                            + ";MODE=MySQL;DB_CLOSE_DELAY=-1;"
                            + "DATABASE_TO_LOWER=TRUE")
                    : SimpleDs.of(target);
            JdbcRuntimeBrokerSchema.initialize(ds);
            World jdbc = new World();
            jdbc.bindings = new JdbcRuntimeBindingRepository(ds,
                    () -> run + "-b" + jdbcIds.incrementAndGet());
            jdbc.sessions = new JdbcRuntimeSessionRepository(ds);
            boolean clean = true;
            for (int i = 0; i < ops; i++) {
                Op op = nextOp(random, mem, run);
                opCounts.merge(op.name, 1L, Long::sum);
                totalOps++;
                String a = op.apply(mem, 0);
                String b = op.apply(jdbc, 1);
                String form = b.startsWith("EX:") ? "throw:" + b.substring(3,
                        Math.min(b.length(), 3 + b.substring(3).indexOf(':') + 1
                                + 28)) : shape(b);
                shapes.merge(op.name + " -> " + form, 1L, Long::sum);
                if ("expireAll".equals(op.name)) {
                    clock.now = clock.now.plus(Duration.ofHours(2));
                    try (Connection c = ds.getConnection();
                            Statement st = c.createStatement()) {
                        st.executeUpdate("UPDATE qwen_runtime_binding SET "
                                + "operation_lease_until = "
                                + "'2000-01-01 00:00:00' WHERE "
                                + "operation_lease_until IS NOT NULL AND "
                                + "tenant_id LIKE '" + run + "-%'");
                    }
                }
                if (!a.equals(b)) {
                    clean = false;
                    String kind = op.name + " | memory=" + shape(a)
                            + " | jdbc=" + shape(b);
                    divergences.merge(kind, 1L, Long::sum);
                    firstExample.putIfAbsent(kind, "seed=" + sequenceSeed
                            + " op#" + i + " " + op.describe + "\n      memory: "
                            + a + "\n      jdbc  : " + b);
                    break; // worlds are no longer in lockstep
                }
            }
            if (clean) {
                cleanSequences++;
            }
        }
        System.out.println("[" + label + "] sequences=" + sequences
                + " ops/sequence<=" + ops + " operations compared="
                + totalOps + " in "
                + (System.currentTimeMillis() - started) / 1000 + " s");
        System.out.println("[" + label + "] op mix: " + opCounts);
        for (Map.Entry<String, Long> entry : shapes.entrySet()) {
            System.out.println(String.format("   %7d  %s", entry.getValue(),
                    entry.getKey()));
        }
        System.out.println("[" + label + "] sequences with zero divergence: "
                + cleanSequences + "/" + sequences);
        for (Map.Entry<String, Long> entry : divergences.entrySet()) {
            System.out.println("[" + label + "] DIVERGENCE x"
                    + entry.getValue() + ": " + entry.getKey());
            System.out.println("    first: "
                    + firstExample.get(entry.getKey()));
        }
    }

    private static String shape(String outcome) {
        if (outcome.startsWith("EX:")) {
            return outcome;
        }
        return outcome.startsWith("OK:null") ? "null" : "value";
    }

    private abstract static class Op {
        final String name;
        final String describe;

        Op(String name, String describe) {
            this.name = name;
            this.describe = describe;
        }

        abstract Object run(World world, int which) throws Exception;

        String apply(World world, int which) {
            try {
                Object result = run(world, which);
                return "OK:" + project(result, world);
            } catch (Exception failure) {
                String message = String.valueOf(failure.getMessage());
                return "EX:" + failure.getClass().getSimpleName() + ":"
                        + message;
            }
        }
    }

    @SuppressWarnings("unchecked")
    private static String project(Object result, World world) {
        if (result == null) {
            return "null";
        }
        if (result instanceof RuntimeBindingRecord) {
            RuntimeBindingRecord record = (RuntimeBindingRecord) result;
            world.bindingHandles.add(record);
            return binding(record);
        }
        if (result instanceof RuntimeSessionRecord) {
            RuntimeSessionRecord record = (RuntimeSessionRecord) result;
            world.sessionHandles.add(record);
            return session(record);
        }
        if (result instanceof List) {
            return ((List<RuntimeBindingRecord>) result).stream()
                    .map(DiffFuzz::binding).sorted()
                    .collect(Collectors.joining(";", "[", "]"));
        }
        return String.valueOf(result);
    }

    private static String instant(Instant value) {
        if (value == null) {
            return "-";
        }
        long delta = Duration.between(BASE, value).toSeconds();
        return delta >= 0 && delta < 100_000 ? value.toString() : "CLOCK";
    }

    private static String binding(RuntimeBindingRecord r) {
        RuntimeLease l = r.getLease();
        return r.getBindingId() + "|" + r.getRequest().getScope().getTenantId()
                + "/" + r.getRequest().getIsolationKey() + "|g"
                + r.getGeneration() + "|" + r.getState() + "|"
                + (l == null ? "-" : l.getRuntimeInstanceId() + ","
                        + l.getEndpoint() + "," + l.getToken() + ","
                        + l.getLeaseId() + "," + l.getEpoch())
                + "|drain=" + r.isDrainRequested() + "|owner="
                + r.getOperationOwner() + "|lease="
                + (r.getOperationLeaseUntil() == null ? "-" : "set")
                + "|og" + r.getOperationGeneration() + "|v" + r.getVersion()
                + "|h=" + instant(r.getLastHealthAt()) + "|a="
                + instant(r.getLastActiveAt());
    }

    private static String session(RuntimeSessionRecord r) {
        return r.getRuntimeSessionId() + "|"
                + r.getSession().getScope().getTenantId() + "|"
                + r.getSession().getHarnessSessionId() + "|"
                + r.getSession().getTurnKind() + "|" + r.getBindingId()
                + "|g" + r.getRuntimeGeneration() + "|" + r.getState()
                + "|v" + r.getVersion() + "|a="
                + instant(r.getLastActiveAt());
    }

    private static Instant someInstant(Random random) {
        // micros precision on purpose; sub-micro rounding is probed separately
        return BASE.plusSeconds(random.nextInt(1000))
                .plusNanos(random.nextInt(1_000_000) * 1000L);
    }

    private static Op nextOp(Random random, World reference, String run) {
        int roll = random.nextInt(100);
        int handleCount = reference.bindingHandles.size();
        int sessionCount = reference.sessionHandles.size();
        if (roll < 12) {
            int r = random.nextInt(requests.length);
            return new Op("findOrCreate", "request#" + r) {
                Object run(World w, int which) {
                    return w.bindings.findOrCreate(requests[r]);
                }
            };
        }
        if (roll < 18) {
            int r = random.nextInt(requests.length);
            return new Op("findActive", "request#" + r) {
                Object run(World w, int which) {
                    return w.bindings.findActive(requests[r]);
                }
            };
        }
        if (roll < 23) {
            int s = random.nextInt(scopes.length);
            String key = random.nextBoolean() ? "iso-a" : "iso-b";
            return new Op("findActiveByIsolationKey", "scope#" + s + " " + key) {
                Object run(World w, int which) {
                    return w.bindings.findActiveByIsolationKey(scopes[s], key);
                }
            };
        }
        if (roll < 28) {
            String id = run + "-b" + (1 + random.nextInt(12));
            return new Op("findById", id) {
                Object run(World w, int which) {
                    return w.bindings.findById(id);
                }
            };
        }
        if (roll < 43) {
            String id = random.nextInt(12) == 0 ? run + "-missing"
                    : run + "-b" + (1 + random.nextInt(8));
            boolean invalidArgs = !Boolean.getBoolean("fuzz.validArgsOnly");
            String owner = invalidArgs && random.nextInt(15) == 0 ? ""
                    : "own-" + random.nextInt(2);
            Duration duration = invalidArgs && random.nextInt(15) == 0
                    ? (random.nextBoolean() ? Duration.ZERO : null)
                    : Duration.ofMinutes(30);
            return new Op("claimOperation", id + " owner='" + owner
                    + "' duration=" + duration) {
                Object run(World w, int which) {
                    return w.bindings.claimOperation(id, owner, duration);
                }
            };
        }
        if (roll < 51) {
            String id = random.nextInt(12) == 0 ? run + "-missing"
                    : run + "-b" + (1 + random.nextInt(8));
            String owner = "own-" + random.nextInt(2);
            long generation = 1 + random.nextInt(3);
            return new Op("renewOperation", id + " " + owner + " og"
                    + generation) {
                Object run(World w, int which) {
                    return w.bindings.renewOperation(id, owner, generation,
                            Duration.ofMinutes(30));
                }
            };
        }
        if (roll < 74 && handleCount > 0) {
            // bias towards fresh handles, but keep stale ones in play
            int h = random.nextInt(3) == 0 ? random.nextInt(handleCount)
                    : handleCount - 1 - random.nextInt(Math.min(3, handleCount));
            int mutation = random.nextInt(8);
            Instant at = someInstant(random);
            return new Op("binding.compareAndSet", "handle#" + h
                    + " mutation#" + mutation) {
                Object run(World w, int which) {
                    RuntimeBindingRecord expected = w.bindingHandles.get(h);
                    RuntimeLease lease = new RuntimeLease("rt-" + mutation,
                            URI.create("http://127.0.0.1:" + (4000 + mutation)),
                            "tok-" + mutation, "lease-" + mutation, mutation);
                    RuntimeBindingRecord replacement;
                    switch (mutation) {
                        case 0:
                            replacement = expected.withState(
                                    RuntimeBindingRecord.State.READY, lease, at);
                            break;
                        case 1:
                            replacement = expected.withState(
                                    RuntimeBindingRecord.State.DRAINING, lease, at);
                            break;
                        case 2:
                            replacement = expected.withState(
                                    RuntimeBindingRecord.State.RELEASED,
                                    expected.getLease(), at);
                            break;
                        case 3:
                            replacement = expected.withState(
                                    RuntimeBindingRecord.State.FAILED, null, at);
                            break;
                        case 4:
                            replacement = expected.withDrainRequested(
                                    !expected.isDrainRequested(), at);
                            break;
                        case 5:
                            replacement = expected.withLastHealthAt(at, at);
                            break;
                        case 6:
                            replacement = expected.withVersion(
                                    expected.getVersion() + 1); // forged
                            break;
                        default:
                            replacement = expected.withState(
                                    RuntimeBindingRecord.State.PROVISIONING,
                                    null, at);
                            break;
                    }
                    return w.bindings.compareAndSet(expected, replacement);
                }
            };
        }
        if (roll < 78) {
            return new Op("expireAll", "all leases expire") {
                Object run(World w, int which) {
                    return "done";
                }
            };
        }
        if (roll < 86) {
            int s = random.nextInt(2);
            String id = "sess-" + random.nextInt(4);
            String harness = "h-" + (random.nextInt(8) == 0 ? "other" : "main");
            String binding = run + "-b" + (1 + random.nextInt(3));
            long generation = 1 + random.nextInt(2);
            boolean bad = random.nextInt(10) == 0;
            return new Op("session.findOrCreate", id + " scope#" + s + " "
                    + harness + " " + binding + " g" + generation
                    + (bad ? " (non-ACQUIRING)" : "")) {
                Object run(World w, int which) {
                    return w.sessions.findOrCreate(new RuntimeSessionRecord(
                            new RuntimeSession(harness, id, "bootstrap",
                                    scopes[s]), binding, generation,
                            bad ? RuntimeSessionRecord.State.READY
                                    : RuntimeSessionRecord.State.ACQUIRING,
                            0, BASE));
                }
            };
        }
        if (roll < 90) {
            int s = random.nextInt(2);
            String id = "sess-" + random.nextInt(5);
            return new Op("session.findById", id + " scope#" + s) {
                Object run(World w, int which) {
                    return w.sessions.findById(scopes[s], id);
                }
            };
        }
        if (roll < 96 && sessionCount > 0) {
            int h = random.nextInt(sessionCount);
            RuntimeSessionRecord.State next = RuntimeSessionRecord.State
                    .values()[random.nextInt(5)];
            Instant at = someInstant(random);
            return new Op("session.compareAndSet", "handle#" + h + " -> "
                    + next) {
                Object run(World w, int which) {
                    RuntimeSessionRecord expected = w.sessionHandles.get(h);
                    return w.sessions.compareAndSet(expected,
                            expected.withState(next, at));
                }
            };
        }
        String binding = run + "-b" + (1 + random.nextInt(3));
        long generation = 1 + random.nextInt(2);
        return new Op("session.countActiveByBinding", binding + " g"
                + generation) {
            Object run(World w, int which) {
                return w.sessions.countActiveByBinding(binding, generation);
            }
        };
    }
}
