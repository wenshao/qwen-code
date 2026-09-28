import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONReader;
import com.alibaba.fastjson2.JSONWriter;
import java.math.BigDecimal;
import java.util.Map;
public class WireProbe {
  public static void main(String[] a) {
    for (String lit : new String[]{"9".repeat(8000)+"E+2047", "9".repeat(7953)+"E+2047", "9".repeat(7952)+"E+2047", "1"+"0".repeat(9998)+"E+2047", "123.456E+2047", "9".repeat(9000)+".5E+2047"}) {
      String json = "{\"v\":" + lit + "}";
      Map<String,Object> m = JSON.parseObject(json, JSONReader.Feature.DisableReferenceDetect, JSONReader.Feature.UseBigDecimalForDoubles, JSONReader.Feature.UseBigDecimalForFloats);
      Object v = m.get("v");
      String d = v instanceof BigDecimal b ? "BigDecimal(scale="+b.scale()+",precision="+b.precision()+")" : v.getClass().getSimpleName();
      String plain = JSON.toJSONString(m, JSONWriter.Feature.WriteNulls, JSONWriter.Feature.WriteBigDecimalAsPlain);
      String rt; try { JSON.parseObject(plain, JSONReader.Feature.DisableReferenceDetect); rt = "READ-OK"; } catch (RuntimeException e) { rt = "READ-FAIL " + e.getMessage(); }
      System.out.println("wire literal len="+lit.length()+" ("+lit.substring(0,6)+"...E+2047) -> "+d+" -> plain len="+plain.length()+" -> "+rt);
    }
  }
}
