package com.alibaba.qwen.code.runtimebroker;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONReader;
import com.alibaba.fastjson2.JSONWriter;
import com.alibaba.fastjson2.TypeReference;
import java.math.BigDecimal;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Function;

/** Which fastjson2 reader keeps "$ref" and "@type" members as plain data? */
public class ReaderVariants {
    static final TypeReference<Map<String, Object>> MAP_TYPE = new TypeReference<>() { };
    static Map<String, Object> m(Object... kv) {
        Map<String, Object> out = new LinkedHashMap<>();
        for (int i = 0; i < kv.length; i += 2) out.put((String) kv[i], kv[i + 1]);
        return out;
    }
    @SuppressWarnings("unchecked")
    static final Object[][] READERS = {
        {"TypeReference (66d1aedb)", (Function<String, Map<String, Object>>) s -> JSON.parseObject(s, MAP_TYPE)},
        {"TypeReference + DisableReferenceDetect", (Function<String, Map<String, Object>>) s -> JSON.parseObject(s, MAP_TYPE, JSONReader.Feature.DisableReferenceDetect)},
        {"Map.class + DisableReferenceDetect", (Function<String, Map<String, Object>>) s -> (Map<String, Object>) JSON.parseObject(s, Map.class, JSONReader.Feature.DisableReferenceDetect)},
        {"parseObject(String) + DisableReferenceDetect", (Function<String, Map<String, Object>>) s -> JSON.parseObject(s, JSONReader.Feature.DisableReferenceDetect)},
    };
    public static void main(String[] a) {
        Object[][] cases = {
            {"$ref $", m("$ref", "$")}, {"$ref @", m("$ref", "@")}, {"$ref ..", m("x", m("$ref", ".."))},
            {"$ref $.executionStatus", m("$ref", "$.executionStatus")}, {"$ref ./common.yaml#/x", m("$ref", "./common.yaml#/x")},
            {"@type string", m("@type", "Person", "n", 1)}, {"@type array", m("@type", List.of("Product", "Thing"), "n", 1)},
            {"@type false", m("@type", false, "n", 1)}, {"@type 7", m("@type", 7, "n", 1)}, {"@type object", m("@type", m("a", 1), "n", 1)},
            {"@type null", m("@type", null, "n", 1)}, {"@type java.util.HashMap", m("@type", "java.util.HashMap", "n", 1)},
            {"nested @type array in list", List.of(m("@type", List.of("A"), "n", 1))},
            {"BigDecimal 1E+400 (plain)", new BigDecimal("1E+400")}, {"null value", null},
        };
        System.out.printf("%-30s", "payload (as output, writer = WriteNulls + WriteBigDecimalAsPlain)");
        for (Object[] r : READERS) System.out.printf(" | %-26s", ((String) r[0]).length() > 26 ? ((String) r[0]).substring(0, 26) : r[0]);
        System.out.println();
        int[] fails = new int[READERS.length];
        for (Object[] c : cases) {
            Map<String, Object> in = m("executionStatus", "success", "output", c[1]);
            Map<String, Object> safe = BrokerValues.immutableMap(in);
            String json = JSON.toJSONString(safe, JSONWriter.Feature.WriteNulls, JSONWriter.Feature.WriteBigDecimalAsPlain);
            System.out.printf("%-30s", c[0]);
            for (int i = 0; i < READERS.length; i++) {
                String o;
                try {
                    @SuppressWarnings("unchecked")
                    Map<String, Object> back = ((Function<String, Map<String, Object>>) READERS[i][1]).apply(json);
                    o = BrokerValues.sameJsonMap(safe, BrokerValues.immutableMap(back)) ? "same" : "CHANGED";
                } catch (Throwable t) { o = "THROWS " + t.getClass().getSimpleName(); }
                if (!o.equals("same")) fails[i]++;
                System.out.printf(" | %-26s", o);
            }
            System.out.println();
        }
        System.out.printf("%-30s", "failures");
        for (int f : fails) System.out.printf(" | %-26d", f);
        System.out.println();
    }
}
