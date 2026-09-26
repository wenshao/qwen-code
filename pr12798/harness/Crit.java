import com.alibaba.fastjson2.*;
import java.math.*;
import java.util.*;
public class Crit {
    static String rt(BigDecimal v) {
        Map<String,Object> m = new LinkedHashMap<>(); m.put("x", v);
        String json = JSON.toJSONString(m, JSONWriter.Feature.WriteNulls, JSONWriter.Feature.WriteBigDecimalAsPlain);
        try { Object x = JSON.parseObject(json, JSONReader.Feature.DisableReferenceDetect).get("x");
              BigDecimal b = new BigDecimal(x.toString());
              return (b.compareTo(v)==0 ? "OK" : "WRONG") ;
        } catch (Throwable t) { return "FAIL(" + t.getMessage().replaceAll("[^a-z ]","").trim() + ")"; }
    }
    public static void main(String[] a) {
        System.out.println("fastjson2 " + JSON.VERSION);
        // k leading fractional zeros, then m significant digits: scale = k + m
        int[][] cases = {{0,2048},{0,2049},{1,2048},{1,2047},{2048,1},{2048,2},{3000,1},{3000,2048},{3000,2049},{10000,5},{32766,1},{32767,1},{40000,1},{65536,1},{65537,2048},{1,2049}};
        for (int[] c : cases) {
            BigDecimal v = new BigDecimal("0." + "0".repeat(c[0]) + "7".repeat(c[1]));
            System.out.printf("zeros=%-6d sig=%-5d scale=%-6d precision=%-5d -> %s%n", c[0], c[1], v.scale(), v.precision(), rt(v));
        }
        // integer part + fraction
        for (int[] c : new int[][]{{1,2048},{1,2049},{3000,2048},{3000,2049}}) {
            BigDecimal v = new BigDecimal("5".repeat(c[0]) + "." + "7".repeat(c[1]));
            System.out.printf("int=%-5d frac=%-5d scale=%-6d -> %s%n", c[0], c[1], v.scale(), rt(v));
        }
        // trailing zeros
        for (int t : new int[]{2047, 2048}) {
            BigDecimal v = new BigDecimal("0.5" + "0".repeat(t));
            System.out.printf("0.5 + %d trailing zeros scale=%d -> %s%n", t, v.scale(), rt(v));
        }
        for (String e : new String[]{"1E-300","1E-307","1E-308","1E-323","1E-324","1E-340","1E-1000","1E-1023","1E-1024","1E-2047"}) {
            try { Object x = JSON.parseObject("{\"x\":" + e + "}", JSONReader.Feature.DisableReferenceDetect).get("x");
                  System.out.printf("parse %-8s -> %s %s%n", e, x.getClass().getSimpleName(), x instanceof BigDecimal d ? "scale="+d.scale() : x);
            } catch (Throwable t) { System.out.printf("parse %-8s -> THROW %s%n", e, t.getMessage()); }
        }
    }
}
