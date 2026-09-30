import com.aliyun.oss.*;
import com.aliyun.oss.model.*;
import java.io.*;
import java.net.URI;
import java.net.http.*;
import java.security.MessageDigest;
import java.util.*;

/**
 * Admin helper for the real-OSS verification round. Credentials are read from
 * ~/Aliyun/README.md by Creds and never printed.
 *   create <bucket>             private, unversioned, 1-day expiry lifecycle, tags
 *   info <bucket>               versioning status, ACL, object count and bytes
 *   verify <bucket>             stdin: "<key> <sha256>" per line in stream order;
 *                               prints per-object mismatches and the stream sha256/length
 *   anon <bucket> <key>         anonymous GET status (expect 403)
 *   corrupt <bucket> <key>      overwrite one object with different bytes (same length)
 *   versioning <bucket> <Enabled|Suspended>
 *   cleanup <bucket>            delete every object version, then the bucket
 */
public class RealOss {
  static final String ENDPOINT = "https://oss-cn-hangzhou.aliyuncs.com";

  public static void main(String[] a) throws Exception {
    String[] c = Creds.read();
    OSS oss = new OSSClientBuilder().build(ENDPOINT, c[0], c[1]);
    try {
      switch (a[0]) {
        case "create" -> create(oss, a[1]);
        case "info" -> info(oss, a[1]);
        case "verify" -> verify(oss, a[1]);
        case "anon" -> anon(a[1], a[2]);
        case "corrupt" -> corrupt(oss, a[1], a[2]);
        case "versioning" -> {
          oss.setBucketVersioning(new SetBucketVersioningRequest(a[1], new BucketVersioningConfiguration(a[2])));
          System.out.println("versioning " + oss.getBucketVersioning(a[1]).getStatus());
        }
        case "cleanup" -> cleanup(oss, a[1]);
        default -> throw new IllegalArgumentException(a[0]);
      }
    } finally {
      oss.shutdown();
    }
  }

  static void create(OSS oss, String bucket) {
    CreateBucketRequest r = new CreateBucketRequest(bucket);
    r.setCannedACL(CannedAccessControlList.Private);
    r.setStorageClass(StorageClass.Standard);
    oss.createBucket(r);
    SetBucketLifecycleRequest lr = new SetBucketLifecycleRequest(bucket);
    lr.AddLifecycleRule(new LifecycleRule("expire-1d", "", LifecycleRule.RuleStatus.Enabled, 1));
    oss.setBucketLifecycle(lr);
    Map<String, String> tags = new HashMap<>();
    tags.put("purpose", "qwen-code-pr12894-verification");
    tags.put("delete-after", "2026-10-01");
    oss.setBucketTagging(bucket, tags);
    System.out.println("created " + bucket + " acl=" + oss.getBucketAcl(bucket).getCannedACL()
        + " versioning=" + oss.getBucketVersioning(bucket).getStatus());
  }

  static void info(OSS oss, String bucket) {
    long n = 0, bytes = 0;
    String marker = null;
    Map<String, long[]> byPrefix = new TreeMap<>();
    do {
      ObjectListing l = oss.listObjects(new ListObjectsRequest(bucket).withMarker(marker).withMaxKeys(1000));
      for (OSSObjectSummary s : l.getObjectSummaries()) {
        n++;
        bytes += s.getSize();
        String p = s.getKey().contains("/") ? s.getKey().substring(0, s.getKey().indexOf('/')) : "(root)";
        long[] v = byPrefix.computeIfAbsent(p, k -> new long[2]);
        v[0]++;
        v[1] += s.getSize();
      }
      marker = l.isTruncated() ? l.getNextMarker() : null;
    } while (marker != null);
    System.out.println("versioning=" + oss.getBucketVersioning(bucket).getStatus()
        + " acl=" + oss.getBucketAcl(bucket).getCannedACL() + " objects=" + n + " bytes=" + bytes);
    byPrefix.forEach((k, v) -> System.out.println("  " + k + "/ objects=" + v[0] + " bytes=" + v[1]));
  }

  static void verify(OSS oss, String bucket) throws Exception {
    BufferedReader in = new BufferedReader(new InputStreamReader(System.in));
    MessageDigest stream = MessageDigest.getInstance("SHA-256");
    long length = 0;
    int objects = 0, bad = 0;
    for (String line; (line = in.readLine()) != null;) {
      if (line.isBlank()) continue;
      String[] p = line.trim().split("\\s+");
      MessageDigest one = MessageDigest.getInstance("SHA-256");
      try (InputStream s = oss.getObject(bucket, p[0]).getObjectContent()) {
        byte[] buf = new byte[1 << 16];
        for (int r; (r = s.read(buf)) > 0;) {
          one.update(buf, 0, r);
          stream.update(buf, 0, r);
          length += r;
        }
      }
      objects++;
      String got = HexFormat.of().formatHex(one.digest());
      if (!got.equals(p[1])) {
        bad++;
        System.out.println("MISMATCH " + p[0]);
      }
    }
    System.out.println("objects=" + objects + " mismatches=" + bad + " length=" + length
        + " sha256=" + HexFormat.of().formatHex(stream.digest()));
  }

  static void anon(String bucket, String key) throws Exception {
    HttpResponse<Void> r = HttpClient.newHttpClient().send(HttpRequest.newBuilder(
        URI.create("https://" + bucket + ".oss-cn-hangzhou.aliyuncs.com/" + key)).GET().build(),
        HttpResponse.BodyHandlers.discarding());
    System.out.println("anonymous GET -> " + r.statusCode());
  }

  static void corrupt(OSS oss, String bucket, String key) throws Exception {
    ObjectMetadata meta = oss.getObjectMetadata(bucket, key);
    byte[] bytes;
    try (InputStream s = oss.getObject(bucket, key).getObjectContent()) {
      bytes = s.readAllBytes();
    }
    bytes[bytes.length / 2] ^= 0x01;
    oss.putObject(bucket, key, new ByteArrayInputStream(bytes));
    System.out.println("flipped one bit in " + key + " (" + meta.getContentLength() + " B)");
  }

  static void cleanup(OSS oss, String bucket) {
    int deleted = 0;
    String keyMarker = null, versionMarker = null;
    boolean truncated;
    do {
      VersionListing v = oss.listVersions(new ListVersionsRequest().withBucketName(bucket)
          .withKeyMarker(keyMarker).withVersionIdMarker(versionMarker).withMaxResults(1000));
      List<DeleteVersionsRequest.KeyVersion> batch = new ArrayList<>();
      for (OSSVersionSummary s : v.getVersionSummaries()) {
        batch.add(new DeleteVersionsRequest.KeyVersion(s.getKey(), s.getVersionId()));
      }
      if (!batch.isEmpty()) {
        oss.deleteVersions(new DeleteVersionsRequest(bucket).withKeys(batch));
        deleted += batch.size();
      }
      truncated = v.isTruncated();
      keyMarker = v.getNextKeyMarker();
      versionMarker = v.getNextVersionIdMarker();
    } while (truncated);
    oss.deleteBucket(bucket);
    System.out.println("deleted " + deleted + " object versions and bucket " + bucket);
  }
}
