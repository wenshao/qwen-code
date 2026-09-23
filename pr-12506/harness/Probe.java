import java.net.URI;
import java.net.http.*;
import java.time.Duration;
public class Probe {
  public static void main(String[] a) throws Exception {
    String url = a[0], token = a[1];
    String body = "{\"protocolVersion\":2,\"provisionRequestId\":\"prov-1\",\"tenantId\":\"tenant-1\",\"workspaceId\":\"ws-1\",\"workspaceGeneration\":\"gen-1\",\"workspaceCwd\":\"/workspace/project\",\"capabilityDigest\":\"sha256:" + "a".repeat(64) + "\",\"isolationClass\":\"workspace\"}";
    for (HttpClient.Version v : new HttpClient.Version[]{HttpClient.Version.HTTP_2, HttpClient.Version.HTTP_1_1}) {
      HttpClient c = HttpClient.newBuilder().version(v).connectTimeout(Duration.ofSeconds(3)).build();
      HttpRequest r = HttpRequest.newBuilder(URI.create(url + "/internal/managed-runtime/v2/attest"))
        .timeout(Duration.ofSeconds(5))
        .header("Authorization", "Bearer " + token).header("Cache-Control", "no-store").header("Content-Type", "application/json")
        .header("X-Qwen-Managed-Lease-Id", "lease-1").header("X-Qwen-Managed-Lease-Epoch", "7")
        .POST(HttpRequest.BodyPublishers.ofString(body)).build();
      HttpResponse<String> res = c.send(r, HttpResponse.BodyHandlers.ofString());
      System.out.println("JDK " + System.getProperty("java.version") + " client=" + v + " wire=" + res.version() + " status=" + res.statusCode()
        + " cache-control=" + res.headers().firstValue("cache-control").orElse("-") + " body=" + res.body());
      HttpRequest g = HttpRequest.newBuilder(URI.create(url + "/internal/managed-runtime/v2/tools")).GET().build();
      HttpResponse<String> gr = c.send(g, HttpResponse.BodyHandlers.ofString());
      System.out.println("JDK client=" + v + " GET /internal/managed-runtime/v2/tools status=" + gr.statusCode() + " cache-control=" + gr.headers().firstValue("cache-control").orElse("-"));
    }
  }
}
