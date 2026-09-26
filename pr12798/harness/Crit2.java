import com.alibaba.fastjson2.*;
import java.math.*;
import java.util.*;
public class Crit2 {
    static Object rtv(BigDecimal v) {
        Map<String,Object> m = new LinkedHashMap<>(); m.put("x", v);
        String json = JSON.toJSONString(m, JSONWriter.Feature.WriteNulls, JSONWriter.Feature.WriteBigDecimalAsPlain);
        try { return JSON.parseObject(json, JSONReader.Feature.DisableReferenceDetect).get("x"); }
        catch (Throwable t) { return "FAIL"; }
    }
    public static void main(String[] a) {
        System.out.println("fastjson2 " + JSON.VERSION);
        for (int sig = 1; sig <= 15; sig++) {
            BigDecimal v = new BigDecimal("0." + "0".repeat(2100) + "7".repeat(sig));
            Object r = rtv(v);
            System.out.printf("zeros=2100 sig=%d -> %s%n", sig, r instanceof BigDecimal b ? (b.compareTo(v)==0?"OK":"WRONG") : r);
        }
        for (String s : new String[]{"1E-32767","1E-32768","7E-40000","1E-65537","12345E-40000"}) {
            BigDecimal v = new BigDecimal(s);
            Object r = rtv(v);
            String shown = r instanceof BigDecimal b ? b.toString() + " (scale " + b.scale() + ")" : String.valueOf(r);
            System.out.printf("wrote %-14s read back %s%n", s, shown);
        }
    }
}
