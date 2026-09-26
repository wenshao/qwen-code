import com.alibaba.fastjson2.*;
import java.math.*;
import java.util.*;

public class LibProbe {
    static String plainWrite(Object v) {
        Map<String,Object> m = new LinkedHashMap<>(); m.put("x", v);
        return JSON.toJSONString(m, JSONWriter.Feature.WriteNulls, JSONWriter.Feature.WriteBigDecimalAsPlain);
    }
    static String read(String json, JSONReader.Feature... f) {
        try {
            Object x = JSON.parseObject(json, f).get("x");
            String cls = x == null ? "null" : x.getClass().getSimpleName();
            String sc = x instanceof BigDecimal d ? " scale=" + d.scale() : "";
            return "OK " + cls + sc;
        } catch (Throwable t) {
            String m = String.valueOf(t.getMessage()); if (m.length() > 70) m = m.substring(0, 70) + "...";
            return "THROW " + t.getClass().getSimpleName() + ": " + m;
        }
    }
    static void rt(String label, BigDecimal v) {
        String json;
        try { json = plainWrite(v); } catch (Throwable t) { System.out.printf("%-34s write THROW %s%n", label, t.getClass().getSimpleName()); return; }
        String r = read(json, JSONReader.Feature.DisableReferenceDetect);
        boolean eq = false;
        try { Object x = JSON.parseObject(json, JSONReader.Feature.DisableReferenceDetect).get("x");
              eq = new BigDecimal(x.toString()).compareTo(v) == 0; } catch (Throwable t) {}
        System.out.printf("%-34s scale=%-7d len=%-8d read: %s  equal=%s%n", label, v.scale(), json.length(), r, eq);
    }
    public static void main(String[] a) {
        System.out.println("fastjson2 " + JSON.VERSION);
        System.out.println("== plain write (JDBC toJson) -> JDBC fromJson round trip ==");
        rt("0.1{2048}", new BigDecimal("0." + "1".repeat(2048)));
        rt("0.1{2049}", new BigDecimal("0." + "1".repeat(2049)));
        rt("9{5000}.1{2048}", new BigDecimal("9".repeat(5000) + "." + "1".repeat(2048)));
        rt("0.1 setScale(2049)", new BigDecimal("0.1").setScale(2049));
        rt("1E-2049 (scale 2049)", new BigDecimal("1E-2049"));
        rt("1E+400", new BigDecimal("1E+400"));
        rt("1E+2048", new BigDecimal("1E+2048"));
        rt("1E+5000", new BigDecimal("1E+5000"));
        rt("1E+100000", new BigDecimal("1E+100000"));
        rt("1E+1000000", new BigDecimal("1E+1000000"));
        System.out.println("== exponent literals through the parsers ==");
        for (String lit : new String[]{"1E-2048","1E-2049","1E-3000","1e-32767","1e-32768","1e-40000","0.1e-2048","1.5E+5000"}) {
            String j = "{\"x\":" + lit + "}";
            System.out.printf("%-12s JsonCodec(DisableRef): %-40s | +UseBigDecimalForDoubles: %s%n", lit,
                read(j, JSONReader.Feature.DisableReferenceDetect),
                read(j, JSONReader.Feature.DisableReferenceDetect, JSONReader.Feature.UseBigDecimalForDoubles, JSONReader.Feature.UseBigDecimalForFloats));
        }
        System.out.println("== plain literals through the parsers ==");
        for (int s : new int[]{2048, 2049}) {
            String j = "{\"x\":0." + "1".repeat(s) + "}";
            System.out.printf("plain scale %d  JsonCodec: %-40s | +UseBigDecimalForDoubles: %s%n", s,
                read(j, JSONReader.Feature.DisableReferenceDetect),
                read(j, JSONReader.Feature.DisableReferenceDetect, JSONReader.Feature.UseBigDecimalForDoubles, JSONReader.Feature.UseBigDecimalForFloats));
        }
    }
}
