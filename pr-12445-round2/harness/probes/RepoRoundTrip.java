package com.alibaba.qwen.code.runtimebroker;

import java.math.BigDecimal;
import java.math.BigInteger;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Random;
import java.util.TreeMap;
import java.util.UUID;
import javax.sql.DataSource;
import org.h2.jdbcx.JdbcDataSource;

/**
 * Real JdbcToolExecutionRepository round trip (whatever classes are on the classpath: head or fix).
 * Each payload goes in twice: as an extra reference member (read back through findByIdempotencyKey, compared with
 * sameRequest exactly as RuntimeBrokerService.createExecution does), and as a settled result (CAS, then read back).
 */
public class RepoRoundTrip {
    static DataSource dataSource(String db) {
        if (db.equals("h2")) {
            JdbcDataSource h2 = new JdbcDataSource();
            h2.setURL("jdbc:h2:mem:rt-" + UUID.randomUUID() + ";MODE=MySQL;DB_CLOSE_DELAY=-1;DATABASE_TO_LOWER=TRUE");
            return h2;
        }
        return new DriverManagerDataSource(db, "root", "");
    }

    static Map<String, Object> m(Object... kv) {
        Map<String, Object> out = new LinkedHashMap<>();
        for (int i = 0; i < kv.length; i += 2) out.put((String) kv[i], kv[i + 1]);
        return out;
    }

    static int seq = 0;
    static String run = UUID.randomUUID().toString().substring(0, 8);

    static String[] roundTrip(JdbcToolExecutionRepository repo, DataSource ds, Object payload) {
        String p = run + "-" + (seq++);
        Map<String, Object> reference = m("sessionId", p + "-rs", "promptId", p + "-turn", "callId", p + "-call",
                "argsDigest", p + "-digest", "extra", payload);
        String refOutcome;
        String resOutcome;
        ToolExecutionRecord candidate = ToolExecutionRecord.prepared(p + "-exec", p + "-key", p + "-binding", 1,
                p + "-harness", p + "-rs", p + "-turn", p + "-call", p + "-digest", reference);
        try {
            repo.findOrCreate(candidate);
            ToolExecutionRecord back = new JdbcToolExecutionRepository(ds).findByIdempotencyKey(p + "-key");
            refOutcome = back.sameRequest(candidate) ? "same" : "CHANGED(retry->409)";
        } catch (Throwable t) {
            refOutcome = "THROWS " + t.getClass().getSimpleName();
        }
        String q = p + "r";
        ToolExecutionRecord plain = ToolExecutionRecord.prepared(q + "-exec", q + "-key", q + "-binding", 1,
                q + "-harness", q + "-rs", q + "-turn", q + "-call", q + "-digest",
                m("sessionId", q + "-rs", "promptId", q + "-turn", "callId", q + "-call", "argsDigest", q + "-digest"));
        Map<String, Object> result = m("executionStatus", "success", "output", payload);
        try {
            repo.findOrCreate(plain);
            ToolExecutionRecord claim = repo.claimDispatch(q + "-exec", "owner", Duration.ofMinutes(5));
            ToolExecutionRecord settled = repo.compareAndSet(claim, claim.withResult(result, 1, Instant.now()),
                    "owner", claim.getDispatchGeneration());
            if (settled == null) return new String[] {refOutcome, "CAS-null"};
            ToolExecutionRecord back = new JdbcToolExecutionRepository(ds).findByExecutionCallId(q + "-exec");
            resOutcome = BrokerValues.sameJsonMap(BrokerValues.immutableMap(result), back.getResult()) ? "same" : "CHANGED";
        } catch (Throwable t) {
            resOutcome = "THROWS " + t.getClass().getSimpleName();
        }
        return new String[] {refOutcome, resOutcome};
    }

    public static void main(String[] args) {
        String db = args[0];
        DataSource ds = dataSource(db);
        JdbcRuntimeBrokerSchema.initialize(ds);
        JdbcToolExecutionRepository repo = new JdbcToolExecutionRepository(ds);
        Object[][] targeted = {
            {"JSON Schema {\"$ref\":\"#/definitions/User\"}", m("$ref", "#/definitions/User")},
            {"OpenAPI {\"$ref\":\"./common.yaml#/components/schemas/Error\"}", m("$ref", "./common.yaml#/components/schemas/Error")},
            {"{\"$ref\":\"$.promptId\"}", m("$ref", "$.promptId")},
            {"{\"$ref\":\"@\"}", m("$ref", "@")},
            {"{\"$ref\":\"..\"}", m("child", m("$ref", ".."))},
            {"{\"$ref\":\"$\"}", m("$ref", "$")},
            {"BigDecimal 1E+400", new BigDecimal("1E+400")},
            {"BigDecimal 1.2345678901234567890123E+30", new BigDecimal("1.2345678901234567890123E+30")},
            {"Float 162544.13f", 162544.13f},
            {"Double -1363683.0538119469", -1363683.0538119469d},
            {"JSON-LD {\"@type\":\"Person\"}", m("@type", "Person", "name", "Ada")},
            {"JSON-LD {\"@type\":[\"Product\",\"Thing\"]}", m("@type", List.of("Product", "Thing"), "name", "Widget")},
            {"{\"@type\":null, ...}", m("@type", null, "name", "Widget")},
            {"emoji + CJK", "\uD83D\uDE80 \u6D4B\u8BD5"},
        };
        System.out.printf("db=%s%n%-58s %-22s %-22s%n", db.startsWith("jdbc:") ? db.replaceAll("\\?.*", "") : db,
                "payload", "as reference member", "as settled result");
        for (Object[] t : targeted) {
            String[] o = roundTrip(repo, ds, t[1]);
            System.out.printf("%-58s %-22s %-22s%n", t[0], o[0], o[1]);
        }
        int n = Integer.getInteger("n", 3000);
        Random r = new Random(12458);
        Map<String, Integer> ref = new TreeMap<>();
        Map<String, Integer> res = new TreeMap<>();
        for (int i = 0; i < n; i++) {
            Object payload = random(r, 0);
            String[] o = roundTrip(repo, ds, payload);
            ref.merge(o[0], 1, Integer::sum);
            res.merge(o[1], 1, Integer::sum);
        }
        System.out.println("random JSON payloads n=" + n + " (seed 12458)");
        System.out.println("   as reference member: " + ref);
        System.out.println("   as settled result  : " + res);
    }

    static Object random(Random r, int depth) {
        switch (r.nextInt(depth > 3 ? 9 : 12)) {
            case 0: return null;
            case 1: return r.nextBoolean();
            case 2: return "s" + r.nextInt(1000);
            case 3: return r.nextLong();
            case 4: { double d = Double.longBitsToDouble(r.nextLong()); return Double.isFinite(d) ? d : 1.5d; }
            case 5: { float f = Float.intBitsToFloat(r.nextInt()); return Float.isFinite(f) ? f : 2.5f; }
            case 6: return new BigInteger(r.nextInt(200) + 1, r);
            case 7: return new BigDecimal(new BigInteger(r.nextInt(100) + 1, r), r.nextInt(80) - 40);
            case 8: return m("$ref", new String[] {"#/definitions/x", "$", "$.promptId", "..", "./a.yaml#/b"}[r.nextInt(5)]);
            case 9: case 10: {
                Map<String, Object> map = new LinkedHashMap<>();
                for (int k = 0, s = r.nextInt(4); k < s; k++) map.put("k" + k, random(r, depth + 1));
                return map;
            }
            default: {
                List<Object> list = new ArrayList<>();
                for (int k = 0, s = r.nextInt(4); k < s; k++) list.add(random(r, depth + 1));
                return list;
            }
        }
    }
}
