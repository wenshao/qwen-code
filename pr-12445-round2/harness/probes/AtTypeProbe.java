package com.alibaba.qwen.code.runtimebroker;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONReader;
import com.alibaba.fastjson2.JSONWriter;
import com.alibaba.fastjson2.TypeReference;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Non-string "@type" members: does the codec (head vs patch) keep them? */
public class AtTypeProbe {
    static final TypeReference<Map<String, Object>> MAP_TYPE = new TypeReference<>() { };

    static Map<String, Object> m(Object... kv) {
        Map<String, Object> out = new LinkedHashMap<>();
        for (int i = 0; i < kv.length; i += 2) out.put((String) kv[i], kv[i + 1]);
        return out;
    }

    public static void main(String[] a) {
        Object[][] cases = {
            {"@type string, first", m("@type", "Person", "name", "Ada")},
            {"@type array, first", m("@type", List.of("Product", "Thing"), "name", "Widget")},
            {"@type array, not first", m("name", "Widget", "@type", List.of("Product", "Thing"))},
            {"@type boolean, first", m("@type", false, "k", 1)},
            {"@type number, first", m("@type", 7, "k", 1)},
            {"@type object, first", m("@type", m("a", 1), "k", 1)},
            {"@type null, first", m("@type", null, "k", 1)},
        };
        for (Object[] c : cases) {
            Map<String, Object> in = m("executionStatus", "success", "output", c[1]);
            Map<String, Object> safe = BrokerValues.immutableMap(in);
            String json = JSON.toJSONString(safe, JSONWriter.Feature.WriteNulls, JSONWriter.Feature.WriteBigDecimalAsPlain);
            System.out.printf("%-26s json=%s%n", c[0], json);
            for (String arm : new String[] {"head reader", "patched reader"}) {
                String out;
                try {
                    Map<String, Object> back = arm.startsWith("head") ? JSON.parseObject(json, MAP_TYPE)
                            : JSON.parseObject(json, MAP_TYPE, JSONReader.Feature.DisableReferenceDetect);
                    Map<String, Object> safeBack = BrokerValues.immutableMap(back);
                    Object o = safeBack.get("output");
                    Object t = o instanceof Map<?, ?> om ? om.get("@type") : null;
                    out = (BrokerValues.sameJsonMap(safe, safeBack) ? "same   " : "CHANGED") + " @type=" + t + " (" + (t == null ? "null" : t.getClass().getSimpleName()) + ")";
                } catch (Throwable e) {
                    out = "THROWS " + e.getClass().getSimpleName() + ": " + e.getMessage();
                }
                System.out.printf("    %-15s %s%n", arm, out);
            }
        }
    }
}
