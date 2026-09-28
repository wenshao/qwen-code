package com.alibaba.qwen.code.runtimebroker;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONReader;
import com.alibaba.fastjson2.JSONWriter;
import java.math.BigDecimal;
import java.math.BigInteger;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.function.Supplier;

/**
 * Codec-level probe run against one build's target/classes. For each value:
 * (1) does the shared boundary BrokerValues.immutableMap accept it, and
 * (2) if accepted, does the JdbcToolExecutionRepository writer/reader pair
 * round-trip it (toJson = WriteNulls + WriteBigDecimalAsPlain, fromJson =
 * DisableReferenceDetect), i.e. would the persisted row be readable.
 */
public final class CodecProbe {
    static String describe(Object v) {
        if (v instanceof BigDecimal d) {
            return "BigDecimal(scale=" + d.scale() + ", precision=" + d.precision() + ")";
        }
        if (v instanceof BigInteger i) {
            return "BigInteger(digits=" + i.abs().toString().length() + ")";
        }
        return v == null ? "null" : v.getClass().getSimpleName() + "(" + v + ")";
    }

    static String boundary(Object value) {
        try {
            BrokerValues.immutableMap(Map.of("v", value));
            return "ACCEPT";
        } catch (IllegalArgumentException e) {
            return "REJECT(" + e.getMessage() + ")";
        }
    }

    static String roundTrip(Object value) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("v", value);
        String json;
        try {
            json = JSON.toJSONString(m, JSONWriter.Feature.WriteNulls,
                    JSONWriter.Feature.WriteBigDecimalAsPlain);
        } catch (RuntimeException e) {
            return "WRITE-FAIL " + e.getClass().getSimpleName() + ": " + e.getMessage();
        }
        try {
            Map<String, Object> back = JSON.parseObject(json,
                    JSONReader.Feature.DisableReferenceDetect);
            Object b = back.get("v");
            boolean same = new BigDecimal(value.toString()).compareTo(new BigDecimal(b.toString())) == 0;
            return "READ-OK len=" + json.length() + " as " + describe(b) + " equal=" + same;
        } catch (RuntimeException e) {
            return "READ-FAIL len=" + json.length() + " " + e.getClass().getSimpleName() + ": " + e.getMessage();
        }
    }

    static void row(String label, Supplier<Object> s) {
        Object v = s.get();
        String b = boundary(v);
        String rt = b.startsWith("ACCEPT") ? roundTrip(v) : "(not persisted)";
        System.out.printf("%-34s | %-40s | %-60s | %s%n", label, describe(v), b, rt);
    }

    static void parse(String label, String literal) {
        String json = "{\"v\":" + literal + "}";
        String codec;
        try {
            Map<String, Object> m = JsonCodec.parseObject(json.getBytes(), "probe");
            codec = "OK " + describe(m.get("v"));
        } catch (RuntimeBrokerException e) {
            codec = e.getStatusCode() + " " + e.getCode() + " cause=" + (e.getCause() == null ? "-" : e.getCause().getMessage());
        } catch (IllegalArgumentException e) {
            codec = "IAE " + e.getMessage();
        }
        String transport;
        try {
            Map<String, Object> m = BrokerValues.immutableMap(JSON.parseObject(json,
                    JSONReader.Feature.DisableReferenceDetect,
                    JSONReader.Feature.UseBigDecimalForDoubles,
                    JSONReader.Feature.UseBigDecimalForFloats));
            Object v = m.get("v");
            transport = "OK " + describe(v) + " -> jdbc " + roundTrip(v);
        } catch (RuntimeException e) {
            transport = "FAIL " + e.getClass().getSimpleName() + ": " + e.getMessage();
        }
        System.out.printf("%-28s | inbound JsonCodec: %-80s | worker-response reader: %s%n", label, codec, transport);
    }

    public static void main(String[] args) {
        System.out.println("## arm=" + args[0] + " fastjson2=" + JSON.VERSION + " java=" + System.getProperty("java.version"));
        System.out.println("## A. shared boundary + JDBC writer/reader round trip");
        row("1E+2048 (scale -2048)", () -> new BigDecimal("1E+2048"));
        row("1E+2049 (scale -2049)", () -> new BigDecimal("1E+2049"));
        row("1E+9999 (scale -9999)", () -> new BigDecimal("1E+9999"));
        row("1E+10000 (scale -10000)", () -> new BigDecimal("1E+10000"));
        row("1E+100000 (scale -100000)", () -> new BigDecimal("1E+100000"));
        row("unscaled 1, scale MIN_VALUE", () -> new BigDecimal(BigInteger.ONE, Integer.MIN_VALUE));
        row("0.1{2048} (scale 2048)", () -> new BigDecimal("0." + "1".repeat(2048)));
        row("0.1{2049} (scale 2049)", () -> new BigDecimal("0." + "1".repeat(2049)));
        row("1E+400 (existing contract)", () -> new BigDecimal("1E+400"));
        System.out.println("## B. values inside the +-2048 scale bound whose plain form exceeds the reader's digit budget");
        row("9{7953} x 10^2048 (scale -2048)", () -> new BigDecimal(new BigInteger("9".repeat(7953)), -2048));
        row("9{7952} x 10^2048 (scale -2048)", () -> new BigDecimal(new BigInteger("9".repeat(7952)), -2048));
        row("10^20000 / 10^2048 (scale 2048)", () -> new BigDecimal(BigInteger.TEN.pow(20000), 2048));
        row("BigDecimal 10^10000 (scale 0)", () -> new BigDecimal(BigInteger.TEN.pow(10000)));
        row("BigInteger 10^9999 (10000 digits)", () -> BigInteger.TEN.pow(9999));
        row("BigInteger 10^10000 (10001 digits)", () -> BigInteger.TEN.pow(10000));
        row("BigInteger 10^100000", () -> BigInteger.TEN.pow(100000));
        System.out.println("## C. wire literals: inbound HTTP request codec vs worker-response reader (HttpRuntimeTransport)");
        parse("1E+300", "1E+300");
        parse("1E+400", "1E+400");
        parse("1E+2048", "1E+2048");
        parse("1E+2049", "1E+2049");
        parse("1E+5000", "1E+5000");
        parse("1E+20000", "1E+20000");
        parse("1E+100000", "1E+100000");
        parse("1.5E+20000", "1.5E+20000");
        parse("plain 5000 digits", "1" + "0".repeat(4999));
        parse("plain 10001 digits", "1" + "0".repeat(10000));
        System.out.println("## D. RuntimeResourceHandle (JsonCodec default writer, JsonCodec reader)");
        for (String lit : new String[] {"1E+300", "1E+400", "1E+2048", "1E+2049", "1E+100000"}) {
            String out;
            try {
                RuntimeResourceHandle h = new RuntimeResourceHandle("probe", 1, Map.of("v", new BigDecimal(lit)));
                String json = h.toJson();
                try {
                    RuntimeResourceHandle back = RuntimeResourceHandle.fromJson("probe", 1, json);
                    out = "stored " + json + " -> read OK " + describe(back.getValue().get("v"));
                } catch (RuntimeException e) {
                    out = "stored " + json + " -> READ-FAIL " + e.getClass().getSimpleName() + ": " + e.getMessage()
                            + (e.getCause() == null ? "" : " / " + e.getCause().getMessage());
                }
            } catch (IllegalArgumentException e) {
                out = "constructor REJECT(" + e.getMessage() + ")";
            }
            System.out.printf("%-12s | %s%n", lit, out.length() > 220 ? out.substring(0, 220) + "..." : out);
        }
    }
}
