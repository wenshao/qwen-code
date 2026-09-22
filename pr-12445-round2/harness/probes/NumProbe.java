package com.alibaba.qwen.code.runtimebroker;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONReader;
import com.alibaba.fastjson2.JSONWriter;
import java.math.BigDecimal;
import java.util.Map;

public class NumProbe {
    public static void main(String[] a) {
        String[] texts = {"{\"n\":1.2345678901234567890123E+30}", "{\"n\":1.34928694268557797E+46}", "{\"n\":1E+400}", "{\"n\":12345678901234567890.5}"};
        JSONReader.Feature[][] combos = {
            {}, {JSONReader.Feature.UseBigDecimalForDoubles}, {JSONReader.Feature.UseBigDecimalForFloats},
            {JSONReader.Feature.UseBigDecimalForDoubles, JSONReader.Feature.UseBigDecimalForFloats}};
        String[] names = {"default", "UseBigDecimalForDoubles", "UseBigDecimalForFloats", "both"};
        for (String t : texts) {
            for (int i = 0; i < combos.length; i++) {
                Object v = JSON.parseObject(t, combos[i]).get("n");
                System.out.printf("%-40s %-26s -> %s %s%n", t, names[i], v.getClass().getSimpleName(), v);
            }
            Object v = JSON.parseObject(t, Map.class, JSONReader.Feature.UseBigDecimalForDoubles).get("n");
            System.out.printf("%-40s %-26s -> %s %s%n", t, "Map.class+Doubles", v.getClass().getSimpleName(), v);
        }
        System.out.println("write BigDecimal 1.2345678901234567890123E+30 -> " + JSON.toJSONString(Map.of("n", new BigDecimal("1.2345678901234567890123E+30")), JSONWriter.Feature.WriteNulls));
    }
}
