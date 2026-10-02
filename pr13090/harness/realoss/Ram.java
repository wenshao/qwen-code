import com.aliyuncs.*;
import com.aliyuncs.http.*;
import com.aliyuncs.profile.*;
import java.nio.file.*;
import java.nio.file.attribute.PosixFilePermissions;
import java.util.regex.*;

/**
 * Temporary delete-denied RAM identity for the PR #13090 O4 OSS gate. Never prints key material.
 *   create <user> <policy> <bucket> <envFile>   user + custom policy (versioning/ACL read, DeleteObject denied) + AK
 *   status <user> <policy>                      existence of user / policy / access keys
 *   delete <user> <policy>                      delete AKs, detach + delete policy, delete user
 */
public class Ram {
  static IAcsClient client;
  public static void main(String[] a) throws Exception {
    String[] c = Creds.read();
    client = new DefaultAcsClient(DefaultProfile.getProfile("cn-hangzhou", c[0], c[1]));
    switch (a[0]) {
      case "create" -> create(a[1], a[2], a[3], Path.of(a[4]));
      case "status" -> status(a[1], a[2]);
      case "delete" -> delete(a[1], a[2]);
      default -> throw new IllegalArgumentException(a[0]);
    }
  }
  static String call(String action, String... kv) throws Exception {
    CommonRequest r = new CommonRequest();
    r.setSysMethod(MethodType.POST);
    r.setSysProtocol(ProtocolType.HTTPS);
    r.setSysDomain("ram.aliyuncs.com");
    r.setSysVersion("2015-05-01");
    r.setSysAction(action);
    for (int i = 0; i < kv.length; i += 2) r.putQueryParameter(kv[i], kv[i + 1]);
    return client.getCommonResponse(r).getData();
  }
  static String field(String json, String name) {
    Matcher m = Pattern.compile("\"" + name + "\"\\s*:\\s*\"([^\"]*)\"").matcher(json);
    return m.find() ? m.group(1) : null;
  }
  static void create(String user, String policy, String bucket, Path env) throws Exception {
    if (!bucket.matches("qwen-pr13090-o4-test-[0-9a-f]{6}")) throw new IllegalArgumentException("unexpected bucket");
    call("CreateUser", "UserName", user, "Comments", "qwen-code PR 13090 O4 OSS gate; delete-denied; temporary");
    System.out.println("created user " + user);
    String doc = "{\"Version\":\"1\",\"Statement\":["
        + "{\"Effect\":\"Allow\",\"Action\":[\"oss:GetBucketVersioning\",\"oss:GetBucketAcl\"],\"Resource\":[\"acs:oss:*:*:" + bucket + "\"]},"
        + "{\"Effect\":\"Deny\",\"Action\":[\"oss:DeleteObject\"],\"Resource\":[\"acs:oss:*:*:" + bucket + "/*\"]}]}";
    call("CreatePolicy", "PolicyName", policy, "PolicyDocument", doc, "Description", "PR 13090 O4 gate: bucket versioning/ACL read, DeleteObject denied");
    System.out.println("created policy " + policy + " " + doc.replace(bucket, "<bucket>"));
    call("AttachPolicyToUser", "PolicyType", "Custom", "PolicyName", policy, "UserName", user);
    System.out.println("attached policy");
    String ak = call("CreateAccessKey", "UserName", user);
    String id = field(ak, "AccessKeyId"), secret = field(ak, "AccessKeySecret");
    if (id == null || secret == null) throw new IllegalStateException("access key not returned");
    Files.deleteIfExists(env);
    Files.createFile(env, PosixFilePermissions.asFileAttribute(PosixFilePermissions.fromString("rw-------")));
    Files.writeString(env, "OSS_DELETE_DENIED_ACCESS_KEY_ID=" + id + "\nOSS_DELETE_DENIED_ACCESS_KEY_SECRET=" + secret + "\n");
    System.out.println("created access key (written to 0600 env file, id length " + id.length() + ")");
  }
  static void status(String user, String policy) throws Exception {
    try { call("GetUser", "UserName", user); System.out.println("user exists"); }
    catch (com.aliyuncs.exceptions.ClientException e) { System.out.println("user: " + e.getErrCode()); }
    try { call("GetPolicy", "PolicyType", "Custom", "PolicyName", policy); System.out.println("policy exists"); }
    catch (com.aliyuncs.exceptions.ClientException e) { System.out.println("policy: " + e.getErrCode()); }
    try {
      String keys = call("ListAccessKeys", "UserName", user);
      Matcher m = Pattern.compile("\"AccessKeyId\"").matcher(keys); int n = 0; while (m.find()) n++;
      System.out.println("access keys: " + n);
    } catch (com.aliyuncs.exceptions.ClientException e) { System.out.println("access keys: " + e.getErrCode()); }
  }
  static void delete(String user, String policy) throws Exception {
    try {
      String keys = call("ListAccessKeys", "UserName", user);
      Matcher m = Pattern.compile("\"AccessKeyId\"\\s*:\\s*\"([^\"]+)\"").matcher(keys);
      while (m.find()) { call("DeleteAccessKey", "UserName", user, "UserAccessKeyId", m.group(1)); System.out.println("deleted access key"); }
    } catch (com.aliyuncs.exceptions.ClientException e) { System.out.println("list keys: " + e.getErrCode()); }
    try { call("DetachPolicyFromUser", "PolicyType", "Custom", "PolicyName", policy, "UserName", user); System.out.println("detached policy"); }
    catch (com.aliyuncs.exceptions.ClientException e) { System.out.println("detach: " + e.getErrCode()); }
    try { call("DeletePolicy", "PolicyName", policy); System.out.println("deleted policy"); }
    catch (com.aliyuncs.exceptions.ClientException e) { System.out.println("delete policy: " + e.getErrCode()); }
    try { call("DeleteUser", "UserName", user); System.out.println("deleted user"); }
    catch (com.aliyuncs.exceptions.ClientException e) { System.out.println("delete user: " + e.getErrCode()); }
    status(user, policy);
  }
}
