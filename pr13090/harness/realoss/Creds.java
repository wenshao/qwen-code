import java.nio.file.*;
import java.util.*;
final class Creds {
  static String[] read() throws Exception {
    String t = Files.readString(Path.of(System.getProperty("user.home"), "Aliyun", "README.md"));
    String id = null, secret = null;
    for (String line : t.split("\n")) {
      String[] p = line.trim().split("\\s+");
      if (p.length == 2 && p[0].equals("accessKeyId")) id = p[1];
      if (p.length == 2 && p[0].equals("accessKeySecret")) secret = p[1];
    }
    if (id == null || secret == null) throw new IllegalStateException("credentials not found");
    return new String[] { id, secret };
  }
}
