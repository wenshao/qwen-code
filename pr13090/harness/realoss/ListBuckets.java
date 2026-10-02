import com.aliyun.oss.*;
import com.aliyun.oss.model.*;
public class ListBuckets {
  public static void main(String[] a) throws Exception {
    String[] c = Creds.read();
    OSS oss = new OSSClientBuilder().build("https://oss-cn-hangzhou.aliyuncs.com", c[0], c[1]);
    try {
      for (Bucket b : oss.listBuckets()) System.out.println(b.getName() + " " + b.getLocation() + " " + b.getStorageClass() + " created " + b.getCreationDate());
      System.out.println("(end of list)");
    } finally { oss.shutdown(); }
  }
}
