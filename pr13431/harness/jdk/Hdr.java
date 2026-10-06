import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
public class Hdr {
  public static void main(String[] a) throws Exception {
    HttpServer s = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    s.createContext("/", x -> { byte[] b = "{}".getBytes();
      x.getResponseHeaders().set("Content-Type", "application/json");
      x.sendResponseHeaders(200, b.length); x.getResponseBody().write(b); x.close(); });
    s.start();
    System.out.println("PORT " + s.getAddress().getPort());
  }
}
