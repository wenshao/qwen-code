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
import java.util.function.Function;

/** Four codec arms, random JSON trees; classifies every non-identical round trip by leaf kind. */
public class CodecArms {
    static final TypeReference<Map<String, Object>> MAP_TYPE = new TypeReference<>() { };
    record Arm(String name, Function<Map<String, Object>, String> write, Function<String, Map<String, Object>> read) { }

    static final Arm[] ARMS = {
        new Arm("PR codec", v -> JSON.toJSONString(v, JSONWriter.Feature.WriteNulls), s -> JSON.parseObject(s, MAP_TYPE)),
        new Arm("A  +DisableReferenceDetect", v -> JSON.toJSONString(v, JSONWriter.Feature.WriteNulls),
                s -> JSON.parseObject(s, MAP_TYPE, JSONReader.Feature.DisableReferenceDetect)),
        new Arm("B  A +UseBigDecimalForDoubles", v -> JSON.toJSONString(v, JSONWriter.Feature.WriteNulls),
                s -> JSON.parseObject(s, MAP_TYPE, JSONReader.Feature.DisableReferenceDetect, JSONReader.Feature.UseBigDecimalForDoubles)),
        new Arm("C  A +WriteBigDecimalAsPlain", v -> JSON.toJSONString(v, JSONWriter.Feature.WriteNulls, JSONWriter.Feature.WriteBigDecimalAsPlain),
                s -> JSON.parseObject(s, MAP_TYPE, JSONReader.Feature.DisableReferenceDetect)),
    };

    static String kind = "";

    static String outcome(Arm arm, Map<String, Object> in) {
        try {
            Map<String, Object> safe = BrokerValues.immutableMap(in);
            Map<String, Object> back = BrokerValues.immutableMap(arm.read.apply(arm.write.apply(safe)));
            return BrokerValues.sameJsonMap(safe, back) ? "same" : "CHANGED";
        } catch (Throwable t) {
            return "THROWS " + t.getClass().getSimpleName();
        }
    }

    public static void main(String[] args) {
        long seed = Long.getLong("seed", 12458L);
        int n = Integer.getInteger("n", 100000);
        String[] kinds = {"Double", "Float", "BigInteger", "BigDecimal", "$ref-map", "Integer/Long/str/bool/null"};
        for (int k = 0; k < kinds.length; k++) {
            Random r = new Random(seed + k);
            List<Map<String, Integer>> tallies = new ArrayList<>();
            Map<String, String> example = new LinkedHashMap<>();
            for (Arm arm : ARMS) tallies.add(new TreeMap<>());
            for (int i = 0; i < n; i++) {
                Map<String, Object> in = new LinkedHashMap<>();
                in.put("executionStatus", "success");
                in.put("a", Map.of("x", 1));
                in.put("output", leaf(r, k));
                for (int a = 0; a < ARMS.length; a++) {
                    String o = outcome(ARMS[a], in);
                    tallies.get(a).merge(o, 1, Integer::sum);
                    if (!o.equals("same")) example.putIfAbsent(ARMS[a].name, o + " " + ARMS[0].write.apply(BrokerValues.immutableMap(in)));
                }
            }
            System.out.println("leaf kind " + kinds[k] + "  (" + n + " payloads, seed " + (seed + k) + ")");
            for (int a = 0; a < ARMS.length; a++) System.out.printf("   %-32s %s%n", ARMS[a].name, tallies.get(a));
            example.forEach((arm, e) -> System.out.printf("   e.g. %-27s %s%n", arm, e.length() > 150 ? e.substring(0, 150) + "..." : e));
        }
    }

    static Object leaf(Random r, int k) {
        switch (k) {
            case 0: { double d = Double.longBitsToDouble(r.nextLong()); return Double.isFinite(d) ? d : 0.5d; }
            case 1: { float f = Float.intBitsToFloat(r.nextInt()); return Float.isFinite(f) ? f : 0.25f; }
            case 2: return new BigInteger(r.nextInt(300) + 1, r).multiply(BigInteger.valueOf(r.nextBoolean() ? 1 : -1));
            case 3: return new BigDecimal(new BigInteger(r.nextInt(150) + 1, r), r.nextInt(120) - 60);
            case 4: {
                String[] refs = {"$", "@", "..", "$.a", "$.a.x", "$['a']", "#/definitions/x", "./x.yaml#/y", "../x", "$defs/x"};
                return Map.of("$ref", refs[r.nextInt(refs.length)]);
            }
            default: {
                switch (r.nextInt(5)) {
                    case 0: return r.nextInt();
                    case 1: return r.nextLong();
                    case 2: { StringBuilder s = new StringBuilder(); for (int i = 0; i < 6; i++) s.append((char) r.nextInt(0x3000)); return s.toString(); }
                    case 3: return r.nextBoolean();
                    default: return null;
                }
            }
        }
    }
}
