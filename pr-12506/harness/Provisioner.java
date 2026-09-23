import java.io.*;
import java.net.URI;
import java.net.http.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.concurrent.TimeUnit;
// Java-side provisioner model: spawn worker, write boot on stdin, close stdin, read the ready line,
// attest over loopback with the JDK HttpClient, then Process.destroy() (SIGTERM) and check exit code.
public class Provisioner {
  public static void main(String[] a) throws Exception {
    String entry = a[0];
    byte[] boot = Files.readAllBytes(Paths.get("boot.json"));
    long t0 = System.nanoTime();
    Process p = new ProcessBuilder("node", entry, "managed-runtime-worker").redirectError(ProcessBuilder.Redirect.DISCARD).start();
    try (OutputStream in = p.getOutputStream()) { in.write(boot); }
    BufferedReader out = new BufferedReader(new InputStreamReader(p.getInputStream(), StandardCharsets.UTF_8));
    String ready = out.readLine();
    long readyMs = (System.nanoTime() - t0) / 1_000_000;
    String url = ready.replaceAll(".*\"url\":\"([^\"]+)\".*", "$1");
    String body = "{\"protocolVersion\":2,\"provisionRequestId\":\"prov-1\",\"tenantId\":\"tenant-1\",\"workspaceId\":\"ws-1\",\"workspaceGeneration\":\"gen-1\",\"workspaceCwd\":\"/workspace/project\",\"capabilityDigest\":\"sha256:" + "a".repeat(64) + "\",\"isolationClass\":\"workspace\"}";
    HttpClient c = HttpClient.newHttpClient();
    HttpResponse<String> r = c.send(HttpRequest.newBuilder(URI.create(url + "/internal/managed-runtime/v2/attest"))
        .header("Authorization", "Bearer t").header("Cache-Control", "no-store").header("Content-Type", "application/json")
        .header("X-Qwen-Managed-Lease-Id", "lease-1").header("X-Qwen-Managed-Lease-Epoch", "7")
        .POST(HttpRequest.BodyPublishers.ofString(body)).build(), HttpResponse.BodyHandlers.ofString());
    HttpResponse<String> stale = c.send(HttpRequest.newBuilder(URI.create(url + "/internal/managed-runtime/v2/attest"))
        .header("Authorization", "Bearer t").header("Cache-Control", "no-store").header("Content-Type", "application/json")
        .header("X-Qwen-Managed-Lease-Id", "lease-1").header("X-Qwen-Managed-Lease-Epoch", "6")
        .POST(HttpRequest.BodyPublishers.ofString(body)).build(), HttpResponse.BodyHandlers.ofString());
    p.destroy();
    boolean done = p.waitFor(5, TimeUnit.SECONDS);
    System.out.println("java=" + System.getProperty("java.version") + " readyMs=" + readyMs + " ready=" + ready
      + "\n  attest=" + r.statusCode() + " wire=" + r.version() + " cc=" + r.headers().firstValue("cache-control").orElse("-")
      + " staleEpoch=" + stale.statusCode() + " " + stale.body()
      + "\n  destroy(): exited=" + done + " exitValue=" + (done ? p.exitValue() : -1));
  }
}
