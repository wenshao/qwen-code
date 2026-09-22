package com.alibaba.qwen.code.runtimebroker;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONWriter;
import com.alibaba.fastjson2.TypeReference;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Codec-only probe: the exact toJson/fromJson pair the PR uses. */
public class CodecProbe {
    static final TypeReference<Map<String, Object>> MAP_TYPE = new TypeReference<>() { };

    static String toJson(Map<String, Object> v) { return JSON.toJSONString(v, JSONWriter.Feature.WriteNulls); }
    static Map<String, Object> fromJson(String s) { return JSON.parseObject(s, MAP_TYPE); }

    static void run(String label, Map<String, Object> in) {
        String json = null;
        try {
            Map<String, Object> safe = BrokerValues.immutableMap(in);
            json = toJson(safe);
            Map<String, Object> back = fromJson(json);
            Map<String, Object> safeBack = BrokerValues.immutableMap(back);
            boolean same = BrokerValues.sameJsonMap(safe, safeBack);
            System.out.printf("%-34s same=%-5s json=%s%n      back=%s%n", label, same, abbreviate(json), abbreviate(String.valueOf(safeBack)));
        } catch (Throwable t) {
            System.out.printf("%-34s THROWS %s: %s%n      json=%s%n", label, t.getClass().getName(), abbreviate(String.valueOf(t.getMessage())), abbreviate(String.valueOf(json)));
        }
    }

    static String abbreviate(String s) { return s.length() > 150 ? s.substring(0, 150) + "..." : s; }

    static Map<String, Object> m(Object... kv) {
        Map<String, Object> out = new LinkedHashMap<>();
        for (int i = 0; i < kv.length; i += 2) out.put((String) kv[i], kv[i + 1]);
        return out;
    }

    public static void main(String[] args) {
        run("jsonld @type nested", m("executionStatus", "success", "output", m("@type", "Person", "name", "Ada")));
        run("jsonld @type top-level", m("@type", "Person", "executionStatus", "success"));
        run("@type java class", m("executionStatus", "success", "output", m("@type", "java.util.HashMap", "a", 1)));
        run("@context+@type", m("executionStatus", "success", "output", m("@context", "https://schema.org", "@type", "Article")));
        run("jsonschema $ref #/defs", m("executionStatus", "success", "schema", m("$ref", "#/definitions/User")));
        run("$ref $.path", m("executionStatus", "success", "a", m("x", 1), "b", m("$ref", "$.a")));
        run("$ref ..", m("executionStatus", "success", "a", m("child", m("$ref", ".."))));
        run("$ref @", m("executionStatus", "success", "a", m("$ref", "@")));
        run("$ref $", m("executionStatus", "success", "a", m("$ref", "$")));
        run("$ref in list", m("executionStatus", "success", "a", List.of(m("$ref", "$.executionStatus"))));
        run("$ref with sibling", m("executionStatus", "success", "a", m("$ref", "#/x", "description", "d")));
        run("BigDecimal 1E+400", m("executionStatus", "success", "n", new java.math.BigDecimal("1E+400")));
        run("BigDecimal 1E-400", m("executionStatus", "success", "n", new java.math.BigDecimal("1E-400")));
        run("BigDecimal 40 digits", m("executionStatus", "success", "n", new java.math.BigDecimal("0.1000000000000000055511151231257827021")));
        run("BigInteger 10^40", m("executionStatus", "success", "n", java.math.BigInteger.TEN.pow(40)));
        run("Long.MIN", m("executionStatus", "success", "n", Long.MIN_VALUE));
        run("float 0.1f", m("executionStatus", "success", "n", 0.1f));
        run("float 3.4e38f", m("executionStatus", "success", "n", Float.MAX_VALUE));
        run("double 1e308", m("executionStatus", "success", "n", 1e308));
        run("double MIN_VALUE", m("executionStatus", "success", "n", Double.MIN_VALUE));
        run("double -0.0", m("executionStatus", "success", "n", -0.0d));
        run("lone surrogate", m("executionStatus", "success", "s", "a\uD800b"));
        run("NUL + controls", m("executionStatus", "success", "s", "a\u0000b\u001f "));
        run("empty key", m("executionStatus", "success", "", "v"));
        run("null value", m("executionStatus", "success", "n", null));
        StringBuilder deep = new StringBuilder();
        Map<String, Object> nest = m("leaf", 1);
        for (int i = 0; i < 3000; i++) nest = m("n", nest);
        run("nesting 3000", m("executionStatus", "success", "deep", nest));
        Map<String, Object> nest2 = m("leaf", 1);
        for (int i = 0; i < 600; i++) nest2 = m("n", nest2);
        run("nesting 600", m("executionStatus", "success", "deep", nest2));
    }
}
