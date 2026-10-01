import com.aliyun.oss.*;
import com.aliyun.oss.model.*;
import java.io.*;
import java.util.*;

/**
 * Real Aliyun OSS admin helper for the PR 13138 rig (runs inside the VM). Credentials come from the environment
 * (OSS_ACCESS_KEY_ID / OSS_ACCESS_KEY_SECRET) and are never printed.
 *   create <bucket>          private, unversioned, 1-day expiry lifecycle, purpose tags
 *   info <bucket>            object count and bytes per top-level prefix
 *   corrupt <bucket> <key>   flip one bit in the middle of the object (same length)
 *   delete <bucket> <key>    delete one object
 *   restore <bucket> <key> <file>  put the saved original bytes back
 *   save <bucket> <key> <file>     save the object's bytes to a local file
 *   cleanup <bucket>         delete every object version, then the bucket
 */
public class OssAdmin {
  static final String ENDPOINT = "https://oss-cn-hangzhou.aliyuncs.com";

  public static void main(String[] a) throws Exception {
    OSS oss = new OSSClientBuilder().build(ENDPOINT, System.getenv("OSS_ACCESS_KEY_ID"), System.getenv("OSS_ACCESS_KEY_SECRET"));
    try {
      switch (a[0]) {
        case "create" -> {
          CreateBucketRequest r = new CreateBucketRequest(a[1]);
          r.setCannedACL(CannedAccessControlList.Private);
          r.setStorageClass(StorageClass.Standard);
          oss.createBucket(r);
          SetBucketLifecycleRequest lr = new SetBucketLifecycleRequest(a[1]);
          lr.AddLifecycleRule(new LifecycleRule("expire-1d", "", LifecycleRule.RuleStatus.Enabled, 1));
          oss.setBucketLifecycle(lr);
          Map<String, String> tags = new HashMap<>();
          tags.put("purpose", "qwen-code-pr13138-verification");
          tags.put("delete-after", "2026-10-02");
          oss.setBucketTagging(a[1], tags);
          System.out.println("created acl=" + oss.getBucketAcl(a[1]).getCannedACL() + " versioning=" + oss.getBucketVersioning(a[1]).getStatus());
        }
        case "info" -> {
          long n = 0, bytes = 0; String marker = null;
          do {
            ObjectListing l = oss.listObjects(new ListObjectsRequest(a[1]).withMarker(marker).withMaxKeys(1000));
            for (OSSObjectSummary s : l.getObjectSummaries()) { n++; bytes += s.getSize(); }
            marker = l.isTruncated() ? l.getNextMarker() : null;
          } while (marker != null);
          System.out.println("objects=" + n + " bytes=" + bytes);
        }
        case "corrupt" -> {
          byte[] b;
          try (InputStream s = oss.getObject(a[1], a[2]).getObjectContent()) { b = s.readAllBytes(); }
          b[b.length / 2] ^= 0x01;
          oss.putObject(a[1], a[2], new ByteArrayInputStream(b));
          System.out.println("flipped one bit (" + b.length + " B)");
        }
        case "delete" -> { oss.deleteObject(a[1], a[2]); System.out.println("deleted"); }
        case "save" -> {
          try (InputStream s = oss.getObject(a[1], a[2]).getObjectContent(); OutputStream o = new FileOutputStream(a[3])) { s.transferTo(o); }
          System.out.println("saved");
        }
        case "restore" -> { oss.putObject(a[1], a[2], new File(a[3])); System.out.println("restored"); }
        case "cleanup" -> {
          int deleted = 0; String km = null, vm = null; boolean t;
          do {
            VersionListing v = oss.listVersions(new ListVersionsRequest().withBucketName(a[1]).withKeyMarker(km).withVersionIdMarker(vm).withMaxResults(1000));
            List<DeleteVersionsRequest.KeyVersion> batch = new ArrayList<>();
            for (OSSVersionSummary s : v.getVersionSummaries()) batch.add(new DeleteVersionsRequest.KeyVersion(s.getKey(), s.getVersionId()));
            if (!batch.isEmpty()) { oss.deleteVersions(new DeleteVersionsRequest(a[1]).withKeys(batch)); deleted += batch.size(); }
            t = v.isTruncated(); km = v.getNextKeyMarker(); vm = v.getNextVersionIdMarker();
          } while (t);
          oss.deleteBucket(a[1]);
          System.out.println("deleted " + deleted + " object versions and the bucket");
        }
        default -> throw new IllegalArgumentException(a[0]);
      }
    } finally {
      oss.shutdown();
    }
  }
}
