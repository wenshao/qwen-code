package com.alibaba.qwen.code.runtimebroker;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONReader;
import com.alibaba.fastjson2.JSONWriter;
import com.alibaba.fastjson2.TypeReference;
import java.math.BigDecimal;
import java.math.BigInteger;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Random;
import java.util.TreeMap;

/** PR codec vs candidate codec: targeted $ref values, then a random-tree fuzz. */
public class CodecProbe2 {
    static final TypeReference<Map<String, Object>> MAP_TYPE = new TypeReference<>() { };

    interface Codec { Map<String, Object> read(String s); }
    static final Codec PR = s -> JSON.parseObject(s, MAP_TYPE);
    static final Codec FIX = s -> JSON.parseObject(s, MAP_TYPE,
            JSONReader.Feature.DisableReferenceDetect,
            JSONReader.Feature.UseBigDecimalForDoubles);

    static String write(Map<String, Object> v) { return JSON.toJSONString(v, JSONWriter.Feature.WriteNulls); }

    static String outcome(Codec codec, Map<String, Object> in) {
        try {
            Map<String, Object> safe = BrokerValues.immutableMap(in);
            Map<String, Object> back = BrokerValues.immutableMap(codec.read(write(safe)));
            return BrokerValues.sameJsonMap(safe, back) ? "same" : "CHANGED";
        } catch (Throwable t) {
            return "THROWS " + t.getClass().getSimpleName();
        }
    }

    static Map<String, Object> m(Object... kv) {
        Map<String, Object> out = new LinkedHashMap<>();
        for (int i = 0; i < kv.length; i += 2) out.put((String) kv[i], kv[i + 1]);
        return out;
    }

    public static void main(String[] args) {
        String[] refs = {"#/definitions/User", "#/$defs/User", "./common.yaml#/components/schemas/Error",
                "definitions.json", "https://example.com/schema.json", "$defs/User", "$.a", "$['a']",
                "$", "@", "..", "../x", "$.a[0]", "$.missing"};
        System.out.printf("%-44s %-22s %-22s%n", "payload (value of output)", "PR codec", "fixed codec");
        for (String ref : refs) {
            Map<String, Object> in = m("executionStatus", "success", "a", m("x", 1), "output", m("$ref", ref));
            System.out.printf("%-44s %-22s %-22s%n", "{\"$ref\":\"" + ref + "\"}", outcome(PR, in), outcome(FIX, in));
        }
        Map<String, Object> sib = m("executionStatus", "success", "output", m("description", "d", "$ref", "$"));
        System.out.printf("%-44s %-22s %-22s%n", "{\"description\":\"d\",\"$ref\":\"$\"}", outcome(PR, sib), outcome(FIX, sib));
        BigDecimal[] decs = {new BigDecimal("1E+3"), new BigDecimal("1.2345678901234567890123E+30"),
                new BigDecimal("1E+400"), new BigDecimal("-7.5E-20"), new BigDecimal("123.456")};
        for (BigDecimal d : decs) {
            Map<String, Object> in = m("executionStatus", "success", "n", d);
            System.out.printf("%-44s %-22s %-22s%n", "BigDecimal " + d, outcome(PR, in), outcome(FIX, in));
        }

        // Random JSON-tree fuzz. Values drawn from everything BrokerValues accepts.
        long seed = Long.getLong("seed", 12458L);
        int n = Integer.getInteger("n", 200000);
        Random r = new Random(seed);
        Map<String, Integer> pr = new TreeMap<>();
        Map<String, Integer> fix = new TreeMap<>();
        Map<String, String> firstPr = new TreeMap<>();
        for (int i = 0; i < n; i++) {
            Map<String, Object> in = m("executionStatus", "success", "output", tree(r, 0));
            String a = outcome(PR, in);
            String b = outcome(FIX, in);
            pr.merge(a, 1, Integer::sum);
            fix.merge(b, 1, Integer::sum);
            if (!a.equals("same")) firstPr.putIfAbsent(a, abbreviate(write(BrokerValues.immutableMap(in))));
        }
        System.out.println();
        System.out.println("fuzz seed=" + seed + " trees=" + n);
        System.out.println("  PR codec    : " + pr);
        System.out.println("  fixed codec : " + fix);
        firstPr.forEach((k, v) -> System.out.println("  first PR " + k + ": " + v));
    }

    static String abbreviate(String s) { return s.length() > 160 ? s.substring(0, 160) + "..." : s; }

    static Object tree(Random r, int depth) {
        int pick = r.nextInt(depth > 4 ? 10 : 14);
        switch (pick) {
            case 0: return null;
            case 1: return r.nextBoolean();
            case 2: return "s" + r.nextInt(100);
            case 3: return r.nextInt();
            case 4: return r.nextLong();
            case 5: { double d = Double.longBitsToDouble(r.nextLong()); return Double.isFinite(d) ? d : 0.5d; }
            case 6: { float f = Float.intBitsToFloat(r.nextInt()); return Float.isFinite(f) ? f : 0.25f; }
            case 7: return new BigInteger(r.nextInt(200) + 1, r);
            case 8: return new BigDecimal(new BigInteger(r.nextInt(120) + 1, r), r.nextInt(80) - 40);
            case 9: return r.nextInt(8) == 0 ? "$" : "$.k" + r.nextInt(3);
            case 10: case 11: {
                Map<String, Object> map = new LinkedHashMap<>();
                int size = r.nextInt(4);
                if (r.nextInt(6) == 0) map.put("$ref", r.nextBoolean() ? "#/definitions/x" : "$.k0");
                for (int k = 0; k < size; k++) map.put("k" + k, tree(r, depth + 1));
                return map;
            }
            default: {
                List<Object> list = new ArrayList<>();
                int size = r.nextInt(4);
                for (int k = 0; k < size; k++) list.add(tree(r, depth + 1));
                return list;
            }
        }
    }
}
