import com.aliyuncs.*;
import com.aliyuncs.http.*;
import com.aliyuncs.profile.*;
/** Read-only STS GetCallerIdentity; prints only the identity type, never ids. */
public class Who {
  public static void main(String[] a) throws Exception {
    String[] c = Creds.read();
    DefaultProfile p = DefaultProfile.getProfile("cn-hangzhou", c[0], c[1]);
    IAcsClient client = new DefaultAcsClient(p);
    CommonRequest r = new CommonRequest();
    r.setSysMethod(MethodType.POST); r.setSysProtocol(ProtocolType.HTTPS);
    r.setSysDomain("sts.cn-hangzhou.aliyuncs.com");
    r.setSysVersion("2015-04-01");
    r.setSysAction("GetCallerIdentity");
    String body = client.getCommonResponse(r).getData();
    var m = java.util.regex.Pattern.compile("\"IdentityType\"\\s*:\\s*\"([^\"]+)\"").matcher(body);
    System.out.println("IdentityType=" + (m.find() ? m.group(1) : "?"));
    var arn = java.util.regex.Pattern.compile("\"Arn\"\\s*:\\s*\"acs:ram::[0-9]+:([a-z-]+)").matcher(body);
    System.out.println("ArnKind=" + (arn.find() ? arn.group(1) : "?"));
  }
}
