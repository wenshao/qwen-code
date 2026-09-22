package com.alibaba.qwen.code.runtimebroker;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONWriter;
import java.math.BigDecimal;
import java.util.Map;

/** How many characters does the writer emit for a BigDecimal with a huge exponent? */
public class ExpandProbe {
    public static void main(String[] a) {
        for (String v : new String[] {"1E-100000", "1E+100000"}) {
            Map<String, Object> m = Map.of("n", new BigDecimal(v));
            int head = JSON.toJSONString(m, JSONWriter.Feature.WriteNulls).length();
            int patched = JSON.toJSONString(m, JSONWriter.Feature.WriteNulls, JSONWriter.Feature.WriteBigDecimalAsPlain).length();
            System.out.printf("BigDecimal %-10s  66d1aedb writer: %6d chars   patched writer: %6d chars%n", v, head, patched);
        }
    }
}
