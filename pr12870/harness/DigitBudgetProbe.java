import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONReader;
import com.alibaba.fastjson2.JSONWriter;
import java.math.BigDecimal;
import java.util.Map;
public class DigitBudgetProbe {
  static String rt(String literal) {
    String json = "{\"v\":" + literal + "}";
    try { Object v = JSON.parseObject(json, JSONReader.Feature.DisableReferenceDetect).get("v"); return "OK " + v.getClass().getSimpleName(); }
    catch (RuntimeException e) { return "FAIL " + e.getMessage(); }
  }
  public static void main(String[] a) {
    // integer part / fraction part split, plain literals as written by WriteBigDecimalAsPlain
    int[][] cases = {{10000,0},{10001,0},{9999,1},{7952,2048},{7953,2048},{9000,2048},{1,9999},{1,10000},{1,20000},{5000,5000},{5000,5001},{0,2049}};
    for (int[] c : cases) {
      String lit = (c[0]==0 ? "0" : "9".repeat(c[0])) + (c[1] > 0 ? "." + "9".repeat(c[1]) : "");
      System.out.printf("int=%5d frac=%5d -> %s%n", c[0], c[1], rt(lit));
    }
    // what does WriteBigDecimalAsPlain emit for tiny values with large positive scale?
    BigDecimal tiny = new BigDecimal("1E-2048");
    String plain = JSON.toJSONString(Map.of("v", tiny), JSONWriter.Feature.WriteBigDecimalAsPlain);
    System.out.println("1E-2048 plain len=" + plain.length() + " -> " + rt(plain.substring(5, plain.length()-1)));
  }
}
