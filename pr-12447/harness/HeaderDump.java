import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
public final class HeaderDump {
    public static void main(String[] a) throws Exception {
        HttpClient c = HttpClient.newHttpClient();
        System.out.println("default version = " + c.version());
        HttpResponse<String> r = c.send(HttpRequest.newBuilder(URI.create(a[0]))
                .POST(HttpRequest.BodyPublishers.ofString("{}")).header("content-type", "application/json").build(),
                HttpResponse.BodyHandlers.ofString());
        System.out.println(r.statusCode() + " " + r.version());
    }
}
